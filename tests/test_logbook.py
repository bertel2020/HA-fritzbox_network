"""The events show up in the logbook."""

from homeassistant.core import Event
from homeassistant.helpers import entity_registry as er

from custom_components.fritzbox_network.logbook import async_describe_events

from .conftest import WLAN


def _describers(hass):
    found = {}
    async_describe_events(hass, lambda domain, name, fn: found.__setitem__(name, fn))
    return found


async def test_the_events_are_described(hass):
    assert set(_describers(hass)) == {
        "fritzbox_network_new_device",
        "fritzbox_network_device_renamed",
        "fritzbox_network_device_roamed",
        "fritzbox_network_internet_disconnected",
        "fritzbox_network_internet_reconnected",
        "fritzbox_network_internet_ip_changed",
    }


async def test_the_internet_events_read_well_and_keep_the_address_out_of_the_text(hass):
    describe = _describers(hass)
    changed = describe["fritzbox_network_internet_ip_changed"](
        Event("x", {"old_ip": "203.0.113.7", "new_ip": "203.0.113.9"})
    )
    assert changed["message"] == "external IPv4 address changed"
    assert "203.0.113" not in str(changed)
    assert describe["fritzbox_network_internet_disconnected"](Event("x", {}))["message"] == (
        "internet connection lost"
    )
    assert describe["fritzbox_network_internet_reconnected"](Event("x", {}))["message"] == (
        "internet connection set up again"
    )


async def test_entries_read_well_and_point_at_the_tracker(hass, fake_client, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    describe = _describers(hass)
    tracker = er.async_get(hass).async_get_entity_id(
        "device_tracker", "fritzbox_network", f"SERIAL1_{WLAN}"
    )

    new = describe["fritzbox_network_new_device"](
        Event("x", {"mac": WLAN, "name": "tablet", "ip": "192.0.2.9", "vendor": "Espressif Inc."})
    )
    assert new["message"] == "new device tablet (192.0.2.9, Espressif Inc.)"
    assert new["entity_id"] == tracker

    bare = describe["fritzbox_network_new_device"](
        Event("x", {"mac": "02:00:00:00:00:99", "name": "x", "ip": None, "vendor": None})
    )
    assert bare["message"] == "new device x" and bare["entity_id"] is None

    renamed = describe["fritzbox_network_device_renamed"](
        Event("x", {"mac": WLAN, "old_name": "PC-1", "new_name": "tv"})
    )
    assert renamed["message"] == "device PC-1 was renamed to tv"

    roamed = describe["fritzbox_network_device_roamed"](
        Event("x", {"mac": WLAN, "name": "phone", "old_ap": "Repeater", "new_ap": "Box"})
    )
    assert roamed["message"] == "phone moved from Repeater to Box"
