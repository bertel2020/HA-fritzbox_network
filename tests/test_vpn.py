"""The WireGuard connections of the box: read, as sensors and for the panel."""

from __future__ import annotations

import json
from pathlib import Path

from custom_components.fritzbox_network.models import parse_vpn

COMMAND = "fritzbox_network/subscribe_topology"
PAGE = json.loads((Path(__file__).parent / "fixtures" / "vpn.json").read_text())


def test_the_connections_are_read_devices_after_links_and_secrets_stay_out():
    found = parse_vpn(PAGE)

    assert [(c.name, c.kind) for c in found] == [
        ("Holiday house", "site"),
        ("Anna iPhone", "device"),
        ("Bob laptop", "device"),
        ("Old tablet", "device"),
    ]
    anna = next(c for c in found if c.name == "Anna iPhone")
    assert (anna.connected, anna.active, anna.since) == (True, True, 1793823044)
    assert anna.remote_endpoint == "203.0.113.5:4000"
    # a connection that is not up has no time and no address of the other side
    bob = next(c for c in found if c.name == "Bob laptop")
    assert (bob.connected, bob.active, bob.since, bob.remote_endpoint) == (False, True, None, None)
    assert "SECRET" not in repr(found)


def test_a_box_without_the_page_or_the_list_gives_none_and_an_empty_list_is_kept():
    assert parse_vpn(None) is None
    assert parse_vpn({"pid": "overview", "data": {}}) is None
    assert parse_vpn({"data": {"init": {"boxConnections": {}}}}) == []


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_each_connection_is_a_sensor_that_is_on_while_the_tunnel_stands(
    hass, fake_client, entry
):
    fake_client.vpn = {"data": {"init": {"boxConnections": PAGE["data"]["init"]["boxConnections"]}}}
    await _setup(hass, entry)

    states = {
        s.attributes["friendly_name"]: s
        for s in hass.states.async_all("binary_sensor")
        if s.attributes.get("kind") in ("device", "site")
    }
    assert {n.split(" VPN ")[-1] for n in states} == {
        "Holiday house",
        "Anna iPhone",
        "Bob laptop",
        "Old tablet",
    }
    by_name = {n.split(" VPN ")[-1]: s for n, s in states.items()}
    assert by_name["Anna iPhone"].state == "on"
    assert by_name["Bob laptop"].state == "off"
    assert by_name["Bob laptop"].attributes["enabled"] is True
    assert by_name["Old tablet"].attributes["enabled"] is False
    assert by_name["Anna iPhone"].attributes["connected_since"].startswith("2026-")


async def test_a_box_without_connections_has_no_sensor_and_the_panel_gets_none(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)

    assert not [s for s in hass.states.async_all("binary_sensor") if "kind" in s.attributes]
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": COMMAND, "entry_id": entry.entry_id})
    await client.receive_json()
    event = await client.receive_json()
    assert event["event"]["vpn"] is None


async def test_the_panel_gets_the_connections_without_any_key(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.vpn = {"data": {"init": {"boxConnections": PAGE["data"]["init"]["boxConnections"]}}}
    await _setup(hass, entry)

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": COMMAND, "entry_id": entry.entry_id})
    await client.receive_json()
    event = await client.receive_json()
    vpn = event["event"]["vpn"]
    assert [c["name"] for c in vpn] == ["Holiday house", "Anna iPhone", "Bob laptop", "Old tablet"]
    assert vpn[0] == {
        "uid": "vpnconnection9003",
        "name": "Holiday house",
        "kind": "site",
        "enabled": True,
        "connected": True,
        "since": 1793823044,
        "remote_net": "192.0.2.0/24",
        "remote_endpoint": "198.51.100.9:13729",
        "editable": True,
    }
    assert "SECRET" not in json.dumps(event)


async def test_a_failing_read_keeps_what_was_known(hass, fake_client, entry):
    fake_client.vpn = {"data": {"init": {"boxConnections": PAGE["data"]["init"]["boxConnections"]}}}
    coordinator = await _setup(hass, entry)
    known = coordinator.data.vpn

    def broken():
        raise OSError("gone")

    fake_client.get_vpn = broken
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert coordinator.data.vpn == known


# --- switching ---

from unittest.mock import MagicMock  # noqa: E402

from homeassistant.exceptions import HomeAssistantError  # noqa: E402
import pytest  # noqa: E402

from custom_components.fritzbox_network import coordinator as coordinator_module  # noqa: E402
from custom_components.fritzbox_network.api import FritzNetworkClient  # noqa: E402

SWITCH = "fritzbox_network/vpn/switch"


def _box(fake_client):
    import copy

    fake_client.vpn = {
        "data": {"init": {"boxConnections": copy.deepcopy(PAGE["data"]["init"]["boxConnections"])}}
    }


@pytest.fixture(autouse=True)
def no_wait():
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(coordinator_module, "VPN_VERIFY_SECONDS", 0)
        yield


def _switch_id(hass, name):
    return next(
        s.entity_id
        for s in hass.states.async_all("switch")
        if s.attributes.get("friendly_name", "").endswith(f"VPN {name} enabled")
    )


async def test_the_switch_turns_a_connection_off_and_shows_what_the_box_reports(
    hass, fake_client, entry
):
    _box(fake_client)
    await _setup(hass, entry)
    entity = _switch_id(hass, "Anna iPhone")
    assert hass.states.get(entity).state == "on"

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity}, blocking=True)

    assert ("vpn", "vpnconnection9001", False) in fake_client.calls
    assert hass.states.get(entity).state == "off"
    # the connection that was off can be switched on
    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": _switch_id(hass, "Old tablet")}, blocking=True
    )
    assert ("vpn", "vpnconnection9002", True) in fake_client.calls


