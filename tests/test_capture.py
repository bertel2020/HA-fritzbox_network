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
