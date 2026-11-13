"""Switching a static route: in the panel and by an action."""

import asyncio
import ipaddress
from unittest.mock import MagicMock, patch

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


# the switches of the routes

from fritzconnection.core.exceptions import FritzActionError  # noqa: E402
from homeassistant.helpers import entity_registry as er  # noqa: E402


async def _poll(hass, coordinator, *, read=True):
    """One more poll; ``read`` makes it read the routes too (they are read every tenth poll)."""
    if read:
        coordinator._routes_force = True
    await coordinator.async_refresh()
    await hass.async_block_till_done()


def _entity(hass, coordinator, network):
    return er.async_get(hass).async_get_entity_id(
        "switch", DOMAIN, f"{coordinator.serial}_route_switch_{network}"
    )


async def test_each_route_is_a_switch_with_the_state_of_the_box_and_the_gateway(
    hass, fake_client, entry, routes
):
    online = next(h for h in fake_client.hosts if h.ip and h.active)
    routes[0]["gateway"] = online.ip
    coordinator = await _setup(hass, entry)

    first = hass.states.get(_entity(hass, coordinator, "10.8.0.0/24"))
    second = hass.states.get(_entity(hass, coordinator, "172.16.0.0/16"))

    assert first.state == "off" and second.state == "on"
    assert first.attributes["friendly_name"].endswith("Route 10.8.0.0/24")
    assert first.attributes["network"] == "10.8.0.0/24"
    assert first.attributes["gateway"] == online.ip
    assert first.attributes["gateway_device"] == online.name
    assert first.attributes["gateway_online"] is True
    assert first.attributes["metric"] == 0
    # a gateway the box does not list has no device
    assert (
        second.attributes["gateway_device"] is None and second.attributes["gateway_online"] is None
    )


async def test_the_switch_switches_the_route_and_shows_what_the_box_then_says(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    entity_id = _entity(hass, coordinator, "10.8.0.0/24")

    await hass.services.async_call("switch", "turn_on", {"entity_id": entity_id}, blocking=True)

    assert ("route", "10.8.0.0", "255.255.255.0", True) in fake_client.calls
    assert hass.states.get(entity_id).state == "on"  # at once, not at the next read

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity_id}, blocking=True)
    assert hass.states.get(entity_id).state == "off"

    fake_client.routes_ignore = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call("switch", "turn_on", {"entity_id": entity_id}, blocking=True)
    assert hass.states.get(entity_id).state == "off"


async def test_without_the_right_to_write_there_are_no_switches_and_no_reads(
    hass, fake_client, entry, routes
):
    fake_client.writable = False
    reads = []
    fake_client.get_routes = lambda: reads.append(1) or []
    coordinator = await _setup(hass, entry)

    assert _entity(hass, coordinator, "10.8.0.0/24") is None
    assert not reads and coordinator.data.routes is None


async def test_a_route_that_shows_up_in_the_box_gets_its_switch_at_the_next_read(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    fake_client.routes.append(_route("10.7.0.0/24", "10.7.0.0", "255.255.255.0", "192.0.2.7", True))

    await _poll(hass, coordinator, read=False)  # no read yet: not there
    assert _entity(hass, coordinator, "10.7.0.0/24") is None
    await _poll(hass, coordinator)

    assert hass.states.get(_entity(hass, coordinator, "10.7.0.0/24")).state == "on"


async def test_a_route_missing_in_two_reads_in_a_row_loses_its_switch(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    gone = routes.pop(0)

    await _poll(hass, coordinator)  # one read that misses it: it may be a hiccup of the box
    entity_id = _entity(hass, coordinator, "10.8.0.0/24")
    assert entity_id and hass.states.get(entity_id).state == "unavailable"
    await _poll(hass, coordinator)  # the second one makes it sure

    assert _entity(hass, coordinator, "10.8.0.0/24") is None

    # a route that comes back gets a switch again
    routes.append(gone)
    await _poll(hass, coordinator)
    assert _entity(hass, coordinator, "10.8.0.0/24")


async def test_a_route_that_is_missed_once_and_found_again_keeps_its_switch(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    gone = routes.pop(0)
    await _poll(hass, coordinator)
    routes.append(gone)
    await _poll(hass, coordinator)
    routes.pop()
    await _poll(hass, coordinator)  # missed once again, but the count began anew

    assert _entity(hass, coordinator, "10.8.0.0/24")


async def test_failed_reads_keep_the_state_for_a_while_and_then_make_the_switches_unavailable(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    entity_id = _entity(hass, coordinator, "172.16.0.0/16")

    def refuse():
        raise FritzActionError("refused")

    fake_client.get_routes = refuse
    await _poll(hass, coordinator)
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "on"  # the last state stays
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "unavailable"
    assert _entity(hass, coordinator, "172.16.0.0/16")  # unavailable, not removed

    fake_client.get_routes = lambda: [dict(r) for r in routes]
    await _poll(hass, coordinator)
    assert hass.states.get(entity_id).state == "on"


async def test_a_route_added_or_deleted_in_the_panel_changes_the_switches_at_once(
    hass, hass_ws_client, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
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
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()
    assert hass.states.get(_entity(hass, coordinator, "10.9.0.0/24")).state == "on"

    await client.send_json_auto_id(
        {"type": DELETE, "entry_id": entry.entry_id, "network": "10.9.0.0/24"}
    )
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()
    assert _entity(hass, coordinator, "10.9.0.0/24") is None


async def test_the_switch_of_a_route_that_vanished_while_home_assistant_was_off_is_removed(
    hass, fake_client, entry, routes
):
    registry = er.async_get(hass)
    stale = registry.async_get_or_create(
        "switch",
        DOMAIN,
        f"{entry.unique_id}_route_switch_10.99.0.0/24",
        config_entry=entry,
    )
    assert registry.async_get(stale.entity_id) is not None  # there before the first read
    coordinator = await _setup(hass, entry)

    assert registry.async_get(stale.entity_id) is None
    assert _entity(hass, coordinator, "10.8.0.0/24")  # the ones that are there stay


async def test_a_poll_running_during_a_change_does_not_bring_the_old_routes_back(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    fetch = coordinator._fetch
    changed = [r for r in routes if r["network"] != "10.8.0.0/24"]

    def fetch_while_a_route_is_deleted():
        result = fetch()  # the poll read the routes before the change
        asyncio.run_coroutine_threadsafe(_store(changed), hass.loop).result()
        return result

    async def _store(new):
        coordinator._store_routes(new)

    coordinator._routes_force = True
    with patch.object(coordinator, "_fetch", fetch_while_a_route_is_deleted):
        await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert [r["network"] for r in coordinator.data.routes] == ["172.16.0.0/16"]


async def test_the_routes_are_read_again_with_the_poll_after_a_change(
    hass, fake_client, entry, routes
):
    coordinator = await _setup(hass, entry)
    coordinator._store_routes(list(routes))  # a change from the panel
    routes.append(_route("10.7.0.0/24", "10.7.0.0", "255.255.255.0", "192.0.2.7", True))

    await _poll(hass, coordinator, read=False)  # not a read of its own turn, but forced

    assert "10.7.0.0/24" in [r["network"] for r in coordinator.data.routes]


async def test_the_routes_a_poll_reads_are_counted_in_the_event_loop(
    hass, fake_client, entry, routes
):
    import threading

    coordinator = await _setup(hass, entry)
    seen = []
    note = coordinator._note_routes

    def counting(found):
        seen.append(threading.current_thread() is threading.main_thread())
        note(found)

    coordinator._note_routes = counting
    await _poll(hass, coordinator)

    assert seen == [True]
