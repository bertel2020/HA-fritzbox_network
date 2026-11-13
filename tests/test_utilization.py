"""The course of CPU load, temperature and RAM: the day from the box, week and month recorded."""

from custom_components.fritzbox_network.api import parse_utilization_series
from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.utilization import (
    RANGES,
    UtilizationMonitor,
    day_points,
    stretch,
)

HISTORY = f"{DOMAIN}/box/history"
SWITCH = f"{DOMAIN}/box/history/switch"
NOW = 1_800_000_000


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


def test_the_whole_course_is_read_from_the_energy_monitor_page():
    page = {
        "data": {
            "cputemp": {"series": [["73", "74", "x"]]},
            "cpuutil": {"series": [["17", "24", "250"], ["0", "0", "0"]]},
            "ramusage": {"series": [[28, 28], [35, 35], [37, 38]]},
        }
    }
    assert parse_utilization_series(page) == {
        "cpu": [17, 24, None],  # 250 % is no value
        "temp": [73, 74, None],
        "ram": [37, 38],
    }
    assert parse_utilization_series({"data": {}}) is None
    assert parse_utilization_series([]) is None


def test_a_short_series_is_stretched_and_the_day_ends_now():
    assert stretch([1, 2], 4) == [1, 1, 2, 2]
    assert stretch([], 3) == [None, None, None]
    points = day_points({"cpu": list(range(240)), "temp": [70] * 240, "ram": [30, 40]}, NOW)
    assert len(points) == 240
    assert points[-1] == [NOW, 239, 70, 40]
    assert points[0][0] == NOW - 239 * RANGES["day"][1]
    assert points[0][3] == 30


async def test_the_samples_make_buckets_of_a_week_and_a_month(hass, fake_client, entry):
    monitor = UtilizationMonitor(hass, None, {"samples": []}, fake_client)
    count, size = RANGES["week"]
    end = int(NOW // size + 1) * size
    # two samples in the newest bucket, one three buckets earlier, one too old
    monitor.data["samples"] = [
        [end - 100, 10, 70, 30],
        [end - 200, 20, 72, 30],
        [end - 3 * size - 50, 40, None, 31],
        [end - (count + 5) * size, 99, 99, 99],
    ]
    points = monitor.points("week", NOW)

    assert len(points) == count
    assert points[-1] == [end, 15, 71, 30]
    assert points[-4][1:] == [40, None, 31]
    assert points[0][1:] == [None, None, None]
    assert len(monitor.points("month", NOW)) == RANGES["month"][0]


async def test_it_records_only_while_it_is_switched_on_and_keeps_a_month(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    monitor = coordinator.utilization_history
    assert not monitor.enabled

    await monitor.async_sample()
    assert monitor.data["samples"] == []
    assert ("utilization_history",) not in fake_client.calls

    monitor.set_enabled(True)
    await hass.async_block_till_done()
    assert [s[1:] for s in monitor.data["samples"]] == [[12, 72, 37]]
    assert monitor.since is not None

    monitor.data["samples"].insert(0, [1, 1, 1, 1])  # older than a month
    await monitor.async_sample()
    assert monitor.data["samples"][0][0] > 1000


async def test_a_failed_read_leaves_the_recording_as_it_was(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    monitor = coordinator.utilization_history
    monitor.set_enabled(True)
    await hass.async_block_till_done()
    fake_client.cpu_error = True
    await monitor.async_sample()

    assert len(monitor.data["samples"]) == 1


async def test_the_panel_gets_the_day_from_the_box_and_week_and_month_from_the_recording(
    hass, hass_ws_client, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    client = await hass_ws_client(hass)

    day = (await _call(client, HISTORY, entry_id=entry.entry_id, range="day"))["result"]
    assert day["range"] == "day" and len(day["points"]) == 240
    assert day["points"][-1][1:] == [12, 72, 37]
    assert day["enabled"] is False

    week = (await _call(client, HISTORY, entry_id=entry.entry_id, range="week"))["result"]
    assert len(week["points"]) == RANGES["week"][0] and week["since"] is None
    assert all(p[1:] == [None, None, None] for p in week["points"])

    switched = (await _call(client, SWITCH, entry_id=entry.entry_id, enabled=True))["result"]
    await hass.async_block_till_done()
    assert switched["enabled"] is True and coordinator.utilization_history.enabled
    month = (await _call(client, HISTORY, entry_id=entry.entry_id, range="month"))["result"]
    assert month["since"] is not None and month["enabled"] is True
    assert month["points"][-1][1:] == [12, 72, 37]

    bad = await _call(client, HISTORY, entry_id=entry.entry_id, range="year")
    assert not bad["success"]


async def test_a_box_that_does_not_answer_gives_an_error_not_a_trace(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    fake_client.cpu_error = True

    result = await _call(client, HISTORY, entry_id=entry.entry_id, range="day")

    assert result["success"] is False and result["error"]["code"] == "unknown_error"
