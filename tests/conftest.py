"""Fixtures: a fake FRITZ!Box client fed with the anonymised captures."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.models import parse_hosts, parse_mesh

FIXTURES = Path(__file__).parent / "fixtures"

# Fake MACs of the capture: 03 WLAN online, 04 LAN online, 0b LAN online,
# 01 offline, 0d guest offline, 05 the box itself.
WLAN = "02:00:00:00:00:03"
LAN = "02:00:00:00:00:04"
OFFLINE = "02:00:00:00:00:01"
BOX = "02:00:00:00:00:05"


class FakeClient:
    model_name = "FRITZ!Box 7590 AX"
    system_version = "8.25"
    serial_number = "SERIAL1"

    def __init__(self) -> None:
        self.hosts = parse_hosts((FIXTURES / "hosts.xml").read_text())
        self.mesh = parse_mesh((FIXTURES / "mesh.json").read_text())
        self.writable = True
        self.calls: list[tuple] = []

    def connect(self) -> None:
        return None

    def can_write(self) -> bool:
        return self.writable

    def get_hosts(self):
        return list(self.hosts)

    def get_mesh(self):
        return self.mesh

    def set_internet_access(self, ip: str, allowed: bool) -> None:
        self.calls.append(("internet", ip, allowed))

    def wake_on_lan(self, mac: str) -> None:
        self.calls.append(("wol", mac))


@pytest.fixture(autouse=True)
def _enable_custom_integrations(enable_custom_integrations):
    return


@pytest.fixture
def fake_client():
    client = FakeClient()
    with (
        patch("custom_components.fritzbox_network.FritzNetworkClient", return_value=client),
        patch(
            "custom_components.fritzbox_network.config_flow.FritzNetworkClient", return_value=client
        ),
    ):
        yield client


@pytest.fixture
def entry(hass) -> MockConfigEntry:
    config_entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="SERIAL1",
        title="FRITZ!Box 7590 AX",
        data={"host": "192.168.178.1", "username": "user", "password": "secret"},
    )
    config_entry.add_to_hass(hass)
    return config_entry
