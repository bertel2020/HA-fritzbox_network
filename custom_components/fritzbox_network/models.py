"""Data models and parsers for the FRITZ!Box host list and mesh topology."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any
from xml.etree import ElementTree as ET

from homeassistant.helpers.device_registry import format_mac

# Second hex digit 2, 6, A or E: the locally administered bit is set, which
# is how clients announce a randomized ("private") MAC address.
_PRIVATE_MAC_DIGITS = "26ae"

_MAC_RE = re.compile(r"([0-9a-f]{2}:){5}[0-9a-f]{2}")


def mac_id(mac: str) -> str:
    """MAC without separators, as used in entity ids."""
    return format_mac(mac).replace(":", "")


def _mac(value: Any) -> str | None:
    """The MAC in the usual format, or None where it is not a valid MAC address."""
    if not isinstance(value, str):
        return None
    mac = format_mac(value.strip())
    return mac if _MAC_RE.fullmatch(mac) else None


def _dicts(value: Any) -> list[dict[str, Any]]:
    """The dict items of a list; anything else the box sends in its place is empty."""
    return [i for i in value if isinstance(i, dict)] if isinstance(value, list) else []


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
    filter_profile: str | None = None
    name_writeable: bool | None = None

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
    signal_dbm: int | None = None
    rate_download: float | None = None
    rate_upload: float | None = None
    ssid: str | None = None
    band: str | None = None


@dataclass
class Radio:
    """One Wi-Fi radio (band) of an access point, as the box measures it."""

    channel: int | None = None
    utilization: int | None = None
    noise_dbm: int | None = None


@dataclass
class MeshNode:
    """A mesh participant (the box itself or a repeater)."""

    uid: str
    mac: str
    name: str
    model: str | None
    firmware: str | None
    role: str
    macs: frozenset[str] = frozenset()
    radios: dict[str, Radio] = field(default_factory=dict)


@dataclass
class MeshTopology:
    """Mesh nodes and the upstream link of every known client."""

    nodes: dict[str, MeshNode] = field(default_factory=dict)
    links: dict[str, ClientLink] = field(default_factory=dict)

    @property
    def master(self) -> MeshNode | None:
        return next((n for n in self.nodes.values() if n.role == "master"), None)

    def node_by_mac(self, mac: str) -> MeshNode | None:
        """The node with this MAC, which stays when the box renews the node's uid."""
        return next((n for n in self.nodes.values() if n.mac == mac), None)

    def node_of(self, host: Host) -> MeshNode | None:
        """The mesh node (box or repeater) this host entry belongs to, if any."""
        wanted = {host.mac, *host.mac_list}
        return next((n for n in self.nodes.values() if wanted & n.macs), None)


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


def _writeable(value: str | None) -> bool | None:
    return None if value is None else value == "1"


def parse_hosts(xml: str | bytes) -> list[Host]:
    """Parse the XML behind ``X_AVM-DE_GetHostListPath``."""
    if isinstance(xml, str):
        xml = xml.encode("utf-8")
    hosts: list[Host] = []
    for item in ET.fromstring(xml).findall("Item"):
        mac = _mac(_text(item, "MACAddress"))
        if not mac:
            continue
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
                    m
                    for m in map(_mac, (_text(item, "X_AVM-DE_MACAddressList") or mac).split(","))
                    if m
                ]
                or [mac],
                device_class=_text(item, "X_AVM-DE_DeviceClass"),
                filter_profile=_text(item, "X_AVM-DE_FilterProfileID"),
                name_writeable=_writeable(_text(item, "X_AVM-DE_FriendlyNameIsWriteable")),
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


def _rcpi(value: Any) -> int | None:
    """Signal in dBm; the box reports 255 where it does not know."""
    return value if isinstance(value, int) and value < 0 else None


def _mbit(kbit: Any) -> float | None:
    return round(kbit / 1000, 1) if isinstance(kbit, int | float) and kbit > 0 else None


def _band(interface: dict[str, Any]) -> str | None:
    freq = (interface.get("current_channel_info") or {}).get("primary_freq")
    if not isinstance(freq, int) or freq <= 0:
        return None
    return "2_4ghz" if freq < 3_000_000 else "5ghz" if freq < 5_925_000 else "6ghz"


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _radios(node: dict[str, Any]) -> dict[str, Radio]:
    """The radios a node offers its own network on, by band.

    The guest network is a second interface on the same radio and says the same.
    """
    radios: dict[str, Radio] = {}
    for interface in _dicts(node.get("node_interfaces")):
        band = _band(interface)
        if interface.get("type") != "WLAN" or interface.get("opmode") != "AP" or band is None:
            continue
        radios.setdefault(
            band,
            Radio(
                channel=_int(interface.get("current_channel")),
                utilization=_int(interface.get("channel_utilization")),
                noise_dbm=_int(interface.get("anpi")),
            ),
        )
    return radios


