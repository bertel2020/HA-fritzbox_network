"""The preview of taking over the entities of the core integration: it reads and changes nothing."""

from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.fritzbox_network.migration import counterpart, scan

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
    assert counterpart(f"{SERIAL}-connection_uptime", SERIAL)[2] == "incompatible"
    assert counterpart(f"{SERIAL}-cleanup", SERIAL)[2] == "not_covered"
    assert counterpart(f"{SERIAL}-port_forward_web", SERIAL)[2] == "not_covered"
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
        ("sensor", f"{SERIAL}-connection_uptime"),
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
        (f"{SERIAL}-connection_uptime", "skip", "incompatible"),
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
