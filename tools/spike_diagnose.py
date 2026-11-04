"""Probe of the Diagnosis functions on a real FRITZ!Box: the event log and the packet capture.

Credentials come from the environment, never from arguments:
    FRITZ_HOST (default 192.168.178.1), FRITZ_USER, FRITZ_PASSWORD, FRITZ_TLS=1 for https

What it does (nothing on the box is changed):
- reads the event log, with and without a group, and says how many messages came
- reads the capture page of the web interface and lists the interface names it offers
- records 5 seconds on each interface the panel uses and each one found on the page, and says how
  many bytes and packets came, or why it failed

Writes spike_out/diagnose.txt. Addresses are masked there; the capture files are deleted again.
Run it from the repository root: .venv/bin/python tools/spike_diagnose.py
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fritzconnection.core.exceptions import FritzAuthorizationError  # noqa: E402

from custom_components.fritzbox_network import pcap  # noqa: E402
from custom_components.fritzbox_network.api import FritzNetworkClient  # noqa: E402
from custom_components.fritzbox_network.capture import curate_interfaces  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "spike_out" / "diagnose.txt"
IPV4_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
SECONDS = 5


def mask(text: str) -> str:
    return IPV4_RE.sub(r"\1.\2.x.x", str(text))


def main() -> None:
    host = os.environ.get("FRITZ_HOST", "192.168.178.1")
    user, password = os.environ["FRITZ_USER"], os.environ["FRITZ_PASSWORD"]
    tls = os.environ.get("FRITZ_TLS") == "1"
    client = FritzNetworkClient(host, None, user, password, tls)
    client.connect()
    try:
        rights = client.can_write()
    except FritzAuthorizationError:
        # stop at once: more tries with a wrong login only make the box block the address
        raise SystemExit(
            "The box refused the login (401). Check FRITZ_USER and FRITZ_PASSWORD (quote the "
            "password in single quotes, a $ or ! in it is eaten by the shell) and that the user "
            "may use apps and TR-064. Not trying further."
        ) from None
    lines = [
        f"box: {client.model_name}, firmware {client.system_version}",
        f"user may change settings (BoxAdmin readwrite): {rights}",
        "",
    ]

    client.stop_captures()  # a capture left over from an earlier run loads the box
    lines.append("== event log ==")
    for group in (None, "net", "wlan", "sys"):
        try:
            events = client.get_device_log(group)
            first = events[0] if events else None
            lines.append(f"group={group or 'all'}: {len(events)} messages; first: {mask(first)}")
        except Exception as err:  # noqa: BLE001 - the probe reports whatever happens
            lines.append(f"group={group or 'all'}: FAILED {type(err).__name__}: {mask(err)}")

    lines += ["", "== interfaces on the capture page =="]
    found: list[str] = []
    try:
        with client._lock:  # noqa: SLF001
            sid = client._web_sid or client._web_login()  # noqa: SLF001
        for page in ("/capture.lua", "/support.lua"):
            text = client._connection.session.get(  # noqa: SLF001
                f"{client._web_base()}{page}?sid={sid}",  # noqa: SLF001
                timeout=10,
                verify=False,
            ).text
            ids = sorted(set(re.findall(r"ifaceorminor=([0-9A-Za-z_-]+)", text)))
            ids += re.findall(r"(?i)<button[^>]*name=.start.[^>]*value=.([0-9A-Za-z_-]+)", text)
            ids = sorted(set(ids))
            lines.append(f"{page}: {len(text)} bytes, interfaces: {ids or 'none found'}")
            hints = re.findall(
                r"(?i)[^\n]{0,60}(?:iface|capture_notimeout|ifaceorminor)[^\n]{0,90}", text
            )
            for hint in list(dict.fromkeys(h.strip() for h in hints))[:12]:
                lines.append(f"    hint: {mask(hint)}")
            # every row with a start button: its value and the text of the row, tags removed
            for row in re.findall(
                r"(?is)<tr[^>]*>(?:(?!</tr>).)*?name=.start.(?:(?!</tr>).)*?</tr>", text
            )[:30]:
                value = re.search(r'(?i)name=.start.[^>]*value=.([^">]+)', row)
                label = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", row)).strip()
                lines.append(f"    row: {value.group(1) if value else '?'} -> {mask(label[:100])}")
            # the names of the form fields that hold a choice of interface
            for tag in re.findall(
                r"(?i)<(?:input|option|button)[^>]*(?:iface|eth|wlan|lan|internet)[^>]*>", text
            )[:12]:
                lines.append(f"    field: {mask(tag[:160])}")
            found += ids
    except Exception as err:  # noqa: BLE001
        lines.append(f"FAILED {type(err).__name__}: {mask(err)}")

    lines += ["", "== interfaces the panel offers =="]
    try:
        offered = curate_interfaces(client.get_capture_interfaces())
    except Exception as err:  # noqa: BLE001
        offered = []
        lines.append(f"FAILED {type(err).__name__}: {mask(err)}")
    for item in offered:
        lines.append(f"{item['group']}: {item['id']} -> {item['label']}")

    lines += ["", f"== {SECONDS} s captures on those =="]
    with tempfile.TemporaryDirectory() as tmp:
        for item in offered:
            iface = item["id"]
            path = Path(tmp) / f"{iface}.pcap"
            try:
                reason = client.capture(
                    iface, path, SECONDS, 5_000_000, threading.Event(), lambda n: None
                )
                summary = pcap.summarize(path)
                lines.append(
                    f"{iface} ({item['label']}): ok, {path.stat().st_size} bytes, "
                    f"{summary.packets} packets, {dict(summary.protocols)}, "
                    f"{len(summary.dns)} DNS names, ended: {reason}"
                )
                if summary.unknown:
                    lines.append(f"    not understood: {dict(summary.unknown.most_common(4))}")
            except Exception as err:  # noqa: BLE001
                lines.append(f"{iface} ({item['label']}): FAILED {type(err).__name__}: {mask(err)}")

    OUT.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
