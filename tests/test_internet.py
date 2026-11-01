"""The internet connection: parsing what the box says, the throughput and the events."""

from datetime import timedelta
from unittest.mock import patch

from homeassistant.helpers import entity_registry as er, issue_registry as ir
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.fritzbox_network import coordinator as coordinator_module
from custom_components.fritzbox_network.models import parse_internet, spectrum

from .conftest import INTERNET_FAST, INTERNET_SLOW

COMMAND = "fritzbox_network/subscribe_topology"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


class _Clock:
    """The clock of the coordinator, which the test moves on."""

    now = 10_000.0

    def monotonic(self) -> float:
        return self.now


@pytest.fixture(autouse=True)
def clock():
    clock = _Clock()
    with patch.object(coordinator_module, "time", clock):
        yield clock


async def _poll(hass, coordinator, seconds=30.0):
    """One more poll, as if this many seconds had passed since the last."""
    coordinator_module.time.now += seconds
    await coordinator.async_refresh()
    await hass.async_block_till_done()


def test_the_internet_connection_is_read_from_the_actions():
    info = parse_internet(INTERNET_FAST, INTERNET_SLOW)
    assert info.connected is True
    assert info.uptime == 65439
    assert info.last_error == "ERROR_NONE"
    assert info.access_type == "DSL"
    assert (info.rate_down, info.rate_up) == (56316, 11260)
    assert info.external_ipv4 == "203.0.113.7"
    assert (info.ipv6_prefix, info.ipv6_prefix_length) == ("2001:db8:1::", 56)
    assert info.dns == ("198.51.100.1", "198.51.100.2", "2001:db8::53")
    assert info.dsl.noise_margin_down == 17.0
    assert info.dsl.attenuation_up == 7.0
    assert (info.dsl.fec_errors, info.dsl.crc_errors) == (96, 0)


def test_the_spectrum_averages_the_used_tones_and_leaves_gaps_empty():
    assert spectrum("10,20,0,0,30,50", buckets=3) == (15, 0, 40)
    assert spectrum("10,20,30", buckets=6) == (10, 10, 20, 20, 30, 30)
    assert spectrum("0,0,0,0", buckets=2) == ()
    assert spectrum("", buckets=2) == ()
    assert spectrum(None) == ()
    # what is not a number is skipped
    assert spectrum("10,x,30", buckets=2) == (10, 30)


def test_a_line_that_gives_a_spectrum_has_it_in_the_info():
    slow = {k: dict(v) for k, v in INTERNET_SLOW.items()}
    slow["X_AVM-DE_GetDSLInfo"]["NewSNRpsds"] = ",".join(["0"] * 10 + ["100"] * 54)
    slow["X_AVM-DE_GetDSLInfo"]["NewSNRpsus"] = "50,60"
    info = parse_internet(INTERNET_FAST, slow)
    assert len(info.dsl.spectrum_down) == 64
    assert info.dsl.spectrum_down[0] == 0 and info.dsl.spectrum_down[-1] == 100
    assert len(info.dsl.spectrum_up) == 64
    # a box that does not give them leaves the spectrum empty
    assert parse_internet(INTERNET_FAST, INTERNET_SLOW).dsl.spectrum_down == ()


def test_without_the_dsl_line_the_rate_is_the_one_of_the_link():
    slow = {k: v for k, v in INTERNET_SLOW.items() if k != "X_AVM-DE_GetDSLInfo"}
    info = parse_internet(INTERNET_FAST, slow)
    assert info.dsl is None
    assert (info.rate_down, info.rate_up) == (55020, 11000)


def test_a_box_that_tells_nothing_gives_no_connection():
    assert parse_internet({}, INTERNET_SLOW) is None
    info = parse_internet({"GetStatusInfo": {"NewConnectionStatus": "Disconnected"}}, {})
    assert info.connected is False
    assert info.external_ipv4 is None and info.dns == ()