async def test_a_box_that_does_not_take_the_change_makes_the_action_fail(hass, fake_client, entry):
    _box(fake_client)
    await _setup(hass, entry)
    fake_client.vpn_ignores = True
    entity = _switch_id(hass, "Anna iPhone")

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call("switch", "turn_off", {"entity_id": entity}, blocking=True)
    assert hass.states.get(entity).state == "on"


async def test_a_refusal_of_the_box_is_an_error_for_the_caller(hass, fake_client, entry):
    _box(fake_client)
    await _setup(hass, entry)
    fake_client.fail_actions = True

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "switch", "turn_off", {"entity_id": _switch_id(hass, "Anna iPhone")}, blocking=True
        )


async def test_without_the_right_to_write_there_is_no_switch(hass, fake_client, entry):
    _box(fake_client)
    fake_client.writable = False
    await _setup(hass, entry)

    assert not [
        s
        for s in hass.states.async_all("switch")
        if s.attributes.get("friendly_name", "").endswith("enabled")
    ]


async def test_the_panel_command_switches_and_needs_the_right_and_a_known_connection(
    hass, hass_ws_client, fake_client, entry
):
    _box(fake_client)
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": SWITCH, "entry_id": entry.entry_id, "uid": "vpnconnection9001", "enabled": False}
    )
    assert (await client.receive_json())["success"] is True
    assert ("vpn", "vpnconnection9001", False) in fake_client.calls

    await client.send_json_auto_id(
        {"type": SWITCH, "entry_id": entry.entry_id, "uid": "nope", "enabled": True}
    )
    assert (await client.receive_json())["success"] is False


def test_the_client_puts_the_switch_to_the_rest_path_with_the_session_id():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._web_sid = "0123456789abcdef"
    put = client._fc.session.put
    put.return_value.status_code = 200

    client.set_vpn("vpnconnection9001", False)

    url = put.call_args.args[0]
    assert url.endswith("/api/v0/generic/vpn/connection/vpnconnection9001")
    assert put.call_args.kwargs["json"] == {"activated": 0}
    assert put.call_args.kwargs["headers"]["Authorization"] == "AVM-SID 0123456789abcdef"


def test_the_client_renews_a_dropped_session_once_and_refuses_odd_identifiers():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._web_sid = "old"
    client._web_login = MagicMock(return_value="new")
    dropped, fine = MagicMock(status_code=403), MagicMock(status_code=200)
    client._fc.session.put.side_effect = [dropped, fine]

    client.set_vpn("vpnconnection9001", True)

    assert client._fc.session.put.call_args.kwargs["headers"]["Authorization"] == "AVM-SID new"
    with pytest.raises(ValueError):
        client.set_vpn("../x", True)


# --- an empty answer of the box ---


async def test_an_empty_or_missing_list_is_believed_only_after_three_polls(
    hass, fake_client, entry
):
    _box(fake_client)
    coordinator = await _setup(hass, entry)
    assert len(coordinator.data.vpn) == 4

    fake_client.vpn = {"data": {"init": {"boxConnections": {}}}}
    for _ in range(2):
        await coordinator.async_refresh()
        assert len(coordinator.data.vpn) == 4
    await coordinator.async_refresh()
    assert coordinator.data.vpn == []

    # the same for a page the box does not give (dropped session, start-up)
    _box(fake_client)
    await coordinator.async_refresh()
    assert len(coordinator.data.vpn) == 4
    fake_client.vpn = None
    for _ in range(2):
        await coordinator.async_refresh()
        assert len(coordinator.data.vpn) == 4
    await coordinator.async_refresh()
    assert coordinator.data.vpn is None


async def test_a_list_that_comes_back_resets_the_count(hass, fake_client, entry):
    _box(fake_client)
    coordinator = await _setup(hass, entry)
    gone = {"data": {"init": {"boxConnections": {}}}}
    good = fake_client.vpn
    for answer in (gone, gone, good, gone, gone):
        fake_client.vpn = answer
        await coordinator.async_refresh()
    assert len(coordinator.data.vpn) == 4


# --- the box renumbers ---


async def test_a_connection_that_is_now_another_one_is_not_switched(hass, fake_client, entry):
    _box(fake_client)
    await _setup(hass, entry)
    entity = _switch_id(hass, "Anna iPhone")
    # a connection was deleted on the box: the identifier now belongs to another one
    fake_client.vpn["data"]["init"]["boxConnections"]["connection1"]["name"] = "Someone else"
    coordinator = hass.config_entries.async_entries("fritzbox_network")[0].runtime_data
    await coordinator.async_refresh()

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call("switch", "turn_off", {"entity_id": entity}, blocking=True)
    assert ("vpn", "vpnconnection9001", False) not in fake_client.calls
