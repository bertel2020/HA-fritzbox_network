"""Packet captures of the box: started from the panel, kept as pcap files, downloaded from there.

The box streams a capture over HTTP for as long as the connection stays open. One capture runs at
a time per box; it ends after the chosen time, at the size limit, or when the user stops it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
import http.client
import logging
from pathlib import Path
import re
import threading
import time
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from . import pcap
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# the name of an interface as the box has it: type, a dash, a name ("1-lan", "2-1", "3-17")
INTERFACE_RE = re.compile(r"^\d-[0-9A-Za-z_]+$")
# the interfaces offered when the box does not list its own
DEFAULT_INTERFACES = [
    {"id": "2-1", "label": "1. Internet connection", "group": "internet"},
    {"id": "1-lan", "label": "lan", "group": "lan"},
]
GROUP_ORDER = ["internet", "lan", "wlan", "vpn", "routing"]
INTERFACES_MAX_AGE = 600
MIN_SECONDS = 5
MAX_SECONDS = 600
DEFAULT_SECONDS = 60
MAX_BYTES = 200 * 1024 * 1024
DEFAULT_BYTES = 50 * 1024 * 1024
KEEP_FILES = 20
DIR_NAME = "fritzbox_captures"
KEY_CAPTURES = f"{DOMAIN}_captures"
FILE_RE = re.compile(r"^[a-z0-9]+_\d{8}-\d{6}(-[0-9a-f]{12})?\.pcap$")
VIEW_URL = f"/api/{DOMAIN}/capture/{{entry_id}}/{{name}}"


def interface_slug(interface: str) -> str:
    """The part of a file name that stands for an interface: letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", interface.lower())


def _natural(text: str) -> list[tuple[int, int | str]]:
    """A sort key that puts eth2 before eth10 and 2-1 before 2-3."""
    return [(0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"(\d+)", text) if p]


def curate_interfaces(found: list[dict[str, str]]) -> list[dict[str, str]]:
    """The interfaces of the box worth offering, in groups; the technical ones stay out.

    The box lists about seventy: internal trace and tunnel interfaces among them. Offered are the
    internet connections, the LAN ports, the Wi-Fi access points (the radios give nothing), the
    WireGuard connections and the routing interfaces.
    """
    offered = []
    for item in found:
        interface = item["id"]
        if interface.startswith("2-"):
            group = "internet"
        elif interface == "1-lan" or re.fullmatch(r"1-eth\d+", interface):
            group = "lan"
        elif re.fullmatch(r"1-(vap\d|guest\d?)", interface):
            group = "wlan"
        elif re.fullmatch(r"1-wg\d+", interface):
            group = "vpn"  # the WireGuard connections of the box
        elif interface.startswith("3-"):
            group = "routing"
        else:
            continue
        offered.append({**item, "group": group})
    offered.sort(key=lambda i: (GROUP_ORDER.index(i["group"]), _natural(i["id"])))
    return offered


# a Wi-Fi interface is named after a band when this share of the devices seen on it are on it
BAND_SHARE = 0.8
BAND_MIN_DEVICES = 2


def wifi_bands(links: dict[str, Any], ap_mac: str | None = None) -> dict[str, str]:
    """The band of every device the mesh knows on Wi-Fi: {mac: "2_4ghz" | "5ghz" | ...}.

    With ``ap_mac`` only the devices that hang on that access point itself: a device behind a
    repeater has the band it has there, but its traffic reaches the box over the link of the
    repeater, so it would be counted on the wrong band.
    """
    # the mesh writes the type in capitals ("WLAN", "LAN")
    return {
        mac: link.band
        for mac, link in links.items()
        if link.link_type.lower() == "wlan"
        and link.band
        and (ap_mac is None or link.ap_mac == ap_mac)
    }


def decide_band(votes: dict[str, int]) -> str | None:
    """The band an interface carries, from how many devices of each band were seen on it.

    None when too few devices were seen or they are on several bands: that is no answer, and the
    panel then leaves the interface unnamed.
    """
    total = sum(votes.values())
    if total < BAND_MIN_DEVICES:
        return None
    band, count = max(votes.items(), key=lambda item: item[1])
    return band if count / total >= BAND_SHARE else None


def count_bands(seen: dict[str, int], bands: dict[str, str]) -> dict[str, int]:
    """How many different devices of each band appear among the MAC addresses of a capture."""
    votes: dict[str, int] = {}
    for mac in seen:
        if band := bands.get(mac):
            votes[band] = votes.get(band, 0) + 1
    return votes


@dataclass
class Job:
    """The capture that runs now or ran last."""

    interface: str
    name: str
    started: float
    seconds: int
    max_bytes: int
    device: str | None = None  # the MAC the capture is narrowed to afterwards
    ips: tuple[str, ...] = ()
    bytes: int = 0
    state: str = "running"  # running, done, failed
    reason: str | None = None  # why it ended: time, size, stopped; the error when it failed
    stop: Any = field(default=None, repr=False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "interface": self.interface,
            "name": self.name,
            "state": self.state,
            "reason": self.reason,
            "seconds": self.seconds,
            "elapsed": round(min(time.monotonic() - self.started, self.seconds), 1)
            if self.state == "running"
            else None,
            "bytes": self.bytes,
            "max_bytes": self.max_bytes,
            "device": self.device.replace(":", "") if self.device else None,
        }


