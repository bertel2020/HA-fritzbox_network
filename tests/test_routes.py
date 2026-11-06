"""Switching a static route: in the panel and by an action."""

import ipaddress
from unittest.mock import MagicMock

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import pytest

from custom_components.fritzbox_network.api import FritzNetworkClient
from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.routes import RouteRefused, home_network, validate_route

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


# adding and deleting

HOME = (ipaddress.IPv4Network("192.168.178.0/24"), ipaddress.IPv4Address("192.168.178.1"))
ADD = "fritzbox_network/routes/add"
DELETE = "fritzbox_network/routes/delete"


@pytest.mark.parametrize(
    ("network", "gateway", "metric", "code"),
    [
        ("10.9.0.0/24", "192.168.178.5", 10, None),
        ("10.9.0.7/32", "192.168.178.5", 0, None),
        ("abc", "192.168.178.5", 10, "invalid_network"),
        ("10.9.0.1/24", "192.168.178.5", 10, "invalid_network"),  # host bits set
        ("127.0.0.0/8", "192.168.178.5", 10, "invalid_network"),
        ("0.0.0.0/0", "192.168.178.5", 10, "all_traffic"),
        ("192.168.178.0/25", "192.168.178.5", 10, "overlaps_home"),
        ("192.168.0.0/16", "192.168.178.5", 10, "overlaps_home"),  # contains the home network
        ("10.9.0.0/24", "nope", 10, "invalid_gateway"),
        ("10.9.0.0/24", "10.1.1.1", 10, "gateway_outside"),
        ("10.9.0.0/24", "192.168.178.1", 10, "gateway_is_box"),
        ("172.16.0.0/16", "192.168.178.5", 10, "duplicate"),
        ("10.9.0.0/24", "192.168.178.5", -1, "invalid_metric"),
        ("10.9.0.0/24", "192.168.178.5", 70000, "invalid_metric"),
        ("10.9.0.0/24", "192.168.178.5", True, "invalid_metric"),
    ],
)
def test_a_new_route_keeps_the_rules_that_do_not_cut_the_box_off(network, gateway, metric, code):
    existing = [{"network": "172.16.0.0/16"}]
    if code is None:
        target, via = validate_route(network, gateway, metric, existing, HOME)
        assert str(target) == network and str(via) == gateway
        return
    with pytest.raises(RouteRefused) as refused:
        validate_route(network, gateway, metric, existing, HOME)
    assert refused.value.code == code


def test_the_home_network_comes_from_the_mask_and_the_address_of_the_box():
    assert home_network({"mask": "255.255.255.0", "gateway": "192.168.178.1"}) == HOME
    assert home_network({"mask": "255.255.255.0", "gateway": None}) is None
    assert home_network({"mask": "x", "gateway": "192.168.178.1"}) is None
    assert home_network(None) is None


async def test_the_panel_adds_a_route_and_gets_the_routes_read_back(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": ADD,
            "entry_id": entry.entry_id,
            "network": "10.9.0.0/24",
            "gateway": "192.168.178.5",
            "metric": 15,
        }
    )
    reply = await client.receive_json()

    assert reply["success"] is True
    # the box is given the form it writes itself: the interface of the routes it already has
    assert ("route-add", "10.9.0.0/24", "192.168.178.5", 15, "LanHostConfigManagement1") in (
        fake_client.calls
    )
    assert [r["network"] for r in reply["result"]["entries"]][-1] == "10.9.0.0/24"


async def test_a_route_the_box_makes_switched_off_is_switched_on(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": ADD,
            "entry_id": entry.entry_id,
            "network": "10.9.0.0/24",
            "gateway": "192.168.178.5",
            "metric": 10,
        }
    )

    assert (await client.receive_json())["result"]["entries"][-1]["enabled"] is True
    assert ("route", "10.9.0.0", "255.255.255.0", True) in fake_client.calls


