"""Read-only probe: can a FRITZ!Box give a device a fixed IP address, and where does it say so?

Host, user and password are asked for when the script starts (the password is not shown), never
taken from arguments. The environment can fill them in: FRITZ_HOST, FRITZ_USER, FRITZ_PASSWORD,
FRITZ_TLS=1 for https, FRITZ_DEVICE_MAC (the device to read the edit form of, else the first one).

Does three things, none of them writes:
  1. lists the actions of the TR-064 services that could hold a fixed IP (names and arguments),
  2. logs in to the web interface and reads the device list (data.lua, page netDev),
  3. reads the edit form of one device (data.lua, page edit_device), the fields about IP / DHCP.
Writes spike_out/fixedip.txt; addresses and MACs are masked there. Nothing is changed on the box.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from fritzconnection import FritzConnection

OUT = Path(__file__).resolve().parent.parent / "spike_out"
IPV4_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
MAC_RE = re.compile(r"\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
WANTED = re.compile(r"ip|dhcp|static|fix|reserv|lease", re.IGNORECASE)
SERVICES = ("Hosts1", "LANHostConfigManagement1")

lines: list[str] = []


def mask(value: object) -> str:
    text = IPV4_RE.sub(lambda m: f"{m.group(1)}.{m.group(2)}.x.x", str(value))
    return MAC_RE.sub(lambda m: m.group(0)[:8] + ":xx:xx:xx", text)


def log(line: str = "") -> None:
    print(line)
    lines.append(line)


class Web:
    """The web interface: log in with the challenge of the box, then post to data.lua."""

    def __init__(self, host: str, tls: bool) -> None:
        self.base = f"{'https' if tls else 'http'}://{host}"
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE  # the box has a certificate of its own
        self._context = context
        self.sid = ""

    def _open(self, url: str, data: dict[str, str] | None = None) -> str:
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        with urllib.request.urlopen(
            urllib.request.Request(url, body), context=self._context, timeout=20
        ) as r:
            return r.read().decode("utf-8", "replace")

    def login(self, user: str, password: str) -> bool:
        root = ET.fromstring(self._open(f"{self.base}/login_sid.lua?version=2"))
        challenge = root.findtext("Challenge") or ""
        if challenge.startswith("2$"):
            _, iter1, salt1, iter2, salt2 = challenge.split("$")
            hash1 = hashlib.pbkdf2_hmac(
                "sha256", password.encode(), bytes.fromhex(salt1), int(iter1)
            )
            hash2 = hashlib.pbkdf2_hmac("sha256", hash1, bytes.fromhex(salt2), int(iter2))
            response = f"{salt2}${hash2.hex()}"
        else:
            digest = hashlib.md5(f"{challenge}-{password}".encode("utf-16-le")).hexdigest()
            response = f"{challenge}-{digest}"
        answer = ET.fromstring(
            self._open(
                f"{self.base}/login_sid.lua?version=2", {"username": user, "response": response}
            )
        )
        self.sid = answer.findtext("SID") or ""
        return bool(self.sid) and set(self.sid) != {"0"}

    def data(self, **fields: str) -> dict:
        return json.loads(
            self._open(
                f"{self.base}/data.lua", {"sid": self.sid, "xhr": "1", "lang": "de", **fields}
            )
        )


def walk(value: object, path: str = ""):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, f"{path}[{index}]")
    else:
        yield path, value


def tr064(fc: FritzConnection) -> None:
    log("== 1. TR-064: actions that might hold a fixed IP ==")
    for name in SERVICES:
        service = fc.services.get(name)
        if service is None:
            log(f"[--] {name}: not offered")
            continue
        log(f"[ok] {name}")
        for action in sorted(service.actions):
            marker = "  <==" if WANTED.search(action) else ""
            arguments = ", ".join(sorted(service.actions[action].arguments))
            log(f"       {action}({arguments}){marker}")


def devices(web: Web) -> list[dict]:
    reply = web.data(page="netDev", xhrId="all")
    found: list[dict] = []
    for group in ("active", "passive"):
        found += [d for d in reply.get("data", {}).get(group, []) if isinstance(d, dict)]
    return found


def webform(web: Web, wanted_mac: str | None) -> None:
    log("")
    log("== 2. Web interface: the device list ==")
    listed = devices(web)
    log(f"{len(listed)} devices listed; keys of the first: {sorted(listed[0]) if listed else '-'}")
    if not listed:
        return
    pick = next(
        (d for d in listed if wanted_mac and str(d.get("mac", "")).lower() == wanted_mac.lower()),
        listed[0],
    )
    uid = pick.get("UID") or pick.get("uid")
    log(f"device read: {mask(pick.get('name', '?'))} ({mask(pick.get('mac', '?'))}) uid {uid}")
    log("")
    log("== 3. Web interface: the edit form of that device (fields about IP / DHCP) ==")
    form = web.data(page="edit_device", dev=str(uid))
    shown = 0
    for path, value in walk(form):
        if WANTED.search(path):
            log(f"       {path} = {mask(value)}")
            shown += 1
    if not shown:
        log("       no field about IP / DHCP; all keys follow")
        for path, _ in walk(form):
            log(f"       {path}")
    formfields(web, str(uid))


def ask(name: str, prompt: str, default: str = "", secret: bool = False) -> str:
    """The value from the environment, else asked for on the terminal."""
    if value := os.environ.get(name):
        return value
    if secret:
        return getpass.getpass(f"{prompt}: ")
    return input(f"{prompt}{f' [{default}]' if default else ''}: ").strip() or default


def formfields(web: Web, uid: str) -> None:
    """The names of the fields of the edit page and of the scripts it loads (nothing is sent)."""
    log("")
    log("== 4. Web interface: the fields the edit page sends ==")
    html = web._open(f"{web.base}/index.lua?sid={web.sid}&page=edit_device&dev={uid}")
    names = sorted(set(re.findall(r'name=["\']([^"\']+)["\']', html)))
    log(f"fields of the page: {', '.join(names) or '-'}")
    scripts = sorted(set(re.findall(r'src=["\']([^"\']*\.js[^"\']*)["\']', html)))
    log(f"scripts: {', '.join(re.sub(r'sid=[0-9a-f]+', 'sid=x', s) for s in scripts) or '-'}")
    for src in scripts:
        if "edit_device" not in src and "netdev" not in src.lower():
            continue
        code = web._open(src if src.startswith("http") else f"{web.base}/{src.lstrip('/')}")
        hits = sorted(
            set(
                re.findall(
                    r"[\"']((?:static|dhcp|ipv4|ip_?addr|alwaysSameIp)[A-Za-z0-9_.]*)[\"']", code
                )
            )
        )
        log(f"in {re.sub(r'sid=[0-9a-f]+', 'sid=x', src)}: {', '.join(hits) or '-'}")


def main() -> None:
    host = ask("FRITZ_HOST", "Address of the box", "192.168.178.1")
    tls = os.environ.get("FRITZ_TLS") == "1"
    user = ask("FRITZ_USER", "User")
    password = ask("FRITZ_PASSWORD", "Password", secret=True)
    tr064(FritzConnection(address=host, user=user or None, password=password or None, use_tls=tls))
    web = Web(host, tls)
    if not web.login(user, password):
        log("")
        log("[--] the web login failed: wrong user or password, or no right for the web interface")
    else:
        webform(web, os.environ.get("FRITZ_DEVICE_MAC"))
    OUT.mkdir(exist_ok=True)
    (OUT / "fixedip.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nwritten to {OUT / 'fixedip.txt'}")


if __name__ == "__main__":
    main()