async def test_the_throughput_comes_from_the_byte_counters(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    assert coordinator.internet_rate is None  # one reading is no rate

    # 3 750 000 bytes in 30 s are 1000 kbit/s down, 375 000 bytes are 100 kbit/s up
    fake_client.internet_fast["GetTotalBytesReceived"]["NewTotalBytesReceived"] += 3_750_000
    fake_client.internet_fast["GetTotalBytesSent"]["NewTotalBytesSent"] += 375_000
    await _poll(hass, coordinator)

    assert coordinator.internet_rate == (1000.0, 100.0)
    assert len(coordinator.internet_samples) == 1


async def test_a_counter_that_wrapped_around_still_gives_a_rate(hass, fake_client, entry):
    fake_client.internet_fast["GetTotalBytesReceived"]["NewTotalBytesReceived"] = 2**32 - 1_000
    coordinator = await _setup(hass, entry)
    fake_client.internet_fast["GetTotalBytesReceived"]["NewTotalBytesReceived"] = 3_750_000 - 1_000
    await _poll(hass, coordinator)
    assert coordinator.internet_rate[0] == 1000.0


async def test_a_new_connection_is_noted_with_its_new_address(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    assert not coordinator.internet_events
    reconnected = async_capture_events(hass, "fritzbox_network_internet_reconnected")
    changed = async_capture_events(hass, "fritzbox_network_internet_ip_changed")

    fake_client.internet_fast["GetStatusInfo"]["NewUptime"] = 20
    fake_client.internet_slow["GetExternalIPAddress"]["NewExternalIPAddress"] = "203.0.113.99"
    await _poll(hass, coordinator)

    kinds = [e["kind"] for e in coordinator.internet_events]
    assert len(reconnected) == 1
    assert [e.data for e in changed] == [{"old_ip": "203.0.113.7", "new_ip": "203.0.113.99"}]
    assert sorted(kinds) == ["ip_changed", "reconnected"]
    assert coordinator.data.internet.external_ipv4 == "203.0.113.99"
    # no rate across a reconnect: the counters may have started again
    assert coordinator.internet_rate is None
    # the new address was read at once, not at the next round of the slow part
    assert True in fake_client.internet_reads[1:]


async def test_the_slow_part_is_not_read_at_every_poll(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    fake_client.internet_reads.clear()
    await _poll(hass, coordinator)
    assert fake_client.internet_reads == [False]
    # the addresses are still there, from the last read
    assert coordinator.data.internet.external_ipv4 == "203.0.113.7"


async def test_the_topology_has_the_internet_connection(hass, hass_ws_client, fake_client, entry):
    coordinator = await _setup(hass, entry)
    fake_client.internet_fast["GetTotalBytesReceived"]["NewTotalBytesReceived"] += 3_750_000
    await _poll(hass, coordinator)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": COMMAND})
    assert (await client.receive_json())["success"]
    internet = (await client.receive_json())["event"]["internet"]

    assert internet["connected"] is True
    assert internet["external_ipv4"] == "203.0.113.7"
    assert internet["dsl"]["profile"] == "17a"
    assert internet["throughput"] == {"down": 1000.0, "up": 0.0}
    assert len(internet["samples"]) == 1


async def test_a_box_without_wan_data_still_lists_its_devices(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.internet_fast = {}
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": COMMAND})
    assert (await client.receive_json())["success"]
    topology = (await client.receive_json())["event"]

    assert topology["internet"] is None
    assert topology["clients"]


async def test_the_connection_and_the_throughput_are_sensors(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    fake_client.internet_fast["GetTotalBytesReceived"]["NewTotalBytesReceived"] += 3_750_000
    fake_client.internet_fast["GetTotalBytesSent"]["NewTotalBytesSent"] += 375_000
    await _poll(hass, coordinator)

    assert hass.states.get("binary_sensor.fritz_network_internet_connected").state == "on"
    assert hass.states.get("sensor.fritz_network_internet_download").state == "1.0"
    assert hass.states.get("sensor.fritz_network_internet_upload").state == "0.1"


async def test_the_values_of_the_line_are_off_until_they_are_enabled(hass, fake_client, entry):
    await _setup(hass, entry)
    registry = er.async_get(hass)

    for key in ("dsl_noise_margin_down", "dsl_rate_up", "dsl_crc_errors", "external_ipv4"):
        reg = registry.async_get(f"sensor.fritz_network_{key}")
        assert reg is not None, key
        assert reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    for key in ("internet_download", "internet_upload"):
        assert registry.async_get(f"sensor.fritz_network_{key}").disabled_by is None
    assert registry.async_get("binary_sensor.fritz_network_internet_connected").disabled_by is None


async def test_a_box_without_a_dsl_line_has_no_line_sensors(hass, fake_client, entry):
    del fake_client.internet_slow["X_AVM-DE_GetDSLInfo"]
    await _setup(hass, entry)

    registry = er.async_get(hass)
    assert registry.async_get("sensor.fritz_network_dsl_noise_margin_down") is None
    assert registry.async_get("sensor.fritz_network_internet_download") is not None


async def test_a_box_that_tells_nothing_has_no_internet_sensors(hass, fake_client, entry):
    fake_client.internet_fast = {}
    await _setup(hass, entry)

    registry = er.async_get(hass)
    assert registry.async_get("sensor.fritz_network_internet_download") is None
    assert registry.async_get("binary_sensor.fritz_network_internet_connected") is None


async def test_the_sensors_come_when_the_box_starts_telling(hass, fake_client, entry):
    saved, fake_client.internet_fast = fake_client.internet_fast, {}
    coordinator = await _setup(hass, entry)
    registry = er.async_get(hass)
    assert registry.async_get("sensor.fritz_network_internet_download") is None

    fake_client.internet_fast = saved
    await _poll(hass, coordinator)

    assert registry.async_get("sensor.fritz_network_internet_download") is not None
    assert registry.async_get("sensor.fritz_network_dsl_noise_margin_down") is not None


async def test_a_lost_connection_is_announced_once(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    lost = async_capture_events(hass, "fritzbox_network_internet_disconnected")
    back = async_capture_events(hass, "fritzbox_network_internet_reconnected")

    fake_client.internet_fast["GetStatusInfo"]["NewConnectionStatus"] = "Disconnected"
    await _poll(hass, coordinator)
    await _poll(hass, coordinator)
    assert len(lost) == 1 and not back

    fake_client.internet_fast["GetStatusInfo"]["NewConnectionStatus"] = "Connected"
    await _poll(hass, coordinator)
    assert len(back) == 1
    assert [e["kind"] for e in coordinator.internet_events] == ["reconnected", "disconnected"]


async def test_the_first_reading_announces_nothing(hass, fake_client, entry):
    events = async_capture_events(hass, "fritzbox_network_internet_ip_changed")
    await _setup(hass, entry)
    assert not events


async def test_the_panel_can_reconnect_and_restart_the_box(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/internet/reconnect", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id(
        {"type": "fritzbox_network/box/reboot", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["success"]
    assert ("reconnect",) in fake_client.calls and ("reboot",) in fake_client.calls


async def test_a_user_without_the_right_cannot_interrupt_the_network(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/internet/reconnect", "entry_id": entry.entry_id}
    )
    result = await client.receive_json()
    assert not result["success"] and result["error"]["code"] == "unauthorized"
    assert ("reconnect",) not in fake_client.calls


async def test_a_refusal_of_the_box_goes_back_to_the_panel(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    fake_client.fail_actions = True
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/box/reboot", "entry_id": entry.entry_id}
    )
    result = await client.receive_json()
    assert not result["success"] and "refused" in result["error"]["message"]


async def test_an_unknown_box_is_refused(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "fritzbox_network/box/reboot", "entry_id": "nope"})
    assert (await client.receive_json())["error"]["code"] == "not_found"


async def test_a_weak_line_for_an_hour_is_a_repair_that_goes_away(hass, fake_client, entry):
    fake_client.internet_slow["X_AVM-DE_GetDSLInfo"]["NewDownstreamNoiseMargin"] = 80
    coordinator = await _setup(hass, entry)
    issue = f"internet_line_{entry.entry_id}"
    registry = ir.async_get(hass)
    # low, but not for long
    assert coordinator.internet_low_margin_since is not None
    assert registry.async_get_issue("fritzbox_network", issue) is None

    coordinator.internet_low_margin_since = dt_util.utcnow() - timedelta(hours=2)
    await _poll(hass, coordinator)
    created = registry.async_get_issue("fritzbox_network", issue)
    assert created is not None and created.translation_placeholders == {"margin": "8"}
    assert not created.is_fixable

    fake_client.internet_slow["X_AVM-DE_GetDSLInfo"]["NewDownstreamNoiseMargin"] = 170
    coordinator._polls = 0  # the line is read again at this poll
    await _poll(hass, coordinator)
    assert registry.async_get_issue("fritzbox_network", issue) is None
    assert coordinator.internet_low_margin_since is None


async def test_a_connection_that_keeps_dropping_is_a_repair(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    registry = ir.async_get(hass)
    issue = f"internet_reconnects_{entry.entry_id}"
    uptime = fake_client.internet_fast["GetStatusInfo"]
    for value in (100, 10, 100, 10, 100, 10):
        uptime["NewUptime"] = value
        await _poll(hass, coordinator)
    assert registry.async_get_issue("fritzbox_network", issue) is not None

    await hass.config_entries.async_unload(entry.entry_id)
    assert registry.async_get_issue("fritzbox_network", issue) is None
