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
    PERCENTAGE,
    SIGNAL_STRENGTH_DECIBELS,
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    EntityCategory,
    UnitOfDataRate,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoredExtraData, RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    KEY_ACCESS_POINT,
    KEY_CLIENTS,
    KEY_CONNECTION_TYPE,
    KEY_DEVICES_OFFLINE,
    KEY_DEVICES_ONLINE,
    KEY_DEVICES_TOTAL,
    KEY_DSL_ATTENUATION_DOWN,
    KEY_DSL_ATTENUATION_UP,
    KEY_DSL_CRC_ERRORS,
    KEY_DSL_FEC_ERRORS,
    KEY_DSL_NOISE_DOWN,
    KEY_DSL_NOISE_UP,
    KEY_DSL_RATE_DOWN,
    KEY_DSL_RATE_UP,
    KEY_EXTERNAL_IPV4,
    KEY_EXTERNAL_IPV6,
    KEY_FAILED_POLLS,
    KEY_INTERNET_DOWNLOAD,
    KEY_INTERNET_UPLOAD,
    KEY_INTERNET_UPTIME,
    KEY_IP_ADDRESS,
    KEY_LAST_ONLINE,
    KEY_LAST_UPDATE,
    KEY_LINK_RATE_DOWNLOAD,
    KEY_LINK_RATE_UPLOAD,
    KEY_MESH_STATUS,
    KEY_ONLINE_SINCE,
    KEY_RADIO_CHANNEL,
    KEY_RADIO_NOISE,
    KEY_RADIO_UTILIZATION,
    KEY_SIGNAL_STRENGTH,
    KEY_SSID,
    KEY_VENDOR,
    KEY_VPN_SINCE,
    KEY_VPN_STATUS,
    KEY_VPN_UID,
    KEY_WLAN_BAND,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    FritzNetworkNodeEntity,
    async_remove_node_client_entities,
    async_setup_client_entities,
    async_setup_node_entities,
    is_mesh_node,
)
from .models import ClientLink, Host, InternetInfo, MeshNode, Radio, VpnConnection
from .vendor import vendor_of

CONNECTION_LAN = "lan"
CONNECTION_WLAN = "wlan"
MESH_AVAILABLE = "available"
MESH_UNAVAILABLE = "unavailable"


PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_remove_node_client_entities(hass, entry, "sensor", (KEY_ACCESS_POINT, KEY_LAST_ONLINE))
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [
            FritzNetworkIpAddress(coordinator, host),
            FritzNetworkConnectionType(coordinator, host),
            FritzNetworkOnlineSince(coordinator, host),
            # the box and the repeaters are no clients at an access point, and always on
            *(
                []
                if is_mesh_node(coordinator, host)
                else [
                    FritzNetworkAccessPoint(coordinator, host),
                    FritzNetworkLastOnline(coordinator, host),
                ]
            ),
        ],
    )
    # only for devices with a vendor behind their MAC: a randomized address has none
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            [FritzNetworkVendor(coordinator, host)]
            if not is_mesh_node(coordinator, host) and vendor_of(host.mac)
            else []
        ),
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
        lambda coordinator, node: [
            FritzNetworkClients(coordinator, node),
            *(
                FritzNetworkRadio(coordinator, node, band, description)
                for band in node.radios
                for description in RADIO_SENSORS
            ),
        ],
    )

    coordinator = entry.runtime_data
    async_add_entities(
        [
            FritzNetworkDevicesOnline(coordinator),
            FritzNetworkDevicesOffline(coordinator),
            FritzNetworkDevicesTotal(coordinator),
            FritzNetworkLastUpdate(coordinator),
            FritzNetworkFailedPolls(coordinator),
            FritzNetworkMeshStatus(coordinator),
        ]
    )
    _async_setup_internet(coordinator, entry, async_add_entities)
    _async_setup_vpn(coordinator, entry, async_add_entities)


