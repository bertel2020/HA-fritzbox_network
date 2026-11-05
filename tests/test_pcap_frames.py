"""Shapes of frames the pcap reader meets: VLAN, PPPoE, ARP, IPv6, raw IP, broken ones."""

import struct

import pytest

from custom_components.fritzbox_network import pcap

MAC_A = bytes.fromhex("020000000001")
MAC_B = bytes.fromhex("020000000002")


def _ipv4(proto: int, payload: bytes, src=(10, 0, 0, 1), dst=(10, 0, 0, 2)) -> bytes:
    head = bytearray(20)
    head[0] = 0x45
    head[9] = proto
    head[12:16] = bytes(src)
    head[16:20] = bytes(dst)
    return bytes(head) + payload


def _udp(sport: int, dport: int, body: bytes = b"") -> bytes:
    return struct.pack(">HHHH", sport, dport, 8 + len(body), 0) + body


def _eth(ethertype: int, payload: bytes) -> bytes:
    return MAC_B + MAC_A + struct.pack(">H", ethertype) + payload


def test_a_vlan_tagged_udp_frame_is_looked_into():
    inner = struct.pack(">HH", 5, pcap.ETH_IPV4) + _ipv4(pcap.PROTO_UDP, _udp(5000, 53))
    frame = pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(pcap.ETH_VLAN, inner))

    assert frame.protocol == "udp"
    assert (frame.src_port, frame.dst_port) == (5000, 53)
    assert frame.src_ip == "10.0.0.1"


def test_a_pppoe_session_carries_ipv4():
    ppp = bytes(6) + struct.pack(">H", pcap.PPP_IPV4) + _ipv4(pcap.PROTO_UDP, _udp(1, 2))
    frame = pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(pcap.ETH_PPPOE, ppp))

    assert frame.protocol == "udp"
    assert frame.dst_ip == "10.0.0.2"


def test_arp_names_both_addresses():
    arp = bytes(14) + bytes((192, 168, 0, 1)) + bytes(6) + bytes((192, 168, 0, 2))
    frame = pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(pcap.ETH_ARP, arp))

    assert (frame.protocol, frame.src_ip, frame.dst_ip) == ("arp", "192.168.0.1", "192.168.0.2")


def test_ipv6_tcp_and_icmp():
    head = bytearray(40)
    head[0] = 0x60
    head[6] = pcap.PROTO_TCP
    head[8:24] = bytes(15) + b"\x01"
    head[24:40] = bytes(15) + b"\x02"
    tcp = struct.pack(">HH", 443, 50000) + bytes(8) + b"\x50" + bytes(7)
    frame = pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(pcap.ETH_IPV6, bytes(head) + tcp))
    assert (frame.protocol, frame.src_port) == ("tcp", 443)

    head[6] = 58
    frame = pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(pcap.ETH_IPV6, bytes(head) + bytes(8)))
    assert frame.protocol == "icmp"


def test_raw_ip_and_unknown_shapes():
    raw = pcap.parse_frame(101, _ipv4(1, bytes(8)))
    assert (raw.protocol, raw.src_ip) == ("icmp", "10.0.0.1")
    assert pcap.parse_frame(999, b"abc").unknown == "linktype 999"
    assert pcap.parse_frame(pcap.LINKTYPE_ETHERNET, b"short").protocol == "other"
    assert pcap.parse_frame(pcap.LINKTYPE_ETHERNET, _eth(0x1234, bytes(30))).unknown == (
        "ethertype 0x1234"
    )


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"\x00" * 12,
        bytes(2) + b"\x80" + bytes(10) + b"\x03abc\x00",  # a response
        bytes(4) + b"\x00\x01" + bytes(6) + b"\xc0\x0c",  # a compressed label
        bytes(4) + b"\x00\x01" + bytes(6) + b"\x09abc",  # a label that runs past the end
    ],
)
def test_dns_queries_that_are_not_queries(payload):
    assert pcap.dns_query(payload) is None


def test_dns_query_names():
    payload = bytes(4) + b"\x00\x01" + bytes(6) + b"\x07Example\x03org\x00"
    assert pcap.dns_query(payload) == "example.org"


def _file(path, records, magic=b"\xd4\xc3\xb2\xa1", linktype=1):
    head = magic + struct.pack("<HHiIII", 2, 4, 0, 0, 65535, linktype)
    body = b""
    for data in records:
        body += struct.pack("<IIII", 1, 0, len(data), len(data)) + data
    path.write_bytes(head + body)


def test_filtering_and_summarizing_a_capture(tmp_path):
    mine = _eth(pcap.ETH_IPV4, _ipv4(pcap.PROTO_UDP, _udp(5000, 53, b"x")))
    other = (
        MAC_A
        + bytes.fromhex("020000000009")
        + struct.pack(">H", pcap.ETH_IPV4)
        + _ipv4(pcap.PROTO_UDP, _udp(1, 2), src=(1, 1, 1, 1), dst=(2, 2, 2, 2))
    )
    source = tmp_path / "in.pcap"
    _file(source, [mine, other, b"\x00\x01"])

    target = tmp_path / "out.pcap"
    kept = pcap.filter_device(source, target, "02:00:00:00:00:01", set())
    summary = pcap.summarize(source)

    assert kept >= 1
    assert summary.packets == 3
    assert summary.protocols["udp"] == 2


def test_a_cut_off_packet_ends_the_reading(tmp_path):
    source = tmp_path / "cut.pcap"
    _file(source, [bytes(40)])
    source.write_bytes(source.read_bytes()[:-10])

    assert pcap.summarize(source).packets == 0


def test_a_file_that_is_no_pcap_is_refused(tmp_path):
    source = tmp_path / "no.pcap"
    source.write_bytes(b"not a capture at all, really not" * 2)

    with pytest.raises(pcap.PcapError):
        pcap.summarize(source)
