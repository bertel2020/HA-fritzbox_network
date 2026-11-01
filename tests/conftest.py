"""Fixtures: a fake FRITZ!Box client fed with the anonymised captures."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fritzconnection.core.exceptions import FritzActionError
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
REPEATER = "02:00:00:00:00:0e"


# what a VDSL box answers, shortened and with documentation addresses
INTERNET_FAST = {
    "GetStatusInfo": {
        "NewConnectionStatus": "Connected",
        "NewLastConnectionError": "ERROR_NONE",
        "NewUptime": 65439,
    },
    "GetTotalBytesSent": {"NewTotalBytesSent": 1_000_000},
    "GetTotalBytesReceived": {"NewTotalBytesReceived": 5_000_000},
}
INTERNET_SLOW = {
    "GetCommonLinkProperties": {
        "NewLayer1DownstreamMaxBitRate": 55_020_000,
        "NewLayer1UpstreamMaxBitRate": 11_000_000,
        "NewPhysicalLinkStatus": "Up",
        "NewWANAccessType": "DSL",
    },
    "GetExternalIPAddress": {"NewExternalIPAddress": "203.0.113.7"},
    "X_AVM_DE_GetExternalIPv6Address": {"NewExternalIPv6Address": "2001:db8::1"},
    "X_AVM_DE_GetIPv6Prefix": {"NewIPv6Prefix": "2001:db8:1::", "NewPrefixLength": 56},
    "X_AVM_DE_GetDNSServer": {
        "NewIPv4DNSServer1": "198.51.100.1",
        "NewIPv4DNSServer2": "198.51.100.2",
    },
    "X_AVM_DE_GetIPv6DNSServer": {"NewIPv6DNSServer1": "2001:db8::53"},
    "X_AVM-DE_GetDSLInfo": {
        "NewLinkStatus": "Up",
        "NewModulationType": "VDSL",
        "NewCurrentProfile": "17a",
        "NewDownstreamCurrRate": 56316,
        "NewUpstreamCurrRate": 11260,
        "NewDownstreamMaxRate": 96347,
        "NewUpstreamMaxRate": 34957,
        "NewDownstreamNoiseMargin": 170,
        "NewUpstreamNoiseMargin": 220,
        "NewDownstreamAttenuation": 70,
        "NewUpstreamAttenuation": 70,
        "NewFECErrors": 96,
        "NewCRCErrors": 0,
    },
}


class FakeClient:
    model_name = "FRITZ!Box 7590 AX"
    system_version = "8.25"
    serial_number = "SERIAL1"

    def __init__(self) -> None:
        self.hosts = parse_hosts((FIXTURES / "hosts.xml").read_text())
        self.mesh = parse_mesh((FIXTURES / "mesh.json").read_text())
        self.writable = True
        self.repeater = False
        self.auto_wol: dict[str, bool] = {}
        self.profiles = {"filtprof1": "Standard", "filtprof2": "Kids"}
        self.calls: list[tuple] = []
        self.internet_reads: list[bool] = []
        self.fail_actions = False
        self.internet_fast: dict = {key: dict(value) for key, value in INTERNET_FAST.items()}
        self.internet_slow: dict = {key: dict(value) for key, value in INTERNET_SLOW.items()}

    def connect(self) -> None:
        return None

    def can_write(self) -> bool:
        return self.writable

    def is_mesh_repeater(self) -> bool:
        return self.repeater

    def get_hosts(self):
        return list(self.hosts)

    def get_internet(self, details: bool):
        self.internet_reads.append(details)
        return self.internet_fast, self.internet_slow if details else {}

    def reconnect(self) -> None:
        self.calls.append(("reconnect",))
        if self.fail_actions:
            raise FritzActionError("refused")

    def reboot(self) -> None:
        self.calls.append(("reboot",))
        if self.fail_actions:
            raise FritzActionError("refused")

    def get_host_ip(self, mac: str) -> str | None:
        return next((h.ip for h in self.hosts if h.mac == mac), None)

    def get_mesh(self):
        return self.mesh

    def set_internet_access(self, ip: str, allowed: bool) -> None:
        self.calls.append(("internet", ip, allowed))

    def wake_on_lan(self, mac: str) -> None:
        self.calls.append(("wol", mac))

    def get_auto_wol(self, mac: str) -> bool:
        return self.auto_wol.get(mac, False)

    def set_auto_wol(self, mac: str, enabled: bool) -> None:
        self.auto_wol[mac] = enabled
        self.calls.append(("auto_wol", mac, enabled))

    def set_priority(self, ip: str, enabled: bool) -> None:
        self.calls.append(("priority", ip, enabled))

    def set_friendly_name(self, mac: str, name: str) -> None:
        self.calls.append(("name", mac, name))

    def get_filter_profiles(self) -> dict[str, str]:
        return dict(self.profiles)

    def set_filter_profile(self, ip: str, profile_id: str) -> None:
        self.calls.append(("profile", ip, profile_id))


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
