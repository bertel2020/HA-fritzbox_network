"""Actions: rename or wake a device, switch a route, record traffic, tidy up VPN entities."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.service import async_extract_entity_ids
import voluptuous as vol

from .capture import (
    DEFAULT_BYTES,
    DEFAULT_SECONDS,
    INTERFACE_RE,
    KEY_CAPTURES,
    MAX_BYTES,
    MAX_SECONDS,
    MIN_SECONDS,
)
from .const import (
    DOMAIN,
    KEY_VPN,
    KEY_VPN_SINCE,
    KEY_VPN_SWITCH,
    KEY_VPN_UID,
    vpn_identifier,
)
from .coordinator import FritzNetworkCoordinator
from .models import Host

NETWORK_RE = r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$"

SERVICE_SET_NAME = "set_name"
SERVICE_WAKE_ON_LAN = "wake_on_lan"
SERVICE_CAPTURE = "capture"
SERVICE_REMOVE_VPN = "remove_unavailable_vpn"
SERVICE_SET_ROUTE = "set_route"

ATTR_NAME = "name"
ATTR_NETWORK = "network"
ATTR_ENABLED = "enabled"

SET_NAME_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): vol.All(cv.string, vol.Strip, vol.Length(min=1, max=63)),
        **cv.TARGET_FIELDS,
    }
)
WAKE_ON_LAN_SCHEMA = vol.Schema({**cv.TARGET_FIELDS})
SET_ROUTE_SCHEMA = vol.Schema(
    {
        # the network as the panel names it, "10.8.0.0/24"
        vol.Required(ATTR_NETWORK): vol.All(cv.string, vol.Strip, vol.Match(NETWORK_RE)),
        vol.Required(ATTR_ENABLED): cv.boolean,
    }
)
CAPTURE_SCHEMA = vol.Schema(
    {
        vol.Optional("interface", default="1-lan"): vol.Match(INTERFACE_RE),
        vol.Optional("duration", default=DEFAULT_SECONDS): vol.All(
            int, vol.Range(min=MIN_SECONDS, max=MAX_SECONDS)
        ),
        vol.Optional("size", default=DEFAULT_BYTES // 1048576): vol.All(
            int, vol.Range(min=1, max=MAX_BYTES // 1048576)
        ),
        **cv.TARGET_FIELDS,
    }
)


async def _async_targets(
    hass: HomeAssistant, call: ServiceCall
) -> list[tuple[FritzNetworkCoordinator, Host]]:
    """The devices of this integration a call aims at, by device, area or entity."""
    registry = er.async_get(hass)
    macs: set[str] = set()
    for entity_id in await async_extract_entity_ids(call):
        entry = registry.async_get(entity_id)
        if entry is not None and entry.platform == DOMAIN:
            # unique ids of client entities are "<mac>" or "<mac>_<key>"
            macs.add(entry.unique_id.split("_")[0])
    targets = [
        (config_entry.runtime_data, host)
        for config_entry in hass.config_entries.async_loaded_entries(DOMAIN)
        for host in config_entry.runtime_data.all_hosts.values()
        if host.mac in macs
    ]
    if not targets:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_target")
    return targets


def _require_rights(coordinator: FritzNetworkCoordinator) -> None:
    if not coordinator.can_write:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_write_rights")


async def _async_failing(awaitable) -> None:
    try:
        await awaitable
    except FritzConnectionException as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="action_failed",
            translation_placeholders={"error": str(err)},
        ) from err


async def _async_set_name(call: ServiceCall) -> None:
    for coordinator, host in await _async_targets(call.hass, call):
        _require_rights(coordinator)
        await _async_failing(coordinator.async_set_name(host, call.data[ATTR_NAME]))


async def _async_wake_on_lan(call: ServiceCall) -> None:
    for coordinator, host in await _async_targets(call.hass, call):
        _require_rights(coordinator)
        await _async_failing(coordinator.async_wake_on_lan(host))


async def _async_set_route(call: ServiceCall) -> None:
    """Switch a static route of the box on or off, found by its network."""
    unknown = None
    for config_entry in call.hass.config_entries.async_loaded_entries(DOMAIN):
        coordinator = config_entry.runtime_data
        _require_rights(coordinator)
        try:
            await coordinator.async_set_route(call.data[ATTR_NETWORK], call.data[ATTR_ENABLED])
        except ServiceValidationError as err:
            if err.translation_key != "route_unknown":
                raise
            unknown = err  # another box may have the route
        else:
            return
    if unknown is not None:
        raise unknown
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_target")


async def _async_capture(call: ServiceCall) -> None:
    """Record the traffic of the box, of one device if the call names one; it runs on its own."""
    hass = call.hass
    has_target = any(
        call.data.get(key) for key in ("entity_id", "device_id", "area_id", "label_id")
    )
    if has_target:
        pairs = await _async_targets(hass, call)
    else:
        pairs = [
            (entry.runtime_data, None) for entry in hass.config_entries.async_loaded_entries(DOMAIN)
        ][:1]
    if not pairs:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_target")
    # one recording at a time per box; the first device is the one narrowed to
    coordinator, host = pairs[0]
    manager = hass.data[KEY_CAPTURES][coordinator.config_entry.entry_id]
    try:
        manager.start(
            call.data["interface"],
            call.data["duration"],
            call.data["size"] * 1048576,
            host.mac if host else None,
            (host.ip,) if host and host.ip else (),
        )
    except ValueError as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="capture_busy"
        ) from err


VPN_UNIQUE_ID_KEYS = (KEY_VPN, KEY_VPN_SWITCH, KEY_VPN_SINCE, KEY_VPN_UID)


def stale_vpn_entities(
    registry: er.EntityRegistry, coordinator: FritzNetworkCoordinator
) -> list[er.RegistryEntry]:
    """The WireGuard entities of a box for connections it does not list any more.

    Nothing is stale while the box tells no list at all, so a box that is starting up or has
    dropped the session never costs anyone their entities.
    """
    connections = coordinator.data.vpn
    if connections is None:
        return []
    serial = coordinator.serial
    wanted = {
        f"{serial}_{kind}_{connection.key}"
        for connection in connections
        for kind in VPN_UNIQUE_ID_KEYS
    }
    return [
        entry
        for entry in er.async_entries_for_config_entry(registry, coordinator.config_entry.entry_id)
        if entry.unique_id.startswith(f"{serial}_{KEY_VPN}") and entry.unique_id not in wanted
    ]


def _remove_empty_vpn_device(
    hass: HomeAssistant, registry: er.EntityRegistry, coordinator: FritzNetworkCoordinator
) -> None:
    """Take the WireGuard device away once no connection has an entity on it."""
    devices = dr.async_get(hass)
    device = devices.async_get_device(identifiers={(DOMAIN, vpn_identifier(coordinator.serial))})
    if device and not er.async_entries_for_device(
        registry, device.id, include_disabled_entities=True
    ):
        devices.async_remove_device(device.id)


async def _async_remove_unavailable_vpn(call: ServiceCall) -> None:
    """Remove the entities of WireGuard connections that no longer exist on the box."""
    registry = er.async_get(call.hass)
    for config_entry in call.hass.config_entries.async_loaded_entries(DOMAIN):
        for entry in stale_vpn_entities(registry, config_entry.runtime_data):
            registry.async_remove(entry.entity_id)
        _remove_empty_vpn_device(call.hass, registry, config_entry.runtime_data)


def async_register(hass: HomeAssistant) -> None:
    hass.services.async_register(DOMAIN, SERVICE_SET_NAME, _async_set_name, SET_NAME_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_WAKE_ON_LAN, _async_wake_on_lan, WAKE_ON_LAN_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_CAPTURE, _async_capture, CAPTURE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SET_ROUTE, _async_set_route, SET_ROUTE_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_VPN, _async_remove_unavailable_vpn, vol.Schema({})
    )
