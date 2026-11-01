"""The shipped blueprints stay valid for Home Assistant."""

from pathlib import Path

from homeassistant.components.blueprint.schemas import BLUEPRINT_SCHEMA
from homeassistant.util.yaml import parse_yaml
import pytest

BLUEPRINTS = sorted(
    (Path(__file__).parent.parent / "blueprints" / "automation" / "fritzbox_network").glob("*.yaml")
)


def test_blueprints_exist():
    assert len(BLUEPRINTS) == 2


@pytest.mark.parametrize("path", BLUEPRINTS, ids=lambda p: p.name)
def test_blueprint_is_valid_and_importable(path):
    data = BLUEPRINT_SCHEMA(parse_yaml(path.read_text()))

    source_url = data["blueprint"]["source_url"]
    assert source_url.endswith(f"/blueprints/automation/fritzbox_network/{path.name}")


SCHEDULE = next(p for p in BLUEPRINTS if p.name == "internet_schedule.yaml")


def _switches_template():
    return parse_yaml(SCHEDULE.read_text())["variables"]["switches"]


async def test_the_schedule_takes_the_devices_and_the_labelled_switches(hass, fake_client, entry):
    from homeassistant.helpers import entity_registry as er, label_registry as lr
    from homeassistant.helpers.template import Template

    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    registry = er.async_get(hass)
    label = lr.async_get(hass).async_create("Kinder")
    lan = "switch.fritz_020000000004_internet_access"
    wlan = "switch.fritz_020000000003_internet_access"
    registry.async_update_entity(lan, labels={label.label_id})
    # a switch of another integration with the same label must stay out
    other = registry.async_get_or_create("switch", "other", "x", suggested_object_id="other_switch")
    registry.async_update_entity(other.entity_id, labels={label.label_id})
    # so must a non-switch entity of this integration with the label
    sensor = "sensor.fritz_020000000004_ip_address"
    registry.async_update_entity(sensor, labels={label.label_id})

    def render(devices, group):
        template = Template(_switches_template(), hass)
        return template.async_render({"device_switches": devices, "group_label": group})

    assert render([wlan], label.label_id) == [wlan, lan]
    assert render([lan], label.label_id) == [lan]  # once each
    assert render([wlan], "") == [wlan]
    assert render([], "") == []
    assert render([], "no-such-label") == []
