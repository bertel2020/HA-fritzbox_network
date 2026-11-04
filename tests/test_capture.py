"""The packet capture: the commands behind the panel and the download."""

from custom_components.fritzbox_network.const import DOMAIN

STATUS = f"{DOMAIN}/capture/status"
START = f"{DOMAIN}/capture/start"
STOP = f"{DOMAIN}/capture/stop"
DELETE = f"{DOMAIN}/capture/delete"


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
    assert status["interfaces"] == ["internet", "lan", "wlan24", "wlan5"]

    started = await _call(
        client, START, entry_id=entry.entry_id, interface="lan", seconds=30, mb=10
    )
    assert started["success"]
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"]["state"] == "done"
    assert status["job"]["reason"] == "time"
    assert [f["interface"] for f in status["files"]] == ["lan"]
    assert ("capture", "1-lan", 30) in fake_client.calls


async def test_a_failed_capture_leaves_no_file(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    fake_client.fail_actions = True

    await _call(client, START, entry_id=entry.entry_id, interface="internet", seconds=30, mb=10)
    await hass.async_block_till_done()

    status = (await _call(client, STATUS, entry_id=entry.entry_id))["result"]
    assert status["job"]["state"] == "failed"
    assert status["files"] == []


async def test_a_capture_can_be_deleted_and_names_are_checked(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _call(client, START, entry_id=entry.entry_id, interface="wlan5", seconds=30, mb=10)
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
    long = await _call(client, START, entry_id=entry.entry_id, interface="lan", seconds=9999, mb=10)
    assert not long["success"]
