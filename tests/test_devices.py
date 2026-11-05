"""Entity ids by MAC, dynamic names, new devices, removing by hand."""

from dataclasses import replace

from homeassistant.const import EntityCategory
from homeassistant.core import State
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er, issue_registry as ir
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    mock_restore_cache_with_extra_data,
)

from custom_components.fritzbox_network import async_remove_config_entry_device
from custom_components.fritzbox_network.const import CONF_HIDDEN_MACS
from custom_components.fritzbox_network.diagnostics import async_get_config_entry_diagnostics

from .conftest import BOX, LAN, OFFLINE, REPEATER, WLAN


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


async def test_filters_keep_a_device_another_integration_shares(hass, fake_client, entry):
    await _setup(hass, entry)
    other = MockConfigEntry(domain="other", entry_id="other-entry")
    other.add_to_hass(hass)
    registry = dr.async_get(hass)
    device = _device(hass, entry, WLAN)
    registry.async_update_device(device.id, add_config_entry_id=other.entry_id)

    hass.config_entries.async_update_entry(entry, options={"ignore_private_macs": True})
    await hass.async_block_till_done()

    kept = registry.async_get(device.id)
    assert kept is not None
    assert kept.config_entries == {other.entry_id}
    assert hass.states.get("device_tracker.fritz_020000000003") is None


async def test_online_since_survives_a_restart(hass, fake_client, entry):
    sensor_id = "sensor.fritz_020000000003_online_since"
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


async def test_mesh_entities_follow_the_mac_when_the_uid_changes(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    before = int(hass.states.get("sensor.fritz_020000000005_clients").state)
    mesh = fake_client.mesh
    node = mesh.nodes.pop("n-1")
    mesh.nodes["n-renewed"] = replace(node, uid="n-renewed")
    mesh.links = {
        mac: replace(link, ap_uid="n-renewed") if link.ap_uid == "n-1" else link
        for mac, link in mesh.links.items()
    }

    await coordinator.async_refresh()
    await hass.async_block_till_done()

    state = hass.states.get("sensor.fritz_020000000005_clients")
    assert state.state == str(before)
    assert state.state != "unavailable"


async def test_internet_switch_refuses_an_address_that_changed(hass, fake_client, entry):
    await _setup(hass, entry)
    fake_client.hosts = [
        replace(h, ip="192.0.2.99") if h.mac == WLAN else h for h in fake_client.hosts
    ]

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "switch",
            "turn_off",
            {"entity_id": "switch.fritz_020000000003_internet_access"},
            blocking=True,
        )
    assert not [c for c in fake_client.calls if c[0] == "internet"]


async def test_hosts_stay_when_the_mesh_download_fails(hass, fake_client, entry):
    def failing_mesh():
        raise ConnectionError("mesh download failed")

    fake_client.get_mesh = failing_mesh

    coordinator = await _setup(hass, entry)

    assert coordinator.last_update_success
    assert coordinator.data.mesh is None
    assert hass.states.get("device_tracker.fritz_020000000003").state == "home"


