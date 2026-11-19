"""The preview of taking over the entities of the core integration: it reads and changes nothing."""

from unittest.mock import AsyncMock

from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.helpers import device_registry as dr, entity_registry as er
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    MockModule,
    mock_integration,
)

from custom_components.fritzbox_network.migration import (
    MigrationRefused,
    async_journal,
    async_run,
    async_undo,
    counterpart,
    port_counterpart,
    repeater_counterpart,
    scan,
)
from custom_components.fritzbox_network.models import PortRule

from .conftest import LAN

COMMAND = "fritzbox_network/migrate/scan"
SERIAL = "SERIAL1"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


def _core(hass, *unique_ids, title="FRITZ!Box 7590 AX"):
    """A core entry with entities in the registry; the core integration itself is not loaded."""
    core = MockConfigEntry(domain="fritz", title=title, data={"host": "192.168.178.1"})
    core.add_to_hass(hass)
    registry = er.async_get(hass)
    made = {}
    for domain, uid in unique_ids:
        made[uid] = registry.async_get_or_create(
            domain,
            "fritz",
            uid,
            config_entry=core,
            suggested_object_id=f"core_{uid.replace('-', '_').replace(':', '').lower()}",
        )
    return core, made


def _rows(result):
    return {row["core_entity_id"]: row for row in result["rows"]}


def test_a_core_unique_id_becomes_the_one_of_the_same_thing_here():
    assert counterpart(f"{SERIAL}-is_connected", SERIAL)[0] == f"{SERIAL}_internet_connected"
    assert counterpart(f"{SERIAL}-kb_s_received", SERIAL)[0] == f"{SERIAL}_internet_download"
    assert counterpart(f"{SERIAL}-wi_fi_main_5ghz", SERIAL)[0] == f"{SERIAL}_wifi_5ghz"
    assert counterpart(f"{SERIAL}-wi_fi_guest", SERIAL)[0] == f"{SERIAL}_guest_wifi"
    assert counterpart(f"{SERIAL}-update", SERIAL)[0] == f"{SERIAL}_firmware"
    # a device is the box and the MAC, as this integration writes it
    assert counterpart("02:00:00:00:00:0B_tracker", SERIAL) == (
        f"{SERIAL}_02:00:00:00:00:0b",
        "client",
        "",
        [],
    )
    assert counterpart("02:00:00:00:00:0B_internet_access", SERIAL)[0] == (
        f"{SERIAL}_02:00:00:00:00:0b_internet_access"
    )


def test_what_is_about_the_same_is_marked_and_what_has_no_counterpart_says_why():
    target, _, _, notes = counterpart(f"{SERIAL}-link_kb_s_sent", SERIAL)
    assert target == f"{SERIAL}_dsl_max_rate_up" and notes == ["approximate"]
    assert counterpart(f"{SERIAL}-connection_uptime", SERIAL)[0] == (
        f"{SERIAL}_internet_connected_since"
    )
    target, _, _, notes = counterpart(f"{SERIAL}-max_kb_s_received", SERIAL)
    assert target == f"{SERIAL}_internet_link_rate_down" and notes == []
    assert counterpart(f"{SERIAL}-cleanup", SERIAL)[2] == "not_covered"
    assert counterpart(f"{SERIAL}-port_forward_web", SERIAL)[2] == "unknown"
    assert counterpart(f"{SERIAL}-call_deflection_1", SERIAL)[2] == "not_covered"
    assert counterpart("OTHER-update", SERIAL)[2] == "other_box"
    assert counterpart(f"{SERIAL}-something_new", SERIAL)[2] == "unknown"
    assert counterpart("whatever", SERIAL)[2] == "unknown"


