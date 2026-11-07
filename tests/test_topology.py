"""The topology subscription behind the card."""

import asyncio
from dataclasses import replace

from homeassistant.helpers import device_registry as dr, entity_registry as er

from custom_components.fritzbox_network.const import DOMAIN

from .conftest import BOX, LAN, REPEATER, WLAN

COMMAND = "fritzbox_network/subscribe_topology"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def _subscribe(client, **extra):
    await client.send_json_auto_id({"type": COMMAND, **extra})
    result = await client.receive_json()
    assert result["success"], result
    event = await client.receive_json()
    return event["event"]


async def test_topology_groups_the_devices_by_access_point(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.hosts = [
        *fake_client.hosts,
        replace(
            fake_client.hosts[0], mac=REPEATER, mac_list=[REPEATER], name="repeater", active=True
        ),
    ]
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    nodes = {n["mac"]: n for n in topology["nodes"]}
    assert nodes[BOX]["role"] == "master"
    assert topology["nodes"][0]["mac"] == BOX
    assert REPEATER in nodes
    devices = {c["mac"]: c for c in topology["clients"]}
    # a repeater is an access point, not one of the devices at it
    assert REPEATER not in devices and BOX not in devices
    assert devices[WLAN]["ap_mac"] == REPEATER
    assert devices[WLAN]["link_type"] == "wlan"
    assert devices[LAN]["ap_mac"] == BOX
    assert devices[LAN]["online"] is True
    tracker = er.async_get(hass).async_get_entity_id("device_tracker", DOMAIN, WLAN)
    assert devices[WLAN]["entity_id"] == tracker == "device_tracker.fritz_020000000003"


async def test_topology_says_how_a_repeater_reaches_the_box(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    nodes = {n["mac"]: n for n in (await _subscribe(client))["nodes"]}

    assert nodes[BOX]["uplink"] is None
    # the repeater of the capture hangs on a cable
    assert nodes[REPEATER]["uplink"] == {"type": "lan", "band": None, "signal_dbm": None}


async def test_topology_gives_band_and_signal_of_a_wifi_backhaul(
    hass, hass_ws_client, fake_client, entry
):
    links = fake_client.mesh.links
    links[REPEATER] = replace(links[REPEATER], link_type="WLAN", band="5ghz", signal_dbm=-58)
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    nodes = {n["mac"]: n for n in (await _subscribe(client))["nodes"]}

    assert nodes[REPEATER]["uplink"] == {"type": "wlan", "band": "5ghz", "signal_dbm": -58}


async def test_a_repeater_without_a_known_link_has_no_uplink(
    hass, hass_ws_client, fake_client, entry
):
    del fake_client.mesh.links[REPEATER]
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    nodes = {n["mac"]: n for n in (await _subscribe(client))["nodes"]}

    assert nodes[REPEATER]["uplink"] is None


async def test_topology_is_sent_again_after_an_update(hass, hass_ws_client, fake_client, entry):
    coordinator = await _setup(hass, entry)
    client = await hass_ws_client(hass)
    first = await _subscribe(client)
    assert {c["mac"]: c for c in first["clients"]}[WLAN]["name"] != "renamed"

    fake_client.hosts = [
        replace(h, name="renamed") if h.mac == WLAN else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()

    update = (await client.receive_json())["event"]
    assert {c["mac"]: c for c in update["clients"]}[WLAN]["name"] == "renamed"


async def test_topology_without_mesh_has_no_access_points(hass, hass_ws_client, fake_client, entry):
    fake_client.mesh = None
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    assert topology["nodes"] == []
    assert topology["clients"] and all(c["ap_mac"] is None for c in topology["clients"])


async def test_topology_needs_an_administrator(
    hass, hass_ws_client, hass_admin_user, fake_client, entry
):
    await _setup(hass, entry)
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": COMMAND})
    result = await client.receive_json()

    assert not result["success"]
    assert result["error"]["code"] == "unauthorized"


async def test_topology_of_an_unknown_entry_is_an_error(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": COMMAND, "entry_id": "nope"})
    result = await client.receive_json()

    assert not result["success"]
    assert result["error"]["code"] == "not_found"


def test_the_card_is_shipped_with_the_integration():
    from custom_components.fritzbox_network.panel import CARD_FILE, FRONTEND_DIR

    assert CARD_FILE.is_file() and CARD_FILE.parent == FRONTEND_DIR
    assert (FRONTEND_DIR / "shared.js").is_file()


def test_the_frontend_version_follows_every_file(tmp_path, monkeypatch):
    from custom_components.fritzbox_network import panel

    (tmp_path / "a.js").write_text("one")
    monkeypatch.setattr(panel, "FRONTEND_DIR", tmp_path)
    first = panel.frontend_version()
    assert first == panel.frontend_version()
    (tmp_path / "b.js").write_text("two")
    second = panel.frontend_version()
    assert second != first
    (tmp_path / "a.js").write_text("changed")
    assert panel.frontend_version() != second


async def test_topology_carries_the_vendor_when_the_option_is_on(
    hass, hass_ws_client, fake_client, entry
):
    fake_client.hosts = [
        replace(fake_client.hosts[0], mac="24:0a:c4:00:00:01", mac_list=["24:0a:c4:00:00:01"]),
        *fake_client.hosts[1:],
    ]
    hass.config_entries.async_update_entry(entry, options={"show_vendor": True})
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    vendors = {c["mac"]: c["vendor"] for c in topology["clients"]}
    assert vendors["24:0a:c4:00:00:01"] == "Espressif Inc."
    assert vendors[WLAN] is None  # a private fake MAC


async def test_topology_carries_the_highest_rates_of_the_link(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    wlan = {c["mac"]: c for c in topology["clients"]}[WLAN]
    assert wlan["rate_max_download"] and wlan["rate_max_upload"]
    assert wlan["rate_download"] <= wlan["rate_max_download"]


async def test_topology_carries_the_actions_of_a_device(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    lan = {c["mac"]: c for c in topology["clients"]}[LAN]
    registry = er.async_get(hass)
    for name, platform in (
        ("internet_access", "switch"),
        ("priority", "switch"),
        ("wake_on_lan", "button"),
    ):
        entity_id = lan["actions"].get(name)
        if entity_id is not None:
            entry_ = registry.async_get(entity_id)
            assert entry_ and entry_.domain == platform and entry_.platform == DOMAIN
    assert lan["actions"]["internet_access"] == "switch.fritz_020000000004_internet_access"


async def test_topology_carries_the_radios_and_the_band(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    radios = {n["mac"]: n["radios"] for n in topology["nodes"]}
    assert radios[BOX]
    for radio in radios[BOX].values():
        assert set(radio) == {
            "channel",
            "utilization",
            "noise_dbm",
            "ssid",
            "channel_width",
            "security",
            "guest",
        }
    assert all("band" in c for c in topology["clients"])


async def test_topology_carries_what_the_panel_shows(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    assert topology["entry_id"] == entry.entry_id
    assert topology["can_write"] is True
    lan = {c["mac"]: c for c in topology["clients"]}[LAN]
    for field in (
        "ssid",
        "hostname",
        "port",
        "speed",
        "vpn",
        "wan_access",
        "priority",
        "filter_profile",
        "private_mac",
        "device_id",
        "last_online",
        "created_at",
    ):
        assert field in lan
    registry = dr.async_get(hass)
    assert registry.async_get(lan["device_id"]).connections == {("mac", LAN)}
    assert lan["private_mac"] is True  # the fake MACs are locally administered
    assert lan["created_at"]


async def test_entries_lists_the_boxes(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "fritzbox_network/entries"})
    result = await client.receive_json()

    assert result["success"]
    assert result["result"] == [{"entry_id": entry.entry_id, "title": entry.title}]


async def test_entries_needs_an_administrator(
    hass, hass_ws_client, hass_admin_user, fake_client, entry
):
    await _setup(hass, entry)
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "fritzbox_network/entries"})
    result = await client.receive_json()

    assert not result["success"]
    assert result["error"]["code"] == "unauthorized"


async def test_topology_carries_the_labels_of_the_internet_switch(
    hass, hass_ws_client, fake_client, entry
):
    from homeassistant.helpers import label_registry as lr

    await _setup(hass, entry)
    label = lr.async_get(hass).async_create("Kinder")
    registry = er.async_get(hass)
    switch = "switch.fritz_020000000004_internet_access"
    registry.async_update_entity(switch, labels={label.label_id})
    client = await hass_ws_client(hass)

    topology = await _subscribe(client)

    assert topology["labels"] == [
        {"id": label.label_id, "name": "Kinder", "icon": None, "color": None}
    ]
    clients = {c["mac"]: c for c in topology["clients"]}
    assert clients[LAN]["labels"] == [label.label_id]
    assert clients[WLAN]["labels"] == []


async def test_topology_is_sent_again_when_a_label_is_set_or_made(
    hass, hass_ws_client, fake_client, entry
):
    from homeassistant.helpers import label_registry as lr

    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    first = await _subscribe(client)
    assert first["labels"] == []

    label = lr.async_get(hass).async_create("Gäste")
    update = (await client.receive_json())["event"]
    assert [item["name"] for item in update["labels"]] == ["Gäste"]

    er.async_get(hass).async_update_entity(
        "switch.fritz_020000000004_internet_access", labels={label.label_id}
    )
    update = (await client.receive_json())["event"]
    assert {c["mac"]: c for c in update["clients"]}[LAN]["labels"] == [label.label_id]


async def test_a_repeater_is_connected_to_the_mesh_until_the_box_stops_listing_it(
    hass, fake_client, entry
):
    from .conftest import REPEATER

    coordinator = await _setup(hass, entry)
    repeater = REPEATER.replace(":", "").lower()
    state = hass.states.get(f"binary_sensor.fritz_{repeater}_mesh_connected")
    assert state.state == "on"
    assert state.attributes["role"] == "slave"
    assert state.attributes["mesh_version"] == "8.62"
    # the box has no such sensor: it is the mesh
    assert (
        hass.states.get(f"binary_sensor.fritz_{BOX.replace(':', '').lower()}_mesh_connected")
        is None
    )

    link = fake_client.mesh.links.get(REPEATER)
    uplink = hass.states.get(f"sensor.fritz_{repeater}_uplink")
    assert uplink.state == ((link.ap_name or link.ap_mac) if link else "unknown")

    fake_client.mesh.nodes = {
        uid: n for uid, n in fake_client.mesh.nodes.items() if n.mac != REPEATER
    }
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(f"binary_sensor.fritz_{repeater}_mesh_connected").state == "off"

    # no topology at all is not a lost repeater
    fake_client.mesh = None
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(f"binary_sensor.fritz_{repeater}_mesh_connected").state == "unknown"


async def test_a_repeater_the_box_stops_listing_is_counted_and_a_repair_after_a_while(
    hass, fake_client, entry
):
    from datetime import timedelta

    from homeassistant.helpers import issue_registry as ir
    from homeassistant.util import dt as dt_util

    from .conftest import REPEATER

    coordinator = await _setup(hass, entry)
    nodes = dict(fake_client.mesh.nodes)
    state = hass.states.get("sensor.fritz_network_mesh_nodes")
    assert state.state == str(len(nodes))
    assert state.attributes["repeaters"] == 1
    assert state.attributes["lost_repeaters"] == []

    fake_client.mesh.nodes = {uid: n for uid, n in nodes.items() if n.mac != REPEATER}
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    state = hass.states.get("sensor.fritz_network_mesh_nodes")
    assert state.state == str(len(nodes) - 1)
    assert state.attributes["lost_repeaters"] == ["FRITZ!Repeater 1200 AX"]
    issue = f"mesh_repeater_lost_{entry.entry_id}"
    registry = ir.async_get(hass)
    # not at once: a repeater that restarts is gone for a few minutes
    assert registry.async_get_issue("fritzbox_network", issue) is None

    coordinator.repeaters_lost_since[REPEATER] = dt_util.utcnow() - timedelta(minutes=11)
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert registry.async_get_issue("fritzbox_network", issue) is not None

    fake_client.mesh.nodes = nodes
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert registry.async_get_issue("fritzbox_network", issue) is None
    assert coordinator.repeaters_lost_since == {}


async def test_topology_names_the_repeaters_the_box_does_not_list(
    hass, hass_ws_client, fake_client, entry
):
    from .conftest import REPEATER

    coordinator = await _setup(hass, entry)
    client = await hass_ws_client(hass)
    topology = await _subscribe(client)
    assert topology["lost_repeaters"] == []
    repeater = next(n for n in topology["nodes"] if n["mac"] == REPEATER)
    assert repeater["firmware"] and repeater["mesh_version"] == "8.62"

    fake_client.mesh.nodes = {
        uid: n for uid, n in fake_client.mesh.nodes.items() if n.mac != REPEATER
    }
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    event = await client.receive_json()
    assert event["event"]["lost_repeaters"] == [{"mac": REPEATER, "name": "FRITZ!Repeater 1200 AX"}]


async def test_the_panel_is_told_when_the_options_make_the_entry_reload(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _subscribe(client)

    # a device removed by hand only joins the hidden list: no reload, nothing to tell
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, "hidden_macs": ["02:00:00:00:00:99"]}
    )
    await hass.async_block_till_done()

    hass.config_entries.async_update_entry(entry, options={**entry.options, "ignore_guests": True})
    await hass.async_block_till_done()

    seen = []
    while True:
        try:
            message = await asyncio.wait_for(client.receive_json(), timeout=1)
        except TimeoutError:
            break
        seen.append(message["event"])
    assert {"reload": True} in seen
    assert sum(event == {"reload": True} for event in seen) == 1


async def test_the_panel_is_told_when_the_entry_is_reloaded_by_hand(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    await _subscribe(client)

    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    message = await asyncio.wait_for(client.receive_json(), timeout=5)
    assert message["event"] == {"reload": True}
