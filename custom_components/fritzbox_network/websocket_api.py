"""WebSocket subscription that feeds the topology card."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
import voluptuous as vol

from .const import DOMAIN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .models import mac_id

COMMAND = f"{DOMAIN}/subscribe_topology"


def build_topology(hass: HomeAssistant, coordinator: FritzNetworkCoordinator) -> dict[str, Any]:
    """The access points and the devices at them, as the card draws them."""
    registry = er.async_get(hass)
    mesh = coordinator.data.mesh
    nodes = []
    if mesh:
        nodes = [
            {
                "mac": n.mac,
                "name": coordinator.node_name(n),
                "role": n.role,
                "model": n.model,
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
        clients.append(
            {
                "mac": host.mac,
                "id": mac_id(host.mac),
                "name": host.name,
                "ip": host.ip,
                "online": coordinator.is_connected(host),
                "guest": host.guest,
                "entity_id": registry.async_get_entity_id("device_tracker", DOMAIN, host.mac),
                "ap_mac": link.ap_mac if link else None,
                "link_type": link.link_type.lower() if link else None,
                "signal_dbm": link.signal_dbm if link else None,
                "rate_download": link.rate_download if link else None,
                "rate_upload": link.rate_upload if link else None,
            }
        )
    return {"nodes": nodes, "clients": clients}


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


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe_topology)
