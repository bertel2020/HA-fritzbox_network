"""icons.json only names entities the integration has."""

import json
from pathlib import Path

COMPONENT = Path(__file__).parent.parent / "custom_components" / "fritzbox_network"


def test_every_icon_belongs_to_a_translated_entity():
    icons = json.loads((COMPONENT / "icons.json").read_text())["entity"]
    names = json.loads((COMPONENT / "strings.json").read_text())["entity"]

    for platform, keys in icons.items():
        for key, icon in keys.items():
            assert key in names[platform], f"{platform}.{key} has an icon but no name"
            assert icon["default"].startswith("mdi:")
            for state in icon.get("state", {}):
                # a state of a sensor with fixed states must be one the sensor can have
                states = names[platform][key].get("state")
                if states:
                    assert state in states, f"{platform}.{key}: {state}"
