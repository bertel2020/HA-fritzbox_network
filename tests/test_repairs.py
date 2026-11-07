"""The optional repair for devices that have been offline for long."""

from datetime import timedelta

from homeassistant.helpers import device_registry as dr, issue_registry as ir
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC
from homeassistant.util import dt as dt_util

from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.repairs import (
    StaleDevicesFlow,
    async_create_fix_flow,
    async_update_stale_issue,
    stale_hosts,
)

from .conftest import OFFLINE, WLAN

OFFLINE_SENSOR = "sensor.fritz_020000000001_last_online"


async def _setup(hass, entry, **options):
    hass.config_entries.async_update_entry(entry, options=options)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


def _ago(days):
    return (dt_util.utcnow() - timedelta(days=days)).isoformat()


def _issue(hass, entry):
    return ir.async_get(hass).async_get_issue(DOMAIN, f"stale_devices_{entry.entry_id}")


async def test_only_devices_offline_longer_than_the_limit_are_stale(hass, fake_client, entry):
    await _setup(hass, entry, stale_repair=True, stale_days=30)

    # no time on record: not stale
    assert stale_hosts(hass, entry) == []
    hass.states.async_set(OFFLINE_SENSOR, _ago(10))
    assert stale_hosts(hass, entry) == []
    hass.states.async_set(OFFLINE_SENSOR, _ago(40))
    assert [h.mac for h, _ in stale_hosts(hass, entry)] == [OFFLINE]

    # an online device is never stale, whatever its sensor says
    hass.states.async_set("sensor.fritz_020000000003_last_online", _ago(400))
    assert [h.mac for h, _ in stale_hosts(hass, entry)] == [OFFLINE]


async def test_the_issue_comes_and_goes_with_the_devices(hass, fake_client, entry):
    await _setup(hass, entry, stale_repair=True, stale_days=30)
    assert _issue(hass, entry) is None

    hass.states.async_set(OFFLINE_SENSOR, _ago(40))
    await async_update_stale_issue(hass, entry)
    issue = _issue(hass, entry)
    assert issue.is_fixable
    assert issue.translation_placeholders == {"count": "1", "days": "30"}

    hass.states.async_set(OFFLINE_SENSOR, _ago(1))
    await async_update_stale_issue(hass, entry)
    assert _issue(hass, entry) is None


async def test_no_check_and_no_issue_while_the_option_is_off(hass, fake_client, entry):
    ir.async_create_issue(
        hass,
        DOMAIN,
        f"stale_devices_{entry.entry_id}",
        is_fixable=True,
        severity=ir.IssueSeverity.WARNING,
        translation_key="stale_devices",
    )

    await _setup(hass, entry)

    assert _issue(hass, entry) is None


async def test_the_fix_hides_the_chosen_devices(hass, fake_client, entry):
    await _setup(hass, entry, stale_repair=True, stale_days=30)
    hass.states.async_set(OFFLINE_SENSOR, _ago(40))
    await async_update_stale_issue(hass, entry)
    registry = dr.async_get(hass)
    assert registry.async_get_device_by_connection(
        (CONNECTION_NETWORK_MAC, OFFLINE), entry.entry_id
    )

    flow = await async_create_fix_flow(
        hass, f"stale_devices_{entry.entry_id}", _issue(hass, entry).data
    )
    assert isinstance(flow, StaleDevicesFlow)
    flow.hass = hass
    form = await flow.async_step_init()
    assert form["type"].value == "form"
    assert form["data_schema"]({})["macs"] == [OFFLINE]

    result = await flow.async_step_init({"macs": [OFFLINE]})
    await hass.async_block_till_done()

    assert result["type"].value == "create_entry"
    assert OFFLINE in entry.options["hidden_macs"]
    assert (
        registry.async_get_device_by_connection((CONNECTION_NETWORK_MAC, OFFLINE), entry.entry_id)
        is None
    )
    assert WLAN not in entry.options["hidden_macs"]


async def test_a_device_that_came_back_while_the_form_was_open_is_not_hidden(
    hass, fake_client, entry
):
    await _setup(hass, entry, stale_repair=True, stale_days=30)
    hass.states.async_set(OFFLINE_SENSOR, _ago(40))
    await async_update_stale_issue(hass, entry)
    flow = await async_create_fix_flow(
        hass, f"stale_devices_{entry.entry_id}", _issue(hass, entry).data
    )
    flow.hass = hass
    await flow.async_step_init()

    hass.states.async_set(OFFLINE_SENSOR, _ago(1))
    result = await flow.async_step_init({"macs": [OFFLINE]})
    await hass.async_block_till_done()

    assert result["type"].value == "create_entry"
    assert OFFLINE not in entry.options.get("hidden_macs", [])
