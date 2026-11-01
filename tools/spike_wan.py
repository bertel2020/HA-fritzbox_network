"""Read-only probe of the internet side of a FRITZ!Box: what it reports without extra rights.

Credentials come from the environment, never from arguments:
    FRITZ_HOST (default 192.168.178.1), FRITZ_USER, FRITZ_PASSWORD, FRITZ_TLS=1 for https

Calls only actions that read (Get*). Writes spike_out/wan.txt with the values and which actions
the account may call; addresses are masked there. Nothing is changed on the box.
"""

from __future__ import annotations

import os
from pathlib import Path
import re

from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import FritzConnectionException

OUT = Path(__file__).resolve().parent.parent / "spike_out"
IPV4_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
IPV6_RE = re.compile(r"(?<![0-9A-Za-z:])[0-9A-Fa-f:]{6,}(?![0-9A-Za-z:])")

# (service, action): what it would tell the panel
PROBES = [
    ("WANCommonIFC1", "GetCommonLinkProperties"),
    ("WANCommonIFC1", "GetTotalBytesSent"),
    ("WANCommonIFC1", "GetTotalBytesReceived"),
    ("WANCommonIFC1", "GetTotalPacketsSent"),
    ("WANCommonIFC1", "GetTotalPacketsReceived"),
    ("WANCommonIFC1", "X_AVM-DE_GetOnlineMonitor"),
    ("WANIPConn1", "GetStatusInfo"),
    ("WANIPConn1", "GetExternalIPAddress"),
    ("WANIPConn1", "X_AVM_DE_GetExternalIPv6Address"),
    ("WANIPConn1", "X_AVM_DE_GetIPv6Prefix"),
    ("WANIPConn1", "X_AVM_DE_GetDNSServer"),
    ("WANIPConn1", "X_AVM_DE_GetIPv6DNSServer"),
    ("WANPPPConnection1", "GetInfo"),
    ("WANDSLInterfaceConfig1", "GetInfo"),
    ("WANDSLInterfaceConfig1", "X_AVM-DE_GetDSLInfo"),
    ("WANEthernetLinkConfig1", "GetEthernetLinkStatus"),
    ("DeviceInfo1", "GetInfo"),
]

lines: list[str] = []


def mask(value: object) -> str:
    text = str(value)
    text = IPV4_RE.sub(lambda m: f"{m.group(1)}.{m.group(2)}.x.x", text)

    def hide(match: re.Match[str]) -> str:
        found = match.group(0)
        return f"{found[:4]}::masked" if ":" in found else found

    return IPV6_RE.sub(hide, text)


def log(line: str) -> None:
    print(line)
    lines.append(line)


def main() -> None:
    fc = FritzConnection(
        address=os.environ.get("FRITZ_HOST", "192.168.178.1"),
        user=os.environ.get("FRITZ_USER"),
        password=os.environ.get("FRITZ_PASSWORD"),
        use_tls=os.environ.get("FRITZ_TLS") == "1",
    )
    for service, action in PROBES:
        try:
            result = fc.call_action(service, action)
        except (FritzConnectionException, KeyError) as err:
            log(f"[--] {service}/{action}: {type(err).__name__}: {err}")
            continue
        log(f"[ok] {service}/{action}")
        for key, value in sorted(result.items()):
            log(f"       {key} = {mask(value)}")
    OUT.mkdir(exist_ok=True)
    (OUT / "wan.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nwritten to {OUT / 'wan.txt'}")


if __name__ == "__main__":
    main()
