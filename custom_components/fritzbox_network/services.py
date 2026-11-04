"""Actions: rename a device in the box, wake a device up."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.service import async_extract_entity_ids
import voluptuous as vol

from .capture import (
    DEFAULT_BYTES,
    DEFAULT_SECONDS,
    INTERFACES,
    KEY_CAPTURES,
    MAX_BYTES,
    MAX_SECONDS,
    MIN_SECONDS,
)
from .const import DOMAIN
from .coordinator import FritzNetworkCoordinator
from .models import Host

SERVICE_SET_NAME = "set_name"
SERVICE_WAKE_ON_LAN = "wake_on_lan"
SERVICE_CAPTURE = "capture"

ATTR_NAME = "name"

SET_NAME_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): vol.All(cv.string, vol.Strip, vol.Length(min=1, max=63)),
        **cv.TARGET_FIELDS,
    }
)
WAKE_ON_LAN_SCHEMA = vol.Schema({**cv.TARGET_FIELDS})
CAPTURE_SCHEMA = vol.Schema(
    {
        vol.Optional("interface", default="lan"): vol.In(list(INTERFACES)),
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


def async_register(hass: HomeAssistant) -> None:
    hass.services.async_register(DOMAIN, SERVICE_SET_NAME, _async_set_name, SET_NAME_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_WAKE_ON_LAN, _async_wake_on_lan, WAKE_ON_LAN_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_CAPTURE, _async_capture, CAPTURE_SCHEMA)
