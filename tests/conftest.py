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
        self.guest_wifi: bool | None = False
        self.ports: list[dict] = []
        self.routes: list[dict] = []
        self.routes_ignore = False
        self.routes_new_enabled = False  # as the real box: a new route starts switched off
        self.firmware: dict = {"NewUpgradeAvailable": False}
        self.vpn: dict | None = None
        self.vpn_ignores = False
        self.network: dict | None = {
            "mask": "255.255.255.0",
            "gateway": "192.168.178.1",
            "dhcp": True,
            "pool_from": "192.168.178.20",
            "pool_to": "192.168.178.200",
            "reserved": [],
        }
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

    def get_vpn(self) -> dict | None:
        return self.vpn

    def set_vpn(self, uid: str, enabled: bool) -> None:
        self.calls.append(("vpn", uid, enabled))
        if self.fail_actions:
            raise FritzActionError("refused")
        if self.vpn_ignores:
            return
        for entry in self.vpn["data"]["init"]["boxConnections"].values():
            if entry["uid"] == uid:
                entry["active"] = enabled

    def get_network(self) -> dict | None:
        return self.network

    def set_address_range(self, first: str, last: str) -> None:
        self.calls.append(("pool", first, last))
        if self.fail_actions:
            raise FritzActionError("refused")
        self.network = {**self.network, "pool_from": first, "pool_to": last}

    def get_ip_reservations(self, macs: list[str], max_age: float = 600) -> dict:
        return {mac: {"fixed": mac == BOX, "editable": True} for mac in macs}

    def capture(self, interface, path, seconds, max_bytes, stop, progress) -> str:
        self.calls.append(("capture", interface, seconds))
        if self.fail_actions:
            raise ValueError("the box sent no data")
        path.write_bytes(
            b"\xd4\xc3\xb2\xa1\x02\x00\x04\x00" + b"\0" * 8 + b"\xff\xff\0\0\x01\0\0\0"
        )
        progress(24)
        return "time"

    def get_device_log(self, group=None) -> list[dict]:
        events = [
            {
                "id": "1",
                "group": "net",
                "date": "04.11.26",
                "time": "10:00:01",
                "msg": "Internet connection established",
            },
            {
                "id": "2",
                "group": "wlan",
                "date": "04.11.26",
                "time": "09:00:00",
                "msg": "WLAN device logged in",
            },
        ]
        return [e for e in events if group in (None, e["group"])]

    def get_capture_interfaces(self) -> list[dict]:
        return [
            {"id": "2-1", "label": "1. Internetverbindung"},
            {"id": "1-lan", "label": "lan"},
            {"id": "1-traceDH0", "label": "traceDH0"},
            {"id": "1-vap0", "label": "vap0"},
            {"id": "3-17", "label": "Schnittstelle 0 ('internet')"},
            {"id": "4-128", "label": "unbekannt"},
        ]

    def get_port_mappings(self) -> list[dict]:
        return [dict(p) for p in self.ports]

    def get_routes(self) -> list[dict]:
        return [dict(r) for r in self.routes]

    def set_route_enabled(self, route: dict, enabled: bool) -> None:
        self.calls.append(("route", route["destination"], route["mask"], enabled))
        if self.fail_actions:
            raise FritzActionError("refused")
        if self.routes_ignore:
            return
        for entry in self.routes:
            if (entry["destination"], entry["mask"], entry["source"]) == (
                route["destination"],
                route["mask"],
                route["source"],
            ):
                entry["enabled"] = enabled

    def add_route(self, network, gateway, metric, interface="LanHostConfigManagement1") -> None:
        self.calls.append(("route-add", str(network), str(gateway), metric, interface))
        if self.fail_actions:
            raise FritzActionError("refused")
        if self.routes_ignore:
            return
        self.routes.append(
            {
                "network": str(network),
                "destination": str(network.network_address),
                "mask": str(network.netmask),
                "source": "0.0.0.0",
                "source_mask": "0.0.0.0",
                "gateway": str(gateway),
                "interface": interface,
                "metric": metric,
                "enabled": self.routes_new_enabled,
            }
        )

    def delete_route(self, route: dict) -> None:
        self.calls.append(("route-delete", route["network"]))
        if self.fail_actions:
            raise FritzActionError("refused")
        if self.routes_ignore:
            return
        self.routes = [r for r in self.routes if r["network"] != route["network"]]

    def get_firmware(self) -> dict:
        return dict(self.firmware)

    def get_guest_wifi(self) -> bool | None:
        return self.guest_wifi

    def set_guest_wifi(self, enabled: bool) -> None:
        self.calls.append(("guest_wifi", enabled))
        if self.fail_actions:
            raise FritzActionError("refused")
        # the box shows it with a delay: the next read still says the old value
        self.guest_wifi_next = enabled

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