def parse_mesh(raw: str | bytes) -> MeshTopology:
    """Parse the JSON behind ``X_AVM-DE_GetMeshListPath``."""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("The mesh topology is not a JSON object")
    nodes_by_uid: dict[str, dict[str, Any]] = {
        n["uid"]: n for n in _dicts(data.get("nodes")) if isinstance(n.get("uid"), str)
    }
    interfaces: dict[str, dict[str, Any]] = {
        i["uid"]: i
        for n in nodes_by_uid.values()
        for i in _dicts(n.get("node_interfaces"))
        if isinstance(i.get("uid"), str)
    }

    topology = MeshTopology()
    for uid, node in nodes_by_uid.items():
        node_mac = _mac(node.get("device_mac_address"))
        if node.get("is_meshed") and node_mac:
            topology.nodes[uid] = MeshNode(
                uid=uid,
                mac=node_mac,
                name=node.get("device_friendly_name") or node.get("device_name") or uid,
                model=node.get("device_model"),
                firmware=node.get("device_firmware_version"),
                role=node.get("mesh_role") or "unknown",
                macs=frozenset(
                    m
                    for m in (
                        node_mac,
                        *(_mac(i.get("mac_address")) for i in _dicts(node.get("node_interfaces"))),
                    )
                    if m
                ),
                radios=_radios(node),
            )

    seen_links: set[str] = set()
    for node in nodes_by_uid.values():
        for interface in _dicts(node.get("node_interfaces")):
            for link in _dicts(interface.get("node_links")):
                link_uid = link.get("uid")
                if not isinstance(link_uid, str) or link_uid in seen_links:
                    continue
                if link.get("state") != "CONNECTED":
                    continue
                seen_links.add(link_uid)
                node_1 = nodes_by_uid.get(link.get("node_1_uid"))
                node_2 = nodes_by_uid.get(link.get("node_2_uid"))
                if_1 = interfaces.get(link.get("node_interface_1_uid"))
                if_2 = interfaces.get(link.get("node_interface_2_uid"))
                if not (node_1 and node_2 and if_1 and if_2):
                    continue
                side = _ap_side(node_1, if_1, node_2, if_2)
                if side is None:
                    continue
                ap, client = (node_1, node_2) if side == 1 else (node_2, node_1)
                client_mac = _mac(client.get("device_mac_address"))
                if not client_mac:
                    continue
                ap_side = if_1 if side == 1 else if_2
                topology.links[client_mac] = ClientLink(
                    ap_uid=ap["uid"],
                    ap_mac=_mac(ap.get("device_mac_address")),
                    ap_name=ap.get("device_friendly_name") or ap.get("device_name"),
                    link_type=link.get("type", "unknown"),
                    # rx/tx are as seen by the node of the link they belong to;
                    # the signal and the rates are given from the client's side
                    signal_dbm=_rcpi(link.get("rx_rcpi" if side == 1 else "tx_rcpi")),
                    rate_download=_mbit(
                        link.get("cur_data_rate_tx" if side == 1 else "cur_data_rate_rx")
                    ),
                    rate_upload=_mbit(
                        link.get("cur_data_rate_rx" if side == 1 else "cur_data_rate_tx")
                    ),
                    ssid=ap_side.get("ssid") if link.get("type") == "WLAN" else None,
                    band=_band(ap_side) if link.get("type") == "WLAN" else None,
                )
    return topology


def parse_filter_profiles(xml: str | None) -> dict[str, str]:
    """Parse ``NewFilterProfileList`` into {profile id: name}.

    The layout of the list is read loosely: an element with a child whose tag ends
    in "id" is a profile, the first child with "name" in its tag is its name.
    """
    if not xml:
        return {}
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return {}
    profiles: dict[str, str] = {}
    for element in root.iter():
        fields = {c.tag.lower(): (c.text or "").strip() for c in element if len(c) == 0}
        profile_id = next((v for k, v in fields.items() if k.endswith("id") and v), None)
        if profile_id is None:
            continue
        profiles[profile_id] = next((v for k, v in fields.items() if "name" in k and v), profile_id)
    return profiles


def parse_rights(xml: str | None) -> dict[str, str]:
    """Parse ``NewX_AVM-DE_CurrentUserRights`` into {path: access}."""
    if not xml:
        return {}
    root = ET.fromstring(xml)
    paths = [p.text or "" for p in root.findall("path")]
    access = [a.text or "" for a in root.findall("access")]
    return dict(zip(paths, access, strict=False))
