"""Parsers against the anonymised capture of a FRITZ!Box 7590 AX."""

import json

import pytest

from custom_components.fritzbox_network.models import (
    Radio,
    _radios,
    is_private_mac,
    parse_filter_profiles,
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


def test_filter_profiles_are_read_loosely():
    xml = (
        "<List><Item><ProfileID>filtprof1</ProfileID><ProfileName>Standard</ProfileName></Item>"
        "<Item><ProfileID>filtprof2</ProfileID><Name>Kids</Name></Item>"
        "<Item><ID>filtprof3</ID></Item><Item><Other>x</Other></Item></List>"
    )

    assert parse_filter_profiles(xml) == {
        "filtprof1": "Standard",
        "filtprof2": "Kids",
        "filtprof3": "filtprof3",
    }
    assert parse_filter_profiles("") == {}
    assert parse_filter_profiles("not xml") == {}


def test_hosts_carry_their_access_profile():
    hosts = parse_hosts(
        "<List><Item><MACAddress>02:00:00:00:00:01</MACAddress>"
        "<X_AVM-DE_FilterProfileID>filtprof2</X_AVM-DE_FilterProfileID></Item></List>"
    )

    assert hosts[0].filter_profile == "filtprof2"


def test_hosts_say_whether_their_name_can_be_changed():
    xml = (
        "<List>"
        "<Item><MACAddress>02:00:00:00:00:01</MACAddress>"
        "<X_AVM-DE_FriendlyNameIsWriteable>1</X_AVM-DE_FriendlyNameIsWriteable></Item>"
        "<Item><MACAddress>02:00:00:00:00:02</MACAddress>"
        "<X_AVM-DE_FriendlyNameIsWriteable>0</X_AVM-DE_FriendlyNameIsWriteable></Item>"
        "<Item><MACAddress>02:00:00:00:00:03</MACAddress></Item></List>"
    )

    assert [h.name_writeable for h in parse_hosts(xml)] == [True, False, None]


def test_radios_of_the_access_points_by_band():
    mesh = FakeClient().mesh

    box = mesh.master.radios
    assert set(box) == {"2_4ghz", "5ghz"}
    assert (box["2_4ghz"].channel, box["2_4ghz"].utilization, box["2_4ghz"].noise_dbm) == (
        11,
        4,
        -86,
    )
    repeater = next(n for n in mesh.nodes.values() if n.role == "slave")
    assert repeater.radios["5ghz"].channel == 112
    assert repeater.radios["2_4ghz"].utilization == 19


def test_radios_ignore_what_is_not_a_number_and_what_is_not_the_own_network():
    node = {
        "node_interfaces": [
            {
                "type": "WLAN",
                "opmode": "AP",
                "current_channel": "x",
                "channel_utilization": True,
                "anpi": None,
                "current_channel_info": {"primary_freq": 2412000},
            },
            {
                "type": "WLAN",
                "opmode": "STATION",
                "current_channel_info": {"primary_freq": 5180000},
            },
            {"type": "WLAN", "opmode": "AP", "current_channel_info": {}},
            {"type": "LAN", "opmode": "AP", "current_channel_info": {"primary_freq": 5180000}},
        ]
    }

    assert _radios(node) == {"2_4ghz": Radio(None, None, None)}


def test_built_in_filter_profiles_are_named_after_their_type():
    xml = (
        "<FilterProfileList>"
        "<FilterProfile><FilterProfileID>filtprof2</FilterProfileID><Name></Name>"
        "<FilterProfileType>Guest</FilterProfileType></FilterProfile>"
        "<FilterProfile><FilterProfileID>filtprof1</FilterProfileID><Name></Name>"
        "<FilterProfileType>Standard</FilterProfileType></FilterProfile>"
        "<FilterProfile><FilterProfileID>filtprof3</FilterProfileID><Name></Name>"
        "<FilterProfileType>Unrestricted</FilterProfileType></FilterProfile>"
        "<FilterProfile><FilterProfileID>filtprof7301</FilterProfileID><Name>Samsung OTN</Name>"
        "<FilterProfileType>Personal</FilterProfileType></FilterProfile>"
        "<FilterProfile><FilterProfileID>filtprof9</FilterProfileID><Name></Name>"
        "<FilterProfileType>Personal</FilterProfileType></FilterProfile>"
        "</FilterProfileList>"
    )

    assert parse_filter_profiles(xml) == {
        "filtprof2": "Guest",
        "filtprof1": "Standard",
        "filtprof3": "Unrestricted",
        "filtprof7301": "Samsung OTN",
        "filtprof9": "filtprof9",
    }


def test_the_edit_form_of_a_device_says_whether_its_ip_is_fixed():
    from custom_components.fritzbox_network.models import parse_ip_form

    def form(fixed, editable=True):
        return {
            "data": {
                "vars": {"dev": {"ipv4": {"editable": editable, "dhcp": {"alwaysSameIp": fixed}}}}
            }
        }

    assert parse_ip_form(form(True)) == {"fixed": True, "editable": True}
    assert parse_ip_form(form(False, False)) == {"fixed": False, "editable": False}
    assert parse_ip_form({"data": {"vars": {"dev": {}}}}) is None
    assert parse_ip_form(None) is None


def test_the_login_of_the_web_interface_answers_both_kinds_of_challenge():
    from custom_components.fritzbox_network.api import web_login_response

    assert web_login_response("1234567z", "äbc") == "1234567z-9e224a41eeefa284df7bb0f26c2913e2"
    answer = web_login_response("2$10000$aabbccdd$2000$11223344", "geheim")
    assert answer.startswith("11223344$") and len(answer) == 9 + 64


def test_the_event_log_is_read_with_its_groups_and_limited():
    from custom_components.fritzbox_network.models import parse_device_log

    xml = (
        "<Root>"
        "<Event><id>1</id><group>net</group><date>04.11.26</date><time>10:00:01</time>"
        "<msg>Internet connection established </msg></Event>"
        "<Event><id>2</id><group>wlan</group><date>04.11.26</date><time>09:00:00</time>"
        "<msg>Wi-Fi</msg></Event></Root>"
    )

    events = parse_device_log(xml)
    assert [e["group"] for e in events] == ["net", "wlan"]
    assert events[0]["msg"] == "Internet connection established"
    assert len(parse_device_log(xml, limit=1)) == 1


def test_the_capture_interfaces_are_read_from_the_page_without_the_buttons():
    from custom_components.fritzbox_network.models import parse_capture_interfaces

    html = (
        "<table><tr><td>1. Internetverbindung</td><td>"
        '<button type="submit" name="start" id="uiStart_2-1" value="2-1">Start</button>'
        '<button type="submit" name="stop" value="2;1;x">Stopp</button></td></tr>'
        "<tr><td> lan </td><td>"
        '<button type="submit" name="start" value="1-lan">Start</button></td></tr>'
        "<tr><td>no start button here</td></tr></table>"
    )

    assert parse_capture_interfaces(html) == [
        {"id": "2-1", "label": "1. Internetverbindung"},
        {"id": "1-lan", "label": "lan"},
    ]


def test_only_the_interfaces_worth_offering_are_kept_and_grouped():
    from custom_components.fritzbox_network.capture import curate_interfaces

    found = [
        {"id": i, "label": i}
        for i in (
            "1-traceDH0",
            "3-0",
            "1-vap0",
            "1-lan",
            "1-eth10",
            "1-eth2",
            "2-3",
            "2-1",
            "4-128",
            "1-vap0_r3",
            "1-guest",
            "1-wlan0",
        )
    ]

    offered = curate_interfaces(found)

    assert [(i["id"], i["group"]) for i in offered] == [
        ("2-1", "internet"),
        ("2-3", "internet"),
        ("1-eth2", "lan"),
        ("1-eth10", "lan"),
        ("1-lan", "lan"),
        ("1-guest", "wlan"),
        ("1-vap0", "wlan"),
        ("3-0", "routing"),
    ]
