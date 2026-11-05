"""Data models and parsers for the FRITZ!Box host list and mesh topology."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
import ipaddress
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
    max_rate_download: float | None = None
    max_rate_upload: float | None = None


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
    # bytes counted per device to and from the internet: mac -> (received, sent)
    traffic: dict[str, tuple[int, int]] = field(default_factory=dict)

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


@dataclass(frozen=True)
class DslInfo:
    """The DSL line as the box reports it; attenuation and noise margin in dB."""

    modulation: str | None
    profile: str | None
    rate_down: int | None
    rate_up: int | None
    max_rate_down: int | None
    max_rate_up: int | None
    noise_margin_down: float | None
    noise_margin_up: float | None
    attenuation_down: float | None
    attenuation_up: float | None
    fec_errors: int | None
    crc_errors: int | None
    # the signal to noise over the frequency, as many values as SPECTRUM_BUCKETS; 0 = not used
    spectrum_down: tuple[int, ...] = ()
    spectrum_up: tuple[int, ...] = ()


@dataclass(frozen=True)
class InternetInfo:
    """The connection of the box to the internet; rates in kbit/s, bytes counted since boot."""

    connected: bool | None
    uptime: int | None
    last_error: str | None
    access_type: str | None
    rate_down: int | None
    rate_up: int | None
    external_ipv4: str | None
    external_ipv6: str | None
    ipv6_prefix: str | None
    ipv6_prefix_length: int | None
    dns: tuple[str, ...]
    bytes_sent: int | None
    bytes_received: int | None
    dsl: DslInfo | None


@dataclass(frozen=True)
class FirmwareInfo:
    """Whether the box offers a newer firmware than the one it runs."""

    update_available: bool
    version: str | None
    info_url: str | None


def parse_firmware(result: dict[str, Any]) -> FirmwareInfo | None:
    """The firmware offer from UserInterface1/GetInfo; None where the box gives no answer."""
    if not result or result.get("NewUpgradeAvailable") is None:
        return None
    return FirmwareInfo(
        update_available=bool(result["NewUpgradeAvailable"]),
        version=_address(result.get("NewX_AVM-DE_Version")),
        info_url=_address(result.get("NewX_AVM-DE_InfoURL")),
    )


@dataclass(frozen=True)
class VpnConnection:
    """One WireGuard connection of the box: a device that dials in or a link to another site."""

    uid: str
    name: str
    # "device" for a single device, "site" for a link between two networks
    kind: str
    active: bool
    connected: bool
    # when the tunnel came up (unix seconds); None while it is down
    since: int | None
    remote_net: str | None
    # the public address of the other side, known for a connected link between two sites
    remote_endpoint: str | None
    editable: bool
    # what the entities are known by: the name, with the identifier added where two share a name.
    # The identifier alone is the place in the list of the box and moves when one is deleted.
    key: str = ""


VPN_KINDS = {"wireguard_simple": "device", "wireguard_lan_lan": "site"}


def parse_vpn(page: dict[str, Any] | None) -> list[VpnConnection] | None:
    """The WireGuard connections from the VPN page of the web interface.

    Only the connection list is read. The same answer carries the private key and the pre-shared
    keys of the box in ``wg_device_config``; they are never taken from it. None where the box has
    no such page (an older firmware), an empty list where it has no connection.
    """
    try:
        connections = page["data"]["init"]["boxConnections"]
    except (KeyError, TypeError):
        return None
    if not isinstance(connections, dict):
        return None
    found: list[VpnConnection] = []
    for entry in connections.values():
        if not isinstance(entry, dict):
            continue
        kind = VPN_KINDS.get(str(entry.get("type")))
        uid = str(entry.get("uid") or "")
        if kind is None or not uid:
            continue
        connected = bool(entry.get("connected"))
        try:
            since = int(entry.get("connectedSince") or 0) or None
        except (TypeError, ValueError):
            since = None
        found.append(
            VpnConnection(
                uid=uid,
                name=str(entry.get("name") or uid),
                kind=kind,
                active=bool(entry.get("active")),
                connected=connected,
                since=since if connected else None,
                remote_net=_address(entry.get("remoteNet")),
                remote_endpoint=_address(entry.get("remoteIp")) if connected else None,
                editable=bool(entry.get("editable")),
            )
        )
    names = Counter(c.name for c in found)
    found = [replace(c, key=c.name if names[c.name] == 1 else f"{c.name}#{c.uid}") for c in found]
    found.sort(key=lambda c: (c.kind != "site", c.name.lower()))
    return found


@dataclass
class NetworkData:
    """Result of one poll."""

    hosts: dict[str, Host]
    mesh: MeshTopology | None
    internet: InternetInfo | None = None
    # whether the guest Wi-Fi is on; None where the box has none
    guest_wifi: bool | None = None
    firmware: FirmwareInfo | None = None
    # the WireGuard connections; None where the box does not tell them
    vpn: list[VpnConnection] | None = None
    # first and last address of the range the DHCP server hands out, as numbers
    dhcp_pool: tuple[int, int] | None = None


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


def _wan_bytes(node: dict[str, Any]) -> tuple[int, int] | None:
    """The internet traffic the box counted for a node: (received, sent) in bytes."""
    metrics = node.get("metrics")
    counters = metrics.get("wan_counters") if isinstance(metrics, dict) else None
    counted = counters.get("bytes") if isinstance(counters, dict) else None
    if not isinstance(counted, dict):
        return None
    received, sent = counted.get("rx"), counted.get("tx")
    if isinstance(received, int) and isinstance(sent, int) and received >= 0 and sent >= 0:
        return received, sent
    return None


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
        if node_mac and (counted := _wan_bytes(node)) is not None:
            topology.traffic[node_mac] = counted
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
                    max_rate_download=_mbit(
                        link.get("max_data_rate_tx" if side == 1 else "max_data_rate_rx")
                    ),
                    max_rate_upload=_mbit(
                        link.get("max_data_rate_rx" if side == 1 else "max_data_rate_tx")
                    ),
                    ssid=ap_side.get("ssid") if link.get("type") == "WLAN" else None,
                    band=_band(ap_side) if link.get("type") == "WLAN" else None,
                )
    return topology


def parse_network(result: dict[str, Any]) -> dict[str, Any] | None:
    """The home network from LANHostConfigManagement1/GetInfo: mask, gateway, DHCP range, reserved.

    None where the box gives no mask. Addresses are plain strings; the list of reserved addresses
    is cut at commas and spaces.
    """
    mask = _address(result.get("NewSubnetMask"))
    if not mask:
        return None

    def split(value: Any) -> list[str]:
        return [part for part in re.split(r"[,\s]+", str(value or "")) if part]

    routers = split(result.get("NewIPRouters"))
    return {
        "mask": mask,
        "gateway": routers[0] if routers else None,
        "dhcp": bool(result.get("NewDHCPServerEnable")),
        "pool_from": _address(result.get("NewMinAddress")),
        "pool_to": _address(result.get("NewMaxAddress")),
        "reserved": split(result.get("NewReservedAddresses")),
    }


def dhcp_pool_of(network: dict[str, Any] | None) -> tuple[int, int] | None:
    """The DHCP range of ``parse_network`` as two numbers; None if the server is off."""
    if not network or not network.get("dhcp"):
        return None
    try:
        first = int(ipaddress.IPv4Address(network["pool_from"]))
        last = int(ipaddress.IPv4Address(network["pool_to"]))
    except (ipaddress.AddressValueError, TypeError):
        return None
    return (first, last) if first <= last else None


def check_address_range(network: dict[str, Any], first: str, last: str) -> str | None:
    """Why a new DHCP range does not fit the network of the box; None when it does.

    The codes: "invalid" (not addresses), "order" (first above last), "outside" (not in the
    network), "edge" (network or broadcast address), "gateway" (the box would be in the range).
    """
    try:
        net = ipaddress.ip_network(f"{network['gateway']}/{network['mask']}", strict=False)
        low, high = ipaddress.IPv4Address(first), ipaddress.IPv4Address(last)
        box = ipaddress.IPv4Address(network["gateway"])
    except (KeyError, ValueError, TypeError):
        return "invalid"
    if low > high:
        return "order"
    if low not in net or high not in net:
        return "outside"
    if low == net.network_address or high == net.broadcast_address:
        return "edge"
    if low <= box <= high:
        return "gateway"
    return None


def parse_ip_form(form: Any) -> dict[str, Any] | None:
    """What the edit form of a device (data.lua, page edit_device) says about its IPv4 address.

    {"fixed": the box always gives the device the same address, "editable": the form lets it be
    changed}; None where the form does not say.
    """
    try:
        ipv4 = form["data"]["vars"]["dev"]["ipv4"]
        fixed = ipv4["dhcp"]["alwaysSameIp"]
    except (KeyError, TypeError):
        return None
    if not isinstance(fixed, bool):
        return None
    return {"fixed": fixed, "editable": ipv4.get("editable") is True}


# The built-in profiles come without a name; the box derives it from the type.
_FILTER_PROFILE_TYPES = {"standard": "Standard", "guest": "Guest", "unrestricted": "Unrestricted"}


def parse_filter_profiles(xml: str | None) -> dict[str, str]:
    """Parse ``NewFilterProfileList`` into {profile id: name}.

    The layout of the list is read loosely: an element with a child whose tag ends
    in "id" is a profile, the first child with "name" in its tag is its name. Without
    a name the type of a built-in profile stands in for it, else the id.
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
        name = next((v for k, v in fields.items() if "name" in k and v), None)
        if name is None:
            kind = next((v for k, v in fields.items() if k.endswith("type")), "")
            name = _FILTER_PROFILE_TYPES.get(kind.lower(), profile_id)
        profiles[profile_id] = name
    return profiles


