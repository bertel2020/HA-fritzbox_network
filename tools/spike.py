"""Phase 0: read-only probe of a FRITZ!Box (host list, mesh, a few optional actions).

Credentials come from the environment, never from arguments:
    FRITZ_HOST (default 192.168.178.1), FRITZ_USER, FRITZ_PASSWORD, FRITZ_TLS=1 for https

Writes to spike_out/ (git-ignored): raw/ with the original data, fixtures/ anonymised,
report.txt with the result of every probe. Only reading actions are called.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys

from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import FritzConnectionException

OUT = Path(__file__).resolve().parent.parent / "spike_out"
MAC_RE = re.compile(r"\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
IPV6_RE = re.compile(r"(?<![0-9A-Za-z:])[0-9A-Fa-f:]{3,}(?![0-9A-Za-z:])")
NAME_XML_RE = re.compile(r"<(HostName|X_AVM-DE_FriendlyName)>([^<]+)</\1>")
NAME_JSON_KEYS = {"name", "device_name", "friendly_name", "ssid", "model", "firmware_version"}

report: list[str] = []


def log(line: str) -> None:
    print(line)
    report.append(line)


def probe(fc: FritzConnection, service: str, action: str) -> dict | None:
    try:
        result = fc.call_action(service, action)
    except (FritzConnectionException, KeyError) as err:
        log(f"[--] {service}/{action}: {type(err).__name__}: {err}")
        return None
    log(f"[ok] {service}/{action}: keys={sorted(result)}")
    return result


def fetch(fc: FritzConnection, path: str) -> str:
    with fc.session.get(f"{fc.address}:{fc.port}{path}") as response:
        response.raise_for_status()
        return response.text


def collect_names(text: str) -> set[str]:
    names = {m.group(2) for m in NAME_XML_RE.finditer(text)}
    try:
        data = json.loads(text)
    except ValueError:
        return names

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in NAME_JSON_KEYS and isinstance(value, str) and value:
                    names.add(value)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return names


# Shared by all files of one run, so a device keeps the same fake MAC everywhere.
_MACS: dict[str, str] = {}
_IPS: dict[str, str] = {}
_IPS6: dict[str, str] = {}


def anonymise(text: str, names: set[str]) -> str:
    macs, ips, ips6 = _MACS, _IPS, _IPS6

    def mac(m: re.Match) -> str:
        return macs.setdefault(m.group(0).lower(), f"02:00:00:00:00:{len(macs) + 1:02x}")

    def ip(m: re.Match) -> str:
        return ips.setdefault(m.group(0), f"192.0.2.{len(ips) + 1}")

    # IPv6 first, otherwise its colon groups can be mistaken for a MAC.
    def ipv6(m: re.Match) -> str:
        token = m.group(0)
        if MAC_RE.fullmatch(token) or ("::" not in token and token.count(":") < 3):
            return token
        return ips6.setdefault(token.lower(), f"2001:db8::{len(ips6) + 1:x}")

    text = IPV6_RE.sub(ipv6, text)
    text = MAC_RE.sub(mac, text)
    text = IPV4_RE.sub(ip, text)
    for index, name in enumerate(sorted(names, key=len, reverse=True), start=1):
        text = text.replace(name, f"name-{index}")
    return text


def main() -> int:
    host = os.environ.get("FRITZ_HOST", "192.168.178.1")
    user = os.environ.get("FRITZ_USER")
    password = os.environ.get("FRITZ_PASSWORD")
    if not user or not password:
        print("FRITZ_USER and FRITZ_PASSWORD must be set in the environment.", file=sys.stderr)
        return 2

    (OUT / "raw").mkdir(parents=True, exist_ok=True)
    (OUT / "fixtures").mkdir(parents=True, exist_ok=True)

    fc = FritzConnection(
        address=host,
        user=user,
        password=password,
        use_tls=os.environ.get("FRITZ_TLS") == "1",
        timeout=10,
        use_cache=False,
    )
    log(f"connected: {fc.modelname}, FRITZ!OS {fc.system_version}")

    log("all services: " + ", ".join(sorted(fc.services)))
    for name in ("Hosts1", "WLANConfiguration1", "LANConfigSecurity1", "DeviceInfo1"):
        service = fc.services.get(name)
        log(f"service {name}: " + (", ".join(sorted(service.actions)) if service else "missing"))

    for name, wanted in (
        ("X_AVM-DE_HostFilter1", None),
        ("Hosts1", ("X_AVM-DE_WakeOnLANByMACAddress", "X_AVM-DE_SetFriendlyNameByMAC")),
    ):
        service = fc.services.get(name)
        for action_name, action in sorted(service.actions.items() if service else []):
            if wanted is None or action_name in wanted:
                args = {k: v.direction for k, v in action.arguments.items()}
                log(f"args {name}/{action_name}: {args}")

    files: dict[str, str] = {}
    hosts = probe(fc, "Hosts1", "X_AVM-DE_GetHostListPath")
    if hosts:
        files["hosts.xml"] = fetch(fc, hosts["NewX_AVM-DE_HostListPath"])
    mesh = probe(fc, "Hosts1", "X_AVM-DE_GetMeshListPath")
    if mesh:
        files["mesh.json"] = fetch(fc, mesh["NewX_AVM-DE_MeshListPath"])
    wlan = probe(fc, "WLANConfiguration1", "X_AVM-DE_GetWLANDeviceListPath")
    if wlan:
        files["wlan_devices.xml"] = fetch(fc, wlan["NewX_AVM-DE_WLANDeviceListPath"])

    for action in ("X_AVM-DE_GetChangeCounter", "GetHostNumberOfEntries"):
        probe(fc, "Hosts1", action)
    rights = probe(fc, "LANConfigSecurity1", "X_AVM-DE_GetCurrentUser")
    if rights:
        rights["NewX_AVM-DE_CurrentUsername"] = "user"
        files["current_user.json"] = json.dumps(rights, indent=2, default=str)

    names: set[str] = set()
    for text in files.values():
        names |= collect_names(text)
    for filename, text in files.items():
        (OUT / "raw" / filename).write_text(text, encoding="utf-8")
        (OUT / "fixtures" / filename).write_text(anonymise(text, names), encoding="utf-8")
        log(f"saved {filename} ({len(text)} bytes)")

    (OUT / "report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
