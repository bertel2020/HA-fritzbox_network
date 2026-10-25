"""Device tracker: one presence entity per client device."""

from __future__ import annotations

from homeassistant.components.device_tracker import ScannerEntity, SourceType
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import KEY_TRACKER
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
        lambda coordinator, host: [FritzNetworkTracker(coordinator, host)],
    )


class FritzNetworkTracker(FritzNetworkClientEntity, ScannerEntity):
    """Presence of a client; its name is the device name."""

    _attr_name = None

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "device_tracker", KEY_TRACKER)

    @property
    def device_info(self) -> DeviceInfo:
        return self._attr_device_info

    @property
    def source_type(self) -> SourceType:
        return SourceType.ROUTER

    @property
    def is_connected(self) -> bool:
        host = self.host
        return host is not None and self.coordinator.is_connected(host)

    @property
    def mac_address(self) -> str:
        return self._mac

    @property
    def ip_address(self) -> str | None:
        return host.ip if (host := self.host) else None

    @property
    def hostname(self) -> str | None:
        return host.hostname if (host := self.host) else None

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        host = self.host
        if host is None:
            return {}
        return {
            "interface_type": host.interface_type,
            "model": host.model,
            "guest": host.guest,
            "vpn": host.vpn,
            "mac_list": host.mac_list,
        }
