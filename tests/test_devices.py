"""Entity ids by MAC, dynamic names, new devices, removing by hand."""

from dataclasses import replace

from homeassistant.helpers import device_registry as dr, entity_registry as er, issue_registry as ir
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.fritzbox_network import async_remove_config_entry_device
from custom_components.fritzbox_network.const import CONF_HIDDEN_MACS

from .conftest import LAN, OFFLINE, WLAN


def _device(hass, mac):
    return dr.async_get(hass).async_get_device(connections={(CONNECTION_NETWORK_MAC, mac)})


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_entity_ids_follow_the_mac(hass, fake_client, entry):
    await _setup(hass, entry)
    registry = er.async_get(hass)

    assert registry.async_get("device_tracker.fritz_020000000003").unique_id == WLAN
    assert registry.async_get("sensor.fritz_020000000003_ip_address")
    assert registry.async_get("sensor.fritz_020000000003_access_point")
    assert registry.async_get("switch.fritz_020000000003_internet_access")
    assert (
        hass.states.get("sensor.fritz_020000000003_access_point").state == "FRITZ!Repeater 1200 AX"
    )
    # the box itself is no client
    assert registry.async_get("device_tracker.fritz_020000000005") is None


async def test_renamed_in_the_box_follows_without_changing_the_entity_id(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    devices = dr.async_get(hass)
    devices.async_update_device(_device(hass, LAN).id, name_by_user="My own name")

    fake_client.hosts = [
        replace(h, name="renamed") if h.mac in (WLAN, LAN) else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert _device(hass, WLAN).name == "renamed"
    assert hass.states.get("device_tracker.fritz_020000000003").name == "renamed"
    lan = _device(hass, LAN)
    assert lan.name == "renamed" and lan.name_by_user == "My own name"


async def test_foreign_device_keeps_its_name(hass, fake_client, entry):
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    dr.async_get(hass).async_get_or_create(
        config_entry_id=other.entry_id, connections={(CONNECTION_NETWORK_MAC, WLAN)}, name="Foreign"
    )
    coordinator = await _setup(hass, entry)

    fake_client.hosts = [
        replace(h, name="renamed") if h.mac == WLAN else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()

    assert _device(hass, WLAN).name == "Foreign"


async def test_new_device_appears(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    new = replace(fake_client.hosts[0], mac="02:00:00:00:00:99", name="newcomer", ip="192.0.2.99")
    fake_client.hosts = [*fake_client.hosts, new]

    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get("device_tracker.fritz_020000000099").name == "newcomer"


async def test_remove_by_hand(hass, fake_client, entry):
    await _setup(hass, entry)

    assert not await async_remove_config_entry_device(hass, entry, _device(hass, WLAN))
    box = dr.async_get(hass).async_get_device(identifiers={("fritzbox_network", "SERIAL1")})
    assert not await async_remove_config_entry_device(hass, entry, box)

    offline = _device(hass, OFFLINE)
    assert await async_remove_config_entry_device(hass, entry, offline)
    assert entry.options[CONF_HIDDEN_MACS] == [OFFLINE]
    # what Home Assistant does right after a True answer
    dr.async_get(hass).async_update_device(offline.id, remove_config_entry_id=entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("device_tracker.fritz_020000000001") is None


async def test_internet_switch(hass, fake_client, entry):
    await _setup(hass, entry)
    await hass.services.async_call(
        "switch",
        "turn_off",
        {"entity_id": "switch.fritz_020000000003_internet_access"},
        blocking=True,
    )
    assert fake_client.calls[-1] == ("internet", "192.0.2.3", False)


async def test_without_write_rights_no_switches(hass, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)

    assert hass.states.get("device_tracker.fritz_020000000003")
    assert hass.states.get("switch.fritz_020000000003_internet_access") is None
    assert ir.async_get(hass).async_get_issue(
        "fritzbox_network", f"missing_rights_{entry.entry_id}"
    )
