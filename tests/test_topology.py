"""The topology subscription behind the card."""

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
        assert set(radio) == {"channel", "utilization", "noise_dbm"}
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
