"""DataUpdateCoordinator for the FRITZ!Box network integration."""

from __future__ import annotations

from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta
import logging
import time
from typing import Any
from xml.etree import ElementTree as ET

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .addresses import AddressNotes
from .api import FritzNetworkClient
from .const import (
    BACKOFF_AFTER_FAILURES,
    CONF_ADOPT_NAMES,
    CONF_CONSIDER_HOME,
    CONF_SCAN_INTERVAL,
    CONF_SHOW_VENDOR,
    CONF_SKIP_OFFLINE,
    DEFAULT_ADOPT_NAMES,
    DEFAULT_CONSIDER_HOME,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SHOW_VENDOR,
    DEFAULT_SKIP_OFFLINE,
    DOMAIN,
    EVENT_DEVICE_RENAMED,
    EVENT_DEVICE_ROAMED,
    EVENT_INTERNET_DISCONNECTED,
    EVENT_INTERNET_IP_CHANGED,
    EVENT_INTERNET_RECONNECTED,
    EVENT_NEW_DEVICE,
    FILTER_PROFILE_REFRESH_POLLS,
    FIRMWARE_REFRESH_POLLS,
    INTERNET_DETAIL_POLLS,
    INTERNET_EVENTS,
    INTERNET_HISTORY,
    INTERNET_NOISE_WARN_DB,
    MAX_BACKOFF_SECONDS,
    ROAM_CONFIRM_POLLS,
    WAN_OVERRIDE_SECONDS,
)
from .filters import select_hosts
from .history import DeviceHistory
from .latency import LatencyMonitor
from .models import (
    FirmwareInfo,
    Host,
    InternetInfo,
    MeshNode,
    MeshTopology,
    NetworkData,
    parse_firmware,
    parse_internet,
)
from .vendor import vendor_of

_LOGGER = logging.getLogger(__name__)

type FritzNetworkConfigEntry = ConfigEntry[FritzNetworkCoordinator]

_FETCH_ERRORS = (FritzConnectionException, OSError, ET.ParseError, ValueError, KeyError)

# the byte counters of the box are 32 bit on some models and wrap around
_COUNTER_WRAP = 2**32
# a rate beyond this (kbit/s) is a counter that jumped, not traffic
_MAX_RATE_KBIT = 10_000_000


