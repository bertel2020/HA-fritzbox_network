"""WebSocket subscription that feeds the topology card."""

from __future__ import annotations

import base64
from dataclasses import asdict
import ipaddress
import time
from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components import websocket_api
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, format_mac
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util
import requests
import voluptuous as vol

from . import migration
from .capture import (
    DEFAULT_BYTES,
    DEFAULT_SECONDS,
    INTERFACE_RE,
    KEY_CAPTURES,
    MAX_BYTES,
    MAX_SECONDS,
    MIN_SECONDS,
    VIEW_URL,
    interface_slug,
    wifi_bands,
)
from .connection_check import box_port, run_checks
from .const import (
    CONF_FILTER_DEVICES,
    CONF_FILTER_MODE,
    CONF_HIDDEN_MACS,
    CONF_IGNORE_GUESTS,
    CONF_IGNORE_PRIVATE_MACS,
    CONF_STALE_DAYS,
    DEFAULT_STALE_DAYS,
    DOMAIN,
    FILTER_ALL,
    FILTER_EXCLUDE,
    FILTER_INCLUDE,
    KEY_ACCESS_PROFILE,
    KEY_INTERNET_ACCESS,
    KEY_PRIORITY,
    KEY_WAKE_ON_LAN,
    TRAFFIC_SUMMARY_DAYS,
    options_reload_signal,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .filters import FILTER_OPTIONS, select_hosts
from .latency import INTERVAL, KEPT_SECONDS, STEPS
from .models import (
    MeshNode,
    MeshTopology,
    check_address_range,
    client_uid,
    is_private_mac,
    mac_id,
)
from .repairs import async_update_stale_issue, last_online
from .routes import home_network
from .wifi_qr import wifi_qr_png

COMMAND = f"{DOMAIN}/subscribe_topology"
ENTRIES_COMMAND = f"{DOMAIN}/entries"
CLEANUP_LIST_COMMAND = f"{DOMAIN}/cleanup/list"
HIDE_COMMAND = f"{DOMAIN}/devices/hide"
UNHIDE_COMMAND = f"{DOMAIN}/devices/unhide"
RECONNECT_COMMAND = f"{DOMAIN}/internet/reconnect"
REBOOT_COMMAND = f"{DOMAIN}/box/reboot"
MIGRATE_SCAN_COMMAND = f"{DOMAIN}/migrate/scan"
BOX_INFO_COMMAND = f"{DOMAIN}/box/info"
WLAN_LIST_COMMAND = f"{DOMAIN}/wlan/list"
WLAN_SWITCH_COMMAND = f"{DOMAIN}/wlan/switch"
WLAN_SECRET_COMMAND = f"{DOMAIN}/wlan/guest/secret"
WLAN_PASSWORD_COMMAND = f"{DOMAIN}/wlan/guest/password"
VPN_SWITCH_COMMAND = f"{DOMAIN}/vpn/switch"
DEVICE_ACTION_COMMAND = f"{DOMAIN}/device/action"
PORTS_COMMAND = f"{DOMAIN}/ports/list"
# what reading a page of the web interface of the box can raise
_WEB_ERRORS = (requests.RequestException, PermissionError, OSError, ValueError, KeyError, TypeError)
ROUTES_COMMAND = f"{DOMAIN}/routes/list"
ROUTE_SWITCH_COMMAND = f"{DOMAIN}/routes/switch"
ROUTE_ADD_COMMAND = f"{DOMAIN}/routes/add"
ROUTE_DELETE_COMMAND = f"{DOMAIN}/routes/delete"
IP_COMMAND = f"{DOMAIN}/device/ip"
ADDRESS_OVERVIEW_COMMAND = f"{DOMAIN}/address/overview"
ADDRESS_FIXED_COMMAND = f"{DOMAIN}/address/fixed"
ADDRESS_SAVE_COMMAND = f"{DOMAIN}/address/save"
ADDRESS_POOL_COMMAND = f"{DOMAIN}/address/pool"
HISTORY_COMMAND = f"{DOMAIN}/history/summary"
HISTORY_DEVICE_COMMAND = f"{DOMAIN}/history/device"
VPN_HISTORY_COMMAND = f"{DOMAIN}/vpn/history"
HISTORY_TRAFFIC_COMMAND = f"{DOMAIN}/history/traffic"
LATENCY_COMMAND = f"{DOMAIN}/diagnose/latency"
LATENCY_SWITCH_COMMAND = f"{DOMAIN}/diagnose/latency/switch"
LOG_COMMAND = f"{DOMAIN}/diagnose/log"
CHECK_COMMAND = f"{DOMAIN}/diagnose/check"
CAPTURE_STATUS_COMMAND = f"{DOMAIN}/capture/status"
CAPTURE_START_COMMAND = f"{DOMAIN}/capture/start"
CAPTURE_BANDS_COMMAND = f"{DOMAIN}/capture/bands"
CAPTURE_SUMMARY_COMMAND = f"{DOMAIN}/capture/summary"
CAPTURE_STOP_COMMAND = f"{DOMAIN}/capture/stop"
CAPTURE_DELETE_COMMAND = f"{DOMAIN}/capture/delete"
FILTER_PREVIEW_COMMAND = f"{DOMAIN}/filter/preview"
FILTER_APPLY_COMMAND = f"{DOMAIN}/filter/apply"
ERR_CHANGED = "changed"
ERR_INVALID_RANGE = "invalid_range"
ERR_BUSY = "busy"
ERR_INVALID = "invalid"

FILTER_OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_FILTER_MODE): vol.In([FILTER_ALL, FILTER_INCLUDE, FILTER_EXCLUDE]),
        vol.Optional(CONF_FILTER_DEVICES): [str],
        vol.Optional(CONF_IGNORE_GUESTS): bool,
        vol.Optional(CONF_IGNORE_PRIVATE_MACS): bool,
    }
)

