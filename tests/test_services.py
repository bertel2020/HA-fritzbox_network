"""The actions: rename a device in the box, wake a device up."""

from dataclasses import replace

from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError, Unauthorized
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
import pytest
import voluptuous as vol

from custom_components.fritzbox_network.const import DOMAIN

from .conftest import LAN, WLAN


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


def _device_id(hass, entry, mac):
    return (
        dr.async_get(hass)
        .async_get_device_by_connection((CONNECTION_NETWORK_MAC, mac), entry.entry_id)
        .id
    )


async def test_set_name_renames_in_the_box_and_shows_the_name(hass, fake_client, entry):
    await _setup(hass, entry)

    await hass.services.async_call(
        DOMAIN,
        "set_name",
        {"name": "  Garden camera ", "device_id": _device_id(hass, entry, WLAN)},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert fake_client.calls[-1] == ("name", WLAN, "Garden camera")
    device = dr.async_get(hass).async_get(_device_id(hass, entry, WLAN))
    assert device.name == "Garden camera"
    # the entity id stays
    assert hass.states.get("device_tracker.fritz_020000000003")


async def test_set_name_by_entity(hass, fake_client, entry):
    await _setup(hass, entry)

    await hass.services.async_call(
        DOMAIN,
        "set_name",
        {"name": "TV", "entity_id": "device_tracker.fritz_020000000004"},
        blocking=True,
    )

    assert fake_client.calls[-1] == ("name", LAN, "TV")


async def test_set_name_refuses_a_name_the_box_does_not_let_change(hass, fake_client, entry):
    fake_client.hosts = [
        replace(h, name_writeable=False) if h.mac == WLAN else h for h in fake_client.hosts
    ]
    await _setup(hass, entry)

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN,
            "set_name",
            {"name": "x", "device_id": _device_id(hass, entry, WLAN)},
            blocking=True,
        )
    assert not [c for c in fake_client.calls if c[0] == "name"]


async def test_actions_need_the_right_to_change_settings(hass, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)

    for service, data in (("set_name", {"name": "x"}), ("wake_on_lan", {})):
        with pytest.raises(HomeAssistantError):
            await hass.services.async_call(
                DOMAIN,
                service,
                {**data, "device_id": _device_id(hass, entry, WLAN)},
                blocking=True,
            )
    # reads of the poll are no action: nothing was written
    reads = {("cpu_temperature",), ("read_uptime",)}
    assert [call for call in fake_client.calls if call not in reads] == []


async def test_wake_on_lan_by_device(hass, fake_client, entry):
    await _setup(hass, entry)

    await hass.services.async_call(
        DOMAIN, "wake_on_lan", {"device_id": _device_id(hass, entry, LAN)}, blocking=True
    )

    assert fake_client.calls[-1] == ("wol", LAN)


async def test_an_action_without_a_device_of_ours_is_an_error(hass, fake_client, entry):
    await _setup(hass, entry)

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "wake_on_lan", {"entity_id": "light.somewhere"}, blocking=True
        )


async def test_the_guest_password_can_be_given_or_made_and_comes_back_as_the_response(
    hass, fake_client, entry
):
    await _setup(hass, entry)

    given = await hass.services.async_call(
        DOMAIN,
        "set_guest_wifi_password",
        {"password": "correct horse"},
        blocking=True,
        return_response=True,
    )
    assert given == {"password": "correct horse"}
    made = await hass.services.async_call(
        DOMAIN, "set_guest_wifi_password", {"length": 20}, blocking=True, return_response=True
    )
    assert len(made["password"]) == 20
    assert ("guest_password", None, 20) in fake_client.calls


async def test_a_guest_password_must_be_a_valid_passphrase(hass, fake_client, entry):
    await _setup(hass, entry)
    for data in ({"password": "short"}, {"password": "x" * 64}, {"length": 7}, {"length": 64}):
        with pytest.raises(vol.Invalid):
            await hass.services.async_call(
                DOMAIN, "set_guest_wifi_password", data, blocking=True, return_response=True
            )
    assert not any(call[0] == "guest_password" for call in fake_client.calls)


async def test_the_guest_password_needs_the_right_and_a_guest_network(hass, fake_client, entry):
    fake_client.guest_wifi = None
    await _setup(hass, entry)
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "set_guest_wifi_password", {}, blocking=True, return_response=True
        )


async def test_the_guest_password_is_refused_without_the_right_to_change_settings(
    hass, fake_client, entry
):
    fake_client.writable = False
    await _setup(hass, entry)
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN, "set_guest_wifi_password", {}, blocking=True, return_response=True
        )
    assert not any(call[0] == "guest_password" for call in fake_client.calls)


async def test_a_refusal_of_the_box_does_not_leak_the_password_into_the_error(
    hass, fake_client, entry
):
    await _setup(hass, entry)
    fake_client.fail_actions = True
    with pytest.raises(HomeAssistantError) as err:
        await hass.services.async_call(
            DOMAIN,
            "set_guest_wifi_password",
            {"password": "sehr geheim 123"},
            blocking=True,
            return_response=True,
        )
    assert "sehr geheim" not in str(err.value)


async def test_the_actions_refuse_a_user_who_is_no_administrator(
    hass, fake_client, entry, hass_read_only_user
):
    await _setup(hass, entry)
    device_id = _device_id(hass, entry, WLAN)
    calls = (
        ("set_name", {"name": "TV", "device_id": device_id}),
        ("wake_on_lan", {"device_id": device_id}),
        ("set_route", {"network": "10.8.0.0/24", "enabled": True}),
        ("set_guest_wifi_password", {"length": 12}),
        ("remove_unavailable_vpn", {}),
    )
    for service, data in calls:
        with pytest.raises(Unauthorized):
            await hass.services.async_call(
                DOMAIN,
                service,
                data,
                blocking=True,
                context=Context(user_id=hass_read_only_user.id),
            )
    assert not [c for c in fake_client.calls if c[0] == "name"]


async def test_the_actions_run_for_an_administrator(
    hass, fake_client, entry, hass_admin_user
):
    await _setup(hass, entry)
    await hass.services.async_call(
        DOMAIN,
        "set_name",
        {"name": "TV", "device_id": _device_id(hass, entry, WLAN)},
        blocking=True,
        context=Context(user_id=hass_admin_user.id),
    )
    assert fake_client.calls[-1] == ("name", WLAN, "TV")


async def test_the_guest_password_must_be_printable_ascii_like_in_the_panel(
    hass, fake_client, entry
):
    import voluptuous as vol

    await _setup(hass, entry)
    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            DOMAIN,
            "set_guest_wifi_password",
            {"password": "Gäste-Netz1"},
            blocking=True,
            return_response=True,
        )
    assert not any(call[0] == "guest_password" for call in fake_client.calls)
