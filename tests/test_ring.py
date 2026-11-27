"""The ring buffer: a capture that holds the last minutes, saved on demand or by a trigger."""

from datetime import timedelta
import struct

from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.fritzbox_network import pcap
from custom_components.fritzbox_network.capture import KEY_CAPTURES, SegmentWriter
from custom_components.fritzbox_network.const import DOMAIN

STATUS = f"{DOMAIN}/capture/status"
START = f"{DOMAIN}/capture/start"
RING_START = f"{DOMAIN}/capture/ring_start"
RING_STOP = f"{DOMAIN}/capture/ring_stop"
RING_SAVE = f"{DOMAIN}/capture/ring_save"

HEADER = b"\xd4\xc3\xb2\xa1\x02\x00\x04\x00" + b"\0" * 8 + b"\xff\xff\0\0\x01\0\0\0"


def _packet(n: int, size: int = 60) -> bytes:
    return struct.pack("<IIII", 100 + n, 0, size, size) + bytes([n % 256]) * size


class Clock:
    now = 0.0

    def __call__(self) -> float:
        return self.now


def _count(path) -> int:
    return sum(1 for _ in pcap.Reader(path).packets())


def test_the_stream_is_cut_into_segments_and_old_ones_go(tmp_path):
    clock = Clock()
    writer = SegmentWriter(tmp_path / "ring", window_seconds=60, max_bytes=10**9, clock=clock)
    stream = HEADER + b"".join(_packet(n) for n in range(10))
    # odd pieces: a packet is never cut where it is written
    for start in range(0, len(stream), 37):
        writer.feed(stream[start : start + 37])
    assert len(list((tmp_path / "ring").iterdir())) == 1
    for n in range(10, 40):
        clock.now += 10  # a segment of 30 s holds three packets
        writer.feed(_packet(n))
    files = list((tmp_path / "ring").iterdir())
    # what is older than the window (60 s) is gone, the newest stays
    assert 2 <= len(files) <= 4
    saved = tmp_path / "saved.pcap"
    writer.save(saved)
    count = _count(saved)
    assert 6 <= count <= 12
    assert writer.status()["bytes"] > 0
    writer.close()
    assert not list((tmp_path / "ring").iterdir())


def test_the_size_limit_drops_segments_too(tmp_path):
    clock = Clock()
    writer = SegmentWriter(tmp_path / "ring", window_seconds=10**6, max_bytes=2 * 1024 * 1024)
    writer._clock = clock
    writer.new_stream()
    writer.feed(HEADER)
    for n in range(60):
        clock.now += 1
        writer.feed(_packet(n, 60000))
    held = sum(f.stat().st_size for f in (tmp_path / "ring").iterdir())
    assert held <= 2 * 1024 * 1024 + 60016 * 2
    writer.close()


def test_a_ring_that_holds_nothing_cannot_be_saved(tmp_path):
    writer = SegmentWriter(tmp_path / "ring", 60, 10**6)
    try:
        writer.save(tmp_path / "x.pcap")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


async def test_the_ring_buffer_runs_is_saved_and_stopped(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    eid = entry.entry_id

    status = (await _call(client, STATUS, entry_id=eid))["result"]
    assert status["ring"] == {"active": False}

    started = await _call(client, RING_START, entry_id=eid, interface="1-lan", minutes=5, mb=50)
    assert started["success"]
    assert started["result"]["ring"]["active"]
    await hass.async_block_till_done(wait_background_tasks=False)

    # the box records one thing at a time
    busy = await _call(client, START, entry_id=eid, interface="1-lan", seconds=30, mb=10)
    assert not busy["success"]
    assert busy["error"]["code"] == "busy"
    again = await _call(client, RING_START, entry_id=eid, interface="1-lan", minutes=5, mb=50)
    assert again["error"]["code"] == "busy"

    # wait until the fake box has delivered its packets
    for _ in range(50):
        manager = hass.data[KEY_CAPTURES][eid]
        if manager.ring and manager.ring.writer.status()["bytes"] > 24:
            break
        await hass.async_add_executor_job(lambda: __import__("time").sleep(0.05))
    saved = await _call(client, RING_SAVE, entry_id=eid)
    assert saved["success"]
    files = saved["result"]["files"]
    assert len(files) == 1
    assert files[0]["ring"] is True
    assert files[0]["name"].endswith("-ring.pcap")
    assert _count(manager.directory / files[0]["name"]) == 3
    assert saved["result"]["ring"]["active"]  # it goes on recording

    stopped = await _call(client, RING_STOP, entry_id=eid)
    assert stopped["success"]
    await hass.async_block_till_done()
    status = (await _call(client, STATUS, entry_id=eid))["result"]
    assert status["ring"] == {"active": False}
    assert not (manager.directory / "ring").exists() or not list(
        (manager.directory / "ring").iterdir()
    )
    # the saved file stays, and a capture can be started again
    assert len(status["files"]) == 1
    again = await _call(client, START, entry_id=eid, interface="1-lan", seconds=30, mb=10)
    assert again["success"]


async def test_saving_an_idle_ring_buffer_is_refused(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    result = await _call(client, RING_SAVE, entry_id=entry.entry_id)
    assert not result["success"]


async def test_the_trigger_entity_saves_the_ring_buffer_after_the_wait(hass, fake_client, entry):
    hass.states.async_set("binary_sensor.nas", "on")
    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            "ring_autostart": True,
            "ring_trigger": "binary_sensor.nas",
            "ring_trigger_state": "off",
            "ring_after": 5,
        },
    )
    await _setup(hass, entry)
    manager = hass.data[KEY_CAPTURES][entry.entry_id]
    assert manager.ring_active
    for _ in range(50):
        if manager.ring.writer.status()["bytes"] > 24:
            break
        await hass.async_add_executor_job(lambda: __import__("time").sleep(0.05))

    # a change to another state does nothing
    hass.states.async_set("binary_sensor.nas", "unavailable")
    await hass.async_block_till_done()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=10))
    await hass.async_block_till_done()
    assert manager.files() == []

    hass.states.async_set("binary_sensor.nas", "off")
    await hass.async_block_till_done()
    assert manager.files() == []  # not yet: it waits
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=10))
    await hass.async_block_till_done(wait_background_tasks=False)
    assert len(manager.files()) == 1
    assert manager.files()[0]["ring"] is True

    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert not (manager.directory / "ring").exists() or not list(
        (manager.directory / "ring").iterdir()
    )
