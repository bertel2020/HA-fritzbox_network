"""Read-only probe of the VPN side of a FRITZ!Box: what it tells about WireGuard and IPsec.

Credentials come from the environment, never from arguments:
    FRITZ_HOST (default 192.168.178.1), FRITZ_USER, FRITZ_PASSWORD, FRITZ_TLS=1 for https

Only reads: the TR-064 services and actions that mention VPN, and a few pages of data.lua.
Writes spike_out/vpn.txt (masked: addresses, keys, names of peers). Nothing is changed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fritzconnection import FritzConnection  # noqa: E402

from custom_components.fritzbox_network.api import web_login_response  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "spike_out"
IPV4_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
KEY_RE = re.compile(r"[A-Za-z0-9+/]{43}=")
SECRET_KEYS = re.compile(r"(key|secret|pass|psk|preshared)", re.I)
NAME_KEYS = re.compile(r"(name|label|comment|user|mail|fqdn|host)", re.I)
WORDS = re.compile(r"(vpn|wireguard|wg|ipsec|remote|myfritz|lan2lan|tunnel)", re.I)
PAGES = [
    "shareWireguard", "shareVpn", "shareVPN", "shareRemote", "shareLan2Lan",
    "wireguard", "vpn", "shareIpsec", "share", "shareWg",
]  # fmt: skip


def mask_text(text: str) -> str:
    text = IPV4_RE.sub(r"\1.\2.x.x", text)
    return KEY_RE.sub("<key>", text)


def mask(value):
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if SECRET_KEYS.search(str(k)) and v:
                out[k] = "<masked>"
            elif NAME_KEYS.search(str(k)) and isinstance(v, str) and v:
                out[k] = f"<name:{len(v)}>"
            else:
                out[k] = mask(v)
        return out
    if isinstance(value, list):
        return [mask(v) for v in value]
    if isinstance(value, str):
        return mask_text(value)
    return value


def main() -> None:
    host = os.environ.get("FRITZ_HOST", "192.168.178.1")
    user = os.environ.get("FRITZ_USER", "")
    password = os.environ.get("FRITZ_PASSWORD", "")
    tls = os.environ.get("FRITZ_TLS") == "1"
    if not user or not password:
        sys.exit("set FRITZ_USER and FRITZ_PASSWORD")
    lines: list[str] = []

    fc = FritzConnection(address=host, user=user, password=password, use_tls=tls)
    lines.append(f"{fc.modelname} / {fc.system_version}")
    lines.append("\n== TR-064: services and actions that mention VPN ==")
    for name, service in fc.services.items():
        hits = [a for a in service.actions if WORDS.search(a)]
        if WORDS.search(name) or hits:
            lines.append(f"{name}: {', '.join(hits) or '(service name matches)'}")
    for service, action in (
        ("X_AVM-DE_RemoteAccess1", "GetInfo"),
        ("X_AVM-DE_MyFritz1", "GetInfo"),
        ("X_AVM-DE_RemoteAccess1", "GetDDNSInfo"),
    ):
        try:
            lines.append(f"{service}.{action}: {mask(fc.call_action(service, action))}")
        except Exception as err:  # noqa: BLE001
            lines.append(f"{service}.{action}: {type(err).__name__}")

    base = f"{'https' if tls else 'http'}://{host}"
    session = requests.Session()
    session.verify = False  # noqa: S501
    import xml.etree.ElementTree as ET  # noqa: PLC0415

    root = ET.fromstring(session.get(f"{base}/login_sid.lua?version=2", timeout=10).text)
    challenge = root.findtext("Challenge") or ""
    answer = ET.fromstring(
        session.post(
            f"{base}/login_sid.lua?version=2",
            data={"username": user, "response": web_login_response(challenge, password)},
            timeout=10,
        ).text
    )
    sid = answer.findtext("SID") or ""
    if not sid or set(sid) == {"0"}:
        sys.exit("web login refused")

    lines.append("\n== data.lua pages ==")
    raw = OUT / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for page in PAGES:
        try:
            text = session.post(
                f"{base}/data.lua",
                data={"sid": sid, "xhr": "1", "lang": "en", "page": page},
                timeout=15,
            ).text
            data = json.loads(text)
        except Exception as err:  # noqa: BLE001
            lines.append(f"{page}: {type(err).__name__}")
            continue
        masked = json.dumps(mask(data), indent=1)
        lines.append(f"{page}: {len(text)} bytes, top-level keys {list(data)[:8]}")
        if WORDS.search(text):
            lines.append(f"  mentions VPN/WireGuard; masked copy in vpn_{page}.json")
            (OUT / f"vpn_{page}.json").write_text(masked)
    (OUT / "vpn.txt").write_text(mask_text("\n".join(lines)) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
