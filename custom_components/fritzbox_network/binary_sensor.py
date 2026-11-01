"""Guest network flag per client device."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, KEY_GUEST, KEY_INTERNET_CONNECTED
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host

PARALLEL_UPDATES = 0


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
    _async_setup_internet(entry, async_add_entities)


@callback
def _async_setup_internet(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """The connection sensor, once the box has told about its internet connection."""
    coordinator = entry.runtime_data
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or coordinator.data.internet is None:
            return
        added = True
        async_add_entities([FritzNetworkInternetConnected(coordinator)])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


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


class FritzNetworkInternetConnected(CoordinatorEntity[FritzNetworkCoordinator], BinarySensorEntity):
    """On = the box has an internet connection."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_INTERNET_CONNECTED
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.serial}_{KEY_INTERNET_CONNECTED}"
        self.entity_id = f"binary_sensor.fritz_network_{KEY_INTERNET_CONNECTED}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def available(self) -> bool:
        internet = self.coordinator.data.internet
        return super().available and internet is not None and internet.connected is not None

    @property
    def is_on(self) -> bool | None:
        internet = self.coordinator.data.internet
        return internet.connected if internet else None
