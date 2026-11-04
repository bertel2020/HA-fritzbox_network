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

from custom_components.fritzbox_network import pcap  # noqa: E402
from custom_components.fritzbox_network.api import FritzNetworkClient  # noqa: E402
from custom_components.fritzbox_network.capture import INTERFACES  # noqa: E402

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
    lines = [
        f"box: {client.model_name}, firmware {client.system_version}",
        f"user may change settings (BoxAdmin readwrite): {client.can_write()}",
        "",
    ]

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
            lines.append(f"{page}: {len(text)} bytes, interfaces: {ids or 'none found'}")
            found += ids
    except Exception as err:  # noqa: BLE001
        lines.append(f"FAILED {type(err).__name__}: {mask(err)}")

    lines += ["", f"== {SECONDS} s captures =="]
    wanted = {**{f"panel:{k}": v for k, v in INTERFACES.items()}, **{f"page:{i}": i for i in found}}
    with tempfile.TemporaryDirectory() as tmp:
        for label, iface in wanted.items():
            path = Path(tmp) / f"{iface}.pcap"
            try:
                reason = client.capture(
                    iface, path, SECONDS, 5_000_000, threading.Event(), lambda n: None
                )
                summary = pcap.summarize(path)
                lines.append(
                    f"{label} ({iface}): ok, {path.stat().st_size} bytes, "
                    f"{summary.packets} packets, {dict(summary.protocols)}, ended: {reason}"
                )
            except Exception as err:  # noqa: BLE001
                lines.append(f"{label} ({iface}): FAILED {type(err).__name__}: {mask(err)}")

    OUT.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
