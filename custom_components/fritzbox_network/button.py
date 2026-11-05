"""Refresh button of the box and Wake-on-LAN button per client device."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, KEY_REFRESH, KEY_WAKE_ON_LAN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    async_remove_node_client_entities,
    async_setup_client_entities,
    is_mesh_node,
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
    # Offline hosts have no interface type, and they are the ones to wake up:
    # only devices known to sit on WLAN are left out.
    async_remove_node_client_entities(hass, entry, "button", (KEY_WAKE_ON_LAN,))
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            []
            if host.interface_type == "802.11" or is_mesh_node(coordinator, host)
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
