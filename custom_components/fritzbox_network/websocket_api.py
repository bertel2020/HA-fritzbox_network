"""WebSocket subscription that feeds the topology card."""

from __future__ import annotations

from dataclasses import asdict
import ipaddress
import time
from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, format_mac
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .capture import (
    DEFAULT_BYTES,
    DEFAULT_SECONDS,
    INTERFACES,
    KEY_CAPTURES,
    MAX_BYTES,
    MAX_SECONDS,
    MIN_SECONDS,
    VIEW_URL,
)
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
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .filters import FILTER_OPTIONS, select_hosts
from .models import MeshNode, MeshTopology, check_address_range, is_private_mac, mac_id
from .repairs import async_update_stale_issue, last_online

COMMAND = f"{DOMAIN}/subscribe_topology"
ENTRIES_COMMAND = f"{DOMAIN}/entries"
CLEANUP_LIST_COMMAND = f"{DOMAIN}/cleanup/list"
HIDE_COMMAND = f"{DOMAIN}/devices/hide"
UNHIDE_COMMAND = f"{DOMAIN}/devices/unhide"
RECONNECT_COMMAND = f"{DOMAIN}/internet/reconnect"
REBOOT_COMMAND = f"{DOMAIN}/box/reboot"
PORTS_COMMAND = f"{DOMAIN}/ports/list"
IP_COMMAND = f"{DOMAIN}/device/ip"
ADDRESS_OVERVIEW_COMMAND = f"{DOMAIN}/address/overview"
ADDRESS_FIXED_COMMAND = f"{DOMAIN}/address/fixed"
ADDRESS_SAVE_COMMAND = f"{DOMAIN}/address/save"
ADDRESS_POOL_COMMAND = f"{DOMAIN}/address/pool"
HISTORY_COMMAND = f"{DOMAIN}/history/summary"
HISTORY_DEVICE_COMMAND = f"{DOMAIN}/history/device"
CAPTURE_STATUS_COMMAND = f"{DOMAIN}/capture/status"
CAPTURE_START_COMMAND = f"{DOMAIN}/capture/start"
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
                "radios": {
                    band: {
                        "channel": radio.channel,
                        "utilization": radio.utilization,
                        "noise_dbm": radio.noise_dbm,
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
            if (entity_id := registry.async_get_entity_id(platform, DOMAIN, f"{host.mac}_{key}"))
        }
        # a group is a label on the "Internet access" switch, not on the device: a label on
        # the device would also reach its priority switch
        internet = (
            registry.async_get(actions["internet_access"]) if "internet_access" in actions else None
        )
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
                "vendor": coordinator.panel_vendor(host.mac),
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
        "internet": _internet(coordinator),
        "firmware": _firmware(coordinator),
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
        last = last_online(hass, host)
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
        entries = await hass.async_add_executor_job(coordinator.client.get_port_mappings)
    except FritzConnectionException as err:
        connection.send_error(msg["id"], websocket_api.ERR_UNKNOWN_ERROR, str(err))
        return
    hosts = {h.ip: h for h in coordinator.data.hosts.values() if h.ip}
    for entry in entries:
        host = hosts.get(entry["client"])
        entry["device_id"] = mac_id(host.mac) if host else None
        entry["device_name"] = host.name if host else None
    connection.send_result(msg["id"], {"entries": entries})


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
            "traffic": history.traffic_all() if history else {},
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): HISTORY_DEVICE_COMMAND,
        vol.Required("entry_id"): str,
        vol.Required("mac"): str,
    }
)
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
    {vol.Required("type"): REBOOT_COMMAND, vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_reboot(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Restart the box. Only the panel offers it, behind a confirmation."""
    await _box_action(hass, connection, msg, "reboot")


def _capture_state(hass: HomeAssistant, entry_id: str) -> dict[str, Any]:
    manager = hass.data[KEY_CAPTURES][entry_id]
    return {
        "job": manager.job.as_dict() if manager.job else None,
        "files": manager.files(),
        "interfaces": list(INTERFACES),
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
        vol.Required("interface"): vol.In(list(INTERFACES)),
        vol.Required("seconds"): vol.All(int, vol.Range(min=MIN_SECONDS, max=MAX_SECONDS)),
        vol.Required("mb"): vol.All(int, vol.Range(min=1, max=MAX_BYTES // 1048576)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_start(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Start recording on an interface of the box."""
    if _loaded_coordinator(hass, connection, msg) is None:
        return
    manager = hass.data[KEY_CAPTURES][msg["entry_id"]]
    try:
        manager.start(msg["interface"], msg["seconds"], msg["mb"] * 1048576)
    except ValueError as err:
        connection.send_error(msg["id"], ERR_BUSY if str(err) == "busy" else ERR_INVALID, str(err))
        return
    connection.send_result(
        msg["id"], await hass.async_add_executor_job(_capture_state, hass, msg["entry_id"])
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
    websocket_api.async_register_command(hass, ws_device_ip)
    websocket_api.async_register_command(hass, ws_address_overview)
    websocket_api.async_register_command(hass, ws_address_fixed)
    websocket_api.async_register_command(hass, ws_address_save)
    websocket_api.async_register_command(hass, ws_address_pool)
    websocket_api.async_register_command(hass, ws_history_summary)
    websocket_api.async_register_command(hass, ws_history_device)
    websocket_api.async_register_command(hass, ws_reconnect)
    websocket_api.async_register_command(hass, ws_reboot)
    websocket_api.async_register_command(hass, ws_capture_status)
    websocket_api.async_register_command(hass, ws_capture_start)
    websocket_api.async_register_command(hass, ws_capture_stop)
    websocket_api.async_register_command(hass, ws_capture_delete)
    websocket_api.async_register_command(hass, ws_filter_preview)
    websocket_api.async_register_command(hass, ws_filter_apply)
