"""The QR code of the guest Wi-Fi: the drawing, the data from the box and the image entity."""

import logging

from homeassistant.components.image import async_get_image
from homeassistant.helpers import entity_registry as er

from custom_components.fritzbox_network.wifi_qr import security_of, wifi_qr_png

ENTITY = "image.fritz_network_guest_wifi_qr"


def test_the_beacon_type_tells_the_security_and_an_unknown_one_is_open():
    assert security_of("11iandWPA3") == "WPA"
    assert security_of("Basic") == "WEP"
    assert security_of("OWETrans") == "nopass"
    assert security_of("something new") == "nopass"
    assert security_of(None) == "nopass"


def test_the_picture_is_a_png_that_does_not_change_for_the_same_input():
    first = wifi_qr_png("Gast", "geheim 123", "WPA")
    assert first.startswith(b"\x89PNG")
    assert wifi_qr_png("Gast", "geheim 123", "WPA") == first
    assert wifi_qr_png("Gast", "anders 456", "WPA") != first


def test_an_open_network_leaves_the_password_out():
    assert wifi_qr_png("Gast", "geheim 123", "nopass") == wifi_qr_png("Gast", None, "nopass")


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def _turn_on(hass, entry):
    registry = er.async_get(hass)
    registry.async_update_entity(ENTITY, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()


async def test_the_qr_image_is_off_by_default_because_it_shows_the_password(
    hass, fake_client, entry
):
    await _setup(hass, entry)
    reg = er.async_get(hass).async_get(ENTITY)
    assert reg is not None and reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert reg.unique_id == "SERIAL1_guest_wifi_qr"
    # nothing was read from the box for an image nobody asked for
    assert ("guest_qr",) not in fake_client.calls


async def test_the_qr_image_is_made_when_added_and_changes_only_with_its_bytes(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    await _turn_on(hass, entry)
    coordinator = entry.runtime_data

    assert (await async_get_image(hass, ENTITY)).content == fake_client.qr
    since = hass.states.get(ENTITY).state
    assert since != "unknown"

    # the same picture again does not count as a change
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).state == since


async def test_a_new_password_makes_the_picture_again_at_once(hass, fake_client, entry):
    await _setup(hass, entry)
    await _turn_on(hass, entry)
    fake_client.calls.clear()

    fake_client.qr = b"\x89PNG-2"
    await hass.services.async_call(
        "fritzbox_network",
        "set_guest_wifi_password",
        {"password": "ein neues passwort"},
        blocking=True,
        return_response=True,
    )
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()

    assert ("guest_qr",) in fake_client.calls
    assert (await async_get_image(hass, ENTITY)).content == b"\x89PNG-2"


async def test_there_is_no_qr_image_without_a_guest_network_or_the_right(hass, fake_client, entry):
    fake_client.guest_wifi = None
    await _setup(hass, entry)
    assert er.async_get(hass).async_get(ENTITY) is None


async def test_there_is_no_qr_image_without_the_right_to_change_settings(hass, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)
    assert er.async_get(hass).async_get(ENTITY) is None


async def test_an_error_of_the_box_leaves_no_picture_and_no_password_in_the_log(
    hass, fake_client, entry, caplog
):
    caplog.set_level(logging.DEBUG, logger="custom_components.fritzbox_network.image")
    await _setup(hass, entry)
    await _turn_on(hass, entry)
    fake_client.fail_actions = True
    fake_client.qr = b"\x89PNG-3"
    entry.runtime_data.guest_password_changed = object()  # as after a new password
    entry.runtime_data.async_update_listeners()
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).state == "unknown"
    # only the kind of error is logged: the text of an error from the box could hold the password
    assert "FritzActionError" in caplog.text
    assert "refused" not in caplog.text


def test_the_client_asks_for_the_password_only_of_a_network_that_has_one():
    from unittest.mock import MagicMock

    from custom_components.fritzbox_network.api import FritzNetworkClient

    def make(beacon):
        client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
        client._fc = MagicMock()
        client._wifi_services = {"guest": "WLANConfiguration3"}

        def call(service, action, **args):
            if action == "GetSecurityKeys":
                return {"NewKeyPassphrase": "geheim 123"}
            return {"NewSSID": "Gast", "NewBeaconType": beacon}

        client._fc.call_action.side_effect = call
        return client

    secured = make("11iandWPA3")
    assert secured.get_guest_wifi_qr() == wifi_qr_png("Gast", "geheim 123", "WPA")
    open_net = make("OWETrans")
    assert open_net.get_guest_wifi_qr() == wifi_qr_png("Gast", None, "nopass")
    actions = [c.args[1] for c in open_net._fc.call_action.call_args_list]
    assert "GetSecurityKeys" not in actions
    no_guest = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    no_guest._fc = MagicMock()
    no_guest._wifi_services = {}
    assert no_guest.get_guest_wifi_qr() is None
