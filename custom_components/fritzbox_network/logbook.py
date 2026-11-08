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

from .const import (
    DOMAIN,
    EVENT_DEVICE_RENAMED,
    EVENT_DEVICE_ROAMED,
    EVENT_INTERNET_DISCONNECTED,
    EVENT_INTERNET_IP_CHANGED,
    EVENT_INTERNET_RECONNECTED,
    EVENT_NEW_DEVICE,
)

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
        # the id of a tracker is the box and the MAC; the event does not say which box
        mac = event.data["mac"]
        entity_id = next(
            (
                e.entity_id
                for e in registry.entities.values()
                if e.platform == DOMAIN
                and e.domain == "device_tracker"
                and e.unique_id.endswith(f"_{mac}")
            ),
            None,
        )
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

    def internet(message: str) -> Callable[[Event], dict[str, Any]]:
        # not about a device: the entry has no entity of its own
        return lambda event: {LOGBOOK_ENTRY_NAME: NAME, LOGBOOK_ENTRY_MESSAGE: message}

    async_describe_event(DOMAIN, EVENT_INTERNET_DISCONNECTED, internet("internet connection lost"))
    async_describe_event(
        DOMAIN, EVENT_INTERNET_RECONNECTED, internet("internet connection set up again")
    )
    # the addresses are in the event data, not in the logbook text
    async_describe_event(
        DOMAIN, EVENT_INTERNET_IP_CHANGED, internet("external IPv4 address changed")
    )
    async_describe_event(DOMAIN, EVENT_NEW_DEVICE, new_device)
    async_describe_event(DOMAIN, EVENT_DEVICE_RENAMED, renamed)
    async_describe_event(DOMAIN, EVENT_DEVICE_ROAMED, roamed)