async def test_the_preview_pairs_the_core_entities_with_those_that_exist_here(
    hass, fake_client, entry
):
    await _setup(hass, entry)
    core, made = _core(
        hass,
        ("binary_sensor", f"{SERIAL}-is_connected"),
        ("sensor", f"{SERIAL}-kb_s_sent"),
        ("button", f"{SERIAL}-cleanup"),
        ("update", "OTHER-update"),
        ("sensor", f"{SERIAL}-brand_new"),
        ("device_tracker", f"{LAN.upper()}_tracker"),
        ("switch", f"{SERIAL}-wi_fi_main_5ghz"),
    )

    result = scan(hass, entry)
    rows = _rows(result)

    assert result["core"] == {
        "entry_id": core.entry_id,
        "title": "FRITZ!Box 7590 AX",
        "state": "not_loaded",
        "same_box": True,
    }
    connected = rows[made[f"{SERIAL}-is_connected"].entity_id]
    assert connected["status"] == "migrate"
    assert connected["target_entity_id"] == "binary_sensor.fritz_network_internet_connected"
    assert rows[made[f"{SERIAL}-kb_s_sent"].entity_id]["status"] == "migrate"
    assert rows[made[f"{SERIAL}-wi_fi_main_5ghz"].entity_id]["target_entity_id"] == (
        "switch.fritz_network_wifi_5ghz"
    )
    tracker = rows[made[f"{LAN.upper()}_tracker"].entity_id]
    assert tracker["status"] == "migrate" and tracker["group"] == "client"
    assert tracker["target_entity_id"] == (f"device_tracker.fritz_{LAN.replace(':', '').lower()}")
    for uid, status, reason in (
        (f"{SERIAL}-cleanup", "none", "not_covered"),
        ("OTHER-update", "skip", "other_box"),
        (f"{SERIAL}-brand_new", "none", "unknown"),
    ):
        row = rows[made[uid].entity_id]
        assert (row["status"], row["reason"]) == (status, reason), uid
        assert row["target_entity_id"] is None


async def test_a_counterpart_that_is_not_made_here_is_not_offered(hass, fake_client, entry):
    # no CPU sensor on this box: moving the core one would leave an entity nobody feeds
    fake_client.cpu_temperature = None
    await _setup(hass, entry)
    _, made = _core(hass, ("sensor", f"{SERIAL}-cpu_temperature"))

    row = _rows(scan(hass, entry))[made[f"{SERIAL}-cpu_temperature"].entity_id]
    assert (row["status"], row["reason"]) == ("none", "not_made_here")


async def test_two_core_entities_for_one_counterpart_are_a_conflict(hass, fake_client, entry):
    await _setup(hass, entry)
    _, first = _core(hass, ("sensor", f"{SERIAL}-kb_s_sent"))
    registry = er.async_get(hass)
    second_entry = MockConfigEntry(domain="fritz", title="second")
    second_entry.add_to_hass(hass)
    second = registry.async_get_or_create(
        "sensor", "fritz", f"{SERIAL}-kb_s_sent-copy", config_entry=second_entry
    )
    # the same counterpart claimed by a second entity
    from custom_components.fritzbox_network import migration

    original = migration.counterpart

    def doubled(unique_id, serial):
        if unique_id.endswith("-copy"):
            return original(unique_id.removesuffix("-copy"), serial)
        return original(unique_id, serial)

    migration.counterpart = doubled
    try:
        rows = _rows(scan(hass, entry))
    finally:
        migration.counterpart = original
    assert rows[first[f"{SERIAL}-kb_s_sent"].entity_id]["status"] == "conflict"
    assert rows[second.entity_id]["reason"] == "claimed_twice"


async def test_the_preview_without_the_core_integration_is_empty(hass, fake_client, entry):
    await _setup(hass, entry)
    result = scan(hass, entry)
    assert result["core"] is None and result["rows"] == []


