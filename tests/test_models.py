"""Parsers against the anonymised capture of a FRITZ!Box 7590 AX."""

from custom_components.fritzbox_network.models import is_private_mac, parse_rights

from .conftest import BOX, LAN, OFFLINE, WLAN, FakeClient


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
