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
            k: v
            for k, v in entry.options.items()
            if k not in ("hidden_macs", "filter_devices", "repeaters")
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
        # what this box offers and what the integration found of it, for a report of a model
        # that behaves differently; nothing here is read from the box for the download
        "box": {
            "services": _services(coordinator),
            "upnp_enabled": coordinator.upnp_enabled,
            "cpu_temperature_supported": coordinator.cpu_supported,
            "uptime_known": coordinator.box_boot is not None,
            "wifi_networks": sorted(coordinator.data.wifi or ()),
            # the repeaters controlled from here, without their addresses
            "repeaters": [
                {
                    "answered": repeater.last_update_success,
                    "cpu_temperature_supported": repeater.cpu_supported,
                    "wifi_networks": sorted(repeater.data.wifi) if repeater.data else [],
                }
                for repeater in coordinator.repeaters.values()
            ],
        },
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


def _services(coordinator: Any) -> list[str]:
    try:
        return coordinator.client.service_names()
    except Exception:  # noqa: BLE001 - a diagnostic must not fail for a service list
        return []


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
