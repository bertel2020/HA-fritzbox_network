"""Internet access switch per client device."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, KEY_AUTO_WOL, KEY_GUEST_WIFI, KEY_INTERNET_ACCESS, KEY_PRIORITY
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host

_LOGGER = logging.getLogger(__name__)

# The box keeps the automatic Wake on LAN per device, not in the host list: every
# device that has the switch enabled is asked now and then, one after the other.
PARALLEL_UPDATES = 1
SCAN_INTERVAL = timedelta(minutes=10)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if not entry.runtime_data.can_write:
        return
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [
            FritzNetworkInternetAccess(coordinator, host),
            FritzNetworkPriority(coordinator, host),
            # like the Wake on LAN button: not for devices known to sit on Wi-Fi
            *(
                []
                if host.interface_type == "802.11"
                else [FritzNetworkAutoWakeOnLan(coordinator, host)]
            ),
        ],
    )
    _async_setup_guest_wifi(entry, async_add_entities)


@callback
def _async_setup_guest_wifi(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """The guest Wi-Fi switch, once the box has told it has a guest network."""
    coordinator = entry.runtime_data
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or coordinator.data.guest_wifi is None:
            return
        added = True
        async_add_entities([FritzNetworkGuestWifi(coordinator)])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


class FritzNetworkGuestWifi(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """The guest Wi-Fi of the box, on or off."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_GUEST_WIFI

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.serial}_{KEY_GUEST_WIFI}"
        self.entity_id = f"switch.fritz_network_{KEY_GUEST_WIFI}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.data.guest_wifi is not None

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.guest_wifi

    async def _set(self, value: bool) -> None:
        try:
            await self.coordinator.async_set_guest_wifi(value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class _HostSwitch(FritzNetworkClientEntity, SwitchEntity):
    """A switch the box takes by IPv4 address."""

    @property
    def available(self) -> bool:
        # The box acts by IPv4 address, a host without one cannot be switched.
        return super().available and bool(self.host and self.host.ip)

    async def _call(self, host: Host, value: bool) -> None:
        raise NotImplementedError

    async def _set(self, value: bool) -> None:
        host = self.host
        if host is None or not host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_ipv4_address")
        try:
            await self._call(host, value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class FritzNetworkInternetAccess(_HostSwitch):
    """On = the device may use the internet."""

    _attr_translation_key = KEY_INTERNET_ACCESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_INTERNET_ACCESS)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None or host.wan_access is None else host.wan_access

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_internet_access(host, value)


class FritzNetworkPriority(_HostSwitch):
    """On = the router prefers the device when the line is busy."""

    _attr_translation_key = KEY_PRIORITY
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_PRIORITY)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None else host.priority

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_priority(host, value)


class FritzNetworkAutoWakeOnLan(FritzNetworkClientEntity, SwitchEntity):
    """On = the box wakes the device itself when something wants to reach it."""

    _attr_translation_key = KEY_AUTO_WOL
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_AUTO_WOL)
        self._enabled: bool | None = None

    @property
    def should_poll(self) -> bool:
        return True

    @property
    def available(self) -> bool:
        return super().available and self._enabled is not None

    @property
    def is_on(self) -> bool | None:
        return self._enabled

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_schedule_update_ha_state(True)

    async def async_update(self) -> None:
        try:
            self._enabled = await self.hass.async_add_executor_job(
                self.coordinator.client.get_auto_wol, self._mac
            )
        except (FritzConnectionException, OSError, KeyError) as err:
            _LOGGER.debug("Automatic Wake on LAN of %s unavailable: %s", self._mac, err)
            self._enabled = None

    async def _set(self, value: bool) -> None:
        try:
            await self.hass.async_add_executor_job(
                self.coordinator.client.set_auto_wol, self._mac, value
            )
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err
        self._enabled = value
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
