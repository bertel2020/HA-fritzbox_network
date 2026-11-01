"""WebSocket subscription that feeds the topology card."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
import voluptuous as vol

from .const import (
    DOMAIN,
    KEY_ACCESS_PROFILE,
    KEY_INTERNET_ACCESS,
    KEY_PRIORITY,
    KEY_WAKE_ON_LAN,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .models import is_private_mac, mac_id
from .repairs import last_online

COMMAND = f"{DOMAIN}/subscribe_topology"
ENTRIES_COMMAND = f"{DOMAIN}/entries"

# The actions of a device the card offers: name in the topology, platform, entity key.
DEVICE_ACTIONS = {
    "internet_access": ("switch", KEY_INTERNET_ACCESS),
    "priority": ("switch", KEY_PRIORITY),
    "wake_on_lan": ("button", KEY_WAKE_ON_LAN),
    "access_profile": ("select", KEY_ACCESS_PROFILE),
}


def build_topology(hass: HomeAssistant, coordinator: FritzNetworkCoordinator) -> dict[str, Any]:
    """The access points and the devices at them, as the card draws them."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    mesh = coordinator.data.mesh
    nodes = []
    if mesh:
        nodes = [
            {
                "mac": n.mac,
                "name": coordinator.node_name(n),
                "role": n.role,
                "model": n.model,
                "radios": {
                    band: {
                        "channel": radio.channel,
                        "utilization": radio.utilization,
                        "noise_dbm": radio.noise_dbm,
                    }
                    for band, radio in n.radios.items()
                },
            }
            for n in mesh.nodes.values()
        ]
        nodes.sort(key=lambda n: (n["role"] != "master", n["name"].lower()))

    clients = []
    for host in coordinator.data.hosts.values():
        # a repeater is shown as an access point, not as one of the devices
        if mesh and mesh.node_of(host):
            continue
        link = mesh.links.get(host.mac) if mesh else None
        actions = {
            name: entity_id
            for name, (platform, key) in DEVICE_ACTIONS.items()
            if (entity_id := registry.async_get_entity_id(platform, DOMAIN, f"{host.mac}_{key}"))
        }
        device = devices.async_get_device(connections={(CONNECTION_NETWORK_MAC, host.mac)})
        last = last_online(hass, host)
        clients.append(
            {
                "mac": host.mac,
                "id": mac_id(host.mac),
                "name": host.name,
                "ip": host.ip,
                "online": coordinator.is_connected(host),
                "guest": host.guest,
                "vendor": coordinator.vendor(host.mac),
                "entity_id": registry.async_get_entity_id("device_tracker", DOMAIN, host.mac),
                "ap_mac": link.ap_mac if link else None,
                "link_type": link.link_type.lower() if link else None,
                "band": link.band if link else None,
                "ssid": link.ssid if link else None,
                "port": host.port,
                "speed": host.speed,
                "vpn": host.vpn,
                "wan_access": host.wan_access,
                "priority": host.priority,
                "filter_profile": coordinator.filter_profiles.get(host.filter_profile or ""),
                "private_mac": is_private_mac(host.mac),
                "device_id": device.id if device else None,
                "last_online": last.isoformat() if last else None,
                "created_at": device.created_at.isoformat() if device else None,
                "actions": actions,
                "signal_dbm": link.signal_dbm if link else None,
                "rate_download": link.rate_download if link else None,
                "rate_upload": link.rate_upload if link else None,
                "rate_max_download": link.max_rate_download if link else None,
                "rate_max_upload": link.max_rate_upload if link else None,
            }
        )
    return {
        "entry_id": coordinator.config_entry.entry_id,
        "can_write": coordinator.can_write,
        "nodes": nodes,
        "clients": clients,
    }


@websocket_api.websocket_command({vol.Required("type"): COMMAND, vol.Optional("entry_id"): str})
@websocket_api.require_admin
@callback
def ws_subscribe_topology(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send the topology now and again after every update of the box."""
    entries: list[FritzNetworkConfigEntry] = [
        e
        for e in hass.config_entries.async_loaded_entries(DOMAIN)
        if msg.get("entry_id") in (None, e.entry_id)
    ]
    if not entries:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such FRITZ!Box")
        return
    coordinator = entries[0].runtime_data

    @callback
    def _send() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], build_topology(hass, coordinator))
        )

    connection.subscriptions[msg["id"]] = coordinator.async_add_listener(_send)
    connection.send_result(msg["id"])
    _send()


@websocket_api.websocket_command({vol.Required("type"): ENTRIES_COMMAND})
@websocket_api.require_admin
@callback
def ws_entries(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The boxes the panel can show, so it can offer a choice when there are several."""
    connection.send_result(
        msg["id"],
        [
            {"entry_id": entry.entry_id, "title": entry.title}
            for entry in hass.config_entries.async_loaded_entries(DOMAIN)
        ],
    )


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe_topology)
    websocket_api.async_register_command(hass, ws_entries)
