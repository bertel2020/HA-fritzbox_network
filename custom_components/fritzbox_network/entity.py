"""Base entities for the FRITZ!Box network integration."""

from __future__ import annotations

from collections.abc import Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_SWITCH_AREAS, DOMAIN, KEY_TRACKER, SWITCH_AREAS, vpn_identifier
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .models import Host, MeshNode, client_uid, mac_id
from .repeater import RepeaterCoordinator


class FritzNetworkClientEntity(CoordinatorEntity[FritzNetworkCoordinator]):
    """An entity of one client device, identified by its MAC address.

    The entity id is derived from the MAC and set once at creation; names
    follow the device, so a rename in the box never changes an entity id.
    """

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: FritzNetworkCoordinator,
        host: Host,
        platform_domain: str,
        key: str,
    ) -> None:
        super().__init__(coordinator)
        self._mac = host.mac
        self._attr_unique_id = client_uid(coordinator.serial, host.mac, key)
        suffix = "" if key == KEY_TRACKER else f"_{key}"
        self.entity_id = f"{platform_domain}.fritz_{mac_id(host.mac)}{suffix}"
        info = DeviceInfo(
            connections={(CONNECTION_NETWORK_MAC, host.mac)},
            name=host.name,
            model=host.model,
            via_device_id=coordinator.box_device_id,
        )
        if vendor := coordinator.vendor(host.mac):
            info["manufacturer"] = vendor
        mesh = coordinator.data.mesh
        if mesh and (node := mesh.node_of(host)) is not None:
            # a repeater is one device: its host entry and its mesh node meet here
            info["identifiers"] = {(DOMAIN, node.mac)}
            info["model"] = node.model or host.model
            info["sw_version"] = node.firmware
        self._attr_device_info = info

    @property
    def host(self) -> Host | None:
        return self.coordinator.data.hosts.get(self._mac)

    @property
    def available(self) -> bool:
        return super().available and self.host is not None


@callback
def async_setup_client_entities(
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
    factory: Callable[[FritzNetworkCoordinator, Host], list[Entity] | None],
) -> None:
    """Create entities for every host now and for every host that appears later.

    The factory returns None for a host it cannot decide on yet.
    """
    coordinator = entry.runtime_data
    known: set[str] = set()  # MACs: the uid of a node may change

    @callback
    def _add_new_hosts() -> None:
        # a host the filter dropped (for example one that moved to the guest network) is gone
        # for the entities too; when the filter lets it in again it gets new ones
        hosts = coordinator.data.hosts
        known.difference_update([m for m in known if m in coordinator.all_hosts and m not in hosts])
        new = [
            h
            for mac, h in coordinator.data.hosts.items()
            if mac not in known and coordinator.wants_device(h)
        ]
        entities: list[Entity] = []
        for host in new:
            created = factory(coordinator, host)
            if created is None:  # not applicable yet, ask again with the next poll
                continue
            known.add(host.mac)
            entities.extend(created)
        if entities:
            async_add_entities(entities)

    _add_new_hosts()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_hosts))


def vpn_device_info(coordinator: FritzNetworkCoordinator) -> DeviceInfo:
    """The device of the WireGuard connections: one for all of them, behind the box."""
    return DeviceInfo(
        identifiers={(DOMAIN, vpn_identifier(coordinator.serial))},
        name="WireGuard VPN",
        manufacturer="AVM",
        model="WireGuard",
        via_device_id=coordinator.box_device_id,
    )


def is_mesh_node(coordinator: FritzNetworkCoordinator, host: Host) -> bool:
    """Whether the host is the box or a repeater: not a client, so no client controls."""
    mesh = coordinator.data.mesh
    return bool(mesh) and mesh.node_of(host) is not None


@callback
def async_remove_node_client_entities(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    domain: str,
    keys: tuple[str, ...],
) -> None:
    """Remove the client controls an earlier version created for the box and repeaters."""
    mesh = entry.runtime_data.data.mesh
    if not mesh:
        return
    serial = entry.runtime_data.serial
    wanted = {
        client_uid(serial, mac, key)
        for node in mesh.nodes.values()
        for mac in node.macs
        for key in keys
    }
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain == domain and entity.unique_id in wanted:
            registry.async_remove(entity.entity_id)


@callback
def async_remove_entities(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    domain: str,
    match: Callable[[str], bool],
) -> None:
    """Remove the entities of a domain whose unique id matches: an area the user turned off."""
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain == domain and match(entity.unique_id):
            registry.async_remove(entity.entity_id)


def switch_areas(entry: FritzNetworkConfigEntry) -> set[str]:
    """The areas that get switches: all, unless the options say otherwise."""
    return set(entry.options.get(CONF_SWITCH_AREAS, SWITCH_AREAS))


class FritzNetworkNodeEntity(CoordinatorEntity[FritzNetworkCoordinator]):
    """An entity of a mesh node: the box itself or a repeater."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: FritzNetworkCoordinator,
        node: MeshNode,
        platform_domain: str,
        key: str,
    ) -> None:
        super().__init__(coordinator)
        self._mac = node.mac
        self._attr_unique_id = client_uid(coordinator.serial, node.mac, key)
        self.entity_id = f"{platform_domain}.fritz_{mac_id(node.mac)}_{key}"
        if node.role == "master":
            # the box device is created in async_setup_entry
            self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})
        else:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, node.mac)},
                name=coordinator.node_name(node),
                model=node.model,
                sw_version=node.firmware,
                via_device_id=coordinator.box_device_id,
            )

    @property
    def node(self) -> MeshNode | None:
        mesh = self.coordinator.data.mesh
        return mesh.node_by_mac(self._mac) if mesh else None

    @property
    def available(self) -> bool:
        return super().available and self.node is not None


@callback
def async_setup_node_entities(
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
    factory: Callable[[FritzNetworkCoordinator, MeshNode], list[Entity]],
) -> None:
    """Create entities for every mesh node now and for every node that appears later."""
    coordinator = entry.runtime_data
    known: set[str] = set()  # MACs: the uid of a node may change

    @callback
    def _add_new_nodes() -> None:
        mesh = coordinator.data.mesh
        new = [n for n in (mesh.nodes.values() if mesh else []) if n.mac not in known]
        known.update(n.mac for n in new)
        entities = [e for node in new for e in factory(coordinator, node)]
        if entities:
            async_add_entities(entities)

    _add_new_nodes()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_nodes))


class FritzNetworkRepeaterEntity(CoordinatorEntity[RepeaterCoordinator]):
    """An entity of a repeater the user chose to control, on the device the mesh already made."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: RepeaterCoordinator, platform_domain: str, key: str) -> None:
        super().__init__(coordinator)
        mac = coordinator.mac
        self._attr_unique_id = client_uid(coordinator.main.serial, mac, key)
        self.entity_id = f"{platform_domain}.fritz_{mac_id(mac)}_{key}"
        node = coordinator.node
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, mac)},
            name=coordinator.device_name,
            model=node.model if node else None,
            sw_version=node.firmware if node else None,
            via_device_id=coordinator.main.box_device_id,
        )

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.data is not None
