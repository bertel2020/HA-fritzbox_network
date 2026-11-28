"""The packet capture: the commands behind the panel and the download."""

from custom_components.fritzbox_network.const import DOMAIN

from .conftest import LAN

STATUS = f"{DOMAIN}/capture/status"
START = f"{DOMAIN}/capture/start"
STOP = f"{DOMAIN}/capture/stop"
DELETE = f"{DOMAIN}/capture/delete"
SUMMARY = f"{DOMAIN}/capture/summary"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


async def test_a_capture_is_recorded_and_kept(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"] is None
    assert status["files"] == []
    assert [(i["id"], i["group"], i["slug"]) for i in status["interfaces"]] == [
        ("2-1", "internet", "21"),
        ("1-lan", "lan", "1lan"),
        ("1-vap0", "wlan", "1vap0"),
        ("3-17", "routing", "317"),
    ]

    started = await _call(
        client, START, entry_id=entry.entry_id, interface="1-lan", seconds=30, mb=10
    )
    assert started["success"]
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"]["state"] == "done"
    assert status["job"]["reason"] == "time"
    assert [f["interface"] for f in status["files"]] == ["1lan"]
    assert ("capture", "1-lan", 30) in fake_client.calls


async def test_a_failed_capture_leaves_no_file(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    fake_client.fail_actions = True

    await _call(client, START, entry_id=entry.entry_id, interface="2-1", seconds=30, mb=10)
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"]["state"] == "failed"
    assert status["files"] == []


async def test_a_capture_can_be_deleted_and_names_are_checked(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _call(client, START, entry_id=entry.entry_id, interface="1-vap1", seconds=30, mb=10)
    await hass.async_block_till_done()
    name = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]["files"][0]["name"]

    refused = await _call(client, DELETE, entry_id=entry.entry_id, name="../../secrets.yaml")
    assert not refused["success"]
    assert (await _call(client, DELETE, entry_id=entry.entry_id, name=name))["success"]
    assert (await _call(client, STATUS, entry_id=entry.entry_id))["result"]["files"] == []


async def test_a_bad_request_is_refused(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    bad = await _call(client, START, entry_id=entry.entry_id, interface="usb", seconds=30, mb=10)
    assert not bad["success"]
    long = await _call(
        client, START, entry_id=entry.entry_id, interface="1-lan", seconds=9999, mb=10
    )
    assert not long["success"]


async def test_a_capture_of_one_device_that_sent_nothing_fails(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await _call(
        client, START, entry_id=entry.entry_id, interface="1-lan", seconds=30, mb=10, mac=LAN
    )
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"]["state"] == "failed"
    assert status["job"]["device"] == LAN.replace(":", "")
    assert status["files"] == []


async def test_a_kept_capture_can_be_summarized(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _call(client, START, entry_id=entry.entry_id, interface="1-lan", seconds=30, mb=10)
    await hass.async_block_till_done()
    name = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]["files"][0]["name"]

    result = (await _call(client, SUMMARY, entry_id=entry.entry_id, name=name))["result"]
    assert result["packets"] == 0
    assert result["flows"] == []
    assert not (await _call(client, SUMMARY, entry_id=entry.entry_id, name="nope.pcap"))["success"]


async def test_the_service_starts_a_capture(hass, fake_client, entry):
    await _setup(hass, entry)

    await hass.services.async_call(
        DOMAIN, "capture", {"interface": "1-vap0", "duration": 20, "size": 5}, blocking=True
    )
    await hass.async_block_till_done()

    assert ("capture", "1-vap0", 20) in fake_client.calls


async def test_the_connection_check_names_the_first_step_that_fails(
    hass, hass_ws_client, fake_client, entry, monkeypatch
):
    from custom_components.fritzbox_network import connection_check

    async def fake(host, port):
        if host == "1.1.1.1":
            raise OSError(113, "No route to host")

    monkeypatch.setattr(connection_check, "_connect", fake)
    monkeypatch.setattr(connection_check, "_resolve", lambda name: fake("example.org", 0))
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, f"{DOMAIN}/diagnose/check", entry_id=entry.entry_id))["result"]

    assert result["verdict"] == "internet"
    assert {s["key"]: s["ok"] for s in result["steps"]}["box"] is True


async def test_the_event_log_of_the_box_can_be_read_by_group(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    everything = (await _call(client, f"{DOMAIN}/diagnose/log", entry_id=entry.entry_id))["result"]
    wifi = (await _call(client, f"{DOMAIN}/diagnose/log", entry_id=entry.entry_id, group="wlan"))[
        "result"
    ]
    bad = await _call(client, f"{DOMAIN}/diagnose/log", entry_id=entry.entry_id, group="x")

    assert len(everything["events"]) == 2
    assert [e["group"] for e in wifi["events"]] == ["wlan"]
    assert not bad["success"]


async def test_the_course_of_the_connection_is_recorded_only_while_switched_on(
    hass, hass_ws_client, fake_client, entry, monkeypatch
):
    from custom_components.fritzbox_network import latency

    async def fake_checks(host, port):
        return {
            "verdict": "ok",
            "steps": [
                {"key": "box", "ok": True, "ms": 3.0, "error": None},
                {"key": "internet", "ok": True, "ms": 12.0, "error": None},
                {"key": "dns", "ok": False, "ms": None, "error": "timeout"},
                {"key": "web", "ok": False, "ms": None, "error": "timeout"},
                {"key": "ipv6", "ok": False, "ms": None, "error": "timeout"},
            ],
        }

    monkeypatch.setattr(latency, "run_checks", fake_checks)
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    state = f"{DOMAIN}/diagnose/latency"

    off = (await _call(client, state, entry_id=entry.entry_id))["result"]
    assert off["enabled"] is False
    assert off["samples"] == []
    assert off["steps"] == ["box", "internet", "dns", "web", "ipv6"]

    await entry.runtime_data.latency.async_sample()
    assert (await _call(client, state, entry_id=entry.entry_id))["result"]["samples"] == []

    on = (await _call(client, f"{state}/switch", entry_id=entry.entry_id, enabled=True))["result"]
    assert on["enabled"] is True
    await hass.async_block_till_done()
    samples = (await _call(client, state, entry_id=entry.entry_id))["result"]["samples"]
    assert [s[1:] for s in samples] == [[3.0, 12.0, None, None, None]]

    await _call(client, f"{state}/switch", entry_id=entry.entry_id, enabled=False)
    await entry.runtime_data.latency.async_sample()
    assert len((await _call(client, state, entry_id=entry.entry_id))["result"]["samples"]) == 1


async def test_a_mac_that_is_no_mac_is_refused(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    bad = await _call(
        client,
        START,
        entry_id=entry.entry_id,
        interface="1-lan",
        seconds=30,
        mb=10,
        mac="../../../x",
    )
    assert not bad["success"]


async def test_a_detection_claims_the_box_before_it_starts_and_lets_go_when_it_fails(
    hass, fake_client, entry
):
    import time

    import pytest

    from custom_components.fritzbox_network import capture as capture_module

    await _setup(hass, entry)
    manager = hass.data[capture_module.KEY_CAPTURES][entry.entry_id]

    manager.begin_detection()
    assert manager.detecting
    with pytest.raises(ValueError, match="busy"):
        manager.begin_detection()
    with pytest.raises(ValueError, match="busy"):  # no capture slips in between
        manager.start("1-lan", 30, 10 * 1048576)

    # no access point to listen to: the detection fails, and the box is free again
    manager._interfaces = [{"id": "1-lan", "group": "lan", "slug": "1lan"}]
    manager._interfaces_at = time.monotonic()
    with pytest.raises(ValueError):
        manager.detect_bands({}, claimed=True)
    assert not manager.detecting


async def test_the_file_of_a_running_capture_is_not_downloaded(hass, fake_client, entry):
    from unittest.mock import MagicMock

    from custom_components.fritzbox_network import capture as capture_module

    await _setup(hass, entry)
    manager = hass.data[capture_module.KEY_CAPTURES][entry.entry_id]
    name = "1lan_20261113-120000.pcap"
    manager.directory.mkdir(parents=True)
    (manager.directory / name).write_bytes(b"x")
    request = MagicMock()
    request.app = {"hass": hass}
    request.__getitem__.return_value = MagicMock(is_admin=True)
    view = capture_module.CaptureDownloadView()

    assert (await view.get(request, entry.entry_id, name)).status == 200  # a finished one

    manager.job = capture_module.Job(
        interface="1-lan", name=name, started=0.0, seconds=30, max_bytes=1, state="running"
    )
    assert manager.is_recording(name)
    assert (await view.get(request, entry.entry_id, name)).status == 409


DISMISS = f"{DOMAIN}/capture/dismiss"
HEADER = b"\xd4\xc3\xb2\xa1\x02\x00\x04\x00" + b"\0" * 8 + b"\xff\xff\0\0\x01\0\0\0"


def _packets(times) -> bytes:
    import struct

    return b"".join(struct.pack("<IIII", int(t), 0, 60, 60) + b"\0" * 60 for t in times)


async def test_a_failed_capture_stays_in_the_list_until_dismissed(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await _call(
        client, START, entry_id=entry.entry_id, interface="1-lan", seconds=30, mb=10, mac=LAN
    )
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["files"] == []
    [failure] = status["failures"]
    assert failure["interface"] == "1-lan"
    assert failure["device"] == LAN.replace(":", "")
    assert failure["device_name"]  # the name of the device at the time, from the host list
    assert "nothing" in failure["error"]
    assert failure["ring"] is False

    assert not (await _call(client, DISMISS, entry_id=entry.entry_id, failure="nope"))["success"]
    assert (await _call(client, DISMISS, entry_id=entry.entry_id, failure=failure["id"]))["success"]
    assert (await _call(client, STATUS, entry_id=entry.entry_id))["result"]["failures"] == []


async def test_the_list_tells_packets_duration_reason_and_interface(hass, fake_client, entry):
    from custom_components.fritzbox_network.capture import KEY_CAPTURES

    def capture(interface, path, seconds, max_bytes, stop, progress, sink=None):
        path.write_bytes(HEADER + _packets([100, 101, 112.0]))
        return "size"

    fake_client.capture = capture
    await _setup(hass, entry)
    manager = hass.data[KEY_CAPTURES][entry.entry_id]
    manager.start("3-0", 30, 10 * 1048576)
    await hass.async_block_till_done()

    [item] = await hass.async_add_executor_job(manager.files)
    assert item["interface"] == "30"
    assert item["interface_id"] == "3-0"  # the id of the box, not only the part in the name
    assert item["packets"] == 3
    assert item["seconds"] == 12.0
    assert item["reason"] == "size"
    assert item["ring"] is False
    assert item["recording"] is False
    # the details are kept next to the capture, the capture itself is not read again
    assert (manager.directory / f"{item['name']}.json").is_file()


async def test_an_older_capture_without_details_is_counted_once(hass, fake_client, entry):
    from custom_components.fritzbox_network.capture import KEY_CAPTURES

    await _setup(hass, entry)
    manager = hass.data[KEY_CAPTURES][entry.entry_id]
    manager.directory.mkdir(parents=True)
    path = manager.directory / "1lan_20261104-101500.pcap"
    path.write_bytes(HEADER + _packets([10, 15]))

    [item] = await hass.async_add_executor_job(manager.files)
    assert (item["packets"], item["seconds"], item["reason"]) == (2, 5.0, None)
    assert (manager.directory / f"{path.name}.json").is_file()


async def test_pruning_keeps_the_newest_by_time_and_takes_the_details_along(
    hass, fake_client, entry
):
    import os

    from custom_components.fritzbox_network.capture import KEEP_FILES, KEY_CAPTURES

    await _setup(hass, entry)
    manager = hass.data[KEY_CAPTURES][entry.entry_id]
    directory = manager.directory
    (directory / "ring").mkdir(parents=True)
    (directory / "ring" / "seg-00000001.pcap").write_bytes(HEADER)  # the ring buffer's own
    names = []
    for n in range(KEEP_FILES + 2):
        name = f"1lan_202611{n + 1:02d}-101500.pcap"
        (directory / name).write_bytes(HEADER)
        (directory / f"{name}.json").write_text("{}")
        os.utime(directory / name, (1_800_000_000 + n, 1_800_000_000 + n))
        names.append(name)
    (directory / "1lan_20260101-000000.pcap.json").write_text("{}")  # its capture is gone

    await hass.async_add_executor_job(manager._prune)  # noqa: SLF001

    kept = sorted(p.name for p in directory.iterdir() if p.suffix == ".pcap")
    assert kept == sorted(names[2:])  # the two oldest went
    assert not (directory / f"{names[0]}.json").exists()
    assert not (directory / "1lan_20260101-000000.pcap.json").exists()
    assert (directory / "ring" / "seg-00000001.pcap").exists()


async def test_deleting_a_capture_takes_its_details_along(hass, fake_client, entry):
    from custom_components.fritzbox_network.capture import KEY_CAPTURES

    await _setup(hass, entry)
    manager = hass.data[KEY_CAPTURES][entry.entry_id]
    manager.start("1-lan", 30, 10 * 1048576)
    await hass.async_block_till_done()
    [item] = await hass.async_add_executor_job(manager.files)
    assert await hass.async_add_executor_job(manager.delete, item["name"])
    assert list(manager.directory.iterdir()) == []


async def test_failures_are_kept_over_a_restart(hass, fake_client, entry):
    from custom_components.fritzbox_network.capture import KEY_CAPTURES

    await _setup(hass, entry)
    fake_client.fail_actions = True
    hass.data[KEY_CAPTURES][entry.entry_id].start("2-1", 30, 10 * 1048576)
    await hass.async_block_till_done()
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    [failure] = hass.data[KEY_CAPTURES][entry.entry_id].failures
    assert failure["interface"] == "2-1"