async def test_the_preview_changes_nothing(hass, fake_client, entry):
    await _setup(hass, entry)
    _core(hass, ("binary_sensor", f"{SERIAL}-is_connected"), ("button", f"{SERIAL}-cleanup"))
    registry = er.async_get(hass)
    before = {
        e.entity_id: (e.platform, e.unique_id, e.config_entry_id, e.disabled_by)
        for e in registry.entities.values()
    }

    scan(hass, entry)
    scan(hass, entry)

    after = {
        e.entity_id: (e.platform, e.unique_id, e.config_entry_id, e.disabled_by)
        for e in registry.entities.values()
    }
    assert after == before


async def test_the_token_changes_when_the_preview_does(hass, fake_client, entry):
    await _setup(hass, entry)
    _core(hass, ("binary_sensor", f"{SERIAL}-is_connected"))
    first = scan(hass, entry)["token"]
    assert scan(hass, entry)["token"] == first
    _core(hass, ("sensor", f"{SERIAL}-kb_s_sent"))
    assert scan(hass, entry)["token"] != first


async def test_the_panel_can_ask_for_the_preview(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    _core(hass, ("binary_sensor", f"{SERIAL}-is_connected"))
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": COMMAND, "entry_id": entry.entry_id})
    result = await client.receive_json()

    assert result["success"]
    assert result["result"]["rows"][0]["status"] == "migrate"
    await client.send_json_auto_id({"type": COMMAND, "entry_id": "nope"})
    assert (await client.receive_json())["error"]["code"] == "not_found"


def _rule(key, description):
    return PortRule(key, description, "TCP", 1, 1, "192.0.2.2", "", 0, True)


def test_a_port_forwarding_of_the_core_integration_is_found_by_its_description():
    rules = {"tcp_80": _rule("tcp_80", "Web Server"), "udp_51820": _rule("udp_51820", "WireGuard")}
    assert port_counterpart(f"{SERIAL}-port_forward_web_server", SERIAL, rules) == (
        f"{SERIAL}_port_tcp_80"
    )
    # the core name may carry more after the description
    assert port_counterpart(f"{SERIAL}-port_forward_wireguard_ipv4", SERIAL, rules) == (
        f"{SERIAL}_port_udp_51820"
    )
    assert port_counterpart(f"{SERIAL}-port_forward_other", SERIAL, rules) is None
    # a description that fits two forwardings tells none of them
    rules["tcp_81"] = _rule("tcp_81", "Web Server")
    assert port_counterpart(f"{SERIAL}-port_forward_web_server", SERIAL, rules) is None


def test_the_entities_of_a_repeater_go_to_the_one_controlled_here():
    repeaters = {"11:22:33:44:55:66": "aa:bb:cc:dd:ee:ff"}
    uid = "112233445566"
    assert repeater_counterpart(f"{uid}-reboot", SERIAL, repeaters) == (
        f"{SERIAL}_aa:bb:cc:dd:ee:ff_reboot",
        "",
    )
    assert repeater_counterpart(f"{uid}-wi_fi_main_5ghz", SERIAL, repeaters)[0] == (
        f"{SERIAL}_aa:bb:cc:dd:ee:ff_wifi_5ghz"
    )
    assert repeater_counterpart(f"{uid}-device_uptime", SERIAL, repeaters)[0] == (
        f"{SERIAL}_aa:bb:cc:dd:ee:ff_box_uptime"
    )
    assert repeater_counterpart(f"{uid}-reconnect", SERIAL, repeaters) == (None, "not_covered")
    assert repeater_counterpart(f"{uid}-something_new", SERIAL, repeaters) == (None, "unknown")
    # a repeater that is not controlled here is another box, as before
    assert repeater_counterpart("665544332211-reboot", SERIAL, repeaters)[1] == (
        "repeater_not_controlled"
    )


async def test_a_port_forwarding_is_taken_over_by_its_description(hass, fake_client, entry):
    await _setup(hass, entry)
    description = fake_client.port_rules["tcp_5027"].description
    assert description
    slug = description.lower().replace(" ", "_")
    _, made = _core(hass, ("switch", f"{SERIAL}-port_forward_{slug}"))

    row = _rows(scan(hass, entry))[made[f"{SERIAL}-port_forward_{slug}"].entity_id]
    assert row["status"] == "migrate"
    assert row["target_entity_id"] == "switch.fritz_network_port_tcp_5027"


def _fake_core_integration(hass):
    """The real core integration needs libraries this project lacks; it is not the subject."""
    mock_integration(
        hass,
        MockModule(
            "fritz",
            async_setup_entry=AsyncMock(return_value=True),
            async_unload_entry=AsyncMock(return_value=True),
        ),
    )


async def _take_over(hass, entry, *unique_ids):
    _fake_core_integration(hass)
    await _setup(hass, entry)
    core, made = _core(hass, *unique_ids)
    return core, made, scan(hass, entry)


async def test_taking_over_moves_the_core_entity_onto_the_device_here(hass, fake_client, entry):
    uid = f"{SERIAL}-is_connected"
    core, made, preview = await _take_over(hass, entry, ("binary_sensor", uid))
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    core_id = made[uid].entity_id
    ours = registry.async_get("binary_sensor.fritz_network_internet_connected")
    # the core row has its own marks, the one here has others: both are kept
    registry.async_update_entity(core_id, name="My line", labels={"a"}, icon="mdi:lan")
    registry.async_update_entity(ours.entity_id, labels={"b"})

    result = await async_run(hass, entry, preview["token"])
    await hass.async_block_till_done()

    assert result["moved"] == 1 and result["failed"] == []
    moved = registry.async_get(core_id)
    assert (moved.platform, moved.unique_id) == ("fritzbox_network", ours.unique_id)
    assert moved.config_entry_id == entry.entry_id
    assert moved.device_id == ours.device_id and devices.async_get(moved.device_id)
    assert (moved.name, moved.icon, moved.labels) == ("My line", "mdi:lan", {"a", "b"})
    # ours is gone, and nothing is found twice
    assert registry.async_get(ours.entity_id) is None or ours.entity_id == core_id
    assert (
        registry.async_get_entity_id("binary_sensor", "fritzbox_network", ours.unique_id) == core_id
    )
    # the core integration is off, not deleted
    assert core.disabled_by is ConfigEntryDisabler.USER
    assert core.state is ConfigEntryState.NOT_LOADED
    # the entry reloaded: the entity lives under the id of the core one
    assert hass.states.get(core_id) is not None
    assert (await async_journal(hass, entry))["moved"][0]["entity_id"] == core_id


async def test_the_area_and_name_of_the_core_device_go_to_the_one_here(hass, fake_client, entry):
    from homeassistant.helpers import area_registry as ar

    uid = f"{SERIAL}-is_connected"
    core, made, preview = await _take_over(hass, entry, ("binary_sensor", uid))
    registry, devices = er.async_get(hass), dr.async_get(hass)
    ours = registry.async_get("binary_sensor.fritz_network_internet_connected")
    area = ar.async_get(hass).async_create("Cellar")
    core_device = devices.async_get_or_create(
        config_entry_id=core.entry_id, identifiers={("fritz", SERIAL)}, name="Box"
    )
    devices.async_update_device(core_device.id, area_id=area.id, name_by_user="Router")
    registry.async_update_entity(made[uid].entity_id, device_id=core_device.id)

    await async_run(hass, entry, preview["token"])

    here = devices.async_get(ours.device_id)
    assert (here.area_id, here.name_by_user) == (area.id, "Router")


async def test_a_changed_preview_is_refused(hass, fake_client, entry):
    _, _, preview = await _take_over(hass, entry, ("binary_sensor", f"{SERIAL}-is_connected"))
    _core(hass, ("sensor", f"{SERIAL}-kb_s_sent"))

    with pytest.raises(MigrationRefused) as err:
        await async_run(hass, entry, preview["token"])
    assert err.value.code == "changed"
    assert await async_journal(hass, entry) is None


async def test_nothing_to_take_over_is_refused(hass, fake_client, entry):
    _fake_core_integration(hass)
    await _setup(hass, entry)
    with pytest.raises(MigrationRefused) as err:
        await async_run(hass, entry, scan(hass, entry)["token"])
    assert err.value.code == "no_core"
    _core(hass, ("button", f"{SERIAL}-cleanup"))
    with pytest.raises(MigrationRefused) as err:
        await async_run(hass, entry, scan(hass, entry)["token"])
    assert err.value.code == "nothing"


async def test_the_entities_without_a_counterpart_stay_with_the_core_integration(
    hass, fake_client, entry
):
    keep = f"{SERIAL}-cleanup"
    uid = f"{SERIAL}-is_connected"
    core, made, preview = await _take_over(hass, entry, ("binary_sensor", uid), ("button", keep))
    await async_run(hass, entry, preview["token"])

    left = er.async_get(hass).async_get(made[keep].entity_id)
    assert (left.platform, left.config_entry_id) == ("fritz", core.entry_id)


async def test_a_second_run_is_refused_until_the_first_is_undone(hass, fake_client, entry):
    uid = f"{SERIAL}-is_connected"
    core, made, preview = await _take_over(
        hass, entry, ("binary_sensor", uid), ("sensor", f"{SERIAL}-kb_s_sent")
    )
    await async_run(hass, entry, preview["token"])
    await hass.async_block_till_done()
    with pytest.raises(MigrationRefused) as err:
        await async_run(hass, entry, scan(hass, entry)["token"])
    assert err.value.code in ("already_done", "nothing")


async def test_undo_gives_the_entities_back_and_turns_the_core_integration_on(
    hass, fake_client, entry
):
    uid = f"{SERIAL}-is_connected"
    core, made, preview = await _take_over(hass, entry, ("binary_sensor", uid))
    registry = er.async_get(hass)
    core_id = made[uid].entity_id
    before = registry.async_get(core_id)
    await async_run(hass, entry, preview["token"])
    await hass.async_block_till_done()

    result = await async_undo(hass, entry)
    await hass.async_block_till_done()

    assert result == {"back": 1, "failed": []}
    back = registry.async_get(core_id)
    assert (back.platform, back.unique_id, back.config_entry_id) == (
        "fritz",
        uid,
        core.entry_id,
    )
    assert back.device_id == before.device_id
    assert core.disabled_by is None
    # ours is made again under its usual id
    assert registry.async_get("binary_sensor.fritz_network_internet_connected") is not None
    assert await async_journal(hass, entry) is None
    with pytest.raises(MigrationRefused) as err:
        await async_undo(hass, entry)
    assert err.value.code == "no_journal"


async def test_the_panel_runs_and_undoes_the_takeover(hass, hass_ws_client, fake_client, entry):
    _fake_core_integration(hass)
    await _setup(hass, entry)
    _core(hass, ("binary_sensor", f"{SERIAL}-is_connected"))
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": COMMAND, "entry_id": entry.entry_id})
    preview = (await client.receive_json())["result"]
    assert preview["done"] is None

    await client.send_json_auto_id(
        {"type": "fritzbox_network/migrate/run", "entry_id": entry.entry_id, "token": "stale"}
    )
    assert (await client.receive_json())["error"]["code"] == "changed"
    await client.send_json_auto_id(
        {
            "type": "fritzbox_network/migrate/run",
            "entry_id": entry.entry_id,
            "token": preview["token"],
        }
    )
    ran = await client.receive_json()
    assert ran["success"] and ran["result"]["moved"] == 1
    await hass.async_block_till_done()

    await client.send_json_auto_id({"type": COMMAND, "entry_id": entry.entry_id})
    assert (await client.receive_json())["result"]["done"]["count"] == 1
    await client.send_json_auto_id(
        {"type": "fritzbox_network/migrate/undo", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["result"]["back"] == 1
