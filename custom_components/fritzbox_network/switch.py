"""Internet access switch per client device."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity, UpdateFailed

from .const import (
    DOMAIN,
    KEY_AUTO_WOL,
    KEY_GUEST_WIFI,
    KEY_INTERNET_ACCESS,
    KEY_PORT_PREFIX,
    KEY_PRIORITY,
    KEY_ROUTE_SWITCH,
    KEY_VPN_SWITCH,
    KEY_WIFI_PREFIX,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import (
    FritzNetworkClientEntity,
    FritzNetworkRepeaterEntity,
    async_remove_node_client_entities,
    async_setup_client_entities,
    is_mesh_node,
    vpn_device_info,
)
from .models import Host, PortRule, VpnConnection, WifiNetwork
from .repeater import RepeaterCoordinator

_LOGGER = logging.getLogger(__name__)

# The box keeps the automatic Wake on LAN per device, not in the host list: every
# device that has the switch enabled is asked now and then, one after the other.
PARALLEL_UPDATES = 1
SCAN_INTERVAL = timedelta(minutes=10)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if not entry.runtime_data.can_write:
        return
    async_remove_node_client_entities(
        hass, entry, "switch", (KEY_INTERNET_ACCESS, KEY_PRIORITY, KEY_AUTO_WOL)
    )
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: (
            # the box and the repeaters are no clients: blocking one would cut off what hangs on it
            []
            if is_mesh_node(coordinator, host)
            else [
                FritzNetworkInternetAccess(coordinator, host),
                FritzNetworkPriority(coordinator, host),
                # like the Wake on LAN button: not for devices known to sit on Wi-Fi
                *(
                    [FritzNetworkAutoWakeOnLan(coordinator, host)]
                    if coordinator.wants_wake_on_lan(host)
                    else []
                ),
            ]
        ),
    )
    _async_setup_guest_wifi(entry, async_add_entities)
    _async_setup_wifi(entry, async_add_entities)
    _async_setup_ports(entry, async_add_entities)
    for repeater in entry.runtime_data.repeaters.values():
        _async_setup_repeater_wifi(repeater, entry, async_add_entities)
    _async_setup_vpn(entry, async_add_entities)
    _async_setup_routes(hass, entry, async_add_entities)


@callback
def _async_setup_wifi(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """A switch for each Wi-Fi network of the box that is no guest network, one per band."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [key for key in coordinator.data.wifi or () if key not in known]
        if not new:
            return
        known.update(new)
        async_add_entities([FritzNetworkWifi(coordinator, key) for key in new])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_repeater_wifi(
    repeater: RepeaterCoordinator,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """A switch for each band of a repeater, once the repeater has told its networks."""
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [key for key in (repeater.data.wifi if repeater.data else {}) if key not in known]
        if not new:
            return
        known.update(new)
        async_add_entities([FritzNetworkRepeaterWifi(repeater, key) for key in new])

    _add()
    entry.async_on_unload(repeater.async_add_listener(_add))


@callback
def _async_setup_ports(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """A switch for each port forwarding of the box, off by default: it opens a port."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [key for key in coordinator.data.port_rules or () if key not in known]
        if not new:
            return
        known.update(new)
        async_add_entities([FritzNetworkPort(coordinator, key) for key in new])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_guest_wifi(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """The guest Wi-Fi switch, once the box has told it has a guest network."""
    coordinator = entry.runtime_data
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or coordinator.data.guest_wifi is None:
            return
        added = True
        async_add_entities([FritzNetworkGuestWifi(coordinator)])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_vpn(
    entry: FritzNetworkConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """A switch for each WireGuard connection the box lets us change."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add() -> None:
        new = [c for c in coordinator.data.vpn or () if c.editable and c.key not in known]
        if not new:
            return
        known.update(c.key for c in new)
        async_add_entities([FritzNetworkVpnSwitch(coordinator, c) for c in new])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_routes(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """A switch for each static route of the box; one that is gone from the box goes with it.

    A route is added when it shows up in the list, whoever made it. The entity of a route that is
    no longer there is removed once the coordinator calls it gone (the box missed it in two reads
    in a row, or it was deleted in the panel). At the first list, entities of an earlier run whose
    route has vanished since are removed as well.
    """
    coordinator = entry.runtime_data
    registry = er.async_get(hass)
    prefix = f"{coordinator.serial}_{KEY_ROUTE_SWITCH}_"
    known: set[str] = set()
    cleaned = False

    @callback
    def _remove(network: str) -> None:
        entity_id = registry.async_get_entity_id("switch", DOMAIN, f"{prefix}{network}")
        if entity_id:
            registry.async_remove(entity_id)

    @callback
    def _update() -> None:
        nonlocal cleaned
        routes = coordinator.data.routes
        if routes is None:
            return
        present = {route["network"] for route in routes}
        if not cleaned:
            cleaned = True
            for item in er.async_entries_for_config_entry(registry, entry.entry_id):
                if item.domain != "switch" or not item.unique_id.startswith(prefix):
                    continue
                if item.unique_id[len(prefix) :] not in present:
                    registry.async_remove(item.entity_id)
        for network in list(coordinator.routes_gone):
            coordinator.routes_gone.discard(network)
            if network not in present:
                known.discard(network)
                _remove(network)
        new = [route["network"] for route in routes if route["network"] not in known]
        if new:
            known.update(new)
            async_add_entities([FritzNetworkRouteSwitch(coordinator, network) for network in new])

    _update()
    entry.async_on_unload(coordinator.async_add_listener(_update))


class FritzNetworkRouteSwitch(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """A static route of the box, switched on or off. Routes are made and deleted in the panel."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_ROUTE_SWITCH

    def __init__(self, coordinator: FritzNetworkCoordinator, network: str) -> None:
        super().__init__(coordinator)
        self._network = network
        self._attr_unique_id = f"{coordinator.serial}_{KEY_ROUTE_SWITCH}_{network}"
        self._attr_translation_placeholders = {"network": network}
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def route(self) -> dict[str, Any] | None:
        return next(
            (r for r in self.coordinator.data.routes or () if r["network"] == self._network), None
        )

    @property
    def available(self) -> bool:
        return super().available and self.route is not None

    @property
    def is_on(self) -> bool | None:
        route = self.route
        return route["enabled"] if route else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        route = self.route
        if route is None:
            return None
        host = next(
            (
                h
                for h in self.coordinator.data.hosts.values()
                if route["gateway"] and h.ip == route["gateway"]
            ),
            None,
        )
        return {
            "network": route["network"],
            "gateway": route["gateway"],
            "gateway_device": host.name if host else None,
            "gateway_online": host.active if host else None,
            "interface": route["interface"],
            "metric": route["metric"],
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_route(self._network, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_route(self._network, False)


class FritzNetworkVpnSwitch(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """A WireGuard connection of the box, switched on or off (not connected or not)."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_VPN_SWITCH

    def __init__(self, coordinator: FritzNetworkCoordinator, connection: VpnConnection) -> None:
        super().__init__(coordinator)
        self._key = connection.key
        self._attr_unique_id = f"{coordinator.serial}_{KEY_VPN_SWITCH}_{connection.key}"
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
        return connection.active if connection else None

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_vpn(self._key, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_vpn(self._key, False)


class FritzNetworkWifi(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """The Wi-Fi network of one band: on or off.

    The name carries the network name, because two bands often have the same one. The box can
    be reached over Wi-Fi: switching off the network that Home Assistant uses cuts it off.
    """

    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: FritzNetworkCoordinator, band: str) -> None:
        super().__init__(coordinator)
        self._band = band
        key = f"{KEY_WIFI_PREFIX}{band}"
        self._attr_translation_key = key
        self._attr_unique_id = f"{coordinator.serial}_{key}"
        self.entity_id = f"switch.fritz_network_{key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})
        network = self._network
        self._attr_translation_placeholders = {"ssid": (network.ssid if network else "") or ""}

    @property
    def _network(self) -> WifiNetwork | None:
        return (self.coordinator.data.wifi or {}).get(self._band)

    @property
    def available(self) -> bool:
        return super().available and self._network is not None

    @property
    def is_on(self) -> bool | None:
        network = self._network
        return network.enabled if network else None

    @property
    def extra_state_attributes(self) -> dict[str, str | None] | None:
        if (network := self._network) is None:
            return None
        return {"ssid": network.ssid, "bssid": network.bssid, "standard": network.standard}

    async def _set(self, value: bool) -> None:
        try:
            await self.coordinator.async_set_wifi(self._band, value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class FritzNetworkRepeaterWifi(FritzNetworkRepeaterEntity, SwitchEntity):
    """The Wi-Fi network of one band of a repeater. Whether the box overrides it is not known."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: RepeaterCoordinator, band: str) -> None:
        key = f"{KEY_WIFI_PREFIX}{band}"
        super().__init__(coordinator, "switch", key)
        self._band = band
        self._attr_translation_key = key
        network = self._network
        self._attr_translation_placeholders = {"ssid": (network.ssid if network else "") or ""}

    @property
    def _network(self) -> WifiNetwork | None:
        data = self.coordinator.data
        return data.wifi.get(self._band) if data else None

    @property
    def available(self) -> bool:
        return super().available and self._network is not None

    @property
    def is_on(self) -> bool | None:
        network = self._network
        return network.enabled if network else None

    async def _set(self, value: bool) -> None:
        try:
            await self.coordinator.async_set_wifi(self._band, value)
        except (FritzConnectionException, UpdateFailed) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class FritzNetworkPort(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """A port forwarding of the box, on or off.

    Off by default, because switching one on opens a port to the internet: whoever turns the
    entity on has decided that. The forwardings are read only while such a switch is on. A
    forwarding a device opened by UPnP is in the list as well; the device may enter it again.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "port"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, key: str) -> None:
        super().__init__(coordinator)
        self._key = key
        self._attr_unique_id = f"{coordinator.serial}_{KEY_PORT_PREFIX}{key}"
        self.entity_id = f"switch.fritz_network_{KEY_PORT_PREFIX}{key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})
        rule = self._rule
        label = (rule.description if rule else None) or key
        self._attr_translation_placeholders = {"name": label}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # an entity that is off costs no request: only this one asks for the values
        self.async_on_remove(self.coordinator.async_want_port_rules())

    @property
    def _rule(self) -> PortRule | None:
        return (self.coordinator.data.port_rules or {}).get(self._key)

    @property
    def available(self) -> bool:
        return super().available and self._rule is not None

    @property
    def is_on(self) -> bool | None:
        rule = self._rule
        return rule.enabled if rule else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if (rule := self._rule) is None:
            return None
        return {
            "protocol": rule.protocol,
            "external_port": rule.external_port,
            "internal_port": rule.internal_port,
            "internal_client": rule.internal_client,
            "lease_seconds": rule.lease,
        }

    async def _set(self, value: bool) -> None:
        try:
            await self.coordinator.async_set_port_rule(self._key, value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class FritzNetworkGuestWifi(CoordinatorEntity[FritzNetworkCoordinator], SwitchEntity):
    """The guest Wi-Fi of the box, on or off."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_GUEST_WIFI

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.serial}_{KEY_GUEST_WIFI}"
        self.entity_id = f"switch.fritz_network_{KEY_GUEST_WIFI}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.data.guest_wifi is not None

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.guest_wifi

    async def _set(self, value: bool) -> None:
        try:
            await self.coordinator.async_set_guest_wifi(value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class _HostSwitch(FritzNetworkClientEntity, SwitchEntity):
    """A switch the box takes by IPv4 address."""

    @property
    def available(self) -> bool:
        # The box acts by IPv4 address, a host without one cannot be switched.
        return super().available and bool(self.host and self.host.ip)

    async def _call(self, host: Host, value: bool) -> None:
        raise NotImplementedError

    async def _set(self, value: bool) -> None:
        host = self.host
        if host is None or not host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_ipv4_address")
        try:
            await self._call(host, value)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class FritzNetworkInternetAccess(_HostSwitch):
    """On = the device may use the internet."""

    _attr_translation_key = KEY_INTERNET_ACCESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_INTERNET_ACCESS)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None or host.wan_access is None else host.wan_access

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_internet_access(host, value)


class FritzNetworkPriority(_HostSwitch):
    """On = the router prefers the device when the line is busy."""

    _attr_translation_key = KEY_PRIORITY
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_PRIORITY)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None else host.priority

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_priority(host, value)


class FritzNetworkAutoWakeOnLan(FritzNetworkClientEntity, SwitchEntity):
    """On = the box wakes the device itself when something wants to reach it."""

    _attr_translation_key = KEY_AUTO_WOL
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_AUTO_WOL)
        self._enabled: bool | None = None

    @property
    def should_poll(self) -> bool:
        return True

    @property
    def available(self) -> bool:
        return super().available and self._enabled is not None

    @property
    def is_on(self) -> bool | None:
        return self._enabled

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_schedule_update_ha_state(True)

    async def async_update(self) -> None:
        try:
            self._enabled = await self.hass.async_add_executor_job(
                self.coordinator.client.get_auto_wol, self._mac
            )
        except (FritzConnectionException, OSError, KeyError) as err:
            _LOGGER.debug("Automatic Wake on LAN of %s unavailable: %s", self._mac, err)
            self._enabled = None

    async def _set(self, value: bool) -> None:
        try:
            await self.hass.async_add_executor_job(
                self.coordinator.client.set_auto_wol, self._mac, value
            )
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err
        self._enabled = value
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
