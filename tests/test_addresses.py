"""The address page: the network of the box, the fixed addresses and what the user notes."""

from unittest.mock import MagicMock

from custom_components.fritzbox_network.addresses import AddressNotes, empty_notes
from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.models import check_address_range, parse_network

from .conftest import BOX, LAN

OVERVIEW = f"{DOMAIN}/address/overview"
FIXED = f"{DOMAIN}/address/fixed"
SAVE = f"{DOMAIN}/address/save"


async def _setup(hass, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


def test_the_network_comes_from_the_dhcp_service_of_the_box():
    network = parse_network(
        {
            "NewSubnetMask": "255.255.255.0",
            "NewIPRouters": "192.168.79.1",
            "NewDHCPServerEnable": True,
            "NewMinAddress": "192.168.79.100",
            "NewMaxAddress": "192.168.79.200",
            "NewReservedAddresses": "192.168.79.250, 192.168.79.251",
        }
    )
    assert network == {
        "mask": "255.255.255.0",
        "gateway": "192.168.79.1",
        "dhcp": True,
        "pool_from": "192.168.79.100",
        "pool_to": "192.168.79.200",
        "reserved": ["192.168.79.250", "192.168.79.251"],
    }
    assert parse_network({}) is None


async def test_the_notes_survive_a_restart():
    store = MagicMock()
    notes = AddressNotes(store, {})
    assert notes.data == empty_notes()
    notes.replace({**empty_notes(), "notes": {"192.168.79.5": "Beamer"}})
    assert notes.data["notes"] == {"192.168.79.5": "Beamer"}
    assert AddressNotes(store, notes.data).data["notes"] == {"192.168.79.5": "Beamer"}
    store.async_delay_save.assert_called_once()


async def test_the_overview_has_the_network_and_the_notes(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    result = (await _call(client, OVERVIEW, entry_id=entry.entry_id))["result"]
    assert result["network"]["gateway"] == "192.168.178.1"
    assert result["own"] == empty_notes()

    fake_client.network = None
    result = (await _call(client, OVERVIEW, entry_id=entry.entry_id))["result"]
    assert result["network"] is None


async def test_the_fixed_addresses_are_read_a_few_devices_at_a_time(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    result = await _call(client, FIXED, entry_id=entry.entry_id, macs=[BOX, LAN])
    assert result["result"]["reservations"][BOX] == {"fixed": True, "editable": True}
    assert result["result"]["reservations"][LAN]["fixed"] is False

    too_many = await _call(client, FIXED, entry_id=entry.entry_id, macs=[LAN] * 13)
    assert too_many["success"] is False


async def test_what_the_user_notes_is_kept_and_checked(hass, hass_ws_client, fake_client, entry):
    coordinator = await _setup(hass, entry)
    client = await hass_ws_client(hass)
    own = {
        "notes": {"192.168.178.5": "Beamer"},
        "names": {LAN: "Küche"},
        "marks": ["192.168.178.45"],
        "muted": ["pool-usage"],
        "blocks": [{"id": 1, "name": "Kameras", "from": 60, "to": 69, "color": "--b2"}],
    }
    result = await _call(client, SAVE, entry_id=entry.entry_id, own=own)
    assert result["success"] is True
    assert coordinator.addresses.data["notes"] == {"192.168.178.5": "Beamer"}
    again = (await _call(client, OVERVIEW, entry_id=entry.entry_id))["result"]
    assert again["own"]["blocks"][0]["name"] == "Kameras"

    entry_row = {"id": 2, "name": "Besucher", "from": 200, "to": 210, "kind": "hold", "note": "Gäste"}
    saved = await _call(client, SAVE, entry_id=entry.entry_id, own={**own, "entries": [entry_row]})
    assert saved["success"] is True
    assert coordinator.addresses.data["entries"] == [entry_row]
    # older data without entries and without marks is still taken
    assert (await _call(client, SAVE, entry_id=entry.entry_id, own={k: v for k, v in own.items() if k != "marks"}))["success"] is True

    for bad in (
        {**own, "notes": {"not an ip": "x"}},
        {**own, "blocks": [{"id": 1, "name": "x", "from": 0, "to": 5, "color": "--b1"}]},
        {**own, "blocks": [{"id": 1, "name": "x", "from": 1, "to": 5, "color": "red"}]},
        {**own, "notes": {"192.168.178.5": "x" * 301}},
        {**own, "entries": [{**entry_row, "kind": "other"}]},
        {**own, "entries": [{**entry_row, "from": 0}]},
    ):
        refused = await _call(client, SAVE, entry_id=entry.entry_id, own=bad)
        assert refused["success"] is False


async def test_the_address_commands_need_an_administrator_and_a_known_box(
    hass, hass_ws_client, hass_admin_user, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    for command, extra in (
        (OVERVIEW, {}),
        (FIXED, {"macs": []}),
        (SAVE, {"own": empty_notes()}),
    ):
        result = await _call(client, command, entry_id="nope", **extra)
        assert result["error"]["code"] == "not_found", command

    hass_admin_user.groups = []
    client = await hass_ws_client(hass)
    for command, extra in ((OVERVIEW, {}), (SAVE, {"own": empty_notes()})):
        result = await _call(client, command, entry_id=entry.entry_id, **extra)
        assert result["error"]["code"] == "unauthorized", command


POOL = f"{DOMAIN}/address/pool"


def test_a_new_dhcp_range_has_to_fit_the_network_of_the_box():
    network = {"mask": "255.255.255.0", "gateway": "192.168.79.1"}
    check = lambda first, last: check_address_range(network, first, last)  # noqa: E731
    assert check("192.168.79.100", "192.168.79.200") is None
    assert check("192.168.79.2", "192.168.79.254") is None
    assert check("192.168.79.200", "192.168.79.100") == "order"
    assert check("192.168.78.100", "192.168.79.200") == "outside"
    assert check("192.168.79.0", "192.168.79.200") == "edge"
    assert check("192.168.79.100", "192.168.79.255") == "edge"
    assert check("192.168.79.1", "192.168.79.200") == "gateway"
    assert check("nonsense", "192.168.79.200") == "invalid"
    assert check_address_range({}, "192.168.79.1", "192.168.79.2") == "invalid"


async def test_the_dhcp_range_is_changed_when_it_fits(hass, hass_ws_client, fake_client, entry):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    result = await _call(
        client, POOL, entry_id=entry.entry_id, first="192.168.178.50", last="192.168.178.150"
    )
    assert result["success"] is True
    assert result["result"]["network"]["pool_from"] == "192.168.178.50"
    assert ("pool", "192.168.178.50", "192.168.178.150") in fake_client.calls


async def test_a_range_that_does_not_fit_or_a_missing_right_changes_nothing(
    hass, hass_ws_client, fake_client, entry
):
    await _setup(hass, entry)
    client = await hass_ws_client(hass)
    for first, last in (
        ("192.168.178.150", "192.168.178.50"),
        ("192.168.178.1", "192.168.178.50"),
        ("10.0.0.5", "10.0.0.50"),
    ):
        result = await _call(client, POOL, entry_id=entry.entry_id, first=first, last=last)
        assert result["error"]["code"] == "invalid_range", (first, last)
    not_ip = await _call(client, POOL, entry_id=entry.entry_id, first="x", last="y")
    assert not_ip["success"] is False
    pool_calls = lambda: [c for c in fake_client.calls if c[0] == "pool"]  # noqa: E731
    assert pool_calls() == []

    fake_client.fail_actions = True
    refused = await _call(
        client, POOL, entry_id=entry.entry_id, first="192.168.178.50", last="192.168.178.150"
    )
    assert refused["error"]["code"] == "unknown_error"
    assert len(pool_calls()) == 1  # tried once, the box said no

    fake_client.fail_actions = False
    entry.runtime_data.can_write = False
    forbidden = await _call(
        client, POOL, entry_id=entry.entry_id, first="192.168.178.50", last="192.168.178.150"
    )
    assert forbidden["error"]["code"] == "unauthorized"
    assert len(pool_calls()) == 1
