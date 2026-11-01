"""Parsers against the anonymised capture of a FRITZ!Box 7590 AX."""

import json

import pytest

from custom_components.fritzbox_network.models import (
    is_private_mac,
    parse_hosts,
    parse_mesh,
    parse_rights,
)

from .conftest import BOX, FIXTURES, LAN, OFFLINE, WLAN, FakeClient


def test_hosts_and_mesh():
    client = FakeClient()
    hosts = {h.mac: h for h in client.hosts}

    assert len(hosts) == 8
    assert hosts[WLAN].active and hosts[WLAN].interface_type == "802.11"
    assert not hosts[OFFLINE].active and hosts[OFFLINE].interface_type is None

    mesh = client.mesh
    assert mesh.master.mac == BOX
    assert {n.role for n in mesh.nodes.values()} == {"master", "slave"}
    assert mesh.links[WLAN].link_type == "WLAN"
    assert mesh.links[WLAN].ap_name == "FRITZ!Repeater 1200 AX"
    assert mesh.links[LAN].link_type == "LAN" and mesh.links[LAN].ap_uid == mesh.master.uid
    assert OFFLINE not in mesh.links


def test_rights_and_private_mac():
    rights = parse_rights(
        "<rights><path>BoxAdmin</path><access>readwrite</access>"
        "<path>Phone</path><access>none</access></rights>"
    )
    assert rights == {"BoxAdmin": "readwrite", "Phone": "none"}
    assert is_private_mac("3a:2a:f4:a1:b2:c3")
    assert not is_private_mac("3c:2a:f4:a1:b2:c3")


def test_signal_rates_band_and_network_name_of_a_wlan_link():
    mesh = FakeClient().mesh

    wlan = mesh.links[WLAN]
    assert wlan.signal_dbm is not None and -100 < wlan.signal_dbm < 0
    assert wlan.rate_download > 0 and wlan.rate_upload > 0
    assert wlan.band in ("2_4ghz", "5ghz") and wlan.ssid

    lan = mesh.links[LAN]
    assert lan.signal_dbm is None and lan.band is None and lan.ssid is None
    assert lan.rate_download >= 100


def test_hosts_skip_entries_with_an_invalid_mac():
    hosts = parse_hosts(
        "<List>"
        "<Item><MACAddress>not-a-mac</MACAddress></Item>"
        "<Item><MACAddress></MACAddress></Item>"
        "<Item><MACAddress>02:00:00:00:00:01</MACAddress>"
        "<X_AVM-DE_MACAddressList>junk,02:00:00:00:00:02</X_AVM-DE_MACAddressList></Item>"
        "<Item><MACAddress>02:00:00:00:00:03</MACAddress>"
        "<X_AVM-DE_MACAddressList>junk</X_AVM-DE_MACAddressList></Item>"
        "</List>"
    )

    assert [h.mac for h in hosts] == ["02:00:00:00:00:01", "02:00:00:00:00:03"]
    assert hosts[0].mac_list == ["02:00:00:00:00:02"]
    assert hosts[1].mac_list == ["02:00:00:00:00:03"]


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"nodes": None},
        {"nodes": "x"},
        {"nodes": [None, 1, "x", {}]},
        {"nodes": [{"uid": "n", "is_meshed": True, "device_mac_address": "junk"}]},
        {"nodes": [{"uid": "n", "node_interfaces": None}]},
        {"nodes": [{"uid": "n", "node_interfaces": [{"uid": "i", "node_links": None}]}]},
        {"nodes": [{"uid": "n", "node_interfaces": [{"uid": "i", "node_links": [{}, 3]}]}]},
        {
            "nodes": [
                {
                    "uid": "n",
                    "node_interfaces": [
                        {"uid": "i", "node_links": [{"uid": "l", "state": "CONNECTED"}]}
                    ],
                }
            ]
        },
    ],
)
def test_mesh_tolerates_unexpected_shapes(raw):
    mesh = parse_mesh(json.dumps(raw))

    assert mesh.links == {}
    assert mesh.nodes == {}


def test_mesh_rejects_something_that_is_no_object():
    with pytest.raises(ValueError, match="not a JSON object"):
        parse_mesh("[]")


def test_mesh_link_to_a_client_with_an_invalid_mac_is_dropped():
    raw = json.loads((FIXTURES / "mesh.json").read_text())
    for node in raw["nodes"]:
        if node.get("device_mac_address") == WLAN:
            node["device_mac_address"] = "junk"

    assert WLAN not in parse_mesh(json.dumps(raw)).links
