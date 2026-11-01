"""Actions: rename a device in the box, wake a device up."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.service import async_extract_entity_ids
import voluptuous as vol

from .const import DOMAIN
from .coordinator import FritzNetworkCoordinator
from .models import Host

SERVICE_SET_NAME = "set_name"
SERVICE_WAKE_ON_LAN = "wake_on_lan"

ATTR_NAME = "name"

SET_NAME_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): vol.All(cv.string, vol.Strip, vol.Length(min=1, max=63)),
        **cv.TARGET_FIELDS,
    }
)
WAKE_ON_LAN_SCHEMA = vol.Schema({**cv.TARGET_FIELDS})


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


def async_register(hass: HomeAssistant) -> None:
    hass.services.async_register(DOMAIN, SERVICE_SET_NAME, _async_set_name, SET_NAME_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_WAKE_ON_LAN, _async_wake_on_lan, WAKE_ON_LAN_SCHEMA
    )
