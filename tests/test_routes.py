"""Switching a static route: in the panel and by an action."""

from unittest.mock import MagicMock

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import pytest

from custom_components.fritzbox_network.api import FritzNetworkClient
from custom_components.fritzbox_network.const import DOMAIN

SWITCH = "fritzbox_network/routes/switch"


def _route(network, destination, mask, gateway, enabled):
    return {
        "network": network,
        "destination": destination,
        "mask": mask,
        "source": "0.0.0.0",
        "source_mask": "0.0.0.0",
        "gateway": gateway,
        "interface": "LanHostConfigManagement1",
        "metric": 0,
        "enabled": enabled,
    }


@pytest.fixture
def routes(fake_client):
    fake_client.routes = [
        _route("10.8.0.0/24", "10.8.0.0", "255.255.255.0", "192.0.2.5", False),
        _route("172.16.0.0/16", "172.16.0.0", "255.255.0.0", "192.0.2.99", True),
    ]
    return fake_client.routes


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_the_panel_switches_a_route_and_gets_the_routes_read_back(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": SWITCH, "entry_id": entry.entry_id, "network": "10.8.0.0/24", "enabled": True}
    )
    reply = await client.receive_json()

    assert reply["success"] is True
    assert ("route", "10.8.0.0", "255.255.255.0", True) in fake_client.calls
    assert [r["enabled"] for r in reply["result"]["entries"]] == [True, True]
    # the answer carries the device the gateway is, as the list does
    assert "device_name" in reply["result"]["entries"][0]


async def test_a_route_already_in_the_state_asked_for_is_not_sent_again(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": SWITCH, "entry_id": entry.entry_id, "network": "172.16.0.0/16", "enabled": True}
    )

    assert (await client.receive_json())["success"] is True
    assert not [c for c in fake_client.calls if c[0] == "route"]


async def test_the_panel_is_told_where_the_route_is_unknown_the_box_refuses_or_ignores_it(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    message = {"type": SWITCH, "entry_id": entry.entry_id, "enabled": True}

    await client.send_json_auto_id({**message, "network": "10.99.0.0/24"})
    unknown = await client.receive_json()
    assert unknown["success"] is False and "10.99.0.0/24" in unknown["error"]["message"]

    fake_client.routes_ignore = True
    await client.send_json_auto_id({**message, "network": "10.8.0.0/24"})
    assert (await client.receive_json())["success"] is False  # the route did not change

    fake_client.routes_ignore = False
    fake_client.fail_actions = True
    await client.send_json_auto_id({**message, "network": "10.8.0.0/24"})
    assert (await client.receive_json())["success"] is False


async def test_without_the_right_to_write_nothing_is_switched(
    hass, hass_ws_client, fake_client, entry, routes
):
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": SWITCH, "entry_id": entry.entry_id, "network": "10.8.0.0/24", "enabled": True}
    )

    assert (await client.receive_json())["success"] is False
    assert not [c for c in fake_client.calls if c[0] == "route"]


async def test_the_action_switches_a_route_by_its_network(hass, fake_client, entry, routes):
    await _setup(hass, entry)

    await hass.services.async_call(
        DOMAIN, "set_route", {"network": " 10.8.0.0/24 ", "enabled": True}, blocking=True
    )
    assert routes[0]["enabled"] is True

    await hass.services.async_call(
        DOMAIN, "set_route", {"network": "10.8.0.0/24", "enabled": False}, blocking=True
    )
    assert routes[0]["enabled"] is False


async def test_the_action_names_a_route_the_box_does_not_have_and_needs_the_right(
    hass, fake_client, entry, routes
):
    await _setup(hass, entry)

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "set_route", {"network": "10.99.0.0/24", "enabled": True}, blocking=True
        )
    with pytest.raises(Exception):  # noqa: B017  (the schema refuses what is no network)
        await hass.services.async_call(
            DOMAIN, "set_route", {"network": "everything", "enabled": True}, blocking=True
        )

    fake_client.writable = False
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN, "set_route", {"network": "10.8.0.0/24", "enabled": True}, blocking=True
        )
    assert not [c for c in fake_client.calls if c[0] == "route"]


def test_the_client_sends_the_four_parts_that_name_a_route_with_the_switch():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    route = _route("10.8.0.0/24", "10.8.0.0", "255.255.255.0", "192.0.2.5", False)

    client.set_route_enabled(route, True)

    client._fc.call_action.assert_called_once_with(
        "Layer3Forwarding1",
        "SetForwardingEntryEnable",
        NewDestIPAddress="10.8.0.0",
        NewDestSubnetMask="255.255.255.0",
        NewSourceIPAddress="0.0.0.0",
        NewSourceSubnetMask="0.0.0.0",
        NewEnable=True,
    )
