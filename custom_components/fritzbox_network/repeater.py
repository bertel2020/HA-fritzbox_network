"""A repeater the user chose to control: its own login, its own slow poll, one device.

The repeater is already a device of the box through the mesh. Controlling it needs a login to the
repeater itself, with the account of the box (the box shares its users with the mesh), so there is
no second config entry: a second entry would be a second device that cannot be merged with the
first. The address comes from the host list of the box, so a new address is followed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
import logging
import time
from typing import TYPE_CHECKING

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util
import requests

from .api import FritzNetworkClient
from .const import (
    CONF_REPEATERS,
    CONF_USE_TLS,
    CONF_VERIFY_TLS,
    DOMAIN,
    REPEATER_INTERVAL_SECONDS,
    WAN_OVERRIDE_SECONDS,
)
from .models import FirmwareInfo, MeshNode, WifiNetwork, parse_firmware

if TYPE_CHECKING:
    from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator

_LOGGER = logging.getLogger(__name__)

_ERRORS = (FritzConnectionException, OSError, requests.RequestException, ValueError, KeyError)


@dataclass(frozen=True)
class RepeaterData:
    """What the repeater told at the last poll."""

    boot: datetime | None = None
    wifi: dict[str, WifiNetwork] = field(default_factory=dict)
    firmware: FirmwareInfo | None = None
    cpu_temperature: int | None = None
    # the guest network of the repeater: None where it has none
    guest: bool | None = None


class RepeaterCoordinator(DataUpdateCoordinator[RepeaterData]):
    """Polls one repeater now and then and carries out what its entities ask for."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: FritzNetworkConfigEntry,
        main: FritzNetworkCoordinator,
        mac: str,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} repeater {mac}",
            update_interval=timedelta(seconds=REPEATER_INTERVAL_SECONDS),
        )
        self.mac = mac
        self.main = main
        self._entry = entry
        self.client: FritzNetworkClient | None = None
        self._host: str | None = None
        self._boot: datetime | None = None
        # the CPU temperature is asked once (None = not asked yet), then while an entity wants it
        self.cpu_supported: bool | None = None
        self._cpu_demand = 0
        self._wifi_overrides: dict[str, tuple[bool, float]] = {}

    @property
    def node(self) -> MeshNode | None:
        """The mesh node of the repeater, while the box lists it."""
        mesh = self.main.data.mesh if self.main.data else None
        return mesh.node_by_mac(self.mac) if mesh else None

    @property
    def device_name(self) -> str:
        node = self.node
        return self.main.node_name(node) if node else self.mac

    @property
    def host(self) -> str | None:
        """The address of the repeater now: the one its host entry has in the list of the box."""
        node = self.node
        if node is None:
            return None
        for host in self.main.all_hosts.values():
            if {host.mac, *host.mac_list} & node.macs and host.ip:
                return host.ip
        return None

    @callback
    def async_want_cpu_temperature(self) -> Callable[[], None]:
        """An entity wants the temperature: it is read from the next poll on."""
        self._cpu_demand += 1

        @callback
        def _release() -> None:
            self._cpu_demand -= 1

        return _release

    def _connect(self, host: str) -> FritzNetworkClient:
        data = self._entry.data
        client = FritzNetworkClient(
            host=host,
            port=None,
            username=data[CONF_USERNAME],
            password=data[CONF_PASSWORD],
            use_tls=data.get(CONF_USE_TLS, False),
            verify_tls=data.get(CONF_VERIFY_TLS, False),
        )
        client.connect()
        return client

    def _fetch(self) -> RepeaterData:
        client = self.client
        assert client is not None  # noqa: S101 - set by _async_update_data before this runs
        self._note_uptime(client.read_uptime())
        wifi = client.get_wifi_networks()
        firmware = parse_firmware(client.get_firmware())
        guest = client.get_guest_wifi_info()
        cpu = self.data.cpu_temperature if self.data else None
        if self.cpu_supported is None or (self.cpu_supported and self._cpu_demand):
            try:
                value = client.get_cpu_temperature()
            except (*_ERRORS, PermissionError, TypeError) as err:
                _LOGGER.debug("CPU temperature of %s unavailable: %s", self.mac, err)
            else:
                if value is None:
                    self.cpu_supported = self.cpu_supported or False
                else:
                    self.cpu_supported = True
                    cpu = value
        return RepeaterData(
            boot=self._boot,
            wifi=wifi,
            firmware=firmware,
            cpu_temperature=cpu,
            guest=guest["enabled"] if guest else None,
        )

    def _note_uptime(self, seconds: int | None) -> None:
        if seconds is None:
            return
        boot = (dt_util.utcnow() - timedelta(seconds=seconds)).replace(second=0, microsecond=0)
        if self._boot is None or abs((boot - self._boot).total_seconds()) > 60:
            self._boot = boot

    async def _async_update_data(self) -> RepeaterData:
        host = self.host
        if host is None:
            raise UpdateFailed("The box does not list this repeater or has no address for it")
        try:
            if self.client is None or host != self._host:
                self.client = await self.hass.async_add_executor_job(self._connect, host)
                self._host = host
            data = await self.hass.async_add_executor_job(self._fetch)
        except (FritzAuthorizationError, FritzSecurityError) as err:
            self.client = None
            raise UpdateFailed(f"The repeater did not accept the login: {err}") from err
        except (*_ERRORS, PermissionError, TypeError) as err:
            self.client = None  # connect again at the next poll
            raise UpdateFailed(f"Error talking to the repeater: {err}") from err
        return self._apply_wifi_overrides(data)

    def _apply_wifi_overrides(self, data: RepeaterData) -> RepeaterData:
        """The networks, with a switch just made shown until the repeater shows it too."""
        shown = dict(data.wifi)
        for key, (value, deadline) in list(self._wifi_overrides.items()):
            network = shown.get(key)
            if network is None or network.enabled == value or time.monotonic() > deadline:
                del self._wifi_overrides[key]
            else:
                shown[key] = replace(network, enabled=value)
        return replace(data, wifi=shown)

    def _require_client(self) -> FritzNetworkClient:
        if self.client is None:
            raise UpdateFailed("The repeater is not connected")
        return self.client

    async def async_reboot(self) -> None:
        await self.hass.async_add_executor_job(self._require_client().reboot)

    async def async_install_firmware(self) -> None:
        await self.hass.async_add_executor_job(self._require_client().install_firmware)

    async def async_set_guest_wifi(self, enabled: bool) -> None:
        """Switch the guest network of the repeater and read it again."""
        await self.hass.async_add_executor_job(self._require_client().set_guest_wifi, enabled)
        await self.async_request_refresh()

    async def async_guest_qr(self) -> bytes | None:
        """The QR code of the guest network of the repeater."""
        return await self.hass.async_add_executor_job(self._require_client().get_guest_wifi_qr)

    async def async_set_wifi(self, key: str, enabled: bool) -> None:
        """Switch a band, show it at once and read the repeater again soon."""
        client = self._require_client()
        await self.hass.async_add_executor_job(client.set_wifi_enabled, key, enabled)
        self._wifi_overrides[key] = (enabled, time.monotonic() + WAN_OVERRIDE_SECONDS)
        if self.data is not None:
            self.async_set_updated_data(self._apply_wifi_overrides(self.data))
        await self.async_request_refresh()


def repeater_macs(entry: FritzNetworkConfigEntry) -> list[str]:
    """The repeaters the user chose to control."""
    return list(entry.options.get(CONF_REPEATERS, []))
