"""Guest network flag per client device, the internet connection and the WireGuard connections."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN, KEY_GUEST, KEY_INTERNET_CONNECTED, KEY_VPN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host, VpnConnection

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
    _async_setup_vpn(entry, async_add_entities)


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


@callback
def _async_setup_vpn(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One sensor for each WireGuard connection, also for those set up later on the box."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [c for c in coordinator.data.vpn or () if c.key not in known]
        if not new:
            return
        known.update(c.key for c in new)
        async_add_entities([FritzNetworkVpn(coordinator, c) for c in new])

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


class FritzNetworkVpn(CoordinatorEntity[FritzNetworkCoordinator], BinarySensorEntity):
    """On = the WireGuard connection is up: a device is dialled in or the other site is linked."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_VPN
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: FritzNetworkCoordinator, connection: VpnConnection) -> None:
        super().__init__(coordinator)
        self._key = connection.key
        self._attr_unique_id = f"{coordinator.serial}_{KEY_VPN}_{connection.key}"
        self._attr_translation_placeholders = {"name": connection.name}
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def connection(self) -> VpnConnection | None:
        return self.coordinator.vpn_by_key(self._key)

    @property
    def available(self) -> bool:
        return super().available and self.connection is not None

    @property
    def is_on(self) -> bool | None:
        connection = self.connection
        return connection.connected if connection else None

    @property
    def extra_state_attributes(self) -> dict[str, str | bool | None]:
        connection = self.connection
        if connection is None:
            return {}
        since = (
            dt_util.utc_from_timestamp(connection.since).isoformat() if connection.since else None
        )
        return {
            "kind": connection.kind,
            "enabled": connection.active,
            "connected_since": since,
            "remote_network": connection.remote_net,
        }