async def test_a_route_that_breaks_a_rule_is_refused_before_the_box_is_asked(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    message = {"type": ADD, "entry_id": entry.entry_id, "gateway": "192.168.178.5", "metric": 10}

    await client.send_json_auto_id({**message, "network": "0.0.0.0/0"})
    reply = await client.receive_json()

    assert reply["success"] is False and "0.0.0.0/0" in reply["error"]["message"]
    assert not [c for c in fake_client.calls if c[0] == "route-add"]

    fake_client.network = None  # the box tells no home network: nothing can be checked
    await client.send_json_auto_id({**message, "network": "10.9.0.0/24"})
    assert (await client.receive_json())["success"] is False
    assert not [c for c in fake_client.calls if c[0] == "route-add"]


async def test_an_added_route_that_does_not_show_up_is_an_error(
    hass, hass_ws_client, fake_client, entry, routes
):
    fake_client.routes_ignore = True
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": ADD,
            "entry_id": entry.entry_id,
            "network": "10.9.0.0/24",
            "gateway": "192.168.178.5",
            "metric": 10,
        }
    )

    assert (await client.receive_json())["success"] is False


async def test_the_panel_deletes_a_route_by_its_network(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": DELETE, "entry_id": entry.entry_id, "network": "10.8.0.0/24"}
    )
    reply = await client.receive_json()

    assert reply["success"] is True
    assert [r["network"] for r in reply["result"]["entries"]] == ["172.16.0.0/16"]

    await client.send_json_auto_id(
        {"type": DELETE, "entry_id": entry.entry_id, "network": "10.8.0.0/24"}
    )
    assert (await client.receive_json())["success"] is False  # gone already

    fake_client.routes_ignore = True
    await client.send_json_auto_id(
        {"type": DELETE, "entry_id": entry.entry_id, "network": "172.16.0.0/16"}
    )
    assert (await client.receive_json())["success"] is False  # the box kept it


async def test_without_the_right_to_write_nothing_is_added_or_deleted(
    hass, hass_ws_client, fake_client, entry, routes
):
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": ADD,
            "entry_id": entry.entry_id,
            "network": "10.9.0.0/24",
            "gateway": "192.168.178.5",
            "metric": 10,
        }
    )
    assert (await client.receive_json())["success"] is False
    await client.send_json_auto_id(
        {"type": DELETE, "entry_id": entry.entry_id, "network": "10.8.0.0/24"}
    )
    assert (await client.receive_json())["success"] is False
    assert not [c for c in fake_client.calls if c[0] in ("route-add", "route-delete")]


async def test_the_list_names_the_home_network_for_the_checks_of_the_panel(
    hass, hass_ws_client, fake_client, entry, routes
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "fritzbox_network/routes/list", "entry_id": entry.entry_id}
    )
    result = (await client.receive_json())["result"]

    assert result["home"] == {"network": "192.168.178.0/24", "box": "192.168.178.1"}


def test_the_client_writes_a_new_route_in_the_form_of_the_box_and_deletes_by_the_four_parts():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()

    client.add_route(
        ipaddress.IPv4Network("10.9.0.0/24"), ipaddress.IPv4Address("192.168.178.5"), 15
    )
    client._fc.call_action.assert_called_with(
        "Layer3Forwarding1",
        "AddForwardingEntry",
        NewType="Host",
        NewDestIPAddress="10.9.0.0",
        NewDestSubnetMask="255.255.255.0",
        NewSourceIPAddress="0.0.0.0",
        NewSourceSubnetMask="0.0.0.0",
        NewGatewayIPAddress="192.168.178.5",
        NewInterface="LanHostConfigManagement1",
        NewForwardingMetric=15,
    )

    client.delete_route(_route("10.8.0.0/24", "10.8.0.0", "255.255.255.0", "192.0.2.5", True))
    client._fc.call_action.assert_called_with(
        "Layer3Forwarding1",
        "DeleteForwardingEntry",
        NewDestIPAddress="10.8.0.0",
        NewDestSubnetMask="255.255.255.0",
        NewSourceIPAddress="0.0.0.0",
        NewSourceSubnetMask="0.0.0.0",
    )
