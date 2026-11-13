"""The websocket commands behind the Box and WLAN pages of the panel."""

import base64

import pytest

from .conftest import REPEATER  # noqa: F401  (the mesh of the fixtures)


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def _call(client, entry, command, **data):
    await client.send_json_auto_id(
        {"type": f"fritzbox_network/{command}", "entry_id": entry.entry_id, **data}
    )
    return await client.receive_json()


async def test_box_info_tells_the_box_itself(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, entry, "box/info"))["result"]

    assert result["model"] == "FRITZ!Box 7590 AX"
    assert result["firmware"] == "8.25"
    assert result["cpu_temperature"] == 72
    assert (result["cpu_load"], result["ram_usage"]) == (12, 37)
    assert result["line"] == {"linked": True, "access_type": "DSL"}
    assert result["uptime_seconds"] == pytest.approx(3 * 3600, abs=120)
    assert result["last_restart"] is not None
    assert result["can_write"] is True
    assert isinstance(result["bytes_received"], int)


async def test_box_info_leaves_out_what_the_box_does_not_say(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.cpu_temperature = None
    fake_client.utilization = None
    fake_client.uptime = None
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, entry, "box/info"))["result"]

    assert result["cpu_temperature"] is None
    assert result["cpu_load"] is None and result["ram_usage"] is None
    assert result["last_restart"] is None and result["uptime_seconds"] is None
    assert result["can_write"] is False


async def test_the_wlan_list_has_the_networks_and_no_password(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, entry, "wlan/list"))["result"]

    assert [n["key"] for n in result["networks"]] == ["2_4ghz", "5ghz"]
    assert result["networks"][1]["band"] == "5" and result["networks"][1]["ssid"] == "Home"
    assert result["guest"] == {"enabled": False, "ssid": "Gast"}
    assert "geheim" not in str(result)


async def test_a_wlan_network_is_switched_and_the_list_comes_back(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = await _call(client, entry, "wlan/switch", key="5ghz", enabled=False)
    assert result["success"]
    assert ("wifi", "5ghz", False) in fake_client.calls
    guest = await _call(client, entry, "wlan/switch", key="guest", enabled=True)
    assert guest["success"]
    assert ("guest_wifi", True) in fake_client.calls


async def test_switching_needs_the_right_and_a_known_key(hass, hass_ws_client, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    refused = await _call(client, entry, "wlan/switch", key="5ghz", enabled=False)
    assert not refused["success"] and refused["error"]["code"] == "unauthorized"
    assert not any(call[0] == "wifi" for call in fake_client.calls)
    wrong = await _call(client, entry, "wlan/switch", key="7ghz", enabled=False)
    assert not wrong["success"]


async def test_the_guest_secret_comes_with_a_qr_code_and_only_for_those_who_may(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = (await _call(client, entry, "wlan/guest/secret"))["result"]

    assert result["ssid"] == "Gast" and result["password"] == "geheim 123"
    assert base64.b64decode(result["qr_png_base64"]).startswith(b"\x89PNG")


async def test_the_guest_secret_is_refused_without_the_right_or_a_guest_network(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    refused = await _call(client, entry, "wlan/guest/secret")
    assert refused["error"]["code"] == "unauthorized"
    assert ("guest_secret",) not in fake_client.calls


async def test_the_guest_password_is_set_given_or_made(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    given = await _call(client, entry, "wlan/guest/password", password="ein neues passwort")
    assert given["result"] == {"password": "ein neues passwort"}
    made = await _call(client, entry, "wlan/guest/password", length=16)
    assert len(made["result"]["password"]) == 16


@pytest.mark.parametrize("password", ["short", "x" * 64, "umlaut ä ö ü 123"])
async def test_a_guest_password_must_be_8_to_63_ascii_characters(
    hass, hass_ws_client, fake_client, entry, password
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    result = await _call(client, entry, "wlan/guest/password", password=password)

    assert not result["success"]
    assert not any(call[0] == "guest_password" for call in fake_client.calls)


async def test_box_info_is_an_error_while_the_box_does_not_answer(
    hass, hass_ws_client, fake_client, entry, monkeypatch
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    def _down():
        raise OSError("no route")

    monkeypatch.setattr(fake_client, "read_uptime", _down)
    result = await _call(client, entry, "box/info")

    assert not result["success"]
    assert result["error"]["code"] == "unknown_error"
