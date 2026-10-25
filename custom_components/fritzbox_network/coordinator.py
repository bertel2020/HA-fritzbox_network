"""DataUpdateCoordinator for the FRITZ!Box network integration."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
import logging
import time
from xml.etree import ElementTree as ET

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import FritzNetworkClient
from .const import (
    BACKOFF_AFTER_FAILURES,
    CONF_ADOPT_NAMES,
    CONF_CONSIDER_HOME,
    CONF_FILTER_DEVICES,
    CONF_FILTER_MODE,
    CONF_HIDDEN_MACS,
    CONF_IGNORE_GUESTS,
    CONF_IGNORE_PRIVATE_MACS,
    CONF_SCAN_INTERVAL,
    CONF_SKIP_OFFLINE,
    DEFAULT_ADOPT_NAMES,
    DEFAULT_CONSIDER_HOME,
    DEFAULT_IGNORE_GUESTS,
    DEFAULT_IGNORE_PRIVATE_MACS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SKIP_OFFLINE,
    DOMAIN,
    EVENT_DEVICE_RENAMED,
    FILTER_EXCLUDE,
    FILTER_INCLUDE,
    MAX_BACKOFF_SECONDS,
    WAN_OVERRIDE_SECONDS,
)
from .models import Host, MeshNode, MeshTopology, NetworkData, is_private_mac

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
        self.last_active: dict[str, datetime] = {}
        self._failures = 0
        # mac -> (allowed, monotonic deadline): see WAN_OVERRIDE_SECONDS
        self._wan_override: dict[str, tuple[bool, float]] = {}
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
        self.all_hosts = {h.mac: h for h in hosts}
        selected = self._apply_filters(hosts, mesh)
        self._apply_wan_override(selected)

        now = dt_util.utcnow()
        for host in selected.values():
            if host.active:
                self.last_active[host.mac] = now

        self._remove_filtered_devices(selected)
        self._sync_names(selected)
        return NetworkData(hosts=selected, mesh=mesh)

    def _apply_wan_override(self, hosts: dict[str, Host]) -> None:
        now = time.monotonic()
        for mac, (allowed, deadline) in list(self._wan_override.items()):
            host = hosts.get(mac)
            if host is None or host.wan_access == allowed or now > deadline:
                del self._wan_override[mac]
            else:
                hosts[mac] = replace(host, wan_access=allowed)

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
        options = self._options
        hidden = set(options.get(CONF_HIDDEN_MACS, []))
        mode = options.get(CONF_FILTER_MODE)
        selection = set(options.get(CONF_FILTER_DEVICES, []))
        ignore_guests = options.get(CONF_IGNORE_GUESTS, DEFAULT_IGNORE_GUESTS)
        ignore_private = options.get(CONF_IGNORE_PRIVATE_MACS, DEFAULT_IGNORE_PRIVATE_MACS)
        box = mesh.master if mesh else None

        selected: dict[str, Host] = {}
        for host in hosts:
            node = mesh.node_of(host) if mesh else None
            if host.mac in hidden or (node is not None and node is box):
                continue
            if node is not None:
                # repeaters are part of the network, no filter hides them
                selected[host.mac] = host
                continue
            if ignore_guests and host.guest:
                continue
            if ignore_private and is_private_mac(host.mac):
                continue
            if mode == FILTER_INCLUDE and host.mac not in selection:
                continue
            if mode == FILTER_EXCLUDE and host.mac in selection:
                continue
            selected[host.mac] = host
        return selected

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
                registry.async_remove_device(device.id)

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

    async def async_set_internet_access(self, host: Host, allowed: bool) -> None:
        await self.hass.async_add_executor_job(self.client.set_internet_access, host.ip, allowed)
        self._wan_override[host.mac] = (allowed, time.monotonic() + WAN_OVERRIDE_SECONDS)
        hosts = dict(self.data.hosts)
        self._apply_wan_override(hosts)
        self.async_set_updated_data(NetworkData(hosts=hosts, mesh=self.data.mesh))
        await self.async_request_refresh()

    async def async_wake_on_lan(self, host: Host) -> None:
        await self.hass.async_add_executor_job(self.client.wake_on_lan, host.mac)
