"""The actions: rename a device in the box, wake a device up."""

from dataclasses import replace

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
import pytest

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
