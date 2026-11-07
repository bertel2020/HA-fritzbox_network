"""The internet connection: parsing what the box says, the throughput and the events."""

from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er, issue_registry as ir
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.fritzbox_network import coordinator as coordinator_module
from custom_components.fritzbox_network.coordinator import FritzNetworkCoordinator
from custom_components.fritzbox_network.diagnostics import async_get_config_entry_diagnostics
from custom_components.fritzbox_network.models import parse_firmware, parse_internet, spectrum

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
    assert len(info.dsl.spectrum_down) == 256
    assert info.dsl.spectrum_down[0] == 0 and info.dsl.spectrum_down[-1] == 100
    assert len(info.dsl.spectrum_up) == 256
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

    for key in (
        "dsl_noise_margin_down",
        "dsl_rate_up",
        "dsl_crc_errors",
        "external_ipv4",
        "external_ipv6",
    ):
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


async def test_the_byte_counters_and_the_reachable_rates_are_sensors_that_are_off(
    hass, fake_client, entry
):
    await _setup(hass, entry)
    registry = er.async_get(hass)

    for key in (
        "internet_bytes_received",
        "internet_bytes_sent",
        "dsl_max_rate_down",
        "dsl_max_rate_up",
    ):
        reg = registry.async_get(f"sensor.fritz_network_{key}")
        assert reg is not None, key
        assert reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    # a DSL line has its own rates: the line rate of the other connections is not added to it
    assert registry.async_get("sensor.fritz_network_internet_line_rate_down") is None
    assert registry.async_get("sensor.fritz_network_internet_line_rate_up") is None


async def test_a_connection_that_is_not_dsl_has_a_line_rate_and_no_dsl_values(
    hass, fake_client, entry
):
    del fake_client.internet_slow["X_AVM-DE_GetDSLInfo"]
    fake_client.internet_slow["GetCommonLinkProperties"]["NewWANAccessType"] = "Ethernet"
    await _setup(hass, entry)
    registry = er.async_get(hass)

    for key in ("internet_line_rate_down", "internet_line_rate_up", "internet_bytes_sent"):
        reg = registry.async_get(f"sensor.fritz_network_{key}")
        assert reg is not None, key
        assert reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert registry.async_get("sensor.fritz_network_dsl_max_rate_down") is None


async def test_a_box_without_byte_counters_has_no_byte_sensors(hass, fake_client, entry):
    for action in ("GetTotalBytesReceived", "GetTotalBytesSent"):
        del fake_client.internet_fast[action]
    await _setup(hass, entry)
    registry = er.async_get(hass)

    assert registry.async_get("sensor.fritz_network_internet_bytes_received") is None
    assert registry.async_get("sensor.fritz_network_internet_bytes_sent") is None
    assert registry.async_get("sensor.fritz_network_internet_download") is not None


