"""A check of the connection from Home Assistant out: the box, the name service, the internet."""

from __future__ import annotations

import asyncio
import socket
import time
from typing import Any

TIMEOUT = 4.0
# a public address that answers on 443 without a name, and one name to resolve and connect to
INTERNET_V4 = "1.1.1.1"
INTERNET_V6 = "2606:4700:4700::1111"
TEST_NAME = "example.org"


async def _timed(coro) -> tuple[bool, float | None, str | None]:
    """Run a step: (worked, milliseconds, the error)."""
    started = time.perf_counter()
    try:
        await asyncio.wait_for(coro, TIMEOUT)
    except TimeoutError:
        return False, None, "timeout"
    except OSError as err:
        return False, None, err.strerror or type(err).__name__
    return True, round((time.perf_counter() - started) * 1000, 1), None


async def _connect(host: str, port: int) -> None:
    _, writer = await asyncio.open_connection(host, port)
    writer.close()
    await writer.wait_closed()


async def _resolve(name: str) -> None:
    await asyncio.get_running_loop().getaddrinfo(name, 443, type=socket.SOCK_STREAM)


async def run_checks(box_host: str, box_port: int) -> dict[str, Any]:
    """Try the steps from the box outwards; the verdict names the first one that fails.

    The steps run one after another, a slow one must not hide another. IPv6 is reported but never
    the cause of a failed verdict: many lines have none.
    """
    steps = [
        ("box", _connect(box_host, box_port)),
        ("internet", _connect(INTERNET_V4, 443)),
        ("dns", _resolve(TEST_NAME)),
        ("web", _connect(TEST_NAME, 443)),
        ("ipv6", _connect(INTERNET_V6, 443)),
    ]
    results = []
    for key, coro in steps:
        ok, ms, error = await _timed(coro)
        results.append({"key": key, "ok": ok, "ms": ms, "error": error})
    by_key = {r["key"]: r for r in results}
    if not by_key["box"]["ok"]:
        verdict = "box"
    elif not by_key["internet"]["ok"]:
        verdict = "internet"
    elif not by_key["dns"]["ok"]:
        verdict = "dns"
    elif not by_key["web"]["ok"]:
        verdict = "web"
    else:
        verdict = "ok"
    return {"steps": results, "verdict": verdict}
