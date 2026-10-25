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
from .models import Host, mac_id


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
        self._attr_device_info = DeviceInfo(
            connections={(CONNECTION_NETWORK_MAC, host.mac)},
            default_name=host.name,
            default_model=host.model,
            via_device=(DOMAIN, coordinator.serial),
        )

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
        new = [h for mac, h in coordinator.data.hosts.items() if mac not in known]
        known.update(h.mac for h in new)
        entities = [e for host in new for e in factory(coordinator, host)]
        if entities:
            async_add_entities(entities)

    _add_new_hosts()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_hosts))
