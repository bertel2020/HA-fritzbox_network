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
