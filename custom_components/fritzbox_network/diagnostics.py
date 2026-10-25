"""Diagnostics for the FRITZ!Box network integration."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant

from .coordinator import FritzNetworkConfigEntry

TO_REDACT_ENTRY = {CONF_HOST, CONF_USERNAME, CONF_PASSWORD}
TO_REDACT_HOST = {"mac", "name", "ip", "hostname", "friendly_name", "mac_list", "model"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry
) -> dict[str, Any]:
    coordinator = entry.runtime_data
    mesh = coordinator.data.mesh
    return {
        "entry": async_redact_data(dict(entry.data), TO_REDACT_ENTRY),
        "options": {
            k: v for k, v in entry.options.items() if k not in ("hidden_macs", "filter_devices")
        },
        "can_write": coordinator.can_write,
        "host_count": len(coordinator.all_hosts),
        "selected_count": len(coordinator.data.hosts),
        "hosts": [
            async_redact_data(asdict(h), TO_REDACT_HOST) for h in coordinator.all_hosts.values()
        ],
        "mesh": None
        if mesh is None
        else {
            "nodes": [
                {"role": n.role, "model": n.model, "firmware": n.firmware}
                for n in mesh.nodes.values()
            ],
            "linked_clients": len(mesh.links),
        },
    }
