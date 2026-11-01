"""The topology subscription behind the card."""

from dataclasses import replace

from homeassistant.helpers import entity_registry as er

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
    from custom_components.fritzbox_network import CARD_FILE, CARD_URL

    assert CARD_FILE.is_file()
    assert CARD_URL.endswith(CARD_FILE.name)


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
