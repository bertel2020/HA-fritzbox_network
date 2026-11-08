"""Actions: rename or wake a device, switch a route, record traffic, tidy up VPN entities."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError, Unauthorized
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
from .models import Host, split_client_uid

NETWORK_RE = r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$"

SERVICE_SET_NAME = "set_name"
SERVICE_WAKE_ON_LAN = "wake_on_lan"
SERVICE_CAPTURE = "capture"
SERVICE_REMOVE_VPN = "remove_unavailable_vpn"
SERVICE_SET_ROUTE = "set_route"
SERVICE_SET_GUEST_PASSWORD = "set_guest_wifi_password"

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
SET_GUEST_PASSWORD_SCHEMA = vol.Schema(
    {
        # a WPA passphrase: 8 to 63 printable ASCII characters; without one a random one is made
        vol.Optional("password"): vol.All(
            cv.string, vol.Length(min=8, max=63), vol.Match(r"^[\x20-\x7e]+$")
        ),
        vol.Optional("length", default=12): vol.All(int, vol.Range(min=8, max=63)),
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
    # (box, MAC): an entity belongs to one box, and only that box is asked about its device
    wanted: set[tuple[str, str]] = set()
    for entity_id in await async_extract_entity_ids(call):
        entry = registry.async_get(entity_id)
        if entry is None or entry.platform != DOMAIN or entry.config_entry_id is None:
            continue
        config_entry = hass.config_entries.async_get_entry(entry.config_entry_id)
        if config_entry is None or config_entry.state is not ConfigEntryState.LOADED:
            continue
        # unique ids of client entities are "<box>_<mac>" or "<box>_<mac>_<key>"
        serial = config_entry.runtime_data.serial
        if (parts := split_client_uid(entry.unique_id, serial)) is not None:
            wanted.add((config_entry.entry_id, parts[0]))
    targets = [
        (config_entry.runtime_data, host)
        for config_entry in hass.config_entries.async_loaded_entries(DOMAIN)
        for host in config_entry.runtime_data.all_hosts.values()
        if (config_entry.entry_id, host.mac) in wanted
    ]
    if not targets:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_target")
    return targets


async def _require_admin(call: ServiceCall) -> None:
    """Only an administrator may act on the box; calls without a user (automations) pass."""
    if call.context.user_id is None:
        return
    user = await call.hass.auth.async_get_user(call.context.user_id)
    if user is None or not user.is_admin:
        raise Unauthorized(context=call.context)


def _require_rights(coordinator: FritzNetworkCoordinator) -> None:
    if not coordinator.can_write:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_write_rights")


async def _async_failing(awaitable):
    try:
        return await awaitable
    except FritzConnectionException as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="action_failed",
            translation_placeholders={"error": str(err)},
        ) from err


async def _async_set_name(call: ServiceCall) -> None:
    await _require_admin(call)
    for coordinator, host in await _async_targets(call.hass, call):
        _require_rights(coordinator)
        await _async_failing(coordinator.async_set_name(host, call.data[ATTR_NAME]))


async def _async_wake_on_lan(call: ServiceCall) -> None:
    await _require_admin(call)
    for coordinator, host in await _async_targets(call.hass, call):
        _require_rights(coordinator)
        await _async_failing(coordinator.async_wake_on_lan(host))


async def _async_set_route(call: ServiceCall) -> None:
    """Switch a static route of the box on or off, found by its network."""
    await _require_admin(call)
    unknown = None
    read_only = False
    for config_entry in call.hass.config_entries.async_loaded_entries(DOMAIN):
        coordinator = config_entry.runtime_data
        if not coordinator.can_write:
            read_only = True  # another box may carry the route and may be changed
            continue
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
    if read_only:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_write_rights")
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_target")


async def _async_set_guest_password(call: ServiceCall) -> dict[str, str]:
    """Set the password of the guest Wi-Fi and answer with it; nothing here logs it."""
    await _require_admin(call)
    read_only = False
    for config_entry in call.hass.config_entries.async_loaded_entries(DOMAIN):
        coordinator = config_entry.runtime_data
        if coordinator.data.guest_wifi is None:
            continue
        if not coordinator.can_write:
            read_only = True  # another box may have a guest network and may be changed
            continue
        password = await _async_failing(
            coordinator.async_set_guest_wifi_password(
                call.data.get("password"), call.data["length"]
            )
        )
        return {"password": password}
    if read_only:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_write_rights")
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_guest_wifi")


async def _async_capture(call: ServiceCall) -> None:
    """Record the traffic of the box, of one device if the call names one; it runs on its own."""
    await _require_admin(call)
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
    await _require_admin(call)
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
        DOMAIN,
        SERVICE_SET_GUEST_PASSWORD,
        _async_set_guest_password,
        SET_GUEST_PASSWORD_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_VPN, _async_remove_unavailable_vpn, vol.Schema({})
    )