async def test_the_line_sensor_is_off_by_default_and_follows_the_physical_link(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    reg = er.async_get(hass).async_get("binary_sensor.fritz_network_internet_linked")
    assert reg is not None
    assert reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert coordinator.data.internet.linked is True


async def test_a_line_that_drops_is_read_at_once_and_not_at_the_tenth_poll(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    await _poll(hass, coordinator)
    fake_client.internet_reads.clear()

    fake_client.internet_fast["GetStatusInfo"]["NewConnectionStatus"] = "Disconnected"
    fake_client.internet_slow["GetCommonLinkProperties"]["NewPhysicalLinkStatus"] = "Down"
    await _poll(hass, coordinator)

    assert fake_client.internet_reads == [False, True]
    assert coordinator.data.internet.linked is False


async def test_a_box_that_does_not_tell_the_link_has_no_line_sensor(hass, fake_client, entry):
    del fake_client.internet_slow["GetCommonLinkProperties"]["NewPhysicalLinkStatus"]
    await _setup(hass, entry)

    assert er.async_get(hass).async_get("binary_sensor.fritz_network_internet_linked") is None


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


async def test_the_box_buttons_are_off_and_restart_or_reconnect_when_pressed(
    hass, fake_client, entry
):
    await _setup(hass, entry)
    registry = er.async_get(hass)
    for key in ("reboot", "reconnect"):
        reg = registry.async_get(f"button.fritz_network_{key}")
        assert reg is not None, key
        assert reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
        registry.async_update_entity(reg.entity_id, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    for key in ("reboot", "reconnect"):
        await hass.services.async_call(
            "button", "press", {"entity_id": f"button.fritz_network_{key}"}, blocking=True
        )
    assert ("reboot",) in fake_client.calls and ("reconnect",) in fake_client.calls

    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "button", "press", {"entity_id": "button.fritz_network_reboot"}, blocking=True
        )


async def test_without_the_right_to_change_settings_there_are_no_box_buttons(
    hass, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    registry = er.async_get(hass)

    assert registry.async_get("button.fritz_network_reboot") is None
    assert registry.async_get("button.fritz_network_reconnect") is None
    assert registry.async_get("button.fritz_network_refresh") is not None


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
    for value in (100, 10, 100, 10, 100, 10, 100, 10, 100, 10):
        uptime["NewUptime"] = value
        await _poll(hass, coordinator)
    assert registry.async_get_issue("fritzbox_network", issue) is not None

    await hass.config_entries.async_unload(entry.entry_id)
    assert registry.async_get_issue("fritzbox_network", issue) is None


async def test_the_guest_wifi_is_a_switch_that_shows_the_change_at_once(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    state = hass.states.get("switch.fritz_network_guest_wifi")
    assert state.state == "off"

    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": "switch.fritz_network_guest_wifi"}, blocking=True
    )
    assert ("guest_wifi", True) in fake_client.calls
    # the box still says off at the next poll: the switch keeps showing what was asked for
    await _poll(hass, coordinator)
    assert hass.states.get("switch.fritz_network_guest_wifi").state == "on"
    # once the box shows it too, it is the box that decides again
    fake_client.guest_wifi = True
    await _poll(hass, coordinator)
    fake_client.guest_wifi = False
    await _poll(hass, coordinator)
    assert hass.states.get("switch.fritz_network_guest_wifi").state == "off"


async def test_each_wifi_band_is_a_switch_named_after_its_network(hass, fake_client, entry):
    await _setup(hass, entry)

    for band in ("2_4ghz", "5ghz"):
        state = hass.states.get(f"switch.fritz_network_wifi_{band}")
        assert state is not None and state.state == "on"
        assert state.attributes["ssid"] == "Home"
    assert hass.states.get("switch.fritz_network_wifi_6ghz") is None
    registry = er.async_get(hass)
    assert registry.async_get("switch.fritz_network_wifi_5ghz").unique_id == "SERIAL1_wifi_5ghz"
    assert registry.async_get("switch.fritz_network_wifi_5ghz").disabled_by is None


async def test_a_wifi_switch_shows_the_change_at_once_and_the_box_decides_afterwards(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    entity_id = "switch.fritz_network_wifi_5ghz"

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity_id}, blocking=True)
    assert ("wifi", "5ghz", False) in fake_client.calls
    assert hass.states.get(entity_id).state == "off"
    # the box still says on at the next poll: the switch keeps showing what was asked for
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "off"
    # once the box shows it too, it is the box that decides again
    fake_client.wifi["5ghz"] = replace(fake_client.wifi["5ghz"], enabled=False)
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "off"
    # from then on the box is read every tenth poll: a change made at the box shows up then
    fake_client.wifi["5ghz"] = replace(fake_client.wifi["5ghz"], enabled=True)
    for _ in range(10):
        await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "on"


async def test_a_refused_wifi_switch_is_an_error(hass, fake_client, entry):
    await _setup(hass, entry)
    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "switch", "turn_off", {"entity_id": "switch.fritz_network_wifi_5ghz"}, blocking=True
        )


async def test_the_wifi_networks_are_read_every_tenth_poll(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    reads = fake_client.wifi_reads
    for _ in range(9):
        await _poll(hass, coordinator)
    assert fake_client.wifi_reads == reads
    await _poll(hass, coordinator)
    assert fake_client.wifi_reads == reads + 1


async def test_the_first_poll_does_not_read_the_wifi_networks(hass, fake_client, entry):
    coordinator = FritzNetworkCoordinator(hass, entry, fake_client, "SERIAL1", True, "box", None)
    await coordinator._async_update_data()
    assert fake_client.wifi_reads == 0
    await coordinator._async_update_data()
    assert fake_client.wifi_reads == 1


async def test_without_the_right_to_change_settings_the_wifi_is_not_read_or_switched(
    hass, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    assert fake_client.wifi_reads == 0
    assert hass.states.get("switch.fritz_network_wifi_5ghz") is None


async def test_a_box_without_a_guest_network_or_a_user_without_rights_has_no_switch(
    hass, fake_client, entry
):
    fake_client.guest_wifi = None
    await _setup(hass, entry)
    assert hass.states.get("switch.fritz_network_guest_wifi") is None


async def test_the_guest_wifi_switch_needs_the_right_to_change_settings(hass, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)
    assert hass.states.get("switch.fritz_network_guest_wifi") is None


async def test_a_refusal_of_the_box_is_an_error_not_a_changed_switch(hass, fake_client, entry):
    from homeassistant.exceptions import HomeAssistantError

    await _setup(hass, entry)
    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "switch", "turn_on", {"entity_id": "switch.fritz_network_guest_wifi"}, blocking=True
        )
    assert hass.states.get("switch.fritz_network_guest_wifi").state == "off"


def test_the_firmware_offer_is_read_from_the_answer():
    assert parse_firmware({}) is None
    assert parse_firmware({"NewUpgradeAvailable": None}) is None
    none = parse_firmware({"NewUpgradeAvailable": False})
    assert none.update_available is False and none.version is None
    offer = parse_firmware(
        {
            "NewUpgradeAvailable": True,
            "NewX_AVM-DE_Version": "154.08.00",
            "NewX_AVM-DE_InfoURL": "https://example.org/info",
        }
    )
    assert (offer.update_available, offer.version) == (True, "154.08.00")
    assert offer.info_url == "https://example.org/info"


async def test_a_newer_firmware_shows_as_an_update(hass, fake_client, entry):
    fake_client.firmware = {"NewUpgradeAvailable": True, "NewX_AVM-DE_Version": "8.30"}
    await _setup(hass, entry)
    state = hass.states.get("update.fritz_network_firmware")
    assert state.state == "on"
    assert state.attributes["installed_version"] == "8.25"
    assert state.attributes["latest_version"] == "8.30"


async def test_without_a_newer_firmware_the_update_is_off(hass, fake_client, entry):
    await _setup(hass, entry)
    state = hass.states.get("update.fritz_network_firmware")
    assert state.state == "off"
    assert state.attributes["latest_version"] == state.attributes["installed_version"]


async def test_the_firmware_is_installed_by_the_box_when_the_user_may_change_settings(
    hass, fake_client, entry
):
    fake_client.firmware = {"NewUpgradeAvailable": True, "NewX_AVM-DE_Version": "8.30"}
    await _setup(hass, entry)
    state = hass.states.get("update.fritz_network_firmware")
    assert state.attributes["supported_features"] & 1  # INSTALL

    await hass.services.async_call(
        "update", "install", {"entity_id": "update.fritz_network_firmware"}, blocking=True
    )
    assert ("install_firmware",) in fake_client.calls

    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "update", "install", {"entity_id": "update.fritz_network_firmware"}, blocking=True
        )


async def test_without_the_right_to_change_settings_the_firmware_cannot_be_installed(
    hass, fake_client, entry
):
    fake_client.writable = False
    fake_client.firmware = {"NewUpgradeAvailable": True, "NewX_AVM-DE_Version": "8.30"}
    await _setup(hass, entry)
    state = hass.states.get("update.fritz_network_firmware")
    assert not state.attributes["supported_features"] & 1


async def test_the_last_restart_comes_from_the_setup_and_is_read_again_only_now_and_then(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    state = hass.states.get("sensor.fritz_network_box_uptime")
    assert state is not None and state.state != "unknown"
    boot = coordinator.box_boot
    assert (dt_util.utcnow() - boot).total_seconds() == pytest.approx(3 * 3600, abs=120)

    # the setup read it: neither the first polls nor the next ones ask again
    await _poll(hass, coordinator)
    await _poll(hass, coordinator)
    assert ("read_uptime",) not in fake_client.calls

    # a box that did not answer may have restarted: the first answer afterwards is read
    fake_client.uptime = 60
    coordinator._register_failure()
    await _poll(hass, coordinator)
    assert fake_client.calls.count(("read_uptime",)) == 1
    assert (dt_util.utcnow() - coordinator.box_boot).total_seconds() == pytest.approx(60, abs=120)
    await _poll(hass, coordinator)
    assert fake_client.calls.count(("read_uptime",)) == 1


async def test_the_last_restart_stays_put_while_the_reads_differ_by_less_than_a_minute(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    boot = coordinator.box_boot
    coordinator.note_uptime(3 * 3600 + 30)
    assert coordinator.box_boot == boot
    coordinator.note_uptime(2 * 3600)
    assert coordinator.box_boot != boot


async def test_a_box_that_does_not_tell_its_uptime_has_no_such_sensor(hass, fake_client, entry):
    fake_client.uptime = None
    await _setup(hass, entry)
    assert er.async_get(hass).async_get("sensor.fritz_network_box_uptime") is None


async def test_the_cpu_temperature_is_asked_once_and_read_only_while_the_sensor_is_on(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    registry = er.async_get(hass)
    reg = registry.async_get("sensor.fritz_network_cpu_temperature")
    assert reg is not None and reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert coordinator.cpu_supported is True
    # asked once to see that the box has the sensor, not again while nothing wants the value
    assert fake_client.calls.count(("cpu_temperature",)) == 1
    for _ in range(12):
        await _poll(hass, coordinator)
    assert fake_client.calls.count(("cpu_temperature",)) == 1

    registry.async_update_entity(reg.entity_id, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = entry.runtime_data
    fake_client.cpu_temperature = 68
    await _poll(hass, coordinator)

    assert hass.states.get("sensor.fritz_network_cpu_temperature").state == "68"
    # now and then, not at every poll
    reads = fake_client.calls.count(("cpu_temperature",))
    await _poll(hass, coordinator)
    assert fake_client.calls.count(("cpu_temperature",)) == reads


async def test_a_box_without_the_sensor_is_not_asked_again_and_has_no_entity(
    hass, fake_client, entry
):
    fake_client.cpu_temperature = None
    coordinator = await _setup(hass, entry)
    for _ in range(12):
        await _poll(hass, coordinator)

    assert coordinator.cpu_supported is False
    assert fake_client.calls.count(("cpu_temperature",)) == 1
    assert er.async_get(hass).async_get("sensor.fritz_network_cpu_temperature") is None


async def test_a_failed_read_of_the_temperature_is_tried_again(hass, fake_client, entry):
    fake_client.cpu_error = True
    coordinator = await _setup(hass, entry)
    assert coordinator.cpu_supported is None
    assert er.async_get(hass).async_get("sensor.fritz_network_cpu_temperature") is None

    fake_client.cpu_error = False
    await _poll(hass, coordinator)
    assert coordinator.cpu_supported is True


async def test_the_first_poll_does_not_ask_for_the_temperature(hass, fake_client, entry):
    coordinator = FritzNetworkCoordinator(hass, entry, fake_client, "SERIAL1", True, "box", None)
    await coordinator._async_update_data()
    assert ("cpu_temperature",) not in fake_client.calls
    await coordinator._async_update_data()
    assert ("cpu_temperature",) in fake_client.calls


async def test_a_box_without_upnp_status_is_a_repair_and_not_a_refusal(hass, fake_client, entry):
    fake_client.upnp = False
    await _setup(hass, entry)
    issue_id = f"upnp_disabled_{entry.entry_id}"

    issue = ir.async_get(hass).async_get_issue("fritzbox_network", issue_id)
    assert issue is not None and issue.is_fixable is False
    # the integration works on: the devices are there
    assert hass.states.get("sensor.fritz_network_devices_total") is not None


async def test_the_upnp_repair_goes_away_when_the_box_passes_the_status(hass, fake_client, entry):
    fake_client.upnp = False
    coordinator = await _setup(hass, entry)
    issue_id = f"upnp_disabled_{entry.entry_id}"
    assert ir.async_get(hass).async_get_issue("fritzbox_network", issue_id) is not None

    fake_client.upnp = True
    coordinator._polls = 120  # the box is asked again hourly
    await _poll(hass, coordinator)
    assert ir.async_get(hass).async_get_issue("fritzbox_network", issue_id) is None


async def test_a_box_that_does_not_say_has_no_upnp_repair_and_is_asked_hourly(
    hass, fake_client, entry
):
    fake_client.upnp = None
    coordinator = await _setup(hass, entry)
    assert (
        ir.async_get(hass).async_get_issue("fritzbox_network", f"upnp_disabled_{entry.entry_id}")
        is None
    )
    reads = fake_client.upnp_reads
    for _ in range(5):
        await _poll(hass, coordinator)
    assert fake_client.upnp_reads == reads


async def test_the_diagnostics_list_what_the_box_offers_without_a_request(hass, fake_client, entry):
    await _setup(hass, entry)
    reads = fake_client.upnp_reads
    result = await async_get_config_entry_diagnostics(hass, entry)

    assert result["box"]["services"] == ["DeviceInfo1", "WLANConfiguration1"]
    assert result["box"]["upnp_enabled"] is True
    assert result["box"]["uptime_known"] is True
    assert result["box"]["wifi_networks"] == ["2_4ghz", "5ghz"]
    assert fake_client.upnp_reads == reads


async def _enable_ports(hass, entry):
    await _setup(hass, entry)  # the switches are made once the box has told its forwardings
    registry = er.async_get(hass)
    for entity_id in ("switch.fritz_network_port_udp_51820", "switch.fritz_network_port_tcp_5027"):
        registry.async_update_entity(entity_id, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_each_port_forwarding_is_a_switch_that_is_off_by_default(hass, fake_client, entry):
    await _setup(hass, entry)
    registry = er.async_get(hass)

    reg = registry.async_get("switch.fritz_network_port_udp_51820")
    assert reg is not None and reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert reg.unique_id == "SERIAL1_port_udp_51820"
    assert registry.async_get("switch.fritz_network_port_tcp_5027") is not None
    # read once to see what there is, then not for switches that are off
    assert fake_client.port_reads == 1


async def test_the_forwardings_are_read_only_while_a_switch_is_on(hass, fake_client, entry):
    coordinator = await _enable_ports(hass, entry)
    # a switch that is added asks for the values once, at the next poll
    await _poll(hass, coordinator)
    reads = fake_client.port_reads
    # then now and then (every tenth poll), not at every poll
    for _ in range(10):
        await _poll(hass, coordinator)
    assert fake_client.port_reads == reads + 1

    state = hass.states.get("switch.fritz_network_port_tcp_5027")
    assert state.state == "on"
    assert state.attributes["internal_client"] == "192.0.2.20"
    assert state.attributes["external_port"] == 5027
    assert hass.states.get("switch.fritz_network_port_udp_51820").state == "off"


async def test_a_port_switch_shows_the_change_at_once_and_the_box_decides_afterwards(
    hass, fake_client, entry
):
    coordinator = await _enable_ports(hass, entry)
    entity_id = "switch.fritz_network_port_udp_51820"

    await hass.services.async_call("switch", "turn_on", {"entity_id": entity_id}, blocking=True)
    assert ("port", "udp_51820", True) in fake_client.calls
    assert hass.states.get(entity_id).state == "on"
    # the box still says off: the switch keeps showing what was asked for, and reads every poll
    reads = fake_client.port_reads
    await _poll(hass, coordinator)
    assert fake_client.port_reads == reads + 1
    assert hass.states.get(entity_id).state == "on"
    fake_client.port_rules["udp_51820"] = replace(fake_client.port_rules["udp_51820"], enabled=True)
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "on"
    reads = fake_client.port_reads
    await _poll(hass, coordinator)
    assert fake_client.port_reads == reads  # the box shows it: back to the tenth poll


async def test_a_refused_port_switch_is_an_error(hass, fake_client, entry):
    await _enable_ports(hass, entry)
    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "switch",
            "turn_on",
            {"entity_id": "switch.fritz_network_port_udp_51820"},
            blocking=True,
        )


async def test_the_first_poll_does_not_read_the_forwardings(hass, fake_client, entry):
    coordinator = FritzNetworkCoordinator(hass, entry, fake_client, "SERIAL1", True, "box", None)
    await coordinator._async_update_data()
    assert fake_client.port_reads == 0
    await coordinator._async_update_data()
    assert fake_client.port_reads == 1


async def test_without_the_right_to_change_settings_the_forwardings_are_not_read(
    hass, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    assert fake_client.port_reads == 0
    assert er.async_get(hass).async_get("switch.fritz_network_port_udp_51820") is None


async def test_a_box_that_does_not_answer_about_firmware_has_no_update_entity(
    hass, fake_client, entry
):
    fake_client.firmware = {}
    await _setup(hass, entry)
    assert hass.states.get("update.fritz_network_firmware") is None


async def test_the_topology_carries_the_firmware_offer(hass, hass_ws_client, fake_client, entry):
    fake_client.firmware = {"NewUpgradeAvailable": True, "NewX_AVM-DE_Version": "8.30"}
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": COMMAND})
    assert (await client.receive_json())["success"]
    topology = (await client.receive_json())["event"]
    assert topology["firmware"] == {"installed": "8.25", "latest": "8.30", "info_url": None}


async def test_the_ports_come_with_the_device_they_lead_to(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.ports = [
        {
            "description": "Web",
            "protocol": "TCP",
            "external_port": 443,
            "internal_port": 8443,
            "client": fake_client.hosts[0].ip,
            "enabled": True,
            "lease": 0,
        },
        {
            "description": None,
            "protocol": "UDP",
            "external_port": 5000,
            "internal_port": 5000,
            "client": "192.0.2.250",
            "enabled": False,
            "lease": 3600,
        },
    ]
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/ports/list", "entry_id": entry.entry_id}
    )
    result = (await client.receive_json())["result"]["entries"]

    assert result[0]["device_name"] == fake_client.hosts[0].name
    assert result[0]["device_id"] == fake_client.hosts[0].mac.replace(":", "")
    # a client the box does not list stays a bare address
    assert result[1]["device_id"] is None and result[1]["client"] == "192.0.2.250"


async def test_the_ports_are_only_read_on_demand(hass, fake_client, entry):
    reads = []
    fake_client.get_port_mappings = lambda: reads.append(1) or []
    coordinator = await _setup(hass, entry)
    await _poll(hass, coordinator)
    assert reads == []


async def test_the_ports_set_by_hand_come_with_the_ones_opened_by_upnp_without_doubles(
    hass, hass_ws_client, fake_client, entry
):
    host = fake_client.hosts[0]
    fake_client.port_forwardings = [
        {
            "uid": "forw1",
            "description": "Web",
            "protocol": "TCP",
            "external_port": 443,
            "external_port_end": None,
            "internal_port": 443,
            "internal_port_end": None,
            "client": "2001:db8::1",  # an IPv6 rule has no IPv4 address: the MAC finds the device
            "family": "ipv6",
            "enabled": True,
            "lease": 0,
            "source": "manual",
            "mac": host.mac,
        }
    ]
    fake_client.ports = [
        {  # the same forwarding as the one by hand: not listed twice
            "description": "Web",
            "protocol": "TCP",
            "external_port": 443,
            "internal_port": 443,
            "client": "2001:db8::1",
            "enabled": True,
            "lease": 0,
        },
        {
            "description": "Game",
            "protocol": "UDP",
            "external_port": 3074,
            "internal_port": 3074,
            "client": host.ip,
            "enabled": True,
            "lease": 600,
        },
    ]
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/ports/list", "entry_id": entry.entry_id}
    )
    result = (await client.receive_json())["result"]

    assert result["manual_known"] is True
    assert [(e["description"], e["source"], e["family"]) for e in result["entries"]] == [
        ("Web", "manual", "ipv6"),
        ("Game", "upnp", "ipv4"),
    ]
    assert result["entries"][0]["device_name"] == host.name
    assert result["entries"][0]["device_online"] is host.active
    assert "mac" not in result["entries"][0]
    assert result["entries"][1]["device_id"] == host.mac.replace(":", "")


async def test_the_ports_say_where_the_web_interface_did_not_tell_the_ones_set_by_hand(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.port_forwardings = None
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/ports/list", "entry_id": entry.entry_id}
    )
    result = (await client.receive_json())["result"]

    assert result == {"entries": [], "manual_known": False}


async def test_the_routes_come_with_the_device_their_gateway_is(
    hass, hass_ws_client, fake_client, entry
):
    online = next(h for h in fake_client.hosts if h.ip and h.active)
    row = {
        "destination": "10.8.0.0",
        "mask": "255.255.255.0",
        "source": "0.0.0.0",
        "source_mask": "0.0.0.0",
        "interface": "LanHostConfigManagement1",
        "metric": 0,
        "enabled": True,
    }
    fake_client.routes = [
        {**row, "network": "10.8.0.0/24", "gateway": online.ip},
        {**row, "network": "172.16.0.0/16", "gateway": "192.0.2.250"},
        {**row, "network": "10.9.0.0/24", "gateway": None},
    ]
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/routes/list", "entry_id": entry.entry_id}
    )
    result = (await client.receive_json())["result"]["entries"]

    assert result[0]["device_name"] == online.name and result[0]["gateway_online"] is True
    assert result[0]["device_id"] == online.mac.replace(":", "")
    assert result[0]["device_mac"] == online.mac and result[1]["device_mac"] is None
    # a gateway the box does not list stays a bare address, one without any has no device
    assert result[1]["device_id"] is None and result[1]["gateway_online"] is None
    assert result[2]["device_name"] is None and result[2]["gateway"] is None


async def test_the_routes_are_read_every_tenth_poll_not_with_each(hass, fake_client, entry):
    reads = []
    fake_client.get_routes = lambda: reads.append(1) or []
    coordinator = await _setup(hass, entry)
    assert len(reads) == 1  # the first poll reads them
    for _ in range(9):
        await _poll(hass, coordinator)
    assert len(reads) == 1
    await _poll(hass, coordinator)  # the tenth poll after the first
    assert len(reads) == 2


async def test_the_diagnostics_have_the_connection_without_its_addresses(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    fake_client.internet_fast["GetStatusInfo"]["NewUptime"] = 20
    await _poll(hass, coordinator)

    result = await async_get_config_entry_diagnostics(hass, entry)

    internet = result["internet"]
    assert internet["connected"] is True and internet["access_type"] == "DSL"
    assert internet["dsl"]["noise_margin_down"] == 17.0
    assert internet["external_ipv4"] == "**REDACTED**" and internet["dns"] == "**REDACTED**"
    for address in ("203.0.113", "2001:db8", "198.51.100"):
        assert address not in str(result)
    assert internet["events"] == ["reconnected"]
    assert result["guest_wifi"] is False
    assert result["firmware"]["update_available"] is False


def test_the_byte_counters_prefer_the_64_bit_ones_of_the_add_on_info():
    addon = {
        "NewTotalBytesSent": 10,
        "NewTotalBytesReceived": 20,
        "NewX_AVM_DE_TotalBytesSent64": 5_000_000_000,
        "NewX_AVM_DE_TotalBytesReceived64": 9_000_000_000,
    }
    status = INTERNET_FAST["GetStatusInfo"]
    info = parse_internet({"GetStatusInfo": status, "GetAddonInfos": addon}, INTERNET_SLOW)
    assert (info.bytes_sent, info.bytes_received) == (5_000_000_000, 9_000_000_000)
    # without the 64 bit ones the add-on's own counters count, then the separate actions
    plain = {k: v for k, v in addon.items() if "64" not in k}
    info = parse_internet({"GetStatusInfo": status, "GetAddonInfos": plain}, INTERNET_SLOW)
    assert (info.bytes_sent, info.bytes_received) == (10, 20)
    info = parse_internet(INTERNET_FAST, INTERNET_SLOW)
    assert (info.bytes_sent, info.bytes_received) == (1_000_000, 5_000_000)
    assert parse_internet({"GetStatusInfo": status}, {}).bytes_sent is None


async def test_the_load_of_the_dhcp_range_counts_the_devices_online_in_it(hass, fake_client, entry):
    fake_client.network = {**fake_client.network, "pool_from": "192.0.2.1", "pool_to": "192.0.2.10"}
    await _setup(hass, entry)

    used = sum(
        h.active and h.ip is not None and h.ip.startswith("192.0.2.") and int(h.ip[8:]) <= 10
        for h in fake_client.hosts
    )
    assert used
    state = hass.states.get("sensor.fritz_network_dhcp_pool")
    assert float(state.state) == used * 10
    assert state.attributes["addresses_in_use"] == used
    assert state.attributes["addresses_in_range"] == 10

    known = sum(
        h.ip is not None and h.ip.startswith("192.0.2.") and int(h.ip[8:]) <= 10
        for h in fake_client.hosts
    )
    attributes = state.attributes
    assert attributes["first_address"] == "192.0.2.1"
    assert attributes["last_address"] == "192.0.2.10"
    assert attributes["addresses_offline"] == known - used
    assert attributes["addresses_free"] == 10 - known
    assert attributes["first_free_address"] not in {h.ip for h in fake_client.hosts}
    assert attributes["subnet_mask"] == "255.255.255.0"
    assert attributes["gateway"] == "192.168.178.1"
    assert attributes["reserved_addresses"] == []


async def test_there_is_no_dhcp_load_where_the_server_is_off(hass, fake_client, entry):
    fake_client.network = {**fake_client.network, "dhcp": False}
    await _setup(hass, entry)

    assert hass.states.get("sensor.fritz_network_dhcp_pool") is None


async def test_an_area_turned_off_in_the_options_has_no_switches_and_loses_the_old_ones(
    hass, fake_client, entry
):
    await _enable_ports(hass, entry)
    registry = er.async_get(hass)
    assert registry.async_get("switch.fritz_network_port_udp_51820") is not None

    hass.config_entries.async_update_entry(entry, options={"switch_areas": ["vpn", "routes"]})
    await hass.async_block_till_done()

    assert registry.async_get("switch.fritz_network_port_udp_51820") is None
    assert registry.async_get("switch.fritz_network_port_tcp_5027") is None


async def test_the_wifi_area_turned_off_removes_the_wifi_and_guest_switches(
    hass, fake_client, entry
):
    await _enable_ports(hass, entry)
    assert hass.states.get("switch.fritz_network_guest_wifi") is not None
    assert hass.states.get("switch.fritz_network_wifi_2_4ghz") is not None

    hass.config_entries.async_update_entry(
        entry, options={"switch_areas": ["clients", "ports", "vpn", "routes"]}
    )
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    assert registry.async_get("switch.fritz_network_guest_wifi") is None
    assert registry.async_get("switch.fritz_network_wifi_2_4ghz") is None
    assert registry.async_get("switch.fritz_network_port_udp_51820") is not None