@callback
def _async_setup_vpn(
    coordinator: FritzNetworkCoordinator,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Status, time of connection and identifier for each WireGuard connection."""
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [c for c in coordinator.data.vpn or () if c.key not in known]
        if not new:
            return
        known.update(c.key for c in new)
        async_add_entities(
            FritzNetworkVpnSensor(coordinator, c, description)
            for c in new
            for description in VPN_SENSORS
        )

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_internet(
    coordinator: FritzNetworkCoordinator,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """The sensors of the internet connection, once the box has told about it.

    Not every box does, and a DSL line only has the line values: what is missing at the start
    is added when it shows up.
    """
    added: set[bool] = set()

    @callback
    def _add() -> None:
        internet = coordinator.data.internet
        if internet is None:
            return
        for dsl in (False, True):
            if dsl in added or (dsl and internet.dsl is None):
                continue
            added.add(dsl)
            async_add_entities(
                FritzNetworkInternetSensor(coordinator, description)
                for description in INTERNET_SENSORS
                if description.dsl is dsl
            )

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


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


@dataclass(frozen=True, kw_only=True)
class RadioSensorDescription(SensorEntityDescription):
    """A measurement of one Wi-Fi radio of an access point."""

    value_fn: Callable[[Radio], int | None]


RADIO_SENSORS = (
    RadioSensorDescription(
        key=KEY_RADIO_CHANNEL,
        translation_key=KEY_RADIO_CHANNEL,
        value_fn=lambda radio: radio.channel,
    ),
    RadioSensorDescription(
        key=KEY_RADIO_UTILIZATION,
        translation_key=KEY_RADIO_UTILIZATION,
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda radio: radio.utilization,
    ),
    RadioSensorDescription(
        key=KEY_RADIO_NOISE,
        translation_key=KEY_RADIO_NOISE,
        native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda radio: radio.noise_dbm,
    ),
)

BAND_NAMES = {"2_4ghz": "2.4 GHz", "5ghz": "5 GHz", "6ghz": "6 GHz"}


class FritzNetworkRadio(FritzNetworkNodeEntity, SensorEntity):
    """Channel, load and noise of one Wi-Fi radio of the box or a repeater."""

    entity_description: RadioSensorDescription
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(
        self,
        coordinator: FritzNetworkCoordinator,
        node: MeshNode,
        band: str,
        description: RadioSensorDescription,
    ) -> None:
        super().__init__(coordinator, node, "sensor", f"{description.key}_{band}")
        self.entity_description = description
        self._band = band
        self._attr_translation_placeholders = {"band": BAND_NAMES.get(band, band)}

    @property
    def native_value(self) -> int | None:
        node = self.node
        radio = node.radios.get(self._band) if node else None
        return self.entity_description.value_fn(radio) if radio else None


class FritzNetworkClients(FritzNetworkNodeEntity, SensorEntity):
    """How many devices are connected to the box or repeater."""

    _attr_translation_key = KEY_CLIENTS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: FritzNetworkCoordinator, node: MeshNode) -> None:
        super().__init__(coordinator, node, "sensor", KEY_CLIENTS)

    @property
    def native_value(self) -> int | None:
        mesh = self.coordinator.data.mesh
        node = self.node
        if mesh is None or node is None:
            return None
        return sum(1 for link in mesh.links.values() if link.ap_uid == node.uid)


class FritzNetworkIpAddress(FritzNetworkClientEntity, SensorEntity):
    _attr_translation_key = KEY_IP_ADDRESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_IP_ADDRESS)

    @property
    def native_value(self) -> str | None:
        return host.ip if (host := self.host) else None


class FritzNetworkVendor(FritzNetworkClientEntity, SensorEntity):
    """The vendor behind the MAC address, whatever the option for the device info says."""

    _attr_translation_key = KEY_VENDOR
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "sensor", KEY_VENDOR)

    @property
    def native_value(self) -> str | None:
        return vendor_of(self._mac)


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


class _ConnectionTime(FritzNetworkClientEntity, SensorEntity, RestoreEntity):
    """The time of the last transition between online and offline.

    The value changes only on a transition, so it does not write a new state
    on every poll: going online sets it to now, going offline to the last poll
    that still saw the device. Both the value and whether the device was online
    survive a restart, so a device that stayed online keeps its connect time.
    """

    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host, key: str) -> None:
        super().__init__(coordinator, host, "sensor", key)
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


class FritzNetworkOnlineSince(_ConnectionTime):
    """Since when the device is online; unknown while it is offline."""

    _attr_translation_key = KEY_ONLINE_SINCE

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, KEY_ONLINE_SINCE)

    @property
    def native_value(self) -> datetime | None:
        return self._value if self._was_active else None


class FritzNetworkLastOnline(_ConnectionTime):
    """When the device was online the last time; unknown while it is online."""

    _attr_translation_key = KEY_LAST_ONLINE

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, KEY_LAST_ONLINE)

    @property
    def native_value(self) -> datetime | None:
        return self._value if self._was_active is False else None


class _BoxSensor(CoordinatorEntity[FritzNetworkCoordinator], SensorEntity):
    """A sensor of the box device itself."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: FritzNetworkCoordinator, key: str) -> None:
        super().__init__(coordinator)
        self._attr_translation_key = key
        self._attr_unique_id = f"{coordinator.serial}_{key}"
        self.entity_id = f"sensor.fritz_network_{key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})


class _DeviceCount(_BoxSensor):
    """How many of the devices in the network (after the filters) are in a state."""

    _attr_state_class = SensorStateClass.MEASUREMENT


class FritzNetworkDevicesOnline(_DeviceCount):
    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_DEVICES_ONLINE)

    @property
    def native_value(self) -> int:
        return sum(self.coordinator.is_connected(h) for h in self.coordinator.data.hosts.values())


