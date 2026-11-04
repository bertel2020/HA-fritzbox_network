"""The pcap reader: filter to one device, summarize."""

import struct

import pytest

from custom_components.fritzbox_network import pcap

A = bytes.fromhex("aabbccddee01")
B = bytes.fromhex("aabbccddee02")
C = bytes.fromhex("aabbccddee03")


def _ipv4(src, dst, proto, payload):
    total = 20 + len(payload)
    head = struct.pack(">BBHHHBBH4s4s", 0x45, 0, total, 0, 0, 64, proto, 0, bytes(src), bytes(dst))
    return head + payload


def _udp(sport, dport, payload):
    return struct.pack(">HHHH", sport, dport, 8 + len(payload), 0) + payload


def _frame(src_mac, dst_mac, src_ip, dst_ip, proto, payload):
    return dst_mac + src_mac + b"\x08\x00" + _ipv4(src_ip, dst_ip, proto, payload)


def _dns(name):
    labels = b"".join(bytes([len(p)]) + p.encode() for p in name.split("."))
    return struct.pack(">HHHHHH", 1, 0x0100, 1, 0, 0, 0) + labels + b"\0" + struct.pack(">HH", 1, 1)


def _file(path, frames):
    out = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    for n, frame in enumerate(frames):
        out += struct.pack("<IIII", 100 + n, 0, len(frame), len(frame)) + frame
    path.write_bytes(out)


@pytest.fixture
def capture(tmp_path):
    path = tmp_path / "lan_20261104-101500.pcap"
    one, two, three = (192, 168, 1, 10), (192, 168, 1, 20), (8, 8, 8, 8)
    _file(
        path,
        [
            _frame(A, B, one, three, 17, _udp(5000, 53, _dns("Example.org"))),
            _frame(A, B, one, three, 17, _udp(5001, 53, _dns("example.org"))),
            _frame(
                C,
                B,
                two,
                three,
                6,
                struct.pack(">HH", 40000, 443) + b"\0" * 8 + b"\x50" + b"\0" * 7,
            ),
            _frame(
                B,
                C,
                three,
                two,
                6,
                struct.pack(">HH", 443, 40000) + b"\0" * 8 + b"\x50" + b"\0" * 7,
            ),
        ],
    )
    return path


def test_a_capture_is_filtered_to_one_device(capture, tmp_path):
    target = tmp_path / "only.pcap"
    kept = pcap.filter_device(capture, target, "aa:bb:cc:dd:ee:03", set())
    assert kept == 2
    assert pcap.summarize(target).packets == 2
    assert pcap.filter_device(capture, target, "02:00:00:00:00:00", {"192.168.1.10"}) == 2


def test_a_capture_is_summarized(capture):
    summary = pcap.summarize(capture)
    assert summary.packets == 4
    assert summary.protocols == {"udp": 2, "tcp": 2}
    assert summary.dns == {"example.org": 2}
    (first, size), *_ = summary.flows.most_common(1)
    assert first[3] in (53, 443)
    assert size > 0


def test_something_that_is_no_pcap_is_refused(tmp_path):
    path = tmp_path / "x.pcap"
    path.write_bytes(b"not a capture at all, just text")
    with pytest.raises(pcap.PcapError):
        pcap.summarize(path)


def test_a_cut_off_capture_keeps_what_is_complete(capture, tmp_path):
    cut = tmp_path / "cut.pcap"
    cut.write_bytes(capture.read_bytes()[:-10])
    assert pcap.summarize(cut).packets == 3


def _modified(path, frames):
    """The format of the box: big endian, magic a1b2cd34, 24 byte record headers."""
    out = struct.pack(">IHHiIII", 0xA1B2CD34, 2, 4, 0, 0, 2048, 1)
    for n, frame in enumerate(frames):
        out += struct.pack(">IIII", 1_793_000_000 + n, 5, len(frame), len(frame))
        out += struct.pack(">IHBB", 0, 0x0800, 0, 0) + frame
    path.write_bytes(out)


def test_the_modified_tcpdump_format_of_the_box_is_read_and_filtered(tmp_path):
    one, three = (192, 168, 1, 10), (8, 8, 8, 8)
    source = tmp_path / "box.pcap"
    _modified(
        source,
        [
            _frame(A, B, one, three, 17, _udp(5000, 53, _dns("example.org"))),
            _frame(C, B, (192, 168, 1, 20), three, 17, _udp(5001, 53, _dns("other.net"))),
        ],
    )

    summary = pcap.summarize(source)
    assert summary.packets == 2
    assert summary.dns == {"example.org": 1, "other.net": 1}

    target = tmp_path / "only.pcap"
    assert pcap.filter_device(source, target, "aa:bb:cc:dd:ee:03", set()) == 1
    assert pcap.summarize(target).dns == {"other.net": 1}


def test_raw_ip_and_pppoe_packets_are_understood():
    udp = _udp(5000, 53, _dns("example.org"))
    ip = _ipv4((192, 168, 1, 10), (8, 8, 8, 8), 17, udp)

    raw = pcap.parse_frame(14, ip)  # the routing interfaces of the box
    assert (raw.src_ip, raw.protocol, raw.dst_port) == ("192.168.1.10", "udp", 53)

    pppoe = A + B + b"\x88\x64" + b"\x11\x00\x00\x01" + struct.pack(">H", len(ip) + 2)
    pppoe += struct.pack(">H", 0x0021) + ip  # an internet connection over a DSL line
    framed = pcap.parse_frame(1, pppoe)
    assert (framed.dst_ip, framed.protocol) == ("8.8.8.8", "udp")

    other = pcap.parse_frame(1, A + B + b"\x88\xcc" + b"\0" * 20)
    assert other.protocol == "other"
    assert other.unknown == "ethertype 0x88cc"
    assert pcap.parse_frame(99, b"\0" * 20).unknown == "linktype 99"


def test_the_unicast_mac_addresses_of_a_capture_are_counted_as_sender_and_receiver(tmp_path):
    one, three = (192, 168, 1, 10), (8, 8, 8, 8)
    broadcast = bytes.fromhex("ffffffffffff")
    source = tmp_path / "x.pcap"
    _file(
        source,
        [
            _frame(A, B, one, three, 17, _udp(5000, 53, _dns("a.org"))),
            _frame(B, A, three, one, 17, _udp(53, 5000, _dns("a.org"))),
            _frame(C, broadcast, one, three, 17, _udp(1, 2, b"")),
        ],
    )

    seen = pcap.macs(source)

    assert seen == {"aa:bb:cc:dd:ee:01": 2, "aa:bb:cc:dd:ee:02": 2, "aa:bb:cc:dd:ee:03": 1}


def test_senders_and_receivers_can_be_counted_apart(tmp_path):
    one, three = (192, 168, 1, 10), (8, 8, 8, 8)
    source = tmp_path / "x.pcap"
    _file(
        source,
        [
            _frame(A, B, one, three, 17, _udp(5000, 53, _dns("a.org"))),
            _frame(B, C, three, one, 17, _udp(53, 5000, _dns("a.org"))),
        ],
    )

    assert pcap.macs(source, receivers=False) == {"aa:bb:cc:dd:ee:01": 1, "aa:bb:cc:dd:ee:02": 1}
    assert pcap.macs(source, senders=False) == {"aa:bb:cc:dd:ee:02": 1, "aa:bb:cc:dd:ee:03": 1}
