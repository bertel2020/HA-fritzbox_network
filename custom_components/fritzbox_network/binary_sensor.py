"""Guest network flag per client device."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import KEY_GUEST
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [FritzNetworkGuest(coordinator, host)],
    )


class FritzNetworkGuest(FritzNetworkClientEntity, BinarySensorEntity):
    """On = the device is in the guest network.

    Enabled from the start only for devices that are in the guest network at
    the time they are created; for all others it can be enabled by hand.
    """

    _attr_translation_key = KEY_GUEST
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "binary_sensor", KEY_GUEST)
        self._attr_entity_registry_enabled_default = host.guest

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return host.guest if host else None