BLOCK_COLORS = ["--b1", "--b2", "--b3", "--b4", "--b5"]
ENTRY_KINDS = ["plan", "hold", "ext"]


def _ipv4(value: Any) -> str:
    return str(ipaddress.IPv4Address(value))


def _mac(value: Any) -> str:
    return format_mac(str(value))


_OCTET = vol.All(int, vol.Range(min=1, max=254))
OWN_ADDRESSES_SCHEMA = vol.Schema(
    {
        vol.Required("notes"): vol.All(
            {_ipv4: vol.All(str, vol.Length(max=300))}, vol.Length(max=500)
        ),
        vol.Required("names"): vol.All(
            {_mac: vol.All(str, vol.Length(max=60))}, vol.Length(max=500)
        ),
        vol.Optional("marks", default=[]): vol.All([_ipv4], vol.Length(max=500)),
        vol.Required("muted"): vol.All([vol.All(str, vol.Length(max=60))], vol.Length(max=100)),
        vol.Required("blocks"): vol.All(
            [
                {
                    vol.Required("id"): int,
                    vol.Required("name"): vol.All(str, vol.Length(min=1, max=30)),
                    vol.Required("from"): _OCTET,
                    vol.Required("to"): _OCTET,
                    vol.Required("color"): vol.In(BLOCK_COLORS),
                }
            ],
            vol.Length(max=50),
        ),
        vol.Optional("entries", default=[]): vol.All(
            [
                {
                    vol.Required("id"): int,
                    vol.Required("name"): vol.All(str, vol.Length(max=40)),
                    vol.Required("from"): _OCTET,
                    vol.Required("to"): _OCTET,
                    vol.Required("kind"): vol.In(ENTRY_KINDS),
                    vol.Optional("note", default=""): vol.All(str, vol.Length(max=300)),
                }
            ],
            vol.Length(max=200),
        ),
    }
)

# The actions of a device the card offers: name in the topology, platform, entity key.
DEVICE_ACTIONS = {
    "internet_access": ("switch", KEY_INTERNET_ACCESS),
    "priority": ("switch", KEY_PRIORITY),
    "wake_on_lan": ("button", KEY_WAKE_ON_LAN),
    "access_profile": ("select", KEY_ACCESS_PROFILE),
}


def _uplink(mesh: MeshTopology, node: MeshNode) -> dict[str, Any] | None:
    """How a repeater reaches the mesh: by cable or Wi-Fi, with band and signal.

    None for the box itself and where the mesh names no link for the node.
    """
    if node.role == "master" or (link := mesh.links.get(node.mac)) is None:
        return None
    if link.ap_mac == node.mac:
        return None
    return {
        "type": link.link_type.lower(),
        "band": link.band,
        "signal_dbm": link.signal_dbm,
    }


def _firmware(coordinator: FritzNetworkCoordinator) -> dict[str, Any] | None:
    """The firmware the box runs and the newer one it offers, if any."""
    firmware = coordinator.data.firmware
    if firmware is None:
        return None
    return {
        "installed": coordinator.client.system_version,
        "latest": firmware.version if firmware.update_available else None,
        "info_url": firmware.info_url if firmware.update_available else None,
    }


def _vpn(coordinator: FritzNetworkCoordinator) -> list[dict[str, Any]] | None:
    """The WireGuard connections as the panel draws them; None where the box tells nothing."""
    connections = coordinator.data.vpn
    if connections is None:
        return None
    history = coordinator.history
    now = dt_util.utcnow().timestamp()
    return [
        {
            "stats": history.vpn_stats(c.key, now) if history else None,
            "key": c.key,
            "uid": c.uid,
            "name": c.name,
            "kind": c.kind,
            "enabled": c.active,
            "connected": c.connected,
            "since": c.since,
            "remote_net": c.remote_net,
            "remote_endpoint": c.remote_endpoint,
            "editable": c.editable,
        }
        for c in connections
    ]