class CaptureManager:
    """Starts, stops and lists the captures of one box."""

    def __init__(self, hass: HomeAssistant, entry_id: str, client: Any) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._client = client
        self.job: Job | None = None
        self._interfaces: list[dict[str, str]] | None = None
        self._interfaces_at = 0.0
        self._task: asyncio.Task[None] | None = None

    @property
    def directory(self) -> Path:
        return Path(self._hass.config.path(DIR_NAME)) / self._entry_id

    @property
    def running(self) -> bool:
        return self.job is not None and self.job.state == "running"

    def interfaces(self) -> list[dict[str, str]]:
        """What the box lets a capture listen on; blocking, so call it from an executor thread.

        Asked of the box at most every few minutes; a box that does not tell gets a short list.
        """
        now = time.monotonic()
        if self._interfaces is None or now - self._interfaces_at > INTERFACES_MAX_AGE:
            try:
                listed = curate_interfaces(self._client.get_capture_interfaces())
            except (OSError, ValueError, PermissionError, http.client.HTTPException) as err:
                _LOGGER.debug("The box did not list its capture interfaces: %s", err)
                listed = []
            self._interfaces = listed or [dict(i) for i in DEFAULT_INTERFACES]
            self._interfaces_at = now if listed else now - INTERFACES_MAX_AGE + 30
        return self._interfaces

    def start(
        self,
        interface: str,
        seconds: int,
        max_bytes: int,
        device: str | None = None,
        ips: tuple[str, ...] = (),
    ) -> Job:
        """Begin a capture; raises ValueError for a bad request or when one is running."""
        if not INTERFACE_RE.match(interface):
            raise ValueError("unknown interface")
        if self.running:
            raise ValueError("busy")
        seconds = max(MIN_SECONDS, min(MAX_SECONDS, seconds))
        max_bytes = max(1024 * 1024, min(MAX_BYTES, max_bytes))
        stamp = dt_util.now().strftime("%Y%m%d-%H%M%S")
        suffix = f"-{device.replace(':', '')}" if device else ""
        job = Job(
            interface=interface,
            name=f"{interface_slug(interface)}_{stamp}{suffix}.pcap",
            started=time.monotonic(),
            seconds=seconds,
            max_bytes=max_bytes,
            device=device,
            ips=ips,
        )
        job.stop = threading.Event()
        self.job = job
        self._task = self._hass.async_create_task(self._run(job))
        return job

    def stop(self) -> None:
        if self.running and self.job is not None:
            self.job.stop.set()

    async def _run(self, job: Job) -> None:
        directory = self.directory
        path = directory / job.name

        def work() -> str:
            directory.mkdir(parents=True, exist_ok=True)

            def progress(written: int) -> None:
                job.bytes = written

            reason = self._client.capture(
                job.interface, path, job.seconds, job.max_bytes, job.stop, progress
            )
            if job.device:
                narrowed = path.with_suffix(".tmp")
                kept = pcap.filter_device(path, narrowed, job.device, set(job.ips))
                narrowed.replace(path)
                job.bytes = path.stat().st_size
                if kept == 0:
                    path.unlink()
                    raise ValueError("the device sent or received nothing in that time")
            return reason

        try:
            job.reason = await self._hass.async_add_executor_job(work)
            job.state = "done"
        except Exception as err:  # noqa: BLE001 - whatever the box or the disk did, the panel shows it
            _LOGGER.warning("The capture on %s failed: %s", job.interface, err)
            job.state = "failed"
            job.reason = str(err)
            await self._hass.async_add_executor_job(lambda: path.unlink(missing_ok=True))
        await self._hass.async_add_executor_job(self._prune)

    def _prune(self) -> None:
        files = self.files()
        for item in files[KEEP_FILES:]:
            (self.directory / item["name"]).unlink(missing_ok=True)

    def files(self) -> list[dict[str, Any]]:
        """The kept captures, newest first."""
        if not self.directory.is_dir():
            return []
        found = []
        for path in self.directory.iterdir():
            if FILE_RE.match(path.name) and path.is_file():
                stat = path.stat()
                found.append({"name": path.name, "bytes": stat.st_size, "time": stat.st_mtime})
        found.sort(key=lambda f: f["time"], reverse=True)
        return [
            {
                **f,
                "time": datetime.fromtimestamp(f["time"], dt_util.UTC).isoformat(),
                "interface": f["name"].split("_", 1)[0],
                "device": f["name"][:-5].split("-")[2] if f["name"].count("-") == 2 else None,
            }
            for f in found
        ]

    def summary(self, name: str) -> pcap.Summary | None:
        """What a kept capture contains; None where it is gone or cannot be read."""
        path = self.directory / name
        if not FILE_RE.match(name) or not path.is_file():
            return None
        try:
            return pcap.summarize(path)
        except (pcap.PcapError, OSError):
            return None

    def delete(self, name: str) -> bool:
        if not FILE_RE.match(name):
            return False
        path = self.directory / name
        if not path.is_file() or (self.running and self.job and self.job.name == name):
            return False
        path.unlink()
        return True


class CaptureDownloadView(HomeAssistantView):
    """Serves a kept capture to an administrator."""

    url = VIEW_URL
    name = f"api:{DOMAIN}:capture"
    requires_auth = True

    async def get(self, request: web.Request, entry_id: str, name: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        if not request["hass_user"].is_admin:
            return web.Response(status=403)
        manager = hass.data.get(KEY_CAPTURES, {}).get(entry_id)
        if manager is None or not FILE_RE.match(name):
            return web.Response(status=404)
        path = manager.directory / name
        if not path.is_file():
            return web.Response(status=404)
        return web.FileResponse(
            path,
            headers={
                "Content-Type": "application/vnd.tcpdump.pcap",
                "Content-Disposition": f'attachment; filename="{name}"',
            },
        )
