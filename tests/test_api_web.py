"""The web-interface paths of the client and the connection check, without a box."""

import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from custom_components.fritzbox_network import connection_check
from custom_components.fritzbox_network.api import FritzNetworkClient


def _client(tls: bool = False) -> FritzNetworkClient:
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret", use_tls=tls)
    client._fc = MagicMock()
    return client


def test_web_data_renews_the_session_once_and_then_gives_up():
    client = _client()
    client._web_sid = "old"
    calls = []

    def post(path, data):
        calls.append(data["sid"])
        raise requests.ConnectionError("gone")

    client._web_post = post
    client._web_login = lambda: "new"

    with pytest.raises(requests.ConnectionError):
        client._web_data(page="x")

    assert calls == ["old", "new"]
    assert client._web_sid is None


def test_web_data_parses_the_answer():
    client = _client()
    client._web_sid = "sid"
    client._web_post = lambda path, data: json.dumps({"pid": "x"})

    assert client._web_data(page="x") == {"pid": "x"}


@pytest.mark.parametrize("tls", [False, True])
def test_the_stream_connection_follows_the_tls_setting(tls):
    connection = _client(tls)._new_connection()

    assert type(connection).__name__ == ("HTTPSConnection" if tls else "HTTPConnection")


def test_capture_interfaces_are_read_from_the_capture_page():
    client = _client()
    client._web_sid = "sid"
    connection = MagicMock()
    connection.getresponse.return_value.status = 200
    connection.getresponse.return_value.read.return_value = b"<html></html>"
    client._new_connection = lambda: connection

    with patch(
        "custom_components.fritzbox_network.api.parse_capture_interfaces", return_value=[{"a": "b"}]
    ):
        assert client.get_capture_interfaces() == [{"a": "b"}]
    connection.close.assert_called_once()


def test_capture_interfaces_fail_on_a_refusal():
    client = _client()
    client._web_sid = "sid"
    connection = MagicMock()
    connection.getresponse.return_value.status = 403
    client._new_connection = lambda: connection

    with pytest.raises(ValueError):
        client.get_capture_interfaces()
    connection.close.assert_called_once()


def test_stopping_captures_asks_the_box_and_swallows_errors():
    client = _client()
    connection = MagicMock()
    client._new_connection = lambda: connection

    client.stop_captures("sid")
    assert "stopall" in connection.request.call_args.args[1]

    connection.request.side_effect = OSError("down")
    client.stop_captures("sid")

    client._web_sid = None
    client._web_login = MagicMock(side_effect=PermissionError("no"))
    client.stop_captures()


def test_the_fixed_address_is_read_through_the_device_list():
    client = _client()
    pages = [
        {"data": {"active": [{"mac": "AA:BB:CC:DD:EE:01", "UID": "landevice1"}], "passive": []}},
        {"data": {"vars": {"dev": {"ipv4": {"dhcp": {"alwaysSameIp": True}}}}}},
    ]
    client._web_data = lambda **fields: pages.pop(0)

    result = client.get_ip_reservation("aa:bb:cc:dd:ee:01")

    assert result and result["fixed"] is True
    pages.append({"data": {"active": [], "passive": []}})
    assert client.get_ip_reservation("aa:bb:cc:dd:ee:99") is None


def test_the_fixed_address_is_none_when_the_box_fails():
    client = _client()
    client._web_data = MagicMock(side_effect=requests.ConnectionError("x"))

    assert client.get_ip_reservation("AA:BB:CC:DD:EE:01") is None


def test_reservations_are_kept_for_a_while():
    client = _client()
    client.get_ip_reservation = MagicMock(return_value={"fixed": False})

    client.get_ip_reservations(["m1"])
    client.get_ip_reservations(["m1"])

    assert client.get_ip_reservation.call_count == 1


def test_the_vpn_page_without_the_wanted_shape_is_none():
    client = _client()
    client._web_data = lambda **f: {"pid": "shareWireguard", "data": {}}
    assert client.get_vpn() is None
    client._web_data = lambda **f: {"pid": "other"}
    assert client.get_vpn() is None
    client._web_data = lambda **f: {
        "pid": "shareWireguard",
        "data": {"init": {"boxConnections": {"c": 1}}, "key": "secret"},
    }
    assert client.get_vpn() == {"data": {"init": {"boxConnections": {"c": 1}}}}


def test_reboot_and_reconnect_call_the_box():
    client = _client()
    client.reboot()
    client.reconnect()
    names = [c.args[1] for c in client._fc.call_action.call_args_list]
    assert names == ["Reboot", "ForceTermination"]


def test_box_port_prefers_the_entry_then_the_tls_default():
    assert connection_check.box_port({"port": 1234}) == 1234
    assert connection_check.box_port({"use_tls": True}) == 49443
    assert connection_check.box_port({}) == 49000


async def test_timed_reports_a_timeout_and_an_oserror(monkeypatch):
    monkeypatch.setattr(connection_check, "TIMEOUT", 0.01)

    async def slow():
        await asyncio.sleep(1)

    async def broken():
        raise OSError(111, "Connection refused")

    assert await connection_check._timed(slow()) == (False, None, "timeout")
    assert await connection_check._timed(broken()) == (False, None, "Connection refused")


async def test_the_verdict_names_dns_and_web(monkeypatch):
    async def ok(host, port):
        return None

    async def bad(name):
        raise OSError(1, "no name")

    monkeypatch.setattr(connection_check, "_connect", ok)
    monkeypatch.setattr(connection_check, "_resolve", bad)
    assert (await connection_check.run_checks("box", 1))["verdict"] == "dns"

    async def web_fails(host, port):
        if host == connection_check.TEST_NAME:
            raise OSError(1, "no")

    monkeypatch.setattr(connection_check, "_connect", web_fails)
    monkeypatch.setattr(connection_check, "_resolve", lambda n: ok(n, 0))
    assert (await connection_check.run_checks("box", 1))["verdict"] == "web"

    async def box_fails(host, port):
        if host == "box":
            raise OSError(1, "no")

    monkeypatch.setattr(connection_check, "_connect", box_fails)
    assert (await connection_check.run_checks("box", 1))["verdict"] == "box"
