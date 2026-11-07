"""Guest network flag per client device, the internet connection and the WireGuard connections."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    KEY_GUEST,
    KEY_INTERNET_CONNECTED,
    KEY_INTERNET_LINKED,
    KEY_MESH_CONNECTED,
    KEY_VPN,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    FritzNetworkNodeEntity,
    async_setup_client_entities,
    async_setup_node_entities,
    vpn_device_info,
)
from .models import Host, MeshNode, VpnConnection

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
    # the box is the mesh: only the repeaters can be lost
    async_setup_node_entities(
        entry,
        async_add_entities,
        lambda coordinator, node: (
            [] if node.role == "master" else [FritzNetworkMeshConnected(coordinator, node)]
        ),
    )
    _async_setup_internet(entry, async_add_entities)
    _async_setup_vpn(entry, async_add_entities)


@callback
def _async_setup_internet(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """The connection sensor, once the box has told about its internet connection.

    The sensor of the line only where the box tells whether the cable has a signal.
    """
    coordinator = entry.runtime_data
    connected_added = False
    linked_added = False

    @callback
    def _add() -> None:
        nonlocal connected_added, linked_added
        internet = coordinator.data.internet
        if internet is None:
            return
        new: list[CoordinatorEntity] = []
        if not connected_added:
            connected_added = True
            new.append(FritzNetworkInternetConnected(coordinator))
        if not linked_added and internet.linked is not None:
            linked_added = True
            new.append(FritzNetworkInternetLinked(coordinator))
        if new:
            async_add_entities(new)

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


class FritzNetworkMeshConnected(FritzNetworkNodeEntity, BinarySensorEntity):
    """On = the repeater is part of the mesh of the box; off = the box does not list it any more."""

    _attr_translation_key = KEY_MESH_CONNECTED
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: FritzNetworkCoordinator, node: MeshNode) -> None:
        super().__init__(coordinator, node, "binary_sensor", KEY_MESH_CONNECTED)

    @property
    def available(self) -> bool:
        # unlike the other values of a node it says something while the node is gone: off
        return self.coordinator.last_update_success

    @property
    def is_on(self) -> bool | None:
        # without a topology nothing is known: that is not the same as a lost repeater
        if self.coordinator.data.mesh is None:
            return None
        return self.node is not None

    @property
    def extra_state_attributes(self) -> dict[str, str | None] | None:
        if (node := self.node) is None:
            return None
        return {
            "role": node.role,
            "model": node.model,
            "firmware": node.firmware,
            "mesh_version": node.meshd_version,
        }


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


class FritzNetworkInternetLinked(CoordinatorEntity[FritzNetworkCoordinator], BinarySensorEntity):
    """On = the line of the box has a signal (the cable is plugged in); off by default.

    Read together with the slow part of the connection, so it is up to ten polls old; a
    connection that drops makes the box read it at once.
    """

    _attr_has_entity_name = True
    _attr_translation_key = KEY_INTERNET_LINKED
    _attr_device_class = BinarySensorDeviceClass.PLUG
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.serial}_{KEY_INTERNET_LINKED}"
        self.entity_id = f"binary_sensor.fritz_network_{KEY_INTERNET_LINKED}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def available(self) -> bool:
        internet = self.coordinator.data.internet
        return super().available and internet is not None and internet.linked is not None

    @property
    def is_on(self) -> bool | None:
        internet = self.coordinator.data.internet
        return internet.linked if internet else None


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
        self._attr_device_info = vpn_device_info(coordinator)

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
