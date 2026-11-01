"""Diagnostics for the FRITZ!Box network integration."""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant

from .coordinator import FritzNetworkConfigEntry

TO_REDACT_ENTRY = {CONF_HOST, CONF_USERNAME, CONF_PASSWORD}
# the addresses of the connection and the servers behind it say who and where the user is
TO_REDACT_INTERNET = {"external_ipv4", "external_ipv6", "ipv6_prefix", "dns"}
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
        "poll": {
            "interval_seconds": coordinator.update_interval.total_seconds()
            if coordinator.update_interval
            else None,
            "last_fetch_seconds": coordinator.last_fetch_seconds,
            "slowest_fetch_seconds": coordinator.slowest_fetch_seconds,
        },
        "internet": _internet(coordinator),
        "guest_wifi": coordinator.data.guest_wifi,
        "firmware": asdict(firmware) if (firmware := coordinator.data.firmware) else None,
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


def _internet(coordinator: Any) -> dict[str, Any] | None:
    """The connection and what happened to it, without the addresses and the line spectrum."""
    info = coordinator.data.internet
    if info is None:
        return None
    dsl = replace(info.dsl, spectrum_down=(), spectrum_up=()) if info.dsl else None
    return {
        **async_redact_data(asdict(replace(info, dsl=dsl)), TO_REDACT_INTERNET),
        "throughput_kbit": coordinator.internet_rate,
        "samples": len(coordinator.internet_samples),
        "events": [e["kind"] for e in coordinator.internet_events],
        "low_margin_since": (
            coordinator.internet_low_margin_since.isoformat()
            if coordinator.internet_low_margin_since
            else None
        ),
    }