def _internet(coordinator: FritzNetworkCoordinator) -> dict[str, Any] | None:
    """The internet connection as the panel draws it; None where the box tells nothing about it."""
    info = coordinator.data.internet
    if info is None:
        return None
    rate = coordinator.internet_rate
    return {
        "connected": info.connected,
        "uptime": info.uptime,
        "last_error": info.last_error,
        "access_type": info.access_type,
        "rate_down": info.rate_down,
        "rate_up": info.rate_up,
        "external_ipv4": info.external_ipv4,
        "external_ipv6": info.external_ipv6,
        "ipv6_prefix": info.ipv6_prefix,
        "ipv6_prefix_length": info.ipv6_prefix_length,
        "dns": list(info.dns),
        "dsl": asdict(info.dsl) if info.dsl else None,
        "throughput": None
        if rate is None
        else {"down": round(rate[0], 1), "up": round(rate[1], 1)},
        "samples": [
            [round(t), round(down, 1), round(up, 1)] for t, down, up in coordinator.internet_samples
        ],
        "events": list(coordinator.internet_events),
        "addresses": coordinator.history.addresses() if coordinator.history else {},
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
                "firmware": n.firmware,
                "mesh_version": n.meshd_version,
                "radios": {
                    band: {
                        "channel": radio.channel,
                        "utilization": radio.utilization,
                        "noise_dbm": radio.noise_dbm,
                        "ssid": radio.ssid,
                        "channel_width": radio.channel_width,
                        "security": radio.security,
                        "guest": radio.guest,
                    }
                    for band, radio in n.radios.items()
                },
                "uplink": _uplink(mesh, n),
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
            if (
                entity_id := registry.async_get_entity_id(
                    platform, DOMAIN, client_uid(coordinator.serial, host.mac, key)
                )
            )
        }
        # a group is a label on the "Internet access" switch, not on the device: a label on
        # the device would also reach its priority switch
        internet = (
            registry.async_get(actions["internet_access"]) if "internet_access" in actions else None
        )
        device = devices.async_get_device(connections={(CONNECTION_NETWORK_MAC, host.mac)})
        last = last_online(hass, coordinator.serial, host)
        clients.append(
            {
                "mac": host.mac,
                "id": mac_id(host.mac),
                "name": host.name,
                "ip": host.ip,
                "online": coordinator.is_connected(host),
                "guest": host.guest,
                "vendor": coordinator.panel_vendor(host.mac),
                "hostname": host.hostname,
                "entity_id": registry.async_get_entity_id(
                    "device_tracker", DOMAIN, client_uid(coordinator.serial, host.mac)
                ),
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
                "filter_profile_id": host.filter_profile,
                "private_mac": is_private_mac(host.mac),
                "device_id": device.id if device else None,
                "last_online": last.isoformat() if last else None,
                "created_at": device.created_at.isoformat() if device else None,
                "actions": actions,
                "labels": sorted(internet.labels) if internet else [],
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
        "labels": [
            {"id": label.label_id, "name": label.name, "icon": label.icon, "color": label.color}
            for label in sorted(
                lr.async_get(hass).async_list_labels(), key=lambda label: label.name.lower()
            )
        ],
        "profiles": [
            {"id": profile_id, "name": name}
            for profile_id, name in coordinator.filter_profiles.items()
        ],
        "internet": _internet(coordinator),
        "firmware": _firmware(coordinator),
        "vpn": _vpn(coordinator),
        "nodes": nodes,
        # repeaters with a device here that the box does not list in its mesh now
        "lost_repeaters": [
            {"mac": mac, "name": name} for mac, name in coordinator.lost_repeaters()
        ],
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

    @callback
    def _on_reload() -> None:
        # the options changed and the entry reloads: this subscription is of no use after it
        connection.send_message(websocket_api.event_message(msg["id"], {"reload": True}))

    @callback
    def _on_entity_registry(event: Any) -> None:
        entry = er.async_get(hass).async_get(event.data["entity_id"])
        if entry is not None and entry.platform == DOMAIN:
            _send()

    @callback
    def _on_label_registry(event: Any) -> None:
        _send()

    # a label put on a device or created is shown at once, not with the next poll
    unsubs = [
        coordinator.async_add_listener(_send),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, _on_entity_registry),
        hass.bus.async_listen(lr.EVENT_LABEL_REGISTRY_UPDATED, _on_label_registry),
        async_dispatcher_connect(hass, options_reload_signal(entries[0].entry_id), _on_reload),
    ]

    @callback
    def _unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    connection.subscriptions[msg["id"]] = _unsubscribe
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


def _loaded_coordinator(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> tuple[FritzNetworkConfigEntry, FritzNetworkCoordinator] | None:
    """The box the command is about; an error goes back to the caller when there is none."""
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        if entry.entry_id == msg["entry_id"]:
            return entry, entry.runtime_data
    connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such FRITZ!Box")
    return None


def _mesh_macs(coordinator: FritzNetworkCoordinator) -> set[str]:
    """The MACs of the box and the repeaters: they are never offered for cleaning up."""
    mesh = coordinator.data.mesh
    if not mesh:
        return set()
    return {
        mac for host in coordinator.all_hosts.values() if mesh.node_of(host) for mac in [host.mac]
    }


def _device(host: Any) -> dict[str, Any]:
    return {
        "mac": host.mac,
        "id": mac_id(host.mac),
        "name": host.name,
        "guest": host.guest,
        "private_mac": is_private_mac(host.mac),
    }


@websocket_api.websocket_command(
    {vol.Required("type"): CLEANUP_LIST_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_cleanup_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The offline devices with the time they were last online, and the hidden ones.

    The panel narrows the list by days itself, so the slider needs no round trip.
    """
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry, coordinator = found
    nodes = _mesh_macs(coordinator)
    now = dt_util.utcnow()
    stale = []
    for host in coordinator.data.hosts.values():
        if host.mac in nodes or coordinator.is_connected(host):
            continue
        last = last_online(hass, coordinator.serial, host)
        if last is None:
            continue
        stale.append(
            {
                **_device(host),
                "vendor": coordinator.panel_vendor(host.mac),
                "last_online": last.isoformat(),
                "days": max(0, (now - last).days),
            }
        )
    stale.sort(key=lambda d: d["last_online"])
    hidden = [
        {
            "mac": mac,
            "id": mac_id(mac),
            "name": host.name if (host := coordinator.all_hosts.get(mac)) else mac,
        }
        for mac in entry.options.get(CONF_HIDDEN_MACS, [])
    ]
    connection.send_result(
        msg["id"],
        {
            "days": entry.options.get(CONF_STALE_DAYS, DEFAULT_STALE_DAYS),
            "devices": stale,
            "hidden": hidden,
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): HIDE_COMMAND, vol.Required("entry_id"): str, vol.Required("macs"): [str]}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_hide_devices(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Hide devices: they leave Home Assistant with their entities.

    Only offline devices that are not the box or a repeater: an online one would be back with
    the next poll. The server checks this again, whatever the panel showed.
    """
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry, coordinator = found
    nodes = _mesh_macs(coordinator)
    hidden = list(entry.options.get(CONF_HIDDEN_MACS, []))
    done: list[str] = []
    refused: list[dict[str, str]] = []
    for mac in dict.fromkeys(format_mac(m) for m in msg["macs"]):
        host = coordinator.all_hosts.get(mac)
        if host is None:
            refused.append({"mac": mac, "reason": "unknown"})
        elif mac in nodes:
            refused.append({"mac": mac, "reason": "node"})
        elif coordinator.is_connected(host):
            refused.append({"mac": mac, "reason": "online"})
        else:
            if mac not in hidden:
                hidden.append(mac)
            done.append(mac)
    if done:
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_HIDDEN_MACS: sorted(hidden)}
        )
        await coordinator.async_request_refresh()
        await async_update_stale_issue(hass, entry)
    connection.send_result(msg["id"], {"hidden": done, "refused": refused})


@websocket_api.websocket_command(
    {
        vol.Required("type"): UNHIDE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("macs"): [str],
    }
)
@websocket_api.require_admin
@callback
def ws_unhide_devices(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Show hidden devices again. The entry reloads: the options shrank."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry, _ = found
    back = {format_mac(m) for m in msg["macs"]}
    hidden = [m for m in entry.options.get(CONF_HIDDEN_MACS, []) if m not in back]
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_HIDDEN_MACS: hidden}
    )
    connection.send_result(msg["id"], {"unhidden": sorted(back)})


@websocket_api.websocket_command(
    {vol.Required("type"): PORTS_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ports(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The port forwardings and UPnP openings of the box, read when the page is opened.

    Read only, and read on demand: they are a security matter that rarely changes, so they do not
    cost a request at every poll.
    """
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    try:
        upnp = await hass.async_add_executor_job(coordinator.client.get_port_mappings)
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    # TR-064 lists only what devices opened by UPnP; the ones set by hand are in the web interface
    try:
        manual = await hass.async_add_executor_job(coordinator.client.get_port_forwardings)
    except (*_WEB_ERRORS, FritzConnectionException):
        manual = None
    for entry in upnp:
        entry.setdefault("source", "upnp")
        entry.setdefault("family", "ipv4")
    seen = {(e["protocol"], e["external_port"], e["client"]) for e in manual or ()}
    entries = [
        *(manual or ()),
        *(e for e in upnp if (e["protocol"], e["external_port"], e["client"]) not in seen),
    ]
    by_ip = {h.ip: h for h in coordinator.data.hosts.values() if h.ip}
    by_mac = {h.mac: h for h in coordinator.data.hosts.values()}
    for entry in entries:
        host = by_mac.get(entry.pop("mac", None)) or by_ip.get(entry["client"])
        entry["device_id"] = mac_id(host.mac) if host else None
        entry["device_name"] = host.name if host else None
        entry["device_online"] = bool(host.active) if host else None
    connection.send_result(msg["id"], {"entries": entries, "manual_known": manual is not None})


@websocket_api.websocket_command(
    {vol.Required("type"): ROUTES_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_routes(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The static IPv4 routes of the box, read when the page is opened.

    Read on demand, like the ports: the table is short, changes rarely and costs one request per
    route. Each route comes with the device its gateway is, and whether that device is online.
    """
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    try:
        entries = await hass.async_add_executor_job(coordinator.client.get_routes)
        info = await hass.async_add_executor_job(coordinator.client.get_network)
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(
        msg["id"], {"entries": _routes_with_devices(coordinator, entries), "home": _home(info)}
    )


def _home(info: dict[str, Any] | None) -> dict[str, str] | None:
    """The home network and the address of the box in it, for the checks the panel shows."""
    home = home_network(info)
    return {"network": str(home[0]), "box": str(home[1])} if home else None


def _routes_with_devices(coordinator: Any, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The routes, each with the device its gateway is and whether that device is online."""
    hosts = {h.ip: h for h in coordinator.data.hosts.values() if h.ip}
    for entry in entries:
        host = hosts.get(entry["gateway"]) if entry["gateway"] else None
        entry["device_id"] = mac_id(host.mac) if host else None
        entry["device_mac"] = host.mac if host else None
        entry["device_name"] = host.name if host else None
        entry["gateway_online"] = bool(host.active) if host else None
    return entries


@websocket_api.websocket_command(
    {
        vol.Required("type"): ROUTE_SWITCH_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("network"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_route_switch(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Switch a static route of the box; the answer is the routes as the box then lists them."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    try:
        entries = await coordinator.async_set_route(msg["network"], msg["enabled"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {"entries": _routes_with_devices(coordinator, entries)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): ROUTE_ADD_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("network"): str,
        vol.Required("gateway"): str,
        vol.Required("metric"): vol.All(int, vol.Range(min=0, max=65535)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_route_add(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Add a static route to the box, after the checks that keep it from cutting the box off."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    try:
        entries = await coordinator.async_add_route(msg["network"], msg["gateway"], msg["metric"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {"entries": _routes_with_devices(coordinator, entries)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): ROUTE_DELETE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("network"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_route_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Delete a static route of the box."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    try:
        entries = await coordinator.async_delete_route(msg["network"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {"entries": _routes_with_devices(coordinator, entries)})


@websocket_api.websocket_command(
    {vol.Required("type"): IP_COMMAND, vol.Required("entry_id"): str, vol.Required("mac"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_device_ip(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Whether the box always gives a device the same IP address; read when its page opens."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    reservation = await hass.async_add_executor_job(
        found[1].client.get_ip_reservation, format_mac(msg["mac"])
    )
    connection.send_result(msg["id"], {"reservation": reservation})


@websocket_api.websocket_command(
    {vol.Required("type"): ADDRESS_OVERVIEW_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_address_overview(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The home network of the box and what the user noted about its addresses."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    network = await hass.async_add_executor_job(coordinator.client.get_network)
    notes = coordinator.addresses.data if coordinator.addresses else {}
    connection.send_result(msg["id"], {"network": network, "own": notes})


@websocket_api.websocket_command(
    {
        vol.Required("type"): ADDRESS_FIXED_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("macs"): vol.All([vol.All(str, vol.Length(max=40))], vol.Length(max=12)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_address_fixed(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Whether the box always gives these devices the same address (a few per call)."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    macs = [format_mac(m) for m in msg["macs"]]
    reservations = await hass.async_add_executor_job(found[1].client.get_ip_reservations, macs)
    connection.send_result(msg["id"], {"reservations": reservations})


@websocket_api.websocket_command(
    {
        vol.Required("type"): ADDRESS_SAVE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("own"): OWN_ADDRESSES_SCHEMA,
    }
)
@websocket_api.require_admin
@callback
def ws_address_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Keep the notes, names, entries and groups of the user; nothing is written to the box."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    if found[1].addresses is None:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, "Nothing to save to")
        return
    found[1].addresses.replace(msg["own"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): ADDRESS_POOL_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("first"): _ipv4,
        vol.Required("last"): _ipv4,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_address_pool(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Change the range the DHCP server of the box hands out, if it fits the network."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    network = await hass.async_add_executor_job(coordinator.client.get_network)
    if network is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "The box tells no network")
        return
    if problem := check_address_range(network, msg["first"], msg["last"]):
        connection.send_error(msg["id"], ERR_INVALID_RANGE, problem)
        return
    try:
        await hass.async_add_executor_job(
            coordinator.client.set_address_range, msg["first"], msg["last"]
        )
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(
        msg["id"], {"network": await hass.async_add_executor_job(coordinator.client.get_network)}
    )


@websocket_api.websocket_command(
    {vol.Required("type"): HISTORY_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_history_summary(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The last day of every device in hours, for the sparklines of the list."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    history = found[1].history
    connection.send_result(
        msg["id"],
        {
            "devices": history.summary(time.time()) if history else {},
            "traffic": history.traffic_all(TRAFFIC_SUMMARY_DAYS) if history else {},
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): HISTORY_DEVICE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("mac"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_history_device(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """One device: the day in small steps and the week in hours."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    history = found[1].history
    connection.send_result(
        msg["id"],
        history.device(format_mac(msg["mac"]))
        if history
        else {"day": [], "week": [], "traffic": {}},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): HISTORY_TRAFFIC_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_history_traffic(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The traffic of every device per day for the whole year, read when the year is asked for."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    history = found[1].history
    connection.send_result(msg["id"], {"traffic": history.traffic_all() if history else {}})


@websocket_api.websocket_command(
    {vol.Required("type"): VPN_HISTORY_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_vpn_history(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The sessions and on-periods of every WireGuard tunnel for its chart, read on opening."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    history = coordinator.history
    now = dt_util.utcnow().timestamp()
    connections = coordinator.data.vpn or []
    connection.send_result(
        msg["id"],
        {c.key: history.vpn_chart(c.key, now) for c in connections} if history else {},
    )


async def _box_action(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    method: str,
) -> None:
    """Run an action on the box that interrupts the network, for the user's rights only."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    try:
        await hass.async_add_executor_job(getattr(coordinator.client, method))
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    # the box needs a moment: the next poll shows the new state
    coordinator.async_update_listeners()
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {vol.Required("type"): RECONNECT_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_reconnect(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Hang up and dial in again. Only the panel offers it, behind a confirmation."""
    await _box_action(hass, connection, msg, "reconnect")


@websocket_api.websocket_command(
    {
        vol.Required("type"): VPN_SWITCH_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("key"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vpn_switch(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Switch a WireGuard connection of the box."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    try:
        await coordinator.async_set_vpn(msg["key"], msg["enabled"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): DEVICE_ACTION_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("mac"): str,
        vol.Required("action"): vol.In(
            ["internet_access", "priority", "filter_profile", "wake_on_lan"]
        ),
        vol.Optional("value"): vol.Any(bool, str),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_device_action(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Change a device at the box directly, whether or not Home Assistant has an entity for it."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    coordinator = found[1]
    if not coordinator.can_write:
        connection.send_error(
            msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings"
        )
        return
    host = coordinator.all_hosts.get(format_mac(msg["mac"]))
    if host is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such device")
        return
    action, value = msg["action"], msg.get("value")
    if action in ("internet_access", "priority") and not host.ip:
        # the box addresses these by IPv4: without one it would act on address 0
        connection.send_error(
            msg["id"], websocket_api.ERR_NOT_SUPPORTED, "The device has no IPv4 address"
        )
        return
    try:
        if action == "wake_on_lan":
            await coordinator.async_wake_on_lan(host)
        elif action == "filter_profile":
            if not isinstance(value, str) or value not in coordinator.filter_profiles:
                raise HomeAssistantError("Unknown access profile")
            await coordinator.async_set_filter_profile(host, value)
        else:
            if not isinstance(value, bool):
                raise HomeAssistantError("A switch needs true or false")
            if action == "internet_access":
                await coordinator.async_set_internet_access(host, value)
            else:
                await coordinator.async_set_priority(host, value)
    except (HomeAssistantError, FritzConnectionException) as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {})


# the band as the panel names it, by the key of the network
_BAND_NAMES = {"2_4ghz": "2.4", "5ghz": "5", "6ghz": "6"}


def _no_rights(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "No right to change settings")


@websocket_api.websocket_command(
    {vol.Required("type"): BOX_INFO_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_box_info(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The box itself: model, firmware, last restart, CPU temperature, line and counters."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    client = coordinator.client
    # asked now: a box that restarts must not show the numbers of before it went down
    try:
        coordinator.note_uptime(await hass.async_add_executor_job(client.read_uptime))
    except (FritzConnectionException, OSError, ValueError):
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, "The box does not answer")
        return
    temperature = None
    if coordinator.cpu_supported is not False:
        # asked now, not from the last poll: the page shows what the box says at this moment
        try:
            temperature = await hass.async_add_executor_job(client.get_cpu_temperature)
        except (FritzConnectionException, OSError, ValueError, PermissionError):
            temperature = None
    boot = coordinator.box_boot
    internet = coordinator.data.internet
    connection.send_result(
        msg["id"],
        {
            "model": client.model_name,
            "firmware": client.system_version,
            "last_restart": boot.isoformat() if boot else None,
            "uptime_seconds": int((dt_util.utcnow() - boot).total_seconds()) if boot else None,
            "cpu_temperature": temperature,
            "line": {
                "linked": internet.linked if internet else None,
                "access_type": internet.access_type if internet else None,
            },
            "bytes_received": internet.bytes_received if internet else None,
            "bytes_sent": internet.bytes_sent if internet else None,
            "can_write": coordinator.can_write,
        },
    )


async def _wlan_state(hass: HomeAssistant, coordinator: FritzNetworkCoordinator) -> dict[str, Any]:
    """The Wi-Fi networks of the box and the guest network, read now."""
    networks = await hass.async_add_executor_job(coordinator.client.get_wifi_networks)
    guest = await hass.async_add_executor_job(coordinator.client.get_guest_wifi_info)
    return {
        "networks": [
            {
                "key": key,
                "band": _BAND_NAMES.get(key, key),
                "ssid": network.ssid,
                "enabled": network.enabled,
                "bssid": network.bssid,
                "standard": network.standard,
            }
            for key, network in networks.items()
        ],
        "guest": guest,
        "can_write": coordinator.can_write,
    }


@websocket_api.websocket_command(
    {vol.Required("type"): WLAN_LIST_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wlan_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The Wi-Fi networks of the box, without any password."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    try:
        result = await _wlan_state(hass, found[1])
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): WLAN_SWITCH_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("key"): vol.In(["2_4ghz", "5ghz", "6ghz", "guest"]),
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wlan_switch(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Switch a Wi-Fi network on or off and answer with the networks as they are now."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    if not coordinator.can_write:
        _no_rights(connection, msg)
        return
    try:
        if msg["key"] == "guest":
            await coordinator.async_set_guest_wifi(msg["enabled"])
        else:
            await coordinator.async_set_wifi(msg["key"], msg["enabled"])
        result = await _wlan_state(hass, coordinator)
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): WLAN_SECRET_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wlan_secret(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Name, password and QR code of the guest Wi-Fi. Only with the right to change settings."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    if not coordinator.can_write:
        _no_rights(connection, msg)
        return
    try:
        secret = await hass.async_add_executor_job(coordinator.client.get_guest_wifi_secret)
        if secret is None:
            connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No guest Wi-Fi")
            return
        png = await hass.async_add_executor_job(
            wifi_qr_png, secret["ssid"], secret["password"], secret["security"]
        )
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(
        msg["id"], {**secret, "qr_png_base64": base64.b64encode(png).decode("ascii")}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): WLAN_PASSWORD_COMMAND,
        vol.Required("entry_id"): str,
        # a WPA passphrase: 8 to 63 printable ASCII characters; without one a random one is made
        vol.Optional("password"): vol.All(
            str, vol.Length(min=8, max=63), vol.Match(r"^[\x20-\x7e]+$")
        ),
        vol.Optional("length", default=12): vol.All(int, vol.Range(min=8, max=63)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wlan_password(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Set the guest Wi-Fi password and answer with it; it is not logged here."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    _, coordinator = found
    if not coordinator.can_write:
        _no_rights(connection, msg)
        return
    try:
        password = await coordinator.async_set_guest_wifi_password(
            msg.get("password"), msg["length"]
        )
    except ServiceValidationError:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No guest Wi-Fi")
        return
    except FritzConnectionException as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"password": password})


@websocket_api.websocket_command(
    {vol.Required("type"): MIGRATE_SCAN_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_migrate_scan(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """What taking over the entities of the core integration would do. Reads, changes nothing."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], migration.scan(hass, found[0]))


@websocket_api.websocket_command(
    {vol.Required("type"): REBOOT_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_reboot(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Restart the box. Only the panel offers it, behind a confirmation."""
    await _box_action(hass, connection, msg, "reboot")


@websocket_api.websocket_command(
    {vol.Required("type"): CHECK_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_check_connection(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Try the box, the internet, the name service and the web from Home Assistant."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry = found[0]
    connection.send_result(msg["id"], await run_checks(entry.data[CONF_HOST], box_port(entry.data)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): LOG_COMMAND,
        vol.Required("entry_id"): str,
        vol.Optional("group"): vol.In(["sys", "net", "fon", "wlan", "usb"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_device_log(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The event log of the box, read on demand."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    try:
        events = await hass.async_add_executor_job(found[1].client.get_device_log, msg.get("group"))
    except (FritzConnectionException, OSError, ValueError, KeyError) as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    connection.send_result(msg["id"], {"events": events})


def _latency_state(coordinator: FritzNetworkCoordinator) -> dict[str, Any]:
    monitor = coordinator.latency
    return {
        "enabled": monitor.enabled if monitor else False,
        "interval": int(INTERVAL.total_seconds()),
        "steps": STEPS,
        "samples": monitor.samples(KEPT_SECONDS) if monitor else [],
    }


@websocket_api.websocket_command(
    {vol.Required("type"): LATENCY_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@callback
def ws_latency(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The course of the connection of the last 24 hours, and whether it is being recorded."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], _latency_state(found[1]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): LATENCY_SWITCH_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@callback
def ws_latency_switch(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Start or stop recording the course of the connection."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    if found[1].latency is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Nothing to record with")
        return
    found[1].latency.set_enabled(msg["enabled"])
    connection.send_result(msg["id"], _latency_state(found[1]))


def _capture_state(hass: HomeAssistant, entry_id: str) -> dict[str, Any]:
    manager = hass.data[KEY_CAPTURES][entry_id]
    return {
        "job": manager.job.as_dict() if manager.job else None,
        "files": manager.files(),
        "interfaces": [
            {**i, "slug": interface_slug(i["id"]), "band": manager.bands.get(i["id"])}
            for i in manager.interfaces()
        ],
        "detecting": manager.detecting,
        "url": VIEW_URL.replace("{entry_id}", entry_id).replace("{name}", ""),
        "limits": {
            "min_seconds": MIN_SECONDS,
            "max_seconds": MAX_SECONDS,
            "seconds": DEFAULT_SECONDS,
            "max_mb": MAX_BYTES // 1048576,
            "mb": DEFAULT_BYTES // 1048576,
        },
    }


@websocket_api.websocket_command(
    {vol.Required("type"): CAPTURE_STATUS_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_status(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The running capture and the kept files; the panel asks again while one runs."""
    if _loaded_coordinator(hass, connection, msg) is None:
        return
    state = await hass.async_add_executor_job(_capture_state, hass, msg["entry_id"])
    connection.send_result(msg["id"], state)


@websocket_api.websocket_command(
    {
        vol.Required("type"): CAPTURE_START_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("interface"): vol.Match(INTERFACE_RE),
        vol.Required("seconds"): vol.All(int, vol.Range(min=MIN_SECONDS, max=MAX_SECONDS)),
        vol.Required("mb"): vol.All(int, vol.Range(min=1, max=MAX_BYTES // 1048576)),
        vol.Optional("mac"): vol.Match(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$"),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_start(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Start recording on an interface of the box."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    manager = hass.data[KEY_CAPTURES][msg["entry_id"]]
    mac = ips = None
    if msg.get("mac"):
        mac = format_mac(msg["mac"])
        host = found[1].all_hosts.get(mac)
        ips = (host.ip,) if host and host.ip else ()
    try:
        manager.start(msg["interface"], msg["seconds"], msg["mb"] * 1048576, mac, ips or ())
    except ValueError as err:
        connection.send_error(msg["id"], ERR_BUSY if str(err) == "busy" else ERR_INVALID, str(err))
        return
    connection.send_result(
        msg["id"], await hass.async_add_executor_job(_capture_state, hass, msg["entry_id"])
    )


@websocket_api.websocket_command(
    {vol.Required("type"): CAPTURE_BANDS_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_bands(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Find out which band the Wi-Fi access points carry (about ten seconds on each)."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    mesh = found[1].data.mesh
    if mesh is None or mesh.master is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "The box tells no mesh")
        return
    manager = hass.data[KEY_CAPTURES][msg["entry_id"]]
    wifi = wifi_bands(mesh.links, mesh.master.mac)
    try:
        result = await hass.async_add_executor_job(manager.detect_bands, wifi)
    except ValueError as err:
        code = ERR_BUSY if str(err) == "busy" else ERR_INVALID
        connection.send_error(msg["id"], code, str(err))
        return
    except (OSError, PermissionError) as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    manager.save_bands()
    state = await hass.async_add_executor_job(_capture_state, hass, msg["entry_id"])
    connection.send_result(msg["id"], {**state, **result})


@websocket_api.websocket_command(
    {
        vol.Required("type"): CAPTURE_SUMMARY_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("name"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_summary(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """What a kept capture contains: the protocols, the biggest conversations, the DNS names."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    manager = hass.data[KEY_CAPTURES][msg["entry_id"]]
    summary = await hass.async_add_executor_job(manager.summary, msg["name"])
    if summary is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such capture")
        return
    names = {h.ip: h.name for h in found[1].all_hosts.values() if h.ip}
    flows = [
        {
            "a": a,
            "b": b,
            "a_name": names.get(a),
            "b_name": names.get(b),
            "protocol": protocol,
            "port": port,
            "bytes": size,
            "packets": summary.flow_packets[(a, b, protocol, port)],
        }
        for (a, b, protocol, port), size in summary.flows.most_common(10)
    ]
    connection.send_result(
        msg["id"],
        {
            "packets": summary.packets,
            "bytes": summary.bytes,
            "seconds": summary.seconds,
            "protocols": dict(summary.protocols.most_common()),
            "flows": flows,
            "dns": [{"name": n, "count": c} for n, c in summary.dns.most_common(15)],
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): CAPTURE_STOP_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_stop(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """End the running capture; what was recorded so far is kept."""
    if _loaded_coordinator(hass, connection, msg) is None:
        return
    hass.data[KEY_CAPTURES][msg["entry_id"]].stop()
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): CAPTURE_DELETE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("name"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Delete a kept capture."""
    if _loaded_coordinator(hass, connection, msg) is None:
        return
    manager = hass.data[KEY_CAPTURES][msg["entry_id"]]
    if not await hass.async_add_executor_job(manager.delete, msg["name"]):
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such capture")
        return
    connection.send_result(msg["id"], {})


def _filter_preview(
    entry: FritzNetworkConfigEntry,
    coordinator: FritzNetworkCoordinator,
    changes: dict[str, Any],
) -> dict[str, Any]:
    """What the filters would do with these changes compared with what they do now."""
    mesh = coordinator.data.mesh
    hosts = list(coordinator.all_hosts.values())
    current = {**entry.options}
    wanted = {**current, **changes}
    now = select_hosts(hosts, mesh, current)
    then = select_hosts(hosts, mesh, wanted)
    nodes = _mesh_macs(coordinator)
    hidden = set(wanted.get(CONF_HIDDEN_MACS, []))
    return {
        "options": {
            CONF_FILTER_MODE: wanted.get(CONF_FILTER_MODE, FILTER_ALL),
            CONF_FILTER_DEVICES: list(wanted.get(CONF_FILTER_DEVICES, [])),
            CONF_IGNORE_GUESTS: bool(wanted.get(CONF_IGNORE_GUESTS, False)),
            CONF_IGNORE_PRIVATE_MACS: bool(wanted.get(CONF_IGNORE_PRIVATE_MACS, False)),
        },
        "keep": [_device(h) for m, h in then.items() if m in now],
        "add": [_device(h) for m, h in then.items() if m not in now],
        "remove": [_device(h) for m, h in now.items() if m not in then],
        "devices": sorted(
            (_device(h) for m, h in coordinator.all_hosts.items() if m not in nodes | hidden),
            key=lambda d: d["name"].lower(),
        ),
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): FILTER_PREVIEW_COMMAND,
        vol.Required("entry_id"): str,
        vol.Optional("options", default=dict): FILTER_OPTIONS_SCHEMA,
    }
)
@websocket_api.require_admin
@callback
def ws_filter_preview(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Which devices the filters keep, add and remove with these options; nothing is written."""
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry, coordinator = found
    connection.send_result(msg["id"], _filter_preview(entry, coordinator, msg["options"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): FILTER_APPLY_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("options"): FILTER_OPTIONS_SCHEMA,
        vol.Required("expected_remove"): [str],
    }
)
@websocket_api.require_admin
@callback
def ws_filter_apply(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save the filters, if they remove exactly the devices the caller was shown.

    Removing a device drops it with its entities for good. If the list changed meanwhile
    (a device went online, the box listed another), nothing is written.
    """
    if (found := _loaded_coordinator(hass, connection, msg)) is None:
        return
    entry, coordinator = found
    preview = _filter_preview(entry, coordinator, msg["options"])
    if sorted(d["mac"] for d in preview["remove"]) != sorted(
        format_mac(m) for m in msg["expected_remove"]
    ):
        connection.send_error(msg["id"], ERR_CHANGED, "The devices that would be removed changed")
        return
    options = {**entry.options}
    for key in FILTER_OPTIONS:
        options[key] = preview["options"][key]
    hass.config_entries.async_update_entry(entry, options=options)
    connection.send_result(msg["id"], {})


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe_topology)
    websocket_api.async_register_command(hass, ws_entries)
    websocket_api.async_register_command(hass, ws_cleanup_list)
    websocket_api.async_register_command(hass, ws_hide_devices)
    websocket_api.async_register_command(hass, ws_unhide_devices)
    websocket_api.async_register_command(hass, ws_ports)
    websocket_api.async_register_command(hass, ws_routes)
    websocket_api.async_register_command(hass, ws_route_switch)
    websocket_api.async_register_command(hass, ws_route_add)
    websocket_api.async_register_command(hass, ws_route_delete)
    websocket_api.async_register_command(hass, ws_device_ip)
    websocket_api.async_register_command(hass, ws_address_overview)
    websocket_api.async_register_command(hass, ws_address_fixed)
    websocket_api.async_register_command(hass, ws_address_save)
    websocket_api.async_register_command(hass, ws_address_pool)
    websocket_api.async_register_command(hass, ws_history_summary)
    websocket_api.async_register_command(hass, ws_history_device)
    websocket_api.async_register_command(hass, ws_vpn_history)
    websocket_api.async_register_command(hass, ws_history_traffic)
    websocket_api.async_register_command(hass, ws_reconnect)
    websocket_api.async_register_command(hass, ws_vpn_switch)
    websocket_api.async_register_command(hass, ws_device_action)
    websocket_api.async_register_command(hass, ws_reboot)
    websocket_api.async_register_command(hass, ws_migrate_scan)
    websocket_api.async_register_command(hass, ws_box_info)
    websocket_api.async_register_command(hass, ws_wlan_list)
    websocket_api.async_register_command(hass, ws_wlan_switch)
    websocket_api.async_register_command(hass, ws_wlan_secret)
    websocket_api.async_register_command(hass, ws_wlan_password)
    websocket_api.async_register_command(hass, ws_latency)
    websocket_api.async_register_command(hass, ws_latency_switch)
    websocket_api.async_register_command(hass, ws_device_log)
    websocket_api.async_register_command(hass, ws_check_connection)
    websocket_api.async_register_command(hass, ws_capture_status)
    websocket_api.async_register_command(hass, ws_capture_start)
    websocket_api.async_register_command(hass, ws_capture_bands)
    websocket_api.async_register_command(hass, ws_capture_summary)
    websocket_api.async_register_command(hass, ws_capture_stop)
    websocket_api.async_register_command(hass, ws_capture_delete)
    websocket_api.async_register_command(hass, ws_filter_preview)
    websocket_api.async_register_command(hass, ws_filter_apply)
