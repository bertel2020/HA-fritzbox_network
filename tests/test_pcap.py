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
