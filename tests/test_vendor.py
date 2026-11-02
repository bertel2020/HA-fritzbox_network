"""The vendor from the MAC address, only when the option is on."""

from dataclasses import replace

from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.fritzbox_network.vendor import async_load, vendor_of

ESP = "24:0a:c4:00:00:01"


def _esp_host(fake_client, mac=ESP):
    return replace(fake_client.hosts[0], mac=mac, mac_list=[mac], name="sensor", active=True)


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_vendor_of_a_public_mac_but_not_of_a_private_one():
    await async_load()

    assert vendor_of(ESP) == "Espressif Inc."
    # the locally administered bit is set: a randomized address has no vendor
    assert vendor_of("26:0a:c4:00:00:01") is None
    assert vendor_of("not a mac") is None


async def test_the_vendor_is_the_manufacturer_of_the_device_when_the_option_is_on(
    hass, fake_client, entry
):
    fake_client.hosts = [*fake_client.hosts, _esp_host(fake_client)]
    hass.config_entries.async_update_entry(entry, options={"show_vendor": True})

    await _setup(hass, entry)

    device = dr.async_get(hass).async_get_device_by_connection(
        (CONNECTION_NETWORK_MAC, ESP), entry.entry_id
    )
    assert device.manufacturer == "Espressif Inc."


async def test_no_vendor_by_default(hass, fake_client, entry):
    fake_client.hosts = [*fake_client.hosts, _esp_host(fake_client)]

    coordinator = await _setup(hass, entry)

    device = dr.async_get(hass).async_get_device_by_connection(
        (CONNECTION_NETWORK_MAC, ESP), entry.entry_id
    )
    assert device.manufacturer is None
    assert coordinator.vendor(ESP) is None


async def test_the_new_device_event_carries_the_vendor(hass, fake_client, entry):
    hass.config_entries.async_update_entry(entry, options={"show_vendor": True})
    events = async_capture_events(hass, "fritzbox_network_new_device")
    coordinator = await _setup(hass, entry)

    fake_client.hosts = [*fake_client.hosts, _esp_host(fake_client)]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert [e.data["vendor"] for e in events] == ["Espressif Inc."]


async def test_the_panel_shows_the_vendor_whatever_the_option_says(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.hosts = [*fake_client.hosts, _esp_host(fake_client)]
    coordinator = await _setup(hass, entry)

    assert coordinator.vendor(ESP) is None  # the option is off: no manufacturer in Home Assistant
    assert coordinator.panel_vendor(ESP) == "Espressif Inc."

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "fritzbox_network/subscribe_topology", "entry_id": entry.entry_id}
    )
    await client.receive_json()
    event = await client.receive_json()
    vendors = {c["mac"]: c["vendor"] for c in event["event"]["clients"]}
    assert vendors[ESP] == "Espressif Inc."