async def test_online_since_and_last_online_follow_the_presence(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    since = "sensor.fritz_020000000003_online_since"
    last = "sensor.fritz_020000000003_last_online"
    assert hass.states.get(since).state not in ("unknown", "unavailable")
    assert hass.states.get(last).state == "unknown"

    fake_client.hosts = [
        replace(h, active=False) if h.mac == WLAN else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get(since).state == "unknown"
    assert hass.states.get(last).state not in ("unknown", "unavailable")


async def test_box_diagnostic_sensors_are_off_by_default_and_report_failures(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    registry = er.async_get(hass)
    ids = {
        key: registry.async_get_entity_id("sensor", "fritzbox_network", f"SERIAL1_{key}")
        for key in ("last_update", "failed_polls", "mesh_status")
    }
    assert all(ids.values())
    assert all(registry.async_get(i).disabled_by for i in ids.values())

    for entity_id in ids.values():
        registry.async_update_entity(entity_id, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = entry.runtime_data

    assert hass.states.get(ids["last_update"]).state not in ("unknown", "unavailable")
    assert hass.states.get(ids["failed_polls"]).state == "0"
    assert hass.states.get(ids["mesh_status"]).state == "available"

    def failing_hosts():
        raise ConnectionError("down")

    fake_client.get_hosts = failing_hosts
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert hass.states.get(ids["failed_polls"]).state == "1"
    assert hass.states.get(ids["mesh_status"]).state == "available"


async def test_new_device_fires_an_event_but_not_at_startup(hass, fake_client, entry):
    events = async_capture_events(hass, "fritzbox_network_new_device")
    coordinator = await _setup(hass, entry)
    assert events == []

    new_mac = "02:00:00:00:00:99"
    fake_client.hosts = [
        *fake_client.hosts,
        replace(fake_client.hosts[0], mac=new_mac, mac_list=[new_mac], name="newcomer"),
    ]
    await coordinator.async_refresh()
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert [e.data["mac"] for e in events] == [new_mac]
    assert events[0].data["name"] == "newcomer"


async def test_box_counts_the_devices(hass, fake_client, entry):
    coordinator = await _setup(hass, entry)
    hosts = coordinator.data.hosts.values()
    online = sum(coordinator.is_connected(h) for h in hosts)

    states = {
        key: hass.states.get(f"sensor.fritz_network_{key}")
        for key in ("devices_online", "devices_offline", "devices_total")
    }
    assert int(states["devices_online"].state) == online > 0
    assert int(states["devices_total"].state) == len(hosts)
    assert int(states["devices_offline"].state) == len(hosts) - online


async def test_refresh_button_polls_the_box_even_without_write_rights(hass, fake_client, entry):
    fake_client.writable = False
    coordinator = await _setup(hass, entry)
    polls = 0
    original = fake_client.get_hosts

    def counting_hosts():
        nonlocal polls
        polls += 1
        return original()

    fake_client.get_hosts = counting_hosts
    await hass.services.async_call(
        "button", "press", {"entity_id": "button.fritz_network_refresh"}, blocking=True
    )
    await hass.async_block_till_done()

    assert coordinator.last_update_success
    assert polls >= 1


def _enable(hass, entity_id):
    er.async_get(hass).async_update_entity(entity_id, disabled_by=None)


async def test_access_profile_select_lists_the_profiles_and_sets_one(hass, fake_client, entry):
    await _setup(hass, entry)
    entity_id = "select.fritz_020000000003_access_profile"
    registry = er.async_get(hass)
    assert registry.async_get(entity_id).disabled_by is not None

    _enable(hass, entity_id)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    state = hass.states.get(entity_id)
    assert state.attributes["options"] == ["Standard", "Kids"]
    assert state.state == "Standard"

    await hass.services.async_call(
        "select", "select_option", {"entity_id": entity_id, "option": "Kids"}, blocking=True
    )
    assert fake_client.calls[-1] == ("profile", "192.0.2.3", "filtprof2")
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state == "Kids"


async def test_no_access_profile_select_without_profiles_or_rights(hass, fake_client, entry):
    fake_client.profiles = {}
    await _setup(hass, entry)
    assert (
        er.async_get(hass).async_get_entity_id(
            "select", "fritzbox_network", f"{WLAN}_access_profile"
        )
        is None
    )


async def test_priority_switch_sets_the_priority(hass, fake_client, entry):
    await _setup(hass, entry)
    entity_id = "switch.fritz_020000000003_priority"
    assert er.async_get(hass).async_get(entity_id).disabled_by is not None
    _enable(hass, entity_id)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    # the capture has this device with priority
    assert hass.states.get(entity_id).state == "on"

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity_id}, blocking=True)

    assert fake_client.calls[-1] == ("priority", "192.0.2.3", False)
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state == "off"


async def test_auto_wake_on_lan_switch_reads_and_sets_the_box(hass, fake_client, entry):
    fake_client.auto_wol[LAN] = True
    await _setup(hass, entry)
    entity_id = "switch.fritz_020000000004_auto_wake_on_lan"
    _enable(hass, entity_id)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state == "on"

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity_id}, blocking=True)

    assert fake_client.calls[-1] == ("auto_wol", LAN, False)
    assert hass.states.get(entity_id).state == "off"
    # a device known to sit on Wi-Fi has no such switch
    assert (
        er.async_get(hass).async_get_entity_id(
            "switch", "fritzbox_network", f"{WLAN}_auto_wake_on_lan"
        )
        is None
    )


async def test_auto_wake_on_lan_is_unavailable_when_the_box_does_not_answer(
    hass, fake_client, entry
):
    def failing(mac):
        raise ConnectionError("no answer")

    fake_client.get_auto_wol = failing
    await _setup(hass, entry)
    entity_id = "switch.fritz_020000000004_auto_wake_on_lan"
    _enable(hass, entity_id)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get(entity_id).state == "unavailable"


async def test_roaming_fires_once_after_the_new_access_point_held(hass, fake_client, entry):
    events = async_capture_events(hass, "fritzbox_network_device_roamed")
    coordinator = await _setup(hass, entry)
    link = fake_client.mesh.links[WLAN]
    old_ap = link.ap_mac
    assert old_ap and old_ap != BOX
    assert events == []

    fake_client.mesh.links[WLAN] = replace(link, ap_mac=BOX, ap_name="FRITZ!Box")
    await coordinator.async_refresh()
    assert events == []  # once is not enough
    await coordinator.async_refresh()
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert len(events) == 1
    data = events[0].data
    assert data["mac"] == WLAN
    assert (data["old_ap_mac"], data["new_ap_mac"]) == (old_ap, BOX)
    assert data["old_ap"] == "FRITZ!Repeater 1200 AX" and data["link_type"] == "wlan"


