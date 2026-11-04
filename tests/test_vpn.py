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
