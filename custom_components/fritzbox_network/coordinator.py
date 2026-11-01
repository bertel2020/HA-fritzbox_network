"""DataUpdateCoordinator for the FRITZ!Box network integration."""

from __future__ import annotations

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
    EVENT_NEW_DEVICE,
    FILTER_PROFILE_REFRESH_POLLS,
    MAX_BACKOFF_SECONDS,
    ROAM_CONFIRM_POLLS,
    WAN_OVERRIDE_SECONDS,
)
from .filters import select_hosts
from .models import Host, MeshNode, MeshTopology, NetworkData
from .vendor import vendor_of

_LOGGER = logging.getLogger(__name__)

type FritzNetworkConfigEntry = ConfigEntry[FritzNetworkCoordinator]

_FETCH_ERRORS = (FritzConnectionException, OSError, ET.ParseError, ValueError, KeyError)


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
        # How long the last and the slowest poll took, shown in the diagnostics.
        self.last_fetch_seconds: float | None = None
        self.slowest_fetch_seconds: float = 0.0
        # Options at setup: removing a device only adds to the hidden list and
        # needs no reload (see __init__._async_update_listener).
        self.options_snapshot = dict(entry.options)

    @property
    def _options(self):
        return self.config_entry.options

    def _fetch(self) -> tuple[list[Host], MeshTopology | None]:
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
        self._polls += 1
        return hosts, mesh

    async def _async_update_data(self) -> NetworkData:
        started = time.monotonic()
        try:
            hosts, mesh = await self.hass.async_add_executor_job(self._fetch)
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

        self._remove_filtered_devices(selected)
        self._sync_names(selected)
        return NetworkData(hosts=selected, mesh=mesh)

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
        self.async_set_updated_data(NetworkData(hosts=hosts, mesh=self.data.mesh))
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

    async def async_wake_on_lan(self, host: Host) -> None:
        await self.hass.async_add_executor_job(self.client.wake_on_lan, host.mac)
