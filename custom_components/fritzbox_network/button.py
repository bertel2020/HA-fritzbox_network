"""Wake-on-LAN button per client device."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, KEY_WAKE_ON_LAN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if not entry.runtime_data.can_write:
        return
    # Offline hosts have no interface type, and they are the ones to wake up:
    # only devices known to sit on WLAN are left out.
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            [] if host.interface_type == "802.11" else [FritzNetworkWakeOnLan(coordinator, host)]
        ),
    )


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