class FritzNetworkDevicesOffline(_DeviceCount):
    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_DEVICES_OFFLINE)

    @property
    def native_value(self) -> int:
        return sum(
            not self.coordinator.is_connected(h) for h in self.coordinator.data.hosts.values()
        )


class FritzNetworkDevicesTotal(_DeviceCount):
    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_DEVICES_TOTAL)

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.hosts)


@dataclass(frozen=True, kw_only=True)
class InternetSensorDescription(SensorEntityDescription):
    """A value of the internet connection; ``dsl`` for the ones of the DSL line."""

    value_fn: Callable[[FritzNetworkCoordinator, InternetInfo], str | float | int | None]
    dsl: bool = False


def _mbit(kbit: int | float | None) -> float | None:
    return None if kbit is None else round(kbit / 1000, 3)


def _measurement(key: str, **kwargs) -> dict:
    return {
        "key": key,
        "translation_key": key,
        "state_class": SensorStateClass.MEASUREMENT,
        "entity_category": EntityCategory.DIAGNOSTIC,
        "entity_registry_enabled_default": False,
        **kwargs,
    }


INTERNET_SENSORS = (
    # the throughput is what the history is for: on from the start
    InternetSensorDescription(
        **_measurement(
            KEY_INTERNET_DOWNLOAD,
            device_class=SensorDeviceClass.DATA_RATE,
            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
            entity_category=None,
            entity_registry_enabled_default=True,
        ),
        value_fn=lambda c, i: _mbit(c.internet_rate[0]) if c.internet_rate else None,
    ),
    InternetSensorDescription(
        **_measurement(
            KEY_INTERNET_UPLOAD,
            device_class=SensorDeviceClass.DATA_RATE,
            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
            entity_category=None,
            entity_registry_enabled_default=True,
        ),
        value_fn=lambda c, i: _mbit(c.internet_rate[1]) if c.internet_rate else None,
    ),
    InternetSensorDescription(
        **_measurement(
            KEY_INTERNET_UPTIME,
            device_class=SensorDeviceClass.DURATION,
            native_unit_of_measurement=UnitOfTime.SECONDS,
        ),
        value_fn=lambda c, i: i.uptime,
    ),
    InternetSensorDescription(
        key=KEY_EXTERNAL_IPV4,
        translation_key=KEY_EXTERNAL_IPV4,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda c, i: i.external_ipv4,
    ),
    InternetSensorDescription(
        key=KEY_EXTERNAL_IPV6,
        translation_key=KEY_EXTERNAL_IPV6,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda c, i: i.external_ipv6,
    ),
    InternetSensorDescription(
        **_measurement(
            KEY_DSL_RATE_DOWN,
            device_class=SensorDeviceClass.DATA_RATE,
            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
        ),
        dsl=True,
        value_fn=lambda c, i: _mbit(i.dsl.rate_down),
    ),
    InternetSensorDescription(
        **_measurement(
            KEY_DSL_RATE_UP,
            device_class=SensorDeviceClass.DATA_RATE,
            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
        ),
        dsl=True,
        value_fn=lambda c, i: _mbit(i.dsl.rate_up),
    ),
    InternetSensorDescription(
        **_measurement(KEY_DSL_NOISE_DOWN, native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS),
        dsl=True,
        value_fn=lambda c, i: i.dsl.noise_margin_down,
    ),
    InternetSensorDescription(
        **_measurement(KEY_DSL_NOISE_UP, native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS),
        dsl=True,
        value_fn=lambda c, i: i.dsl.noise_margin_up,
    ),
    InternetSensorDescription(
        **_measurement(
            KEY_DSL_ATTENUATION_DOWN, native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS
        ),
        dsl=True,
        value_fn=lambda c, i: i.dsl.attenuation_down,
    ),
    InternetSensorDescription(
        **_measurement(KEY_DSL_ATTENUATION_UP, native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS),
        dsl=True,
        value_fn=lambda c, i: i.dsl.attenuation_up,
    ),
    InternetSensorDescription(
        **_measurement(KEY_DSL_FEC_ERRORS, state_class=SensorStateClass.TOTAL_INCREASING),
        dsl=True,
        value_fn=lambda c, i: i.dsl.fec_errors,
    ),
    InternetSensorDescription(
        **_measurement(KEY_DSL_CRC_ERRORS, state_class=SensorStateClass.TOTAL_INCREASING),
        dsl=True,
        value_fn=lambda c, i: i.dsl.crc_errors,
    ),
)


