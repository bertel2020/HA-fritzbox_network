"""The client against a mocked fritzconnection."""

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
        return {"NewX_AVM-DE_APType": types[service], **state}

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
        c for c in client._fc.call_action.call_args_list if c.args[0] == "WLANConfiguration1"
    ]
    assert len(searches) == 1


def test_a_box_without_a_guest_network_says_none_and_refuses_to_set_it():
    client = _guest_client({"WLANConfiguration1": "normal", "WLANConfiguration2": "normal"})
    assert client.get_guest_wifi() is None
    with pytest.raises(FritzServiceError):
        client.set_guest_wifi(True)


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


def _capture_client(monkeypatch, chunks):
    from custom_components.fritzbox_network import api

    class Response:
        headers = {"Content-Type": "application/octet-stream"}

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size=None):
            yield from chunks

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(api.requests, "get", lambda *a, **k: Response())
    client = api.FritzNetworkClient("192.0.2.1", None, "user", "secret")
    client._web_sid = "0123456789abcdef"  # noqa: SLF001
    return client


def test_a_capture_answered_with_text_names_what_the_box_said(monkeypatch, tmp_path):
    import threading

    import pytest

    client = _capture_client(monkeypatch, [b"Permission denied for this user\n"])
    with pytest.raises(ValueError, match="Permission denied"):
        client.capture("1-lan", tmp_path / "x.pcap", 5, 10_000, threading.Event(), lambda n: None)


def test_a_capture_stops_at_the_size_limit(monkeypatch, tmp_path):
    import threading

    head = b"\xd4\xc3\xb2\xa1" + b"\0" * 20
    client = _capture_client(monkeypatch, [head, b"x" * 100, b"y" * 100])
    path = tmp_path / "x.pcap"

    reason = client.capture("1-lan", path, 5, 100, threading.Event(), lambda n: None)

    assert reason == "size"
    assert path.read_bytes().startswith(head)
