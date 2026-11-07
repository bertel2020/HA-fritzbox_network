"""The client against a mocked fritzconnection."""

import contextlib
import threading
import time
from unittest.mock import MagicMock, patch

from fritzconnection.core.exceptions import (
    FritzActionError,
    FritzArrayIndexError,
    FritzLookUpError,
    FritzServiceError,
)
import pytest

from custom_components.fritzbox_network.api import REQUEST_TIMEOUT, FritzNetworkClient


def _client() -> FritzNetworkClient:
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._fc.services = {"X_AVM-DE_HostFilter1": object()}
    client._fc.call_action.side_effect = FritzLookUpError("714")
    return client


def test_allowing_an_address_that_is_not_blocked_is_not_an_error():
    _client().set_internet_access("192.0.2.1", True)


def test_blocking_still_raises_on_a_lookup_error():
    with pytest.raises(FritzLookUpError):
        _client().set_internet_access("192.0.2.1", False)


def test_downloads_carry_a_timeout():
    client = _client()
    response = client._fc.session.get.return_value.__enter__.return_value
    response.text = "<x/>"

    assert client._download("/hosts.xml") == "<x/>"
    assert client._fc.session.get.call_args.kwargs["timeout"] == REQUEST_TIMEOUT


def test_polling_and_switching_never_talk_to_the_box_at_the_same_time():
    client = _client()
    inside = 0
    overlaps = 0
    guard = threading.Lock()

    def call_action(*args, **kwargs):
        nonlocal inside, overlaps
        with guard:
            inside += 1
            overlaps += inside > 1
        time.sleep(0.01)
        with guard:
            inside -= 1
        return {"NewX_AVM-DE_HostListPath": "/hosts.xml"}

    client._fc.call_action.side_effect = call_action
    client._fc.session.get.return_value.__enter__.return_value.text = "<List/>"

    workers = [threading.Thread(target=client.get_hosts) for _ in range(4)] + [
        threading.Thread(target=client.set_internet_access, args=("192.0.2.1", False))
        for _ in range(4)
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert overlaps == 0


def test_host_ip_asks_for_the_one_host():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewIPAddress": "192.0.2.7"}

    assert client.get_host_ip("02:00:00:00:00:03") == "192.0.2.7"
    client._fc.call_action.assert_called_once_with(
        "Hosts1", "GetSpecificHostEntry", NewMACAddress="02:00:00:00:00:03".upper()
    )


def test_host_ip_is_none_without_an_address_or_an_entry():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewIPAddress": ""}
    assert client.get_host_ip("02:00:00:00:00:03") is None

    client._fc.call_action.side_effect = FritzLookUpError("714")
    assert client.get_host_ip("02:00:00:00:00:03") is None


def test_filter_profiles_and_setting_one():
    client = _client()
    client._fc.services = {"X_AVM-DE_HostFilter1": object()}
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {
        "NewFilterProfileList": (
            "<List><Item><ProfileID>p1</ProfileID><Name>Kids</Name></Item></List>"
        )
    }

    assert client.get_filter_profiles() == {"p1": "Kids"}
    client.set_filter_profile("192.0.2.1", "p1")
    client._fc.call_action.assert_called_with(
        "X_AVM-DE_HostFilter1",
        "AddHostEntryToFilterProfile",
        NewIPv4Address="192.0.2.1",
        NewFilterProfileID="p1",
    )


def test_no_filter_profiles_without_the_service():
    client = _client()
    client._fc.services = {}

    assert client.get_filter_profiles() == {}


def _priority_client(argument_names):
    client = _client()
    client._fc.call_action.side_effect = None
    arguments = {n: MagicMock(direction="in") for n in argument_names}
    action = MagicMock(arguments=arguments)
    client._fc.services = {"Hosts1": MagicMock(actions={"X_AVM-DE_SetPrioritizationByIP": action})}
    return client


def test_priority_finds_the_argument_names_in_the_box_description():
    client = _priority_client(["NewPrioritization", "NewIPAddress"])

    client.set_priority("192.0.2.1", True)

    client._fc.call_action.assert_called_once_with(
        "Hosts1",
        "X_AVM-DE_SetPrioritizationByIP",
        NewIPAddress="192.0.2.1",
        NewPrioritization=True,
    )


def test_priority_refuses_arguments_it_does_not_understand():
    with pytest.raises(FritzServiceError):
        _priority_client(["NewA", "NewB"]).set_priority("192.0.2.1", True)


def test_auto_wake_on_lan_reads_and_writes_by_mac():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewAutoWOLEnabled": True}

    assert client.get_auto_wol("02:00:00:00:00:03") is True
    client.set_auto_wol("02:00:00:00:00:03", False)

    client._fc.call_action.assert_called_with(
        "Hosts1",
        "X_AVM-DE_SetAutoWakeOnLANByMACAddress",
        NewMACAddress="02:00:00:00:00:03".upper(),
        NewAutoWOLEnabled=False,
    )


def test_set_friendly_name_by_mac():
    client = _client()
    client._fc.call_action.side_effect = None

    client.set_friendly_name("02:00:00:00:00:03", "TV")

    client._fc.call_action.assert_called_once_with(
        "Hosts1",
        "X_AVM-DE_SetFriendlyNameByMAC",
        NewMACAddress="02:00:00:00:00:03".upper(),
        **{"NewX_AVM-DE_FriendlyName": "TV"},
    )


def test_connect_opens_the_connection_with_a_timeout():
    client = FritzNetworkClient("192.168.178.1", 49000, "user", "secret", use_tls=True)
    with patch("custom_components.fritzbox_network.api.FritzConnection") as connection:
        client.connect()

    assert connection.call_args.kwargs["timeout"] == REQUEST_TIMEOUT
    assert connection.call_args.kwargs["use_tls"] is True
    assert client.model_name == connection.return_value.modelname
    assert client.system_version == connection.return_value.system_version


def test_using_the_client_before_connecting_is_an_error():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    with pytest.raises(RuntimeError):
        _ = client.model_name


def test_serial_number_is_none_when_empty():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewSerialNumber": ""}
    assert client.serial_number is None
    client._fc.call_action.return_value = {"NewSerialNumber": "ABC"}
    assert client.serial_number == "ABC"


def test_can_write_needs_readwrite_box_admin():
    client = _client()
    client._fc.call_action.side_effect = None
    with patch("custom_components.fritzbox_network.api.parse_rights") as rights:
        rights.return_value = {"BoxAdmin": "readwrite"}
        assert client.can_write() is True
        rights.return_value = {"BoxAdmin": "readonly"}
        assert client.can_write() is False

    client._fc.call_action.side_effect = FritzActionError("denied")
    assert client.can_write() is False


def test_mesh_is_none_when_the_box_has_none():
    client = _client()
    client._fc.call_action.side_effect = FritzServiceError("no")
    assert client.get_mesh() is None


def test_mesh_is_downloaded_and_parsed():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewX_AVM-DE_MeshListPath": "/mesh.json"}
    client._fc.session.get.return_value.__enter__.return_value.text = '{"nodes": []}'

    assert client.get_mesh() is not None


@pytest.mark.parametrize(
    ("serial", "role", "expected"),
    [("ABC", "master", False), ("", "slave", False), ("021234567890", "slave", True)],
)
def test_repeater_is_found_by_the_serial_number(serial, role, expected):
    client = _client()
    node = MagicMock(macs=["02:12:34:56:78:90"], role=role)
    with (
        patch.object(
            FritzNetworkClient, "serial_number", new_callable=lambda: property(lambda s: serial)
        ),
        patch.object(FritzNetworkClient, "get_mesh", return_value=MagicMock(nodes={"n": node})),
    ):
        assert client.is_mesh_repeater() is expected


def test_no_mesh_means_no_repeater():
    client = _client()
    with (
        patch.object(
            FritzNetworkClient,
            "serial_number",
            new_callable=lambda: property(lambda s: "021234567890"),
        ),
        patch.object(FritzNetworkClient, "get_mesh", return_value=None),
    ):
        assert client.is_mesh_repeater() is False


def test_filter_profiles_are_empty_when_the_action_fails():
    client = _client()
    client._fc.call_action.side_effect = FritzActionError("no")
    assert client.get_filter_profiles() == {}


def test_setting_a_filter_profile_needs_the_service():
    client = _client()
    client._fc.services = {}
    with pytest.raises(FritzServiceError):
        client.set_filter_profile("192.0.2.1", "p1")
    with pytest.raises(FritzServiceError):
        client.set_internet_access("192.0.2.1", True)


def test_wake_on_lan_by_mac():
    client = _client()
    client._fc.call_action.side_effect = None

    client.wake_on_lan("02:00:00:00:00:03")

    client._fc.call_action.assert_called_once_with(
        "Hosts1", "X_AVM-DE_WakeOnLANByMACAddress", NewMACAddress="02:00:00:00:00:03".upper()
    )


def _guest_client(types: dict[str, str]) -> FritzNetworkClient:
    """A box whose WLANConfiguration services have these access point types."""
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    state = {"NewEnable": False}

    def call(service, action, **args):
        if service not in types:
            raise FritzServiceError("no such service")
        if action == "SetEnable":
            state["NewEnable"] = args["NewEnable"]
            return {}
        if action == "X_AVM-DE_GetWLANExtInfo":
            # as in the description of the box: the type is here and not in GetInfo
            return {"NewX_AVM-DE_APType": types[service], "NewX_AVM-DE_APEnabled": True}
        return dict(state)

    client._fc.call_action.side_effect = call
    return client


def test_the_guest_wifi_is_the_service_whose_type_says_so():
    client = _guest_client(
        {
            "WLANConfiguration1": "normal",
            "WLANConfiguration2": "normal",
            "WLANConfiguration3": "guest",
        }
    )
    assert client.get_guest_wifi() is False
    client.set_guest_wifi(True)
    assert client.get_guest_wifi() is True
    client._fc.call_action.assert_any_call("WLANConfiguration3", "SetEnable", NewEnable=True)
    # the services are searched once, not at every read
    searches = [
        c
        for c in client._fc.call_action.call_args_list
        if c.args[0] == "WLANConfiguration1" and c.args[1] == "X_AVM-DE_GetWLANExtInfo"
    ]
    assert len(searches) == 1


def test_a_box_without_a_guest_network_says_none_and_refuses_to_set_it():
    client = _guest_client({"WLANConfiguration1": "normal", "WLANConfiguration2": "normal"})
    assert client.get_guest_wifi() is None
    with pytest.raises(FritzServiceError):
        client.set_guest_wifi(True)


def _reconnect_client(services, error=None):
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._fc.services = dict.fromkeys(services)
    client._fc.call_action.side_effect = error
    return client


def test_reconnect_hangs_up_the_connection_the_box_has():
    client = _reconnect_client(["WANPPPConnection1"])
    client.reconnect()
    client._fc.call_action.assert_called_once_with("WANPPPConnection1", "ForceTermination")

    client = _reconnect_client(["WANIPConn1", "WANPPPConnection1"])
    client.reconnect()
    client._fc.call_action.assert_called_once_with("WANIPConn1", "ForceTermination")


def test_reconnect_accepts_that_the_box_is_already_hanging_up_but_not_other_refusals():
    # UPnP error 707: the disconnect is in progress, which is what was asked for
    _reconnect_client(
        ["WANIPConn1"], FritzActionError("UPnPError: errorCode: 707 DisconnectInProgress")
    ).reconnect()
    with pytest.raises(FritzActionError):
        _reconnect_client(["WANIPConn1"], FritzActionError("errorCode: 501")).reconnect()
    with pytest.raises(FritzServiceError):
        _reconnect_client([]).reconnect()


def test_the_guest_password_is_set_with_a_key_from_the_allowed_characters_and_no_wep_keys():
    client = _wifi_client(
        {"WLANConfiguration1": ("normal", "2400"), "WLANConfiguration2": ("guest", "2400")}
    )
    original = client._fc.call_action.side_effect

    def call(service, action, **args):
        if action == "GetInfo":
            return {"NewAllowedCharsPSK": "0123456789abcdef", "NewMaxCharsPSK": 64}
        return original(service, action, **args)

    client._fc.call_action.side_effect = call
    given = client.set_guest_wifi_password("pass word 1")
    assert given == "pass word 1"
    made = client.set_guest_wifi_password(None, 16)
    assert len(made) == 16 and all(c.isalnum() or c in "@#" for c in made)

    sets = [c for c in client._fc.call_action.call_args_list if c.args[1] == "SetSecurityKeys"]
    assert len(sets) == 2 and all(c.args[0] == "WLANConfiguration2" for c in sets)
    kwargs = sets[0].kwargs
    assert kwargs["NewKeyPassphrase"] == "pass word 1"
    assert len(kwargs["NewPreSharedKey"]) == 64
    assert set(kwargs["NewPreSharedKey"]) <= set("0123456789ABCDEF")
    assert [kwargs[f"NewWEPKey{i}"] for i in range(4)] == ["", "", "", ""]


def test_a_box_without_a_guest_network_has_no_password_to_set():
    client = _wifi_client({"WLANConfiguration1": ("normal", "2400")})
    with pytest.raises(FritzServiceError):
        client.set_guest_wifi_password("whatever 123")


def _port_client(rows, services=("WANPPPConnection1", "WANIPConn1"), fail_add=None):
    """A box whose connection services list these forwardings (a list of dicts)."""
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()

    def call(service, action, **args):
        if service not in services:
            raise FritzServiceError("no such service")
        if action == "GetPortMappingNumberOfEntries":
            return {"NewPortMappingNumberOfEntries": len(rows)}
        if action == "GetGenericPortMappingEntry":
            if args["NewPortMappingIndex"] >= len(rows):
                raise FritzArrayIndexError("713")
            return rows[args["NewPortMappingIndex"]]
        if action == "AddPortMapping":
            if fail_add:
                raise fail_add
            return {}
        raise AssertionError(action)

    client._fc.call_action.side_effect = call
    return client


WIREGUARD = {
    "NewRemoteHost": "0.0.0.0",
    "NewExternalPort": 51820,
    "NewProtocol": "UDP",
    "NewInternalPort": 51820,
    "NewInternalClient": "192.0.2.10",
    "NewEnabled": False,
    "NewPortMappingDescription": "Wireguard",
    "NewLeaseDuration": 0,
}


def test_the_forwardings_come_from_the_connection_service_that_has_them():
    # a DSL box: the PPP service lists them, the IP service does not know the action
    client = _port_client([WIREGUARD], services=("WANPPPConnection1",))
    rules = client.get_port_rules()
    assert list(rules) == ["udp_51820"]
    assert rules["udp_51820"].internal_client == "192.0.2.10"
    assert rules["udp_51820"].enabled is False
    assert all(c.args[0] == "WANPPPConnection1" for c in client._fc.call_action.call_args_list)

    cable = _port_client([WIREGUARD], services=("WANIPConn1",))
    assert list(cable.get_port_rules()) == ["udp_51820"]
    assert _port_client([WIREGUARD], services=()).get_port_rules() == {}


def test_switching_a_forwarding_enters_it_again_with_everything_else_unchanged():
    client = _port_client([WIREGUARD])
    client.set_port_rule_enabled("udp_51820", True)
    add = next(c for c in client._fc.call_action.call_args_list if c.args[1] == "AddPortMapping")
    assert add.args[0] == "WANPPPConnection1"
    assert add.kwargs == {
        "NewRemoteHost": "0.0.0.0",
        "NewExternalPort": 51820,
        "NewProtocol": "UDP",
        "NewInternalPort": 51820,
        "NewInternalClient": "192.0.2.10",
        "NewEnabled": "1",
        "NewPortMappingDescription": "Wireguard",
        "NewLeaseDuration": 0,
    }
    client.set_port_rule_enabled("udp_51820", False)
    adds = [c for c in client._fc.call_action.call_args_list if c.args[1] == "AddPortMapping"]
    assert adds[-1].kwargs["NewEnabled"] == "0"


def test_a_forwarding_that_is_gone_is_not_entered_again():
    client = _port_client([WIREGUARD])
    with pytest.raises(FritzServiceError):
        client.set_port_rule_enabled("tcp_1", True)
    assert not [c for c in client._fc.call_action.call_args_list if c.args[1] == "AddPortMapping"]


def test_forwardings_with_the_same_port_on_other_remote_hosts_have_other_keys():
    other = {**WIREGUARD, "NewRemoteHost": "203.0.113.5"}
    rules = _port_client([WIREGUARD, other]).get_port_rules()
    assert list(rules) == ["udp_51820", "udp_51820_203_0_113_5"]


def test_a_row_the_box_gives_without_its_target_is_left_out():
    broken = {k: v for k, v in WIREGUARD.items() if k != "NewInternalClient"}
    assert _port_client([broken]).get_port_rules() == {}


def _wifi_client(boxes: dict[str, tuple[str, str]], enabled: bool = True) -> FritzNetworkClient:
    """A box whose services have this (access point type, band), as X_AVM-DE_GetWLANExtInfo says."""
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()

    def call(service, action, **args):
        if service not in boxes:
            raise FritzServiceError("no such service")
        if action == "X_AVM-DE_GetWLANExtInfo":
            kind, band = boxes[service]
            return {"NewX_AVM-DE_APType": kind, "NewX_AVM-DE_FrequencyBand": band}
        if action == "SetEnable":
            return {}
        return {"NewEnable": enabled, "NewSSID": service, "NewBSSID": "AA", "NewStandard": "ax"}

    client._fc.call_action.side_effect = call
    return client


def test_the_wifi_networks_are_named_by_what_the_box_says_not_by_the_index():
    # the guest network is not the last one here, and the 5 GHz one is not the second
    client = _wifi_client(
        {
            "WLANConfiguration1": ("normal", "5000"),
            "WLANConfiguration2": ("guest", "2400"),
            "WLANConfiguration3": ("normal", "2400"),
        }
    )
    networks = client.get_wifi_networks()
    assert {k: v.ssid for k, v in networks.items()} == {
        "5ghz": "WLANConfiguration1",
        "2_4ghz": "WLANConfiguration3",
    }
    assert client.get_guest_wifi() is True
    client.set_wifi_enabled("5ghz", False)
    client._fc.call_action.assert_any_call("WLANConfiguration1", "SetEnable", NewEnable=False)
    client.set_guest_wifi(True)
    client._fc.call_action.assert_any_call("WLANConfiguration2", "SetEnable", NewEnable=True)


def test_a_second_service_on_a_band_or_an_unknown_band_gets_no_switch():
    client = _wifi_client(
        {
            "WLANConfiguration1": ("normal", "2400"),
            "WLANConfiguration2": ("normal", "5000"),
            "WLANConfiguration3": ("normal", "5000"),
            "WLANConfiguration4": ("normal", "60000"),
        }
    )
    assert client.get_wifi_networks().keys() == {"2_4ghz", "5ghz"}


def test_a_box_without_the_ext_info_has_no_wifi_networks_and_refuses_to_switch():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._fc.call_action.side_effect = FritzServiceError("no such service")
    assert client.get_wifi_networks() == {}
    with pytest.raises(FritzServiceError):
        client.set_wifi_enabled("5ghz", True)
    with pytest.raises(FritzServiceError):
        client.set_wifi_enabled("guest", True)


def test_the_port_mappings_are_read_until_the_box_runs_out():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    rows = [
        {
            "NewPortMappingDescription": "Web",
            "NewProtocol": "TCP",
            "NewExternalPort": 443,
            "NewInternalPort": 8443,
            "NewInternalClient": "192.0.2.10",
            "NewEnabled": True,
            "NewLeaseDuration": 0,
        },
        {"NewProtocol": "UDP", "NewExternalPort": 1, "NewInternalPort": 1, "NewEnabled": False},
    ]

    def call(service, action, **args):
        index = args["NewPortMappingIndex"]
        if index >= len(rows):
            raise FritzArrayIndexError("713")
        return rows[index]

    client._fc.call_action.side_effect = call
    entries = client.get_port_mappings()

    assert [e["external_port"] for e in entries] == [443, 1]
    assert entries[0]["description"] == "Web" and entries[0]["client"] == "192.0.2.10"
    assert entries[1]["description"] is None and entries[1]["enabled"] is False


def test_the_port_mappings_are_empty_where_the_box_has_no_upnp_service():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._fc.call_action.side_effect = FritzServiceError("no such service")
    assert client.get_port_mappings() == []


def test_the_routes_are_read_as_networks_and_say_nothing_of_type_or_status():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    rows = [
        {
            "NewEnable": False,
            "NewStatus": "Enabled",
            "NewType": "Host",
            "NewDestIPAddress": "10.8.0.0",
            "NewDestSubnetMask": "255.255.255.0",
            "NewSourceIPAddress": "0.0.0.0",
            "NewSourceSubnetMask": "0.0.0.0",
            "NewGatewayIPAddress": "192.0.2.5",
            "NewInterface": "LanHostConfigManagement1",
            "NewForwardingMetric": 0,
        },
        {
            "NewEnable": True,
            "NewDestIPAddress": "172.16.3.4",
            "NewDestSubnetMask": "255.255.0.0",
            "NewGatewayIPAddress": "0.0.0.0",
            "NewForwardingMetric": 20,
        },
    ]

    def call(service, action, **args):
        if action == "GetForwardNumberOfEntries":
            return {"NewForwardNumberOfEntries": 2}
        return rows[args["NewForwardingIndex"]]

    client._fc.call_action.side_effect = call
    routes = client.get_routes()

    assert [r["network"] for r in routes] == ["10.8.0.0/24", "172.16.0.0/16"]
    assert [r["enabled"] for r in routes] == [False, True]
    assert routes[0]["gateway"] == "192.0.2.5" and routes[1]["gateway"] is None
    assert routes[0]["source"] == "0.0.0.0" and routes[0]["source_mask"] == "0.0.0.0"
    assert routes[1]["metric"] == 20 and routes[0]["interface"] == "LanHostConfigManagement1"
    assert "status" not in routes[0] and "type" not in routes[0]


def test_the_routes_stop_where_the_box_runs_out_and_keep_an_odd_mask_readable():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()

    def call(service, action, **args):
        if action == "GetForwardNumberOfEntries":
            return {"NewForwardNumberOfEntries": 5}  # more than it lists
        if args["NewForwardingIndex"] > 0:
            raise FritzArrayIndexError("713")
        return {"NewDestIPAddress": "10.0.0.0", "NewDestSubnetMask": "bad", "NewEnable": True}

    client._fc.call_action.side_effect = call
    routes = client.get_routes()

    assert len(routes) == 1 and routes[0]["network"] == "10.0.0.0/bad"


def test_the_port_forwardings_set_by_hand_are_read_from_the_page_of_the_web_interface():
    import json
    from pathlib import Path

    page = json.loads(
        (Path(__file__).parent / "fixtures" / "portoverview.json").read_text(encoding="utf-8")
    )
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._web_data = MagicMock(return_value=page)

    rules = client.get_port_forwardings()

    client._web_data.assert_called_once_with(page="portoverview")
    assert [r["uid"] for r in rules] == ["forw1", "forw2", "forw3", "forw4", "forw5"]
    first, _, v4, v6, ranged = rules
    assert first["description"] == "OpenVPN" and first["protocol"] == "UDP"
    assert first["client"] == "192.168.178.40" and first["mac"] == "02:00:00:00:00:40"
    assert first["enabled"] is False and v4["enabled"] is True
    assert first["external_port"] == first["internal_port"] == 1194
    assert first["external_port_end"] is None and first["family"] == "ipv4"
    # a rule of IPv6 is for the address of the device, not for its IPv4 one
    assert v6["family"] == "ipv6" and v6["client"] == "2001:db8:0:1::4521"
    # a range keeps both ends, and the port at the device differs from the one from outside
    assert (ranged["external_port"], ranged["external_port_end"]) == (27015, 27030)
    assert (ranged["internal_port"], ranged["internal_port_end"]) == (27000, 27015)
    # rules that are no port rule (a MyFRITZ share) are not listed
    assert all(r["uid"] != "forw6" for r in rules)


def test_the_page_of_the_port_forwardings_is_none_where_it_is_not_the_expected_one():
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    for page in ({"pid": "overview"}, {"pid": "portoverview", "data": {}}, "x", None):
        client._web_data = MagicMock(return_value=page)
        assert client.get_port_forwardings() is None
    client._web_data = MagicMock(return_value={"pid": "portoverview", "data": {"devices": []}})
    assert client.get_port_forwardings() == []


def _internet_client(answers: dict[str, dict]) -> tuple[FritzNetworkClient, list[str]]:
    """A box that answers the actions named in ``answers`` and refuses all others."""
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    asked: list[str] = []

    def call(service, action, **args):
        asked.append(action)
        if action not in answers:
            raise FritzActionError("401")
        return answers[action]

    client._fc.call_action.side_effect = call
    return client, asked


def test_the_add_on_info_replaces_the_two_counter_actions():
    client, asked = _internet_client(
        {"GetStatusInfo": {"NewUptime": 1}, "GetAddonInfos": {"NewX_AVM_DE_TotalBytesSent64": 7}}
    )
    fast, slow = client.get_internet(details=False)
    assert set(fast) == {"GetStatusInfo", "GetAddonInfos"} and slow == {}
    assert "GetTotalBytesSent" not in asked


def test_a_box_without_the_add_on_info_is_asked_for_the_counters():
    client, asked = _internet_client(
        {
            "GetStatusInfo": {"NewUptime": 1},
            "GetTotalBytesSent": {"NewTotalBytesSent": 1},
            "GetTotalBytesReceived": {"NewTotalBytesReceived": 2},
        }
    )
    fast, _ = client.get_internet(details=False)
    assert set(fast) == {"GetStatusInfo", "GetTotalBytesSent", "GetTotalBytesReceived"}
    assert asked.count("GetAddonInfos") == 1


def test_the_web_login_asks_for_the_challenge_with_a_get():
    """A POST without a body is refused by the box with a plain text error."""
    from types import SimpleNamespace

    from custom_components.fritzbox_network.api import FritzNetworkClient, web_login_response

    challenge = "2$10$aa$10$bb"
    calls = []

    class Response:
        def __init__(self, text):
            self.text = text

        def raise_for_status(self):
            return None

    class Session:
        def get(self, url, **kwargs):
            calls.append(("get", url))
            sid = "0" * 16
            return Response(
                f"<SessionInfo><SID>{sid}</SID><Challenge>{challenge}</Challenge></SessionInfo>"
            )

        def post(self, url, data=None, **kwargs):
            calls.append(("post", url, data))
            if not data:
                return Response("getcgivars(): Unsupported Content-Type.\n")
            return Response("<SessionInfo><SID>0123456789abcdef</SID></SessionInfo>")

    client = FritzNetworkClient("192.0.2.1", None, "user", "secret")
    client._fc = SimpleNamespace(session=Session())  # noqa: SLF001

    assert client._web_login() == "0123456789abcdef"  # noqa: SLF001
    assert calls[0][0] == "get"
    assert calls[1][2]["response"] == web_login_response(challenge, "secret")


BOX_CLOSED = threading.Event()
STOPPED: list[str] = []


@contextlib.contextmanager
def _box(script):
    """A local web server that plays the capture of a box: ``script(handler)`` writes the answer."""
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def do_GET(self):  # noqa: N802
            if "iface=stopall" in self.path:
                STOPPED.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")
                return
            script(self)

        def log_message(self, *args):
            return None

    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = False  # server_close() waits for the handlers

    BOX_CLOSED.clear()
    STOPPED.clear()
    server = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"127.0.0.1:{server.server_port}"
    finally:
        BOX_CLOSED.set()
        server.shutdown()
        server.server_close()


def _capture(host, tmp_path, seconds, max_bytes=10_000_000, stop=None):
    import threading

    from custom_components.fritzbox_network.api import FritzNetworkClient

    client = FritzNetworkClient(host, None, "user", "secret")
    client._web_sid = "0123456789abcdef"  # noqa: SLF001
    path = tmp_path / "x.pcap"
    reason = client.capture(
        "1-lan", path, seconds, max_bytes, stop or threading.Event(), lambda n: None
    )
    return reason, path


PCAP_HEAD = b"\xd4\xc3\xb2\xa1" + b"\0" * 20


def _stream(handler, quiet=False):
    handler.send_response(200)
    handler.end_headers()
    handler.wfile.write(PCAP_HEAD)
    handler.wfile.flush()
    try:
        for _ in range(100):
            if BOX_CLOSED.wait(0.2):
                return
            if not quiet:
                handler.wfile.write(b"x" * 50)
                handler.wfile.flush()
    except OSError:
        return


@pytest.mark.usefixtures("socket_enabled")
def test_a_capture_answered_with_text_names_what_the_box_said(tmp_path):
    import pytest

    def refuse(handler):
        handler.send_response(200)
        handler.end_headers()
        handler.wfile.write(b"Permission denied for this user\n")

    with _box(refuse) as host, pytest.raises(ValueError, match="Permission denied"):
        _capture(host, tmp_path, 5)


@pytest.mark.usefixtures("socket_enabled")
def test_a_capture_that_never_ends_stops_when_the_time_is_up(tmp_path):
    started = time.monotonic()
    with _box(_stream) as host:
        reason, path = _capture(host, tmp_path, 1)

    assert reason == "time"
    assert time.monotonic() - started < 5
    assert len(STOPPED) == 1  # the box was told to end the capture
    assert path.read_bytes().startswith(PCAP_HEAD)


@pytest.mark.usefixtures("socket_enabled")
def test_a_quiet_capture_stops_when_the_user_stops_it(tmp_path):
    import threading

    stop = threading.Event()
    threading.Timer(0.5, stop.set).start()
    started = time.monotonic()
    with _box(lambda h: _stream(h, quiet=True)) as host:
        reason, _ = _capture(host, tmp_path, 60, stop=stop)

    assert reason == "stopped"
    assert time.monotonic() - started < 5


@pytest.mark.usefixtures("socket_enabled")
def test_a_capture_stops_at_the_size_limit(tmp_path):
    with _box(_stream) as host:
        reason, path = _capture(host, tmp_path, 30, max_bytes=100)

    assert reason == "size"
    assert path.stat().st_size >= 100


@pytest.mark.usefixtures("socket_enabled")
def test_the_modified_tcpdump_header_of_the_box_is_accepted(tmp_path):
    import struct

    head = struct.pack(">IHHiIII", 0xA1B2CD34, 2, 4, 0, 0, 2048, 1)

    def modified(handler):
        handler.send_response(200)
        handler.end_headers()
        handler.wfile.write(head)

    with _box(modified) as host:
        reason, path = _capture(host, tmp_path, 5)

    assert reason in ("time", "stopped")
    assert path.read_bytes() == head
