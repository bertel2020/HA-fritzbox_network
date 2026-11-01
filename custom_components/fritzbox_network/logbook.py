"""Describe the events of the integration in the logbook."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components.logbook import (
    LOGBOOK_ENTRY_ENTITY_ID,
    LOGBOOK_ENTRY_MESSAGE,
    LOGBOOK_ENTRY_NAME,
)
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, EVENT_DEVICE_RENAMED, EVENT_DEVICE_ROAMED, EVENT_NEW_DEVICE

NAME = "FRITZ!Box Network"


@callback
def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: Callable[[str, str, Callable[[Event], dict[str, Any]]], None],
) -> None:
    """Register the events with the logbook."""
    registry = er.async_get(hass)

    def entry(event: Event, message: str) -> dict[str, Any]:
        # the device tracker of the device, when there is one: the entry then
        # shows in its history too
        entity_id = registry.async_get_entity_id("device_tracker", DOMAIN, event.data["mac"])
        return {
            LOGBOOK_ENTRY_NAME: NAME,
            LOGBOOK_ENTRY_MESSAGE: message,
            LOGBOOK_ENTRY_ENTITY_ID: entity_id,
        }

    @callback
    def new_device(event: Event) -> dict[str, Any]:
        data = event.data
        details = ", ".join(v for v in (data.get("ip"), data.get("vendor")) if v)
        return entry(event, f"new device {data['name']}" + (f" ({details})" if details else ""))

    @callback
    def renamed(event: Event) -> dict[str, Any]:
        data = event.data
        return entry(event, f"device {data['old_name']} was renamed to {data['new_name']}")

    @callback
    def roamed(event: Event) -> dict[str, Any]:
        data = event.data
        return entry(event, f"{data['name']} moved from {data['old_ap']} to {data['new_ap']}")

    async_describe_event(DOMAIN, EVENT_NEW_DEVICE, new_device)
    async_describe_event(DOMAIN, EVENT_DEVICE_RENAMED, renamed)
    async_describe_event(DOMAIN, EVENT_DEVICE_ROAMED, roamed)