def parse_rights(xml: str | None) -> dict[str, str]:
    """Parse ``NewX_AVM-DE_CurrentUserRights`` into {path: access}."""
    if not xml:
        return {}
    root = ET.fromstring(xml)
    paths = [p.text or "" for p in root.findall("path")]
    access = [a.text or "" for a in root.findall("access")]
    return dict(zip(paths, access, strict=False))


def _number(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _tenth(value: Any) -> float | None:
    """A value the box gives in tenths (dB)."""
    number = _number(value)
    return None if number is None else number / 10


def _address(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


# the box gives a value per group of tones, several hundred of them; the panel draws this many
SPECTRUM_BUCKETS = 256


def spectrum(value: Any, buckets: int = SPECTRUM_BUCKETS) -> tuple[int, ...]:
    """The comma separated values per tone group as ``buckets`` averages, 0 for an unused bucket.

    The box writes 0 for a tone group the line does not use (the gaps between the bands of VDSL),
    so those do not count into an average. Without a usable list the result is empty.
    """
    if not isinstance(value, str):
        return ()
    tones = [number for part in value.split(",") if (number := _number(part)) is not None]
    if not tones or not any(tones):
        return ()
    size = len(tones) / buckets
    result = []
    for bucket in range(buckets):
        used = [
            t
            for t in tones[
                int(bucket * size) : max(int((bucket + 1) * size), int(bucket * size) + 1)
            ]
            if t > 0
        ]
        result.append(round(sum(used) / len(used)) if used else 0)
    return tuple(result)


def _dsl(result: dict[str, Any]) -> DslInfo | None:
    if not result or result.get("NewLinkStatus") != "Up":
        return None
    return DslInfo(
        modulation=_address(result.get("NewModulationType")),
        profile=_address(result.get("NewCurrentProfile")),
        rate_down=_number(result.get("NewDownstreamCurrRate")),
        rate_up=_number(result.get("NewUpstreamCurrRate")),
        max_rate_down=_number(result.get("NewDownstreamMaxRate")),
        max_rate_up=_number(result.get("NewUpstreamMaxRate")),
        noise_margin_down=_tenth(result.get("NewDownstreamNoiseMargin")),
        noise_margin_up=_tenth(result.get("NewUpstreamNoiseMargin")),
        attenuation_down=_tenth(result.get("NewDownstreamAttenuation")),
        attenuation_up=_tenth(result.get("NewUpstreamAttenuation")),
        fec_errors=_number(result.get("NewFECErrors")),
        crc_errors=_number(result.get("NewCRCErrors")),
        spectrum_down=spectrum(result.get("NewSNRpsds")),
        spectrum_up=spectrum(result.get("NewSNRpsus")),
    )


def _counter(fast: dict[str, dict[str, Any]], direction: str) -> int | None:
    """The byte counter of a direction: the 64 bit one of the add-on info, else the plain ones."""
    addon = fast.get("GetAddonInfos", {})
    plain = fast.get(f"GetTotalBytes{direction}", {})
    for value in (
        addon.get(f"NewX_AVM_DE_TotalBytes{direction}64"),
        addon.get(f"NewTotalBytes{direction}"),
        plain.get(f"NewTotalBytes{direction}"),
    ):
        if (number := _number(value)) is not None:
            return number
    return None


def parse_internet(
    fast: dict[str, dict[str, Any]], slow: dict[str, dict[str, Any]]
) -> InternetInfo | None:
    """The internet connection from the results of the actions, by action name.

    ``fast`` is read at every poll (status and byte counters), ``slow`` now and then (addresses,
    link rates, DSL line). An action the box refused is missing; None where there is no status.
    """
    status = fast.get("GetStatusInfo")
    if status is None:
        return None
    ipv6 = slow.get("X_AVM_DE_GetExternalIPv6Address", {})
    prefix = slow.get("X_AVM_DE_GetIPv6Prefix", {})
    link = slow.get("GetCommonLinkProperties", {})
    dns = [
        server
        for result in (
            slow.get("X_AVM_DE_GetDNSServer", {}),
            slow.get("X_AVM_DE_GetIPv6DNSServer", {}),
        )
        for key, value in sorted(result.items())
        if key.startswith(("NewIPv4DNSServer", "NewIPv6DNSServer")) and (server := _address(value))
    ]
    dsl = _dsl(slow.get("X_AVM-DE_GetDSLInfo", {}))
    # the line rate is what the link really syncs at; the layer 1 maximum is in bit/s
    rate_down = dsl.rate_down if dsl else None
    rate_up = dsl.rate_up if dsl else None
    if rate_down is None and (bits := _number(link.get("NewLayer1DownstreamMaxBitRate"))):
        rate_down = bits // 1000
    if rate_up is None and (bits := _number(link.get("NewLayer1UpstreamMaxBitRate"))):
        rate_up = bits // 1000
    return InternetInfo(
        connected=None
        if status.get("NewConnectionStatus") is None
        else status["NewConnectionStatus"] == "Connected",
        uptime=_number(status.get("NewUptime")),
        last_error=_address(status.get("NewLastConnectionError")),
        access_type=_address(link.get("NewWANAccessType")),
        rate_down=rate_down,
        rate_up=rate_up,
        external_ipv4=_address(slow.get("GetExternalIPAddress", {}).get("NewExternalIPAddress")),
        external_ipv6=_address(ipv6.get("NewExternalIPv6Address")),
        ipv6_prefix=_address(prefix.get("NewIPv6Prefix")),
        ipv6_prefix_length=_number(prefix.get("NewPrefixLength")),
        dns=tuple(dns),
        bytes_sent=_counter(fast, "Sent"),
        bytes_received=_counter(fast, "Received"),
        dsl=dsl,
    )


def parse_device_log(xml_text: str, limit: int = 300) -> list[dict[str, Any]]:
    """The event log of the box as {id, group, date, time, msg}, newest first, at most ``limit``."""
    root = ET.fromstring(xml_text)
    events = []
    for node in root.iter("Event"):
        events.append(
            {
                "id": node.findtext("id") or "",
                "group": node.findtext("group") or "",
                "date": node.findtext("date") or "",
                "time": node.findtext("time") or "",
                "msg": (node.findtext("msg") or "").strip(),
            }
        )
        if len(events) >= limit:
            break
    return events


def parse_capture_interfaces(html: str) -> list[dict[str, str]]:
    """The interfaces the capture page of the box offers: [{"id": "1-lan", "label": "lan"}, ...].

    Every row with a start button is one; its text (without the buttons) is the name the box gives.
    """
    found: dict[str, str] = {}
    for row in re.findall(r"(?is)<tr[^>]*>(?:(?!</tr>).)*?name=.start.(?:(?!</tr>).)*?</tr>", html):
        match = re.search(r"(?i)<button[^>]*name=.start.[^>]*value=.(\d-[0-9A-Za-z_]+)", row)
        if match is None:
            continue
        text = re.sub(r"(?is)<button.*?</button>", " ", row)
        label = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", text)).strip()
        found.setdefault(match.group(1), label or match.group(1))
    return [{"id": key, "label": label} for key, label in found.items()]
