"""Base entities for the FRITZ!Box network integration."""

from __future__ import annotations

from collections.abc import Callable

from homeassistant.core import callback
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, KEY_TRACKER
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .models import Host, MeshNode, mac_id


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
        self._attr_unique_id = f"{host.mac}_{key}"
        suffix = "" if key == KEY_TRACKER else f"_{key}"
        self.entity_id = f"{platform_domain}.fritz_{mac_id(host.mac)}{suffix}"
        info = DeviceInfo(
            connections={(CONNECTION_NETWORK_MAC, host.mac)},
            name=host.name,
            model=host.model,
            via_device_id=coordinator.box_device_id,
        )
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
    factory: Callable[[FritzNetworkCoordinator, Host], list[Entity]],
) -> None:
    """Create entities for every host now and for every host that appears later."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add_new_hosts() -> None:
        new = [
            h
            for mac, h in coordinator.data.hosts.items()
            if mac not in known and coordinator.wants_device(h)
        ]
        known.update(h.mac for h in new)
        entities = [e for host in new for e in factory(coordinator, host)]
        if entities:
            async_add_entities(entities)

    _add_new_hosts()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_hosts))


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
        self._uid = node.uid
        self._attr_unique_id = f"{node.mac}_{key}"
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
        return mesh.nodes.get(self._uid) if mesh else None

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
    known: set[str] = set()

    @callback
    def _add_new_nodes() -> None:
        mesh = coordinator.data.mesh
        new = [n for uid, n in (mesh.nodes.items() if mesh else []) if uid not in known]
        known.update(n.uid for n in new)
        entities = [e for node in new for e in factory(coordinator, node)]
        if entities:
            async_add_entities(entities)

    _add_new_nodes()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_nodes))