class FritzNetworkInternetSensor(_BoxSensor):
    """A value of the internet connection of the box."""

    entity_description: InternetSensorDescription

    def __init__(
        self, coordinator: FritzNetworkCoordinator, description: InternetSensorDescription
    ) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def available(self) -> bool:
        internet = self.coordinator.data.internet
        has_line = internet is not None and (
            internet.dsl is not None or not self.entity_description.dsl
        )
        return super().available and has_line

    @property
    def native_value(self) -> str | float | int | None:
        internet = self.coordinator.data.internet
        if internet is None or (self.entity_description.dsl and internet.dsl is None):
            return None
        return self.entity_description.value_fn(self.coordinator, internet)


class _BoxDiagnostic(_BoxSensor):
    """A diagnostic value of the connection to the box, off by default.

    It stays available while polls fail: that is when it is needed.
    """

    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    @property
    def available(self) -> bool:
        return True


class FritzNetworkLastUpdate(_BoxDiagnostic):
    """When the box was last polled successfully."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_LAST_UPDATE)

    @property
    def native_value(self) -> datetime | None:
        return self.coordinator.last_success


class FritzNetworkFailedPolls(_BoxDiagnostic):
    """How many polls in a row failed."""

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_FAILED_POLLS)

    @property
    def native_value(self) -> int:
        return self.coordinator.failed_polls


class FritzNetworkMeshStatus(_BoxDiagnostic):
    """Whether the mesh topology came with the last poll."""

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = [MESH_AVAILABLE, MESH_UNAVAILABLE]

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator, KEY_MESH_STATUS)

    @property
    def native_value(self) -> str:
        return MESH_AVAILABLE if self.coordinator.data.mesh else MESH_UNAVAILABLE


VPN_STATE_CONNECTED = "connected"
VPN_STATE_IDLE = "not_connected"
VPN_STATE_OFF = "off"


def _vpn_status(connection: VpnConnection) -> str:
    if connection.connected:
        return VPN_STATE_CONNECTED
    return VPN_STATE_IDLE if connection.active else VPN_STATE_OFF


def _vpn_since(connection: VpnConnection) -> datetime | None:
    return dt_util.utc_from_timestamp(connection.since) if connection.since else None


@dataclass(frozen=True, kw_only=True)
class VpnSensorDescription(SensorEntityDescription):
    """A value of a WireGuard connection."""

    value: Callable[[VpnConnection], str | datetime | None]


VPN_SENSORS: tuple[VpnSensorDescription, ...] = (
    VpnSensorDescription(
        key=KEY_VPN_STATUS,
        translation_key=KEY_VPN_STATUS,
        device_class=SensorDeviceClass.ENUM,
        options=[VPN_STATE_CONNECTED, VPN_STATE_IDLE, VPN_STATE_OFF],
        value=_vpn_status,
    ),
    VpnSensorDescription(
        key=KEY_VPN_SINCE,
        translation_key=KEY_VPN_SINCE,
        device_class=SensorDeviceClass.TIMESTAMP,
        value=_vpn_since,
    ),
    VpnSensorDescription(
        key=KEY_VPN_UID,
        translation_key=KEY_VPN_UID,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value=lambda connection: connection.uid,
    ),
)


class FritzNetworkVpnSensor(CoordinatorEntity[FritzNetworkCoordinator], SensorEntity):
    """A value of a WireGuard connection of the box, found again by its name."""

    _attr_has_entity_name = True
    entity_description: VpnSensorDescription

    def __init__(
        self,
        coordinator: FritzNetworkCoordinator,
        connection: VpnConnection,
        description: VpnSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._key = connection.key
        self._attr_unique_id = f"{coordinator.serial}_{description.key}_{connection.key}"
        self._attr_translation_placeholders = {"name": connection.name}
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def connection(self) -> VpnConnection | None:
        return self.coordinator.vpn_by_key(self._key)

    @property
    def available(self) -> bool:
        return super().available and self.connection is not None

    @property
    def native_value(self) -> str | datetime | None:
        connection = self.connection
        return self.entity_description.value(connection) if connection else None
