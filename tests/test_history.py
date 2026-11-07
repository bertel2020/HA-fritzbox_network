"""The history of the devices behind the sparklines."""

from datetime import date, timedelta
from unittest.mock import MagicMock

from custom_components.fritzbox_network.const import TRAFFIC_DAYS
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
    assert history.device(MAC) == {"day": [], "week": [], "traffic": {}}


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


def test_the_traffic_of_a_device_is_added_up_per_day():
    history = _history()
    history.record_traffic("2026-11-01", MAC, 1000, 100)
    assert history.traffic(MAC) == {}
    history.record_traffic("2026-11-01", MAC, 1500, 150)
    history.record_traffic("2026-11-02", MAC, 1600, 150)
    assert history.traffic(MAC) == {"2026-11-01": [500, 50], "2026-11-02": [100, 0]}


def test_a_counter_that_fell_started_anew():
    history = _history()
    history.record_traffic("2026-11-01", MAC, 5000, 500)
    history.record_traffic("2026-11-01", MAC, 200, 20)
    assert history.traffic(MAC) == {"2026-11-01": [200, 20]}


def test_only_the_last_year_of_traffic_is_kept():
    history = _history()
    start = date(2025, 1, 1)
    for day in range(400):
        history.record_traffic((start + timedelta(days=day)).isoformat(), MAC, day, day)
    assert len(history.traffic(MAC)) == TRAFFIC_DAYS == 366


def test_the_mesh_reads_the_bytes_counted_per_device():
    from custom_components.fritzbox_network.models import parse_mesh

    mesh = parse_mesh(
        '{"nodes":[{"uid":"n1","device_mac_address":"AA:BB:CC:DD:EE:01",'
        '"metrics":{"wan_counters":{"bytes":{"rx":10,"tx":4}}}},'
        '{"uid":"n2","device_mac_address":"AA:BB:CC:DD:EE:02","metrics":{}}]}'
    )
    assert mesh.traffic == {"aa:bb:cc:dd:ee:01": (10, 4)}


def test_the_traffic_of_all_devices_is_served_per_mac():
    history = _history()
    history.record_traffic("2026-11-01", MAC, 100, 10)
    history.record_traffic("2026-11-01", MAC, 150, 20)
    history.record_traffic("2026-11-01", "aa:bb:cc:dd:ee:02", 5, 5)
    assert history.traffic_all() == {MAC: {"2026-11-01": [50, 10]}}
    history.record_traffic("2026-11-02", MAC, 200, 30)
    assert history.traffic_all(1) == {MAC: {"2026-11-02": [50, 10]}}


def test_an_address_that_changes_closes_the_one_before():
    history = _history()
    history.note_address("2026-01-01T10:00:00+00:00", "ipv4", "203.0.113.7")
    history.note_address("2026-01-01T11:00:00+00:00", "ipv4", "203.0.113.7")
    assert len(history.addresses()["ipv4"]) == 1
    history.note_address("2026-01-02T10:00:00+00:00", "ipv4", "203.0.113.99")
    newest, oldest = history.addresses()["ipv4"]
    assert (newest["value"], newest["until"]) == ("203.0.113.99", None)
    assert (oldest["value"], oldest["until"]) == ("203.0.113.7", "2026-01-02T10:00:00+00:00")


def test_a_box_without_an_address_closes_the_one_before_and_starts_none():
    history = _history()
    history.note_address("2026-01-01T10:00:00+00:00", "ipv6", "2001:db8::1")
    history.note_address("2026-01-01T12:00:00+00:00", "ipv6", None)
    history.note_address("2026-01-01T13:00:00+00:00", "ipv6", None)
    assert [(a["value"], a["until"]) for a in history.addresses()["ipv6"]] == [
        ("2001:db8::1", "2026-01-01T12:00:00+00:00")
    ]


def test_the_connection_events_are_kept_newest_first_and_limited():
    history = _history()
    for n in range(250):
        history.record_connection_event(f"t{n}", "reconnected", None)
    events = history.connection_events()
    assert len(events) == 200
    assert events[0]["time"] == "t249"


def test_vpn_sessions_are_counted_and_summed():
    history = _history()
    history.note_vpn(NOW, "anna", True, int(NOW) - 600)
    history.note_vpn(NOW + 300, "anna", True, int(NOW) - 600)
    history.note_vpn(NOW + 1200, "anna", False, None)
    # up again, then the box tells another start although no poll saw it down
    history.note_vpn(NOW + 2000, "anna", True, int(NOW) + 1800)
    history.note_vpn(NOW + 4000, "anna", True, int(NOW) + 3900)
    stats = history.vpn_stats("anna", NOW + 4100)
    assert stats["sessions_7d"] == stats["sessions_30d"] == 3
    assert stats["longest"] == 2100  # the second session, NOW + 1800 until NOW + 3900
    assert stats["seconds_7d"] == 1800 + 2100 + 200
    assert stats["last_end"] == int(NOW) + 3900
    assert history.vpn_stats("nobody", NOW)["sessions_30d"] == 0


def test_vpn_notes_when_a_connection_is_on_and_gives_the_chart_data():
    history = _history()
    history.note_vpn(NOW, "anna", False, None, True)
    history.note_vpn(NOW + 100, "anna", True, int(NOW) + 50, True)
    history.note_vpn(NOW + 200, "anna", False, None, False)
    history.note_vpn(NOW + 300, "anna", False, None, False)
    history.note_vpn(NOW + 400, "anna", False, None, True)
    chart = history.vpn_chart("anna", NOW + 500)
    assert chart["sessions"] == [[int(NOW) + 50, int(NOW) + 200]]
    assert chart["enabled_periods"] == [[int(NOW), int(NOW) + 200], [int(NOW) + 400, None]]
    assert "sessions" not in history.vpn_stats("anna", NOW + 500)
    # a poll that does not say whether it is on notes nothing about it
    history.note_vpn(NOW + 600, "bob", True, int(NOW) + 600)
    assert history.vpn_chart("bob", NOW + 700)["enabled_periods"] == []


def test_many_vpn_sessions_are_joined_by_the_smallest_gap_not_cut_off():
    history = _history()
    start = NOW
    # 700 short sessions an hour apart; one gap of a day in the middle
    clock = start
    for n in range(700):
        history.note_vpn(clock, "anna", True, int(clock))
        history.note_vpn(clock + 600, "anna", False, None)
        clock += 86400 if n == 300 else 3600
    sessions = history.vpn_chart("anna", clock)["sessions"]
    assert len(sessions) == 500
    # the whole span is still covered, from the first start to the last end
    assert sessions[0][0] == int(start)
    assert sessions[-1][1] == int(clock - 3600 + 600)
    # the one long gap is the last to go: it still divides two sessions
    gaps = [b[0] - a[1] for a, b in zip(sessions, sessions[1:], strict=False)]
    assert max(gaps) > 80000


async def test_the_history_commands_need_an_administrator(
    hass, fake_client, entry, hass_ws_client, hass_admin_user
):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    mac = fake_client.hosts[0].mac
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)

    for command, extra in (
        ("history/summary", {}),
        ("history/device", {"mac": mac}),
        ("history/traffic", {}),
        ("vpn/history", {}),
    ):
        await client.send_json_auto_id(
            {"type": f"fritzbox_network/{command}", "entry_id": entry.entry_id, **extra}
        )
        result = await client.receive_json()
        assert result["error"]["code"] == "unauthorized", command
