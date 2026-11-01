"""The internet connection: parsing what the box says, the throughput and the events."""

from unittest.mock import patch

import pytest

from custom_components.fritzbox_network import coordinator as coordinator_module
from custom_components.fritzbox_network.models import parse_internet

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

    fake_client.internet_fast["GetStatusInfo"]["NewUptime"] = 20
    fake_client.internet_slow["GetExternalIPAddress"]["NewExternalIPAddress"] = "203.0.113.99"
    await _poll(hass, coordinator)

    kinds = [e["kind"] for e in coordinator.internet_events]
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
