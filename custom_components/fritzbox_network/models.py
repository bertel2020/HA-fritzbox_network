"""Data models and parsers for the FRITZ!Box host list and mesh topology."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any
from xml.etree import ElementTree as ET

from homeassistant.helpers.device_registry import format_mac

# Second hex digit 2, 6, A or E: the locally administered bit is set, which
# is how clients announce a randomized ("private") MAC address.
_PRIVATE_MAC_DIGITS = "26ae"


def mac_id(mac: str) -> str:
    """MAC without separators, as used in entity ids."""
    return format_mac(mac).replace(":", "")


def is_private_mac(mac: str) -> bool:
    """Return True for a randomized, locally administered MAC address."""
    digits = mac_id(mac)
    return len(digits) == 12 and digits[1] in _PRIVATE_MAC_DIGITS


@dataclass
class Host:
    """One entry of the FRITZ!Box host list."""

    mac: str
    name: str
    ip: str | None
    active: bool
    interface_type: str | None
    port: str | None
    speed: int | None
    guest: bool
    vpn: bool
    wan_access: bool | None
    priority: bool
    model: str | None
    hostname: str | None
    friendly_name: str | None
    mac_list: list[str] = field(default_factory=list)
    device_class: str | None = None

    @property
    def is_ethernet(self) -> bool:
        return self.interface_type == "Ethernet"


@dataclass
class ClientLink:
    """The upstream connection of a client in the mesh."""

    ap_uid: str
    ap_mac: str | None
    ap_name: str | None
    link_type: str


@dataclass
class MeshNode:
    """A mesh participant (the box itself or a repeater)."""

    uid: str
    mac: str
    name: str
    model: str | None
    firmware: str | None
    role: str


@dataclass
class MeshTopology:
    """Mesh nodes and the upstream link of every known client."""

    nodes: dict[str, MeshNode] = field(default_factory=dict)
    links: dict[str, ClientLink] = field(default_factory=dict)

    @property
    def master(self) -> MeshNode | None:
        return next((n for n in self.nodes.values() if n.role == "master"), None)


@dataclass
class NetworkData:
    """Result of one poll."""

    hosts: dict[str, Host]
    mesh: MeshTopology | None


def _text(item: ET.Element, tag: str) -> str | None:
    value = item.findtext(tag)
    return value.strip() if value and value.strip() else None


def _flag(item: ET.Element, tag: str) -> bool:
    return _text(item, tag) == "1"


def parse_hosts(xml: str | bytes) -> list[Host]:
    """Parse the XML behind ``X_AVM-DE_GetHostListPath``."""
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    hosts: list[Host] = []
    for item in ET.fromstring(xml).findall("Item"):
        mac = _text(item, "MACAddress")
        if not mac:
            continue
        mac = format_mac(mac)
        hostname = _text(item, "HostName")
        friendly = _text(item, "X_AVM-DE_FriendlyName")
        wan = _text(item, "X_AVM-DE_WANAccess")
        speed = _text(item, "X_AVM-DE_Speed")
        hosts.append(
            Host(
                mac=mac,
                name=friendly or hostname or f"fritz_{mac_id(mac)}",
                ip=_text(item, "IPAddress"),
                active=_flag(item, "Active"),
                interface_type=_text(item, "InterfaceType"),
                port=_text(item, "X_AVM-DE_Port"),
                speed=int(speed) if speed and speed.isdigit() else None,
                guest=_flag(item, "X_AVM-DE_Guest"),
                vpn=_flag(item, "X_AVM-DE_VPN"),
                wan_access=None if wan is None else wan == "granted",
                priority=_flag(item, "X_AVM-DE_Priority"),
                model=_text(item, "X_AVM-DE_Model"),
                hostname=hostname,
                friendly_name=friendly,
                mac_list=[
                    format_mac(m)
                    for m in (_text(item, "X_AVM-DE_MACAddressList") or mac).split(",")
                ],
                device_class=_text(item, "X_AVM-DE_DeviceClass"),
            )
        )
    return hosts


def _ap_side(
    node_1: dict[str, Any], if_1: dict[str, Any], node_2: dict[str, Any], if_2: dict[str, Any]
) -> int | None:
    """Return 1 or 2 for the side of a link that is the access point, else None."""
    for index, interface in ((1, if_1), (2, if_2)):
        if interface.get("opmode") in ("AP", "AP_GUEST"):
            return index
    meshed = [i for i, n in ((1, node_1), (2, node_2)) if n.get("is_meshed")]
    if len(meshed) == 1:
        return meshed[0]
    if len(meshed) == 2:
        for index, node in ((1, node_1), (2, node_2)):
            if node.get("mesh_role") == "master":
                return index
    return None


def parse_mesh(raw: str | bytes) -> MeshTopology:
    """Parse the JSON behind ``X_AVM-DE_GetMeshListPath``."""
    data = json.loads(raw)
    nodes_by_uid: dict[str, dict[str, Any]] = {n["uid"]: n for n in data.get("nodes", [])}
    interfaces: dict[str, dict[str, Any]] = {
        i["uid"]: i for n in nodes_by_uid.values() for i in n.get("node_interfaces", [])
    }

    topology = MeshTopology()
    for uid, node in nodes_by_uid.items():
        if node.get("is_meshed") and node.get("device_mac_address"):
            topology.nodes[uid] = MeshNode(
                uid=uid,
                mac=format_mac(node["device_mac_address"]),
                name=node.get("device_friendly_name") or node.get("device_name") or uid,
                model=node.get("device_model"),
                firmware=node.get("device_firmware_version"),
                role=node.get("mesh_role") or "unknown",
            )

    seen_links: set[str] = set()
    for node in nodes_by_uid.values():
        for interface in node.get("node_interfaces", []):
            for link in interface.get("node_links", []):
                if link["uid"] in seen_links or link.get("state") != "CONNECTED":
                    continue
                seen_links.add(link["uid"])
                node_1 = nodes_by_uid.get(link["node_1_uid"])
                node_2 = nodes_by_uid.get(link["node_2_uid"])
                if_1 = interfaces.get(link["node_interface_1_uid"])
                if_2 = interfaces.get(link["node_interface_2_uid"])
                if not (node_1 and node_2 and if_1 and if_2):
                    continue
                side = _ap_side(node_1, if_1, node_2, if_2)
                if side is None:
                    continue
                ap, client = (node_1, node_2) if side == 1 else (node_2, node_1)
                client_mac = client.get("device_mac_address")
                if not client_mac:
                    continue
                topology.links[format_mac(client_mac)] = ClientLink(
                    ap_uid=ap["uid"],
                    ap_mac=format_mac(ap["device_mac_address"])
                    if ap.get("device_mac_address")
                    else None,
                    ap_name=ap.get("device_friendly_name") or ap.get("device_name"),
                    link_type=link.get("type", "unknown"),
                )
    return topology


def parse_rights(xml: str | None) -> dict[str, str]:
    """Parse ``NewX_AVM-DE_CurrentUserRights`` into {path: access}."""
    if not xml:
        return {}
    root = ET.fromstring(xml)
    paths = [p.text or "" for p in root.findall("path")]
    access = [a.text or "" for a in root.findall("access")]
    return dict(zip(paths, access, strict=False))
