"""Entity ids by MAC, dynamic names, new devices, removing by hand."""

from dataclasses import replace

from homeassistant.core import State
from homeassistant.helpers import device_registry as dr, entity_registry as er, issue_registry as ir
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from pytest_homeassistant_custom_component.common import mock_restore_cache_with_extra_data

from custom_components.fritzbox_network import async_remove_config_entry_device
from custom_components.fritzbox_network.const import CONF_HIDDEN_MACS
from custom_components.fritzbox_network.diagnostics import async_get_config_entry_diagnostics

from .conftest import LAN, OFFLINE, REPEATER, WLAN


def _device(hass, entry, mac):
    return dr.async_get(hass).async_get_device_by_connection(
        (CONNECTION_NETWORK_MAC, mac), entry.entry_id
    )


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
    devices.async_update_device(_device(hass, entry, LAN).id, name_by_user="My own name")

    fake_client.hosts = [
        replace(h, name="renamed") if h.mac in (WLAN, LAN) else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert _device(hass, entry, WLAN).name == "renamed"
    assert hass.states.get("device_tracker.fritz_020000000003").name == "renamed"
    lan = _device(hass, entry, LAN)
    assert lan.name == "renamed" and lan.name_by_user == "My own name"


async def test_new_device_appears(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    new = replace(fake_client.hosts[0], mac="02:00:00:00:00:99", name="newcomer", ip="192.0.2.99")
    fake_client.hosts = [*fake_client.hosts, new]

    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get("device_tracker.fritz_020000000099").name == "newcomer"


async def test_remove_by_hand(hass, fake_client, entry):
    await _setup(hass, entry)

    assert not await async_remove_config_entry_device(hass, entry, _device(hass, entry, WLAN))
    [box] = dr.async_get(hass).async_get_devices(identifiers={("fritzbox_network", "SERIAL1")})
    assert not await async_remove_config_entry_device(hass, entry, box)

    offline = _device(hass, entry, OFFLINE)
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
    # the box shows the change late: the switch shows what was asked for meanwhile
    await hass.async_block_till_done()
    assert hass.states.get("switch.fritz_020000000003_internet_access").state == "off"


async def test_without_write_rights_no_switches(hass, fake_client, entry):
    fake_client.writable = False
    await _setup(hass, entry)

    assert hass.states.get("device_tracker.fritz_020000000003")
    assert hass.states.get("switch.fritz_020000000003_internet_access") is None
    assert ir.async_get(hass).async_get_issue(
        "fritzbox_network", f"missing_rights_{entry.entry_id}"
    )


async def test_filters_remove_devices_but_not_the_repeater(hass, fake_client, entry):
    # the repeater has a private MAC (like every fake MAC) and must survive the filter
    fake_client.hosts = [
        *fake_client.hosts,
        replace(
            fake_client.hosts[0], mac=REPEATER, mac_list=[REPEATER], name="repeater", active=True
        ),
    ]
    await _setup(hass, entry)
    assert _device(hass, entry, WLAN) and _device(hass, entry, REPEATER)

    hass.config_entries.async_update_entry(entry, options={"ignore_private_macs": True})
    await hass.async_block_till_done()

    assert _device(hass, entry, WLAN) is None
    assert hass.states.get("device_tracker.fritz_020000000003") is None
    assert _device(hass, entry, REPEATER)
    assert hass.states.get("device_tracker.fritz_02000000000e").state == "home"


async def test_last_seen_survives_a_restart(hass, fake_client, entry):
    sensor_id = "sensor.fritz_020000000003_last_seen"
    mock_restore_cache_with_extra_data(
        hass,
        [
            (
                State(sensor_id, "2026-10-01T10:00:00+00:00"),
                {"value": "2026-10-01T10:00:00+00:00", "was_active": True},
            )
        ],
    )
    await _setup(hass, entry)

    # online before and after the restart: the connect time stays
    assert hass.states.get(sensor_id).state == "2026-10-01T10:00:00+00:00"


async def test_skip_offline_creates_devices_only_when_online(hass, fake_client, entry):
    hass.config_entries.async_update_entry(entry, options={"skip_offline": True})
    coordinator = await _setup(hass, entry)

    assert _device(hass, entry, WLAN)
    assert _device(hass, entry, OFFLINE) is None

    fake_client.hosts = [
        replace(h, active=True) if h.mac == OFFLINE else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert _device(hass, entry, OFFLINE)


async def test_box_and_repeater_count_their_devices(hass, fake_client, entry):
    # the repeater's own host entry and its mesh node are one device
    fake_client.hosts = [
        *fake_client.hosts,
        replace(
            fake_client.hosts[0], mac=REPEATER, mac_list=[REPEATER], name="repeater", active=True
        ),
    ]
    await _setup(hass, entry)
    mesh = fake_client.mesh

    box = hass.states.get("sensor.fritz_020000000005_clients")
    repeater = hass.states.get("sensor.fritz_02000000000e_clients")
    assert int(box.state) == sum(1 for lk in mesh.links.values() if lk.ap_uid == "n-1") >= 2
    assert int(repeater.state) == 1

    devices = dr.async_get(hass)
    [node_device] = devices.async_get_devices(identifiers={("fritzbox_network", REPEATER)})
    assert node_device == _device(hass, entry, REPEATER)
    assert node_device.model == "FRITZ!Repeater 1200 AX" and node_device.sw_version == "268.08.20"
    assert node_device.name == "repeater"
    assert not await async_remove_config_entry_device(hass, entry, node_device)


async def test_guest_flag_is_enabled_only_for_guests(hass, fake_client, entry):
    await _setup(hass, entry)

    assert hass.states.get("binary_sensor.fritz_02000000000d_guest").state == "on"
    registry = er.async_get(hass)
    plain = registry.async_get("binary_sensor.fritz_020000000003_guest")
    assert plain.disabled_by is er.RegistryEntryDisabler.INTEGRATION


async def test_diagnostics_show_the_poll_time_and_hide_secrets(hass, fake_client, entry):
    await _setup(hass, entry)

    result = await async_get_config_entry_diagnostics(hass, entry)

    assert result["poll"]["last_fetch_seconds"] is not None
    assert result["host_count"] == len(fake_client.hosts)
    assert "secret" not in str(result)
    assert WLAN not in str(result)


async def test_link_sensors_exist_only_for_devices_with_a_connection(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    registry = er.async_get(hass)

    assert registry.async_get("sensor.fritz_020000000003_signal_strength").disabled_by
    assert registry.async_get("sensor.fritz_020000000001_signal_strength") is None

    fake_client.mesh.links[OFFLINE] = fake_client.mesh.links[WLAN]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert registry.async_get("sensor.fritz_020000000001_signal_strength")
