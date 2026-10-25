"""Sensors per client device."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    EntityCategory,
    UnitOfDataRate,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoredExtraData, RestoreEntity
from homeassistant.util import dt as dt_util

from .const import (
    KEY_ACCESS_POINT,
    KEY_CLIENTS,
    KEY_CONNECTION_TYPE,
    KEY_IP_ADDRESS,
    KEY_LAST_SEEN,
    KEY_LINK_RATE_DOWNLOAD,
    KEY_LINK_RATE_UPLOAD,
    KEY_SIGNAL_STRENGTH,
    KEY_SSID,
    KEY_WLAN_BAND,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    FritzNetworkNodeEntity,
    async_setup_client_entities,
    async_setup_node_entities,
)
from .models import ClientLink, Host, MeshNode

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
    # only for devices the box has a connection for, so offline devices get
    # none until they come online
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            [FritzNetworkLinkSensor(coordinator, host, d) for d in LINK_SENSORS]
            if coordinator.data.mesh and host.mac in coordinator.data.mesh.links
            else None
        ),
    )

    async_setup_node_entities(
        entry,
        async_add_entities,
        lambda coordinator, node: [FritzNetworkClients(coordinator, node)],
    )


@dataclass(frozen=True, kw_only=True)
class LinkSensorDescription(SensorEntityDescription):
    """A value of the connection between a device and its access point."""

    value_fn: Callable[[ClientLink], str | float | None]


LINK_SENSORS = (
    LinkSensorDescription(
        key=KEY_SIGNAL_STRENGTH,
        translation_key=KEY_SIGNAL_STRENGTH,
        device_class=SensorDeviceClass.SIGNAL_STRENGTH,
        native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda link: link.signal_dbm,
    ),
    LinkSensorDescription(
        key=KEY_LINK_RATE_DOWNLOAD,
        translation_key=KEY_LINK_RATE_DOWNLOAD,
        device_class=SensorDeviceClass.DATA_RATE,
        native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda link: link.rate_download,
    ),
    LinkSensorDescription(
        key=KEY_LINK_RATE_UPLOAD,
        translation_key=KEY_LINK_RATE_UPLOAD,
        device_class=SensorDeviceClass.DATA_RATE,
        native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda link: link.rate_upload,
    ),
    LinkSensorDescription(
        key=KEY_WLAN_BAND,
        translation_key=KEY_WLAN_BAND,
        device_class=SensorDeviceClass.ENUM,
        options=["2_4ghz", "5ghz", "6ghz"],
        value_fn=lambda link: link.band,
    ),
    LinkSensorDescription(
        key=KEY_SSID,
        translation_key=KEY_SSID,
        value_fn=lambda link: link.ssid,
    ),
)


class FritzNetworkLinkSensor(FritzNetworkClientEntity, SensorEntity):
    """Signal, rate, band and network name of the connection; off by default."""

    entity_description: LinkSensorDescription
    _attr_entity_registry_enabled_default = False
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: FritzNetworkCoordinator,
        host: Host,
        description: LinkSensorDescription,
    ) -> None:
        super().__init__(coordinator, host, "sensor", description.key)
        self.entity_description = description

    @property
    def native_value(self) -> str | float | None:
        mesh = self.coordinator.data.mesh
        link = mesh.links.get(self._mac) if mesh else None
        return self.entity_description.value_fn(link) if link else None


class FritzNetworkClients(FritzNetworkNodeEntity, SensorEntity):
    """How many devices are connected to the box or repeater."""

    _attr_translation_key = KEY_CLIENTS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: FritzNetworkCoordinator, node: MeshNode) -> None:
        super().__init__(coordinator, node, "sensor", KEY_CLIENTS)

    @property
    def native_value(self) -> int | None:
        mesh = self.coordinator.data.mesh
        if mesh is None:
            return None
        return sum(1 for link in mesh.links.values() if link.ap_uid == self._uid)


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


class FritzNetworkLastSeen(FritzNetworkClientEntity, SensorEntity, RestoreEntity):
    """When the device was last seen.

    The value changes only on a transition, so it does not write a new state
    on every poll: going online sets it to now, going offline to the last poll
    that still saw the device. Both the value and whether the device was online
    survive a restart, so a device that stayed online keeps its connect time.
    """

    _attr_translation_key = KEY_LAST_SEEN
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_LAST_SEEN)
        self._value: datetime | None = None
        self._was_active: bool | None = None

    @property
    def extra_restore_state_data(self) -> RestoredExtraData:
        return RestoredExtraData(
            {
                "value": self._value.isoformat() if self._value else None,
                "was_active": self._was_active,
            }
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (extra := await self.async_get_last_extra_data()) is not None:
            data = extra.as_dict()
            self._value = dt_util.parse_datetime(data.get("value") or "")
            self._was_active = data.get("was_active")
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