class FritzNetworkCoordinator(DataUpdateCoordinator[NetworkData]):
    """Polls the host list and the mesh topology of the box."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: FritzNetworkConfigEntry,
        client: FritzNetworkClient,
        serial: str,
        can_write: bool,
        box_device_id: str,
        history: DeviceHistory | None = None,
    ) -> None:
        self._base_interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=self._base_interval),
        )
        self.client = client
        self.serial = serial
        self.can_write = can_write
        self.box_device_id = box_device_id
        self.history = history
        # what the user noted about the address space; set up with the entry
        self.addresses: AddressNotes | None = None
        self.latency: LatencyMonitor | None = None
        # Unfiltered host list: the options flow offers it for selection.
        self.all_hosts: dict[str, Host] = {}
        # None until the first poll: what the box lists then is not new.
        self._known_macs: set[str] | None = None
        # the access point each device is confirmed at, and one it was seen at since
        self._access_points: dict[str, str] = {}
        self._pending_roam: dict[str, tuple[str, int]] = {}
        self.last_active: dict[str, datetime] = {}
        self._failures = 0
        self.last_success: datetime | None = None
        # (mac, Host field) -> (value, monotonic deadline): see WAN_OVERRIDE_SECONDS
        self._overrides: dict[tuple[str, str], tuple[Any, float]] = {}
        # id -> name of the access profiles of the box, read now and then
        self.filter_profiles: dict[str, str] = {}
        self._polls = 0
        # the internet connection: the slow part of the last read, the byte counters of the poll
        # before, the throughput since then, the last hour of it and what happened to the line
        self._internet_slow: dict[str, Any] = {}
        self._internet_counters: tuple[float, int, int] | None = None
        self.internet_rate: tuple[float, float] | None = None
        # (value, monotonic deadline) of a guest Wi-Fi switch the box has not shown yet
        self._guest_override: tuple[bool, float] | None = None
        # the firmware offer of the box, asked for now and then
        self._firmware: FirmwareInfo | None = None
        # since when the noise margin of the DSL line has been below the limit
        self.internet_low_margin_since: datetime | None = None
        self.internet_samples: deque[tuple[float, float, float]] = deque(maxlen=INTERNET_HISTORY)
        self.internet_events: deque[dict[str, Any]] = deque(
            history.connection_events()[:INTERNET_EVENTS] if history else (), maxlen=INTERNET_EVENTS
        )
        # How long the last and the slowest poll took, shown in the diagnostics.
        self.last_fetch_seconds: float | None = None
        self.slowest_fetch_seconds: float = 0.0
        # Options at setup: removing a device only adds to the hidden list and
        # needs no reload (see __init__._async_update_listener).
        self.options_snapshot = dict(entry.options)

    @property
    def _options(self):
        return self.config_entry.options

    def _fetch_internet(self) -> tuple[dict[str, Any], dict[str, Any]] | None:
        """The internet connection; it must never fail the poll of the devices."""
        previous = self.data.internet if self.data else None
        try:
            details = not self._internet_slow or self._polls % INTERNET_DETAIL_POLLS == 0
            fast, slow = self.client.get_internet(details)
            uptime = int(fast.get("GetStatusInfo", {}).get("NewUptime", 0))
            # a new connection may have a new address: read it now, not at the next round
            if (
                not details
                and previous
                and previous.uptime is not None
                and uptime < previous.uptime
            ):
                slow = self.client.get_internet(True)[1]
        except (*_FETCH_ERRORS, TypeError) as err:
            _LOGGER.debug("Internet connection unavailable: %s", err)
            return None
        return fast, slow

    def _fetch_firmware(self) -> None:
        """The firmware offer, now and then; what was known stays if the box does not answer."""
        if self._polls % FIRMWARE_REFRESH_POLLS:
            return
        try:
            offer = parse_firmware(self.client.get_firmware())
        except (*_FETCH_ERRORS, TypeError) as err:
            _LOGGER.debug("Firmware offer unavailable: %s", err)
            return
        if offer is not None:
            self._firmware = offer

    def _fetch_guest_wifi(self) -> bool | None:
        try:
            return self.client.get_guest_wifi()
        except (*_FETCH_ERRORS, TypeError) as err:
            _LOGGER.debug("Guest Wi-Fi unavailable: %s", err)
            return None

    def _fetch(
        self,
    ) -> tuple[list[Host], MeshTopology | None, tuple[dict, dict] | None, bool | None]:
        hosts = self.client.get_hosts()
        try:
            mesh = self.client.get_mesh()
        except FritzAuthorizationError:
            raise
        except _FETCH_ERRORS as err:
            _LOGGER.debug("Mesh topology unavailable: %s", err)
            mesh = None
        if self.can_write and self._polls % FILTER_PROFILE_REFRESH_POLLS == 0:
            try:
                self.filter_profiles = self.client.get_filter_profiles()
            except FritzAuthorizationError:
                raise
            except _FETCH_ERRORS as err:
                _LOGGER.debug("Access profiles unavailable: %s", err)
        internet = self._fetch_internet()
        guest = self._fetch_guest_wifi()
        self._fetch_firmware()
        self._polls += 1
        return hosts, mesh, internet, guest

    async def _async_update_data(self) -> NetworkData:
        started = time.monotonic()
        try:
            hosts, mesh, wan, guest = await self.hass.async_add_executor_job(self._fetch)
        except (FritzAuthorizationError, FritzSecurityError) as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except _FETCH_ERRORS as err:
            self._register_failure()
            raise UpdateFailed(f"Error talking to the FRITZ!Box: {err}") from err

        self.last_fetch_seconds = round(time.monotonic() - started, 2)
        self.slowest_fetch_seconds = max(self.slowest_fetch_seconds, self.last_fetch_seconds)
        _LOGGER.debug("Poll took %.2f s for %d hosts", self.last_fetch_seconds, len(hosts))
        self._reset_failures()
        self.last_success = dt_util.utcnow()
        self.all_hosts = {h.mac: h for h in hosts}
        selected = self._apply_filters(hosts, mesh)
        self._fire_new_devices(selected)
        self._fire_roaming(selected, mesh)
        self._apply_overrides(selected)

        now = dt_util.utcnow()
        for host in selected.values():
            if host.active:
                self.last_active[host.mac] = now

        self._record_history(selected, mesh)
        self._remove_filtered_devices(selected)
        self._sync_names(selected)
        return NetworkData(
            hosts=selected,
            mesh=mesh,
            internet=self._update_internet(wan),
            guest_wifi=self._apply_guest_override(guest),
            firmware=self._firmware,
        )

    def _record_history(self, selected: dict[str, Host], mesh: MeshTopology | None) -> None:
        """Note online, signal and rate of every device for the sparklines."""
        if self.history is None:
            return
        now = dt_util.utcnow().timestamp()
        for host in selected.values():
            link = mesh.links.get(host.mac) if mesh else None
            rate = link.rate_download if link and link.rate_download else host.speed
            self.history.record(
                now,
                host.mac,
                self.is_connected(host),
                link.signal_dbm if link else None,
                rate or None,
            )
        if mesh:
            day = dt_util.as_local(dt_util.utcnow()).date().isoformat()
            for mac in selected:
                if counted := mesh.traffic.get(mac):
                    self.history.record_traffic(day, mac, *counted)
        self.history.prune(now)

    def _apply_guest_override(self, polled: bool | None) -> bool | None:
        """Show a guest Wi-Fi switch just made until the box shows it too."""
        if self._guest_override is None:
            return polled
        value, deadline = self._guest_override
        if polled is None or polled == value or time.monotonic() > deadline:
            self._guest_override = None
            return polled
        return value

    def _update_internet(self, wan: tuple[dict, dict] | None) -> InternetInfo | None:
        """The internet connection, its throughput since the poll before and what changed."""
        previous = self.data.internet if self.data else None
        if wan is None:
            return previous
        fast, slow = wan
        if slow:
            self._internet_slow = slow
        info = parse_internet(fast, self._internet_slow)
        if info is None:
            return previous
        reconnected = bool(
            previous
            and previous.uptime is not None
            and info.uptime is not None
            and info.uptime < previous.uptime
        )
        self._note_internet_changes(previous, info, reconnected)
        self._note_addresses(info)
        self._track_line_margin(info)
        self._measure_throughput(info, reconnected)
        return info

    def _note_internet_changes(
        self, previous: InternetInfo | None, info: InternetInfo, reconnected: bool
    ) -> None:
        """Keep what happened to the connection for the panel and announce it."""
        if previous is None:
            return
        if previous.connected and info.connected is False:
            self._internet_event("disconnected", EVENT_INTERNET_DISCONNECTED)
        elif reconnected or (previous.connected is False and info.connected):
            self._internet_event("reconnected", EVENT_INTERNET_RECONNECTED)
        if (
            previous.external_ipv4
            and info.external_ipv4
            and previous.external_ipv4 != info.external_ipv4
        ):
            self._internet_event(
                "ip_changed",
                EVENT_INTERNET_IP_CHANGED,
                info.external_ipv4,
                {"old_ip": previous.external_ipv4, "new_ip": info.external_ipv4},
            )

    def _note_addresses(self, info: InternetInfo) -> None:
        """Keep which external addresses were in use and since when."""
        if self.history is None:
            return
        now = dt_util.utcnow().isoformat()
        self.history.note_address(now, "ipv4", info.external_ipv4)
        self.history.note_address(now, "ipv6", info.external_ipv6)
        self.history.note_address(now, "prefix", info.ipv6_prefix)

    def _track_line_margin(self, info: InternetInfo) -> None:
        margins = (
            [m for m in (info.dsl.noise_margin_down, info.dsl.noise_margin_up) if m is not None]
            if info.dsl
            else []
        )
        if margins and min(margins) < INTERNET_NOISE_WARN_DB:
            self.internet_low_margin_since = self.internet_low_margin_since or dt_util.utcnow()
        else:
            self.internet_low_margin_since = None

    def _internet_event(
        self,
        kind: str,
        event_type: str,
        detail: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        event = {"time": dt_util.utcnow().isoformat(), "kind": kind, "detail": detail}
        self.internet_events.appendleft(event)
        if self.history is not None:
            self.history.record_connection_event(event["time"], kind, detail)
        self.hass.bus.async_fire(event_type, data or {})

    def _measure_throughput(self, info: InternetInfo, reconnected: bool) -> None:
        """The rate between this and the last poll, from the byte counters of the box."""
        now = time.monotonic()
        previous, self._internet_counters = (
            self._internet_counters,
            (
                (now, info.bytes_sent, info.bytes_received)
                if info.bytes_sent is not None and info.bytes_received is not None
                else None
            ),
        )
        self.internet_rate = None
        if previous is None or self._internet_counters is None or reconnected:
            return
        seconds = now - previous[0]
        if seconds < 1:
            return
        rates = []
        for old, new in zip(previous[1:], self._internet_counters[1:], strict=True):
            delta = new - old
            if delta < 0 and old < _COUNTER_WRAP:
                delta += _COUNTER_WRAP
            rate = delta * 8 / 1000 / seconds
            if not 0 <= rate <= _MAX_RATE_KBIT:
                return
            rates.append(rate)
        # sent goes to the internet (upload), received comes from it (download)
        up, down = rates
        self.internet_rate = (down, up)
        self.internet_samples.append((dt_util.utcnow().timestamp(), down, up))

    def _apply_overrides(self, hosts: dict[str, Host]) -> None:
        """Show what was just asked for until the box shows it too."""
        now = time.monotonic()
        for (mac, attr), (value, deadline) in list(self._overrides.items()):
            host = hosts.get(mac)
            if host is None or getattr(host, attr) == value or now > deadline:
                del self._overrides[(mac, attr)]
            else:
                hosts[mac] = replace(host, **{attr: value})

    @property
    def failed_polls(self) -> int:
        """How many polls in a row failed."""
        return self._failures

    def _register_failure(self) -> None:
        self._failures += 1
        if self._failures >= BACKOFF_AFTER_FAILURES:
            factor = 2 ** (self._failures - BACKOFF_AFTER_FAILURES + 1)
            seconds = min(self._base_interval * factor, MAX_BACKOFF_SECONDS)
            self.update_interval = timedelta(seconds=seconds)

    def _reset_failures(self) -> None:
        if self._failures:
            self._failures = 0
            self.update_interval = timedelta(seconds=self._base_interval)

    def _apply_filters(self, hosts: list[Host], mesh: MeshTopology | None) -> dict[str, Host]:
        return select_hosts(hosts, mesh, self._options)

    def vendor(self, mac: str) -> str | None:
        """The vendor of a MAC address, if the option to show it is on."""
        if not self._options.get(CONF_SHOW_VENDOR, DEFAULT_SHOW_VENDOR):
            return None
        return vendor_of(mac)

    @staticmethod
    def panel_vendor(mac: str) -> str | None:
        """The vendor of a MAC address for the panel, which shows it whatever the option says."""
        return vendor_of(mac)

    def node_name(self, node: MeshNode) -> str:
        """The name of a mesh node: the one its host entry has, else the mesh name."""
        for host in self.all_hosts.values():
            if {host.mac, *host.mac_list} & node.macs:
                return host.name
        return node.name

    def wants_device(self, host: Host) -> bool:
        """Whether a device should be created for this host now.

        With "skip offline" a host that is offline and has no device yet waits
        until it comes online; existing devices are never touched.
        """
        if host.active or not self._options.get(CONF_SKIP_OFFLINE, DEFAULT_SKIP_OFFLINE):
            return True
        registry = dr.async_get(self.hass)
        return (
            registry.async_get_device_by_connection(
                (CONNECTION_NETWORK_MAC, host.mac), self.config_entry.entry_id
            )
            is not None
        )

    def _remove_filtered_devices(self, selected: dict[str, Host]) -> None:
        """Drop the devices of hosts a filter now excludes.

        Only hosts the box still lists count: a host that is merely gone from the
        list is not touched here.
        """
        registry = dr.async_get(self.hass)
        for device in dr.async_entries_for_config_entry(registry, self.config_entry.entry_id):
            mac = next(
                (m for kind, m in device.connections if kind == CONNECTION_NETWORK_MAC), None
            )
            if mac in self.all_hosts and mac not in selected:
                # a device of another integration with the same MAC stays
                registry.async_update_device(
                    device.id, remove_config_entry_id=self.config_entry.entry_id
                )

    def _fire_new_devices(self, selected: dict[str, Host]) -> None:
        """Announce hosts the box lists for the first time since the integration runs.

        Hosts a filter excludes are not announced, and not again if they get
        selected later; devices that joined while Home Assistant was down are not
        announced either.
        """
        known, self._known_macs = self._known_macs, set(self.all_hosts)
        if known is None:
            return
        for mac in self._known_macs - known:
            if (host := selected.get(mac)) is not None:
                self.hass.bus.async_fire(
                    EVENT_NEW_DEVICE,
                    {"mac": mac, "name": host.name, "ip": host.ip, "vendor": self.vendor(mac)},
                )

    def _fire_roaming(self, selected: dict[str, Host], mesh: MeshTopology | None) -> None:
        """Announce a device that moved to another access point.

        The new access point has to show in several polls in a row, so a device
        that flaps between two does not fire on every poll. Seeing a device for the
        first time sets its access point and fires nothing.
        """
        if mesh is None:
            return
        names = {n.mac: self.node_name(n) for n in mesh.nodes.values()}
        for mac, host in selected.items():
            link = mesh.links.get(mac)
            if link is None or link.ap_mac is None:
                continue
            confirmed = self._access_points.get(mac)
            if confirmed is None or link.ap_mac == confirmed:
                self._access_points[mac] = link.ap_mac
                self._pending_roam.pop(mac, None)
                continue
            seen_at, count = self._pending_roam.get(mac, (None, 0))
            count = count + 1 if seen_at == link.ap_mac else 1
            if count < ROAM_CONFIRM_POLLS:
                self._pending_roam[mac] = (link.ap_mac, count)
                continue
            self._access_points[mac] = link.ap_mac
            self._pending_roam.pop(mac, None)
            self.hass.bus.async_fire(
                EVENT_DEVICE_ROAMED,
                {
                    "mac": mac,
                    "name": host.name,
                    "old_ap_mac": confirmed,
                    "old_ap": names.get(confirmed, confirmed),
                    "new_ap_mac": link.ap_mac,
                    "new_ap": names.get(link.ap_mac, link.ap_name or link.ap_mac),
                    "link_type": link.link_type.lower(),
                    "band": link.band,
                    "signal_dbm": link.signal_dbm,
                },
            )

    def _sync_names(self, hosts: dict[str, Host]) -> None:
        """Carry names changed in the box over to the device registry.

        Only `name` is written: a name set by the user (`name_by_user`) keeps
        winning in the UI.
        """
        if not self._options.get(CONF_ADOPT_NAMES, DEFAULT_ADOPT_NAMES):
            return
        registry = dr.async_get(self.hass)
        for host in hosts.values():
            device = registry.async_get_device_by_connection(
                (CONNECTION_NETWORK_MAC, host.mac), self.config_entry.entry_id
            )
            if device is None or device.name == host.name:
                continue
            old_name = device.name
            registry.async_update_device(device.id, name=host.name)
            self.hass.bus.async_fire(
                EVENT_DEVICE_RENAMED,
                {"mac": host.mac, "old_name": old_name, "new_name": host.name},
            )

    def is_connected(self, host: Host) -> bool:
        """Presence including the consider-home grace period."""
        if host.active:
            return True
        last = self.last_active.get(host.mac)
        if last is None:
            return False
        grace = self._options.get(CONF_CONSIDER_HOME, DEFAULT_CONSIDER_HOME)
        return (dt_util.utcnow() - last).total_seconds() < grace

    async def _async_set_by_ip(self, host: Host, attr: str, value: Any, action: Any) -> None:
        """Run an action the box takes by IPv4 address and show its result at once.

        If DHCP gave the address to another device since the last poll, the action
        would hit the wrong one. A small window between this check and the action
        remains.
        """
        if await self.hass.async_add_executor_job(self.client.get_host_ip, host.mac) != host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="ip_changed")
        await self.hass.async_add_executor_job(action, host.ip, value)
        await self._async_show_now(host.mac, attr, value)

    async def _async_show_now(self, mac: str, attr: str, value: Any) -> None:
        """Show a value just set until the box lists it too, and poll again."""
        self._overrides[(mac, attr)] = (value, time.monotonic() + WAN_OVERRIDE_SECONDS)
        hosts = dict(self.data.hosts)
        self._apply_overrides(hosts)
        self.async_set_updated_data(
            NetworkData(
                hosts=hosts,
                mesh=self.data.mesh,
                internet=self.data.internet,
                guest_wifi=self.data.guest_wifi,
                firmware=self.data.firmware,
            )
        )
        await self.async_request_refresh()

    async def async_set_name(self, host: Host, name: str) -> None:
        """Rename a device in the box; the device in Home Assistant follows."""
        if host.name_writeable is False:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="name_not_writeable",
                translation_placeholders={"name": host.name},
            )
        await self.hass.async_add_executor_job(self.client.set_friendly_name, host.mac, name)
        await self._async_show_now(host.mac, "name", name)

    async def async_set_internet_access(self, host: Host, allowed: bool) -> None:
        await self._async_set_by_ip(host, "wan_access", allowed, self.client.set_internet_access)

    async def async_set_priority(self, host: Host, enabled: bool) -> None:
        await self._async_set_by_ip(host, "priority", enabled, self.client.set_priority)

    async def async_set_filter_profile(self, host: Host, profile_id: str) -> None:
        await self._async_set_by_ip(
            host, "filter_profile", profile_id, self.client.set_filter_profile
        )

    async def async_set_guest_wifi(self, enabled: bool) -> None:
        """Switch the guest Wi-Fi and show the new state until the box does."""
        await self.hass.async_add_executor_job(self.client.set_guest_wifi, enabled)
        self._guest_override = (enabled, time.monotonic() + WAN_OVERRIDE_SECONDS)
        self.async_set_updated_data(replace(self.data, guest_wifi=enabled))
        await self.async_request_refresh()

    async def async_wake_on_lan(self, host: Host) -> None:
        await self.hass.async_add_executor_job(self.client.wake_on_lan, host.mac)
