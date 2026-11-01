"""The history of the devices behind the sparklines."""

from unittest.mock import MagicMock

from custom_components.fritzbox_network.history import DeviceHistory

NOW = 1_800_000_000.0
MAC = "aa:bb:cc:dd:ee:01"


def _history(data=None):
    return DeviceHistory(MagicMock(), data if data is not None else {})


def test_a_point_is_noted_every_five_minutes_while_online():
    history = _history()
    for step in range(0, 900, 60):
        history.record(NOW + step, MAC, True, -60, 100)
    assert len(history.device(MAC)["day"]) == 3


def test_an_offline_device_is_noted_rarely_but_the_change_at_once():
    history = _history()
    history.record(NOW, MAC, True, -60, 100)
    history.record(NOW + 60, MAC, False, None, None)
    assert [p[1] for p in history.device(MAC)["day"]] == [1.0, 0.0]
    history.record(NOW + 600, MAC, False, None, None)
    assert len(history.device(MAC)["day"]) == 2


def test_the_day_is_trimmed_and_the_week_holds_hours():
    history = _history()
    for step in range(0, 2 * 86400, 300):
        history.record(NOW + step, MAC, True, -60, 100)
    series = history.device(MAC)
    assert len(series["day"]) <= 289
    assert len(series["week"]) >= 47
    assert series["week"][-1][1] == 1.0


def test_the_summary_has_an_hour_per_slot():
    history = _history()
    history.record(NOW, MAC, True, -60, 100)
    history.record(NOW + 300, MAC, True, -70, 200)
    summary = history.summary(NOW + 400)[MAC]
    assert len(summary["signal"]) == 24
    assert summary["signal"][-1] == -65
    assert summary["rate"][-1] == 150
    assert summary["online"][0] is None


def test_what_is_not_noted_for_a_week_is_forgotten():
    history = _history()
    history.record(NOW, MAC, True, None, None)
    history.prune(NOW + 8 * 86400)
    assert history.device(MAC) == {"day": [], "week": []}


async def test_the_history_is_kept_by_the_coordinator_and_served(
    hass, fake_client, entry, hass_ws_client
):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    mac = fake_client.hosts[0].mac
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/history/summary", "entry_id": entry.entry_id}
    )
    summary = (await client.receive_json())["result"]["devices"]
    assert mac in summary and len(summary[mac]["online"]) == 24

    await client.send_json_auto_id(
        {"type": "fritzbox_network/history/device", "entry_id": entry.entry_id, "mac": mac}
    )
    result = (await client.receive_json())["result"]
    assert len(result["day"]) == 1
