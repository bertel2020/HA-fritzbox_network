"""A small reader for pcap files: filter a capture to one device and summarize what is in it.

Only what the panel needs: Ethernet frames (also with a VLAN tag), ARP, IPv4 and IPv6 with TCP or
UDP, and the names asked for in DNS queries. Anything else is counted but not looked into.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
import ipaddress
from pathlib import Path
import struct

LINKTYPE_ETHERNET = 1
LINKTYPE_RAW = 101
# magic number -> (byte order, nanosecond timestamps)
MAGICS = {
    b"\xd4\xc3\xb2\xa1": ("<", False),
    b"\xa1\xb2\xc3\xd4": (">", False),
    b"\x4d\x3c\xb2\xa1": ("<", True),
    b"\xa1\xb2\x3c\x4d": (">", True),
}
ETH_IPV4 = 0x0800
ETH_ARP = 0x0806
ETH_VLAN = 0x8100
ETH_IPV6 = 0x86DD
PROTO_TCP = 6
PROTO_UDP = 17
MAX_FLOWS = 200_000
MAX_DNS = 5_000


class PcapError(ValueError):
    """The file is not a pcap this module can read."""


@dataclass
class Packet:
    time: float
    length: int
    data: bytes
    raw: bytes  # the record as it is in the file, header included


@dataclass
class Frame:
    """What is known about one packet."""

    src_mac: str | None = None
    dst_mac: str | None = None
    src_ip: str | None = None
    dst_ip: str | None = None
    protocol: str = "other"  # tcp, udp, arp, icmp, other
    src_port: int | None = None
    dst_port: int | None = None
    payload: bytes = b""


@dataclass
class Summary:
    packets: int = 0
    bytes: int = 0
    seconds: float = 0.0
    protocols: Counter = field(default_factory=Counter)
    flows: Counter = field(default_factory=Counter)
    flow_packets: Counter = field(default_factory=Counter)
    dns: Counter = field(default_factory=Counter)


def _mac(raw: bytes) -> str:
    return ":".join(f"{b:02x}" for b in raw)


class Reader:
    """Reads the packets of a pcap file one after the other."""

    def __init__(self, path: Path) -> None:
        self.path = path
        with path.open("rb") as handle:
            head = handle.read(24)
        if len(head) < 24 or head[:4] not in MAGICS:
            raise PcapError("not a pcap file")
        self.order, self.nano = MAGICS[head[:4]]
        self.header = head
        self.linktype = struct.unpack(f"{self.order}I", head[20:24])[0]

    def packets(self) -> Iterator[Packet]:
        record = struct.Struct(f"{self.order}IIII")
        with self.path.open("rb") as handle:
            handle.seek(24)
            while head := handle.read(16):
                if len(head) < 16:
                    return
                seconds, fraction, captured, length = record.unpack(head)
                data = handle.read(captured)
                if len(data) < captured:
                    return  # a capture that was cut off in the middle of a packet
                time = seconds + fraction / (1e9 if self.nano else 1e6)
                yield Packet(time, length, data, head + data)


def parse_frame(linktype: int, data: bytes) -> Frame:
    """Look into a packet as far as the headers go; an unknown shape is "other"."""
    frame = Frame()
    offset = 0
    ethertype = None
    if linktype == LINKTYPE_ETHERNET:
        if len(data) < 14:
            return frame
        frame.dst_mac, frame.src_mac = _mac(data[0:6]), _mac(data[6:12])
        ethertype = struct.unpack(">H", data[12:14])[0]
        offset = 14
        while ethertype == ETH_VLAN and len(data) >= offset + 4:
            ethertype = struct.unpack(">H", data[offset + 2 : offset + 4])[0]
            offset += 4
    elif linktype == LINKTYPE_RAW and data:
        ethertype = ETH_IPV4 if data[0] >> 4 == 4 else ETH_IPV6
    else:
        return frame
    if ethertype == ETH_ARP:
        frame.protocol = "arp"
        if len(data) >= offset + 28:
            frame.src_ip = str(ipaddress.IPv4Address(data[offset + 14 : offset + 18]))
            frame.dst_ip = str(ipaddress.IPv4Address(data[offset + 24 : offset + 28]))
        return frame
    if ethertype == ETH_IPV4 and len(data) >= offset + 20:
        header = (data[offset] & 0x0F) * 4
        proto = data[offset + 9]
        frame.src_ip = str(ipaddress.IPv4Address(data[offset + 12 : offset + 16]))
        frame.dst_ip = str(ipaddress.IPv4Address(data[offset + 16 : offset + 20]))
        _transport(frame, proto, data, offset + header)
    elif ethertype == ETH_IPV6 and len(data) >= offset + 40:
        proto = data[offset + 6]
        frame.src_ip = str(ipaddress.IPv6Address(data[offset + 8 : offset + 24]))
        frame.dst_ip = str(ipaddress.IPv6Address(data[offset + 24 : offset + 40]))
        _transport(frame, proto, data, offset + 40)
    return frame


def _transport(frame: Frame, proto: int, data: bytes, offset: int) -> None:
    if proto in (PROTO_TCP, PROTO_UDP) and len(data) >= offset + 8:
        frame.protocol = "tcp" if proto == PROTO_TCP else "udp"
        frame.src_port, frame.dst_port = struct.unpack(">HH", data[offset : offset + 4])
        header = (
            8
            if proto == PROTO_UDP
            else ((data[offset + 12] >> 4) * 4 if len(data) > offset + 12 else 20)
        )
        frame.payload = data[offset + header :]
    elif proto in (1, 58):
        frame.protocol = "icmp"


def dns_query(payload: bytes) -> str | None:
    """The name a DNS query asks for, or None if the payload is not a query."""
    if len(payload) < 13 or payload[2] & 0x80 or struct.unpack(">H", payload[4:6])[0] < 1:
        return None
    labels = []
    at = 12
    while at < len(payload):
        size = payload[at]
        if size == 0:
            break
        if size & 0xC0 or at + 1 + size > len(payload):
            return None
        labels.append(payload[at + 1 : at + 1 + size].decode("ascii", "replace"))
        at += 1 + size
    return ".".join(labels).lower() or None


def filter_device(source: Path, target: Path, mac: str, ips: set[str]) -> int:
    """Write the packets of one device (by its MAC or one of its IP addresses); returns how many."""
    reader = Reader(source)
    kept = 0
    with target.open("wb") as out:
        out.write(reader.header)
        for packet in reader.packets():
            frame = parse_frame(reader.linktype, packet.data)
            if mac in (frame.src_mac, frame.dst_mac) or ips & {frame.src_ip, frame.dst_ip}:
                out.write(packet.raw)
                kept += 1
    return kept


def _server_port(frame: Frame) -> int | None:
    """The port that names the service: the lower one, the way services use low numbers."""
    ports = [p for p in (frame.src_port, frame.dst_port) if p is not None]
    return min(ports) if ports else None


def summarize(path: Path) -> Summary:
    """Count a capture: protocols, the conversations by volume and the names asked for."""
    reader = Reader(path)
    summary = Summary()
    first = last = None
    for packet in reader.packets():
        summary.packets += 1
        summary.bytes += packet.length
        first = packet.time if first is None else first
        last = packet.time
        frame = parse_frame(reader.linktype, packet.data)
        summary.protocols[frame.protocol] += 1
        if frame.src_ip and frame.dst_ip and len(summary.flows) < MAX_FLOWS:
            pair = sorted((frame.src_ip, frame.dst_ip))
            key = (pair[0], pair[1], frame.protocol, _server_port(frame))
            summary.flows[key] += packet.length
            summary.flow_packets[key] += 1
        if frame.protocol == "udp" and frame.dst_port == 53 and len(summary.dns) < MAX_DNS:
            if name := dns_query(frame.payload):
                summary.dns[name] += 1
    if first is not None and last is not None:
        summary.seconds = round(last - first, 2)
    return summary


# a record header: seconds, microseconds, captured length, original length
_PLAUSIBLE_YEARS = (1_500_000_000, 2_500_000_000)
MAX_PACKET = 262_144


def record_order(data: bytes) -> str | None:
    """The byte order if the data starts with a pcap record header, None if it does not.

    The box streams a capture without the file header of pcap (an assumption read from the first
    bytes it sends: a time stamp in the right years, then sensible lengths).
    """
    if len(data) < 16:
        return None
    for order in ("<", ">"):
        seconds, micros, captured, length = struct.unpack(f"{order}IIII", data[:16])
        if (
            _PLAUSIBLE_YEARS[0] <= seconds <= _PLAUSIBLE_YEARS[1]
            and micros < 1_000_000
            and 0 < captured <= length <= MAX_PACKET
        ):
            return order
    return None


def file_header(order: str = "<", linktype: int = LINKTYPE_ETHERNET, snaplen: int = 65535) -> bytes:
    """The header of a pcap file for Ethernet frames."""
    return struct.pack(f"{order}IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, snaplen, linktype)
