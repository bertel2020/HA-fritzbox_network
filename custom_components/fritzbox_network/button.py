"""Refresh button of the box and Wake-on-LAN button per client device."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.button import ButtonDeviceClass, ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import UpdateFailed

from .const import (
    AREA_CLIENTS,
    DOMAIN,
    KEY_REBOOT,
    KEY_RECONNECT,
    KEY_REFRESH,
    KEY_REPEATER_REBOOT,
    KEY_WAKE_ON_LAN,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    FritzNetworkRepeaterEntity,
    async_remove_entities,
    async_remove_node_client_entities,
    async_setup_client_entities,
    is_mesh_node,
    switch_areas,
)
from .models import Host

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([FritzNetworkRefresh(entry.runtime_data)])
    if not entry.runtime_data.can_write:
        return
    async_add_entities(
        FritzNetworkRepeaterReboot(repeater) for repeater in entry.runtime_data.repeaters.values()
    )
    async_add_entities(
        [
            FritzNetworkBoxButton(entry.runtime_data, KEY_REBOOT, "async_reboot"),
            FritzNetworkBoxButton(entry.runtime_data, KEY_RECONNECT, "async_reconnect"),
        ]
    )
    # Offline hosts have no interface type, and they are the ones to wake up:
    # only devices known to sit on WLAN are left out.
    async_remove_node_client_entities(hass, entry, "button", (KEY_WAKE_ON_LAN,))
    if AREA_CLIENTS not in switch_areas(entry):
        async_remove_entities(
            hass, entry, "button", lambda uid: uid.endswith(f"_{KEY_WAKE_ON_LAN}")
        )
        return
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            []
            if not coordinator.wants_wake_on_lan(host) or is_mesh_node(coordinator, host)
            else [FritzNetworkWakeOnLan(coordinator, host)]
        ),
    )


class FritzNetworkRefresh(ButtonEntity):
    """Polls the box now instead of at the next interval."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_REFRESH

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.serial}_{KEY_REFRESH}"
        self.entity_id = f"button.fritz_network_{KEY_REFRESH}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    async def async_press(self) -> None:
        await self._coordinator.async_request_refresh()


class FritzNetworkBoxButton(ButtonEntity):
    """Restart the box or hang up and dial in again; off by default, a button has no question.

    The panel asks before it does the same, so this is for automations and for those who want
    the button. It needs the right to change settings.
    """

    _attr_has_entity_name = True
    _attr_device_class = ButtonDeviceClass.RESTART
    _attr_entity_category = EntityCategory.CONFIG
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, key: str, method: str) -> None:
        self._coordinator = coordinator
        self._method = method
        self._attr_translation_key = key
        self._attr_unique_id = f"{coordinator.serial}_{key}"
        self.entity_id = f"button.fritz_network_{key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    async def async_press(self) -> None:
        try:
            await getattr(self._coordinator, self._method)()
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err


class FritzNetworkRepeaterReboot(FritzNetworkRepeaterEntity, ButtonEntity):
    """Restart a repeater that is controlled from here; off by default like the one of the box."""

    _attr_translation_key = KEY_REPEATER_REBOOT
    _attr_device_class = ButtonDeviceClass.RESTART
    _attr_entity_category = EntityCategory.CONFIG
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "button", "reboot")

    async def async_press(self) -> None:
        try:
            await self.coordinator.async_reboot()
        except (FritzConnectionException, UpdateFailed) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err


class FritzNetworkWakeOnLan(FritzNetworkClientEntity, ButtonEntity):
    _attr_translation_key = KEY_WAKE_ON_LAN
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "button", KEY_WAKE_ON_LAN)

    async def async_press(self) -> None:
        host = self.host
        if host is None:
            return
        try:
            await self.coordinator.async_wake_on_lan(host)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err
