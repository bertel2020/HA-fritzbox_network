"""The commands behind the clean-up and filter pages of the panel."""

from datetime import timedelta

from homeassistant.util import dt as dt_util

from custom_components.fritzbox_network.const import DOMAIN

from .conftest import BOX, LAN, OFFLINE, WLAN

OFFLINE_SENSOR = "sensor.fritz_020000000001_last_online"
CLEANUP = f"{DOMAIN}/cleanup/list"
HIDE = f"{DOMAIN}/devices/hide"
UNHIDE = f"{DOMAIN}/devices/unhide"
PREVIEW = f"{DOMAIN}/filter/preview"
APPLY = f"{DOMAIN}/filter/apply"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


def _ago(days):
    return (dt_util.utcnow() - timedelta(days=days)).isoformat()


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


async def test_the_clean_up_list_has_offline_devices_with_a_known_time(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = await _call(client, CLEANUP, entry_id=entry.entry_id)
    assert result["result"]["devices"] == []  # no time on record yet

    hass.states.async_set(OFFLINE_SENSOR, _ago(40))
    result = (await _call(client, CLEANUP, entry_id=entry.entry_id))["result"]

    assert [d["mac"] for d in result["devices"]] == [OFFLINE]
    assert result["devices"][0]["days"] == 40
    assert result["days"] == 30
    assert result["hidden"] == []


async def test_hiding_removes_offline_devices_and_refuses_the_others(
    hass, hass_ws_client, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (
        await _call(
            client, HIDE, entry_id=entry.entry_id, macs=[OFFLINE, LAN, BOX, "02:99:99:99:99:99"]
        )
    )["result"]
    await hass.async_block_till_done()

    assert result["hidden"] == [OFFLINE]
    assert {r["mac"]: r["reason"] for r in result["refused"]} == {
        LAN: "online",
        BOX: "node",
        "02:99:99:99:99:99": "unknown",
    }
    assert entry.options["hidden_macs"] == [OFFLINE]
    assert OFFLINE not in coordinator.data.hosts
    assert LAN in coordinator.data.hosts

    listed = (await _call(client, CLEANUP, entry_id=entry.entry_id))["result"]
    assert [h["mac"] for h in listed["hidden"]] == [OFFLINE]


async def test_unhiding_brings_a_device_back(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _call(client, HIDE, entry_id=entry.entry_id, macs=[OFFLINE])
    await hass.async_block_till_done()

    result = await _call(client, UNHIDE, entry_id=entry.entry_id, macs=[OFFLINE])
    await hass.async_block_till_done()

    assert result["result"] == {"unhidden": [OFFLINE]}
    assert entry.options["hidden_macs"] == []
    assert OFFLINE in entry.runtime_data.data.hosts


async def test_the_preview_shows_what_a_filter_would_do_and_writes_nothing(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    options_before = dict(entry.options)

    result = (
        await _call(
            client,
            PREVIEW,
            entry_id=entry.entry_id,
            options={"filter_mode": "include", "filter_devices": [LAN]},
        )
    )["result"]

    assert [d["mac"] for d in result["keep"]] == [LAN]
    assert WLAN in {d["mac"] for d in result["remove"]}
    assert result["add"] == []
    assert result["options"]["filter_mode"] == "include"
    assert LAN in {d["mac"] for d in result["devices"]}
    assert BOX not in {d["mac"] for d in result["devices"]}
    assert dict(entry.options) == options_before


async def test_the_preview_without_changes_shows_the_state(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, PREVIEW, entry_id=entry.entry_id))["result"]

    assert result["remove"] == [] and result["add"] == []
    assert result["options"] == {
        "filter_mode": "all",
        "filter_devices": [],
        "ignore_guests": False,
        "ignore_private_macs": False,
    }


async def test_applying_needs_the_list_the_caller_was_shown(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    options = {"filter_mode": "include", "filter_devices": [LAN]}
    preview = (await _call(client, PREVIEW, entry_id=entry.entry_id, options=options))["result"]
    shown = [d["mac"] for d in preview["remove"]]

    stale = await _call(client, APPLY, entry_id=entry.entry_id, options=options, expected_remove=[])
    assert not stale["success"]
    assert stale["error"]["code"] == "changed"
    assert entry.options.get("filter_mode") is None

    ok = await _call(client, APPLY, entry_id=entry.entry_id, options=options, expected_remove=shown)
    await hass.async_block_till_done()

    assert ok["success"]
    assert entry.options["filter_mode"] == "include"
    assert entry.options["filter_devices"] == [LAN]
    assert WLAN not in entry.runtime_data.data.hosts


async def test_the_new_commands_need_an_administrator_and_a_known_box(
    hass, hass_ws_client, hass_admin_user, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    for command, extra in (
        (CLEANUP, {}),
        (HIDE, {"macs": []}),
        (UNHIDE, {"macs": []}),
        (PREVIEW, {}),
        (APPLY, {"options": {}, "expected_remove": []}),
    ):
        result = await _call(client, command, entry_id="nope", **extra)
        assert result["error"]["code"] == "not_found", command

    hass_admin_user.groups = []
    client = await hass_ws_client(hass)
    for command, extra in ((CLEANUP, {}), (PREVIEW, {})):
        result = await _call(client, command, entry_id=entry.entry_id, **extra)
        assert result["error"]["code"] == "unauthorized", command


async def test_a_filter_option_the_panel_may_not_set_is_refused(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = await _call(client, PREVIEW, entry_id=entry.entry_id, options={"hidden_macs": [LAN]})

    assert not result["success"]
