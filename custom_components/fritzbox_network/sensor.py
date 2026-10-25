"""Sensors per client device."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import RestoreSensor, SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import KEY_ACCESS_POINT, KEY_CONNECTION_TYPE, KEY_IP_ADDRESS, KEY_LAST_SEEN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host

CONNECTION_LAN = "lan"
CONNECTION_WLAN = "wlan"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [
            FritzNetworkIpAddress(coordinator, host),
            FritzNetworkConnectionType(coordinator, host),
            FritzNetworkAccessPoint(coordinator, host),
            FritzNetworkLastSeen(coordinator, host),
        ],
    )


class FritzNetworkIpAddress(FritzNetworkClientEntity, SensorEntity):
    _attr_translation_key = KEY_IP_ADDRESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_IP_ADDRESS)

    @property
    def native_value(self) -> str | None:
        return host.ip if (host := self.host) else None


class FritzNetworkConnectionType(FritzNetworkClientEntity, SensorEntity):
    _attr_translation_key = KEY_CONNECTION_TYPE
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = [CONNECTION_LAN, CONNECTION_WLAN]

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_CONNECTION_TYPE)

    @property
    def native_value(self) -> str | None:
        host = self.host
        if host is None:
            return None
        link = (
            self.coordinator.data.mesh.links.get(self._mac) if self.coordinator.data.mesh else None
        )
        if link is not None:
            return CONNECTION_WLAN if link.link_type == "WLAN" else CONNECTION_LAN
        if host.interface_type == "802.11":
            return CONNECTION_WLAN
        if host.interface_type == "Ethernet":
            return CONNECTION_LAN
        return None


class FritzNetworkAccessPoint(FritzNetworkClientEntity, SensorEntity):
    _attr_translation_key = KEY_ACCESS_POINT

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_ACCESS_POINT)

    @property
    def native_value(self) -> str | None:
        mesh = self.coordinator.data.mesh
        link = mesh.links.get(self._mac) if mesh else None
        return link.ap_name if link else None


class FritzNetworkLastSeen(FritzNetworkClientEntity, RestoreSensor):
    """When the device was last seen.

    The value changes only on a transition, so it does not write a new state
    on every poll: going online sets it to now, going offline to the last poll
    that still saw the device.
    """

    _attr_translation_key = KEY_LAST_SEEN
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_LAST_SEEN)
        self._value: datetime | None = None
        self._was_active: bool | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self.async_get_last_sensor_data()) is not None:
            value = last.native_value
            self._value = value if isinstance(value, datetime) else None
        self._track(self.host)

    def _track(self, host: Host | None) -> None:
        if host is None:
            return
        if host.active and self._was_active is not True:
            self._value = dt_util.utcnow()
        elif not host.active and self._was_active is True:
            self._value = self.coordinator.last_active.get(self._mac, self._value)
        self._was_active = host.active

    @callback
    def _handle_coordinator_update(self) -> None:
        self._track(self.host)
        super()._handle_coordinator_update()

    @property
    def native_value(self) -> datetime | None:
        return self._value