async def test_a_device_that_flaps_between_access_points_does_not_roam(hass, fake_client, entry):
    events = async_capture_events(hass, "fritzbox_network_device_roamed")
    coordinator = await _setup(hass, entry)
    link = fake_client.mesh.links[WLAN]

    for ap in (BOX, link.ap_mac, BOX, link.ap_mac):
        fake_client.mesh.links[WLAN] = replace(link, ap_mac=ap)
        await coordinator.async_refresh()
    await hass.async_block_till_done()

    assert events == []


async def test_radio_sensors_of_an_access_point(hass, fake_client, entry):
    await _setup(hass, entry)
    registry = er.async_get(hass)
    ids = {
        key: registry.async_get_entity_id("sensor", "fritzbox_network", f"{BOX}_{key}_2_4ghz")
        for key in ("radio_channel", "radio_utilization", "radio_noise")
    }
    assert all(ids.values())
    assert all(registry.async_get(i).disabled_by for i in ids.values())
    assert registry.async_get_entity_id("sensor", "fritzbox_network", f"{BOX}_radio_noise_5ghz")

    for entity_id in ids.values():
        _enable(hass, entity_id)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get(ids["radio_channel"]).state == "11"
    assert hass.states.get(ids["radio_utilization"]).state == "4"
    assert hass.states.get(ids["radio_noise"]).state == "-86"
    assert hass.states.get(ids["radio_utilization"]).attributes["unit_of_measurement"] == "%"
    assert "2.4 GHz" in hass.states.get(ids["radio_channel"]).attributes["friendly_name"]


async def test_a_repeater_gets_no_client_switches(hass, fake_client, entry):
    from dataclasses import replace

    from .conftest import REPEATER

    fake_client.hosts = [
        *fake_client.hosts,
        replace(
            fake_client.hosts[0], mac=REPEATER, mac_list=[REPEATER], name="repeater", active=True
        ),
    ]
    await _setup(hass, entry)
    registry = er.async_get(hass)

    node = REPEATER.lower().replace(":", "")
    assert registry.async_get("device_tracker.fritz_" + node) is not None
    for key in ("internet_access", "priority", "auto_wake_on_lan"):
        assert registry.async_get(f"switch.fritz_{node}_{key}") is None
    assert registry.async_get(f"button.fritz_{node}_wake_on_lan") is None
    assert registry.async_get(f"select.fritz_{node}_access_profile") is None
    for key in ("access_point", "last_online"):
        assert registry.async_get(f"sensor.fritz_{node}_{key}") is None
    assert registry.async_get(f"sensor.fritz_{node}_ip_address") is not None
    # a client still has them
    assert registry.async_get("switch.fritz_020000000003_internet_access")


async def test_the_ip_address_tells_where_it_comes_from(hass, fake_client, entry):
    fake_client.network = {**fake_client.network, "pool_from": "192.0.2.1", "pool_to": "192.0.2.4"}
    await _setup(hass, entry)

    inside = next(h for h in fake_client.hosts if h.ip == "192.0.2.3")
    outside = next(h for h in fake_client.hosts if h.ip == "192.0.2.8")
    for host, expected in ((inside, True), (outside, False)):
        state = hass.states.get(f"sensor.fritz_{host.mac.replace(':', '').lower()}_ip_address")
        assert state.attributes["in_dhcp_range"] is expected
        assert state.attributes["guest"] is host.guest
        assert state.attributes["interface"] == host.interface_type


async def test_the_address_assignment_follows_what_the_box_tells_a_few_devices_per_poll(
    hass, fake_client, entry
):
    coordinator = await _setup(hass, entry)
    for _ in range(6):
        await coordinator.async_refresh()
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    lan = registry.async_get("sensor.fritz_020000000004_address_assignment")
    assert lan is not None
    assert lan.entity_category is EntityCategory.DIAGNOSTIC
    assert hass.states.get(lan.entity_id).state == "dhcp"
    # the box itself is no client
    assert registry.async_get("sensor.fritz_020000000005_address_assignment") is None


async def test_no_address_assignment_where_the_box_does_not_tell(hass, fake_client, entry):
    fake_client.get_ip_reservations = lambda macs, max_age=600: {m: None for m in macs}
    coordinator = await _setup(hass, entry)
    for _ in range(6):
        await coordinator.async_refresh()
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    assert registry.async_get("sensor.fritz_020000000004_address_assignment") is None
