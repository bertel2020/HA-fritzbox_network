"""Packet captures of the box: started from the panel, kept as pcap files, downloaded from there.

The box streams a capture over HTTP for as long as the connection stays open. One capture runs at
a time per box; it ends after the chosen time, at the size limit, or when the user stops it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import contextlib
from dataclasses import dataclass, field
from datetime import datetime
import http.client
import logging
from pathlib import Path
import re
import shutil
import struct
import threading
import time
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import pcap
from .const import (
    CONF_RING_AFTER,
    CONF_RING_AUTOSTART,
    CONF_RING_INTERFACE,
    CONF_RING_MB,
    CONF_RING_MINUTES,
    CONF_RING_TRIGGER,
    CONF_RING_TRIGGER_STATE,
    DEFAULT_RING_AFTER,
    DEFAULT_RING_INTERFACE,
    DEFAULT_RING_MB,
    DEFAULT_RING_MINUTES,
    DOMAIN,
    HISTORY_SAVE_DELAY,
)

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
STORAGE_VERSION = 1
# the Wi-Fi access points of the box whose band is looked for
WIFI_AP_RE = re.compile(r"^1-vap\d+$")
DETECT_SECONDS = 10
DETECT_PAUSE = 2.0
DETECT_MAX_BYTES = 5 * 1024 * 1024
MIN_SECONDS = 5
MAX_SECONDS = 600
DEFAULT_SECONDS = 60
MAX_BYTES = 200 * 1024 * 1024
DEFAULT_BYTES = 50 * 1024 * 1024
KEEP_FILES = 20
DIR_NAME = "fritzbox_captures"
KEY_CAPTURES = f"{DOMAIN}_captures"
FILE_RE = re.compile(r"^[a-z0-9]+_\d{8}-\d{6}(-[0-9a-f]{12})?(-ring)?\.pcap$")
FILE_PARTS_RE = re.compile(r"^([a-z0-9]+)_\d{8}-\d{6}(?:-([0-9a-f]{12}))?(-ring)?\.pcap$")
# the ring buffer: segments of this length, kept for the window, never more than the size limit
RING_DIR = "ring"
RING_SEGMENT_SECONDS = 30
RING_MIN_MINUTES = 1
RING_MAX_MINUTES = 30
RING_MAX_MB = 500
RING_RETRY_SECONDS = (5, 15, 60)
RING_STOP_WAIT = 10
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


def detect_wifi_bands(
    client: Any,
    interfaces: list[str],
    bands: dict[str, str],
    directory: Path,
    seconds: int = DETECT_SECONDS,
    pause: float = DETECT_PAUSE,
) -> tuple[dict[str, str | None], dict[str, dict[str, int]]]:
    """Which band each Wi-Fi access point carries, by the devices that packets are sent to on it.

    Records a few seconds on each interface, one after the other with a pause. Only packets *to*
    a device count: they leave over the access point the device is connected to, while a device
    that sends can also show up where it only looks for networks. A device seen on more than one
    interface says nothing and is left out. Returns the band per interface (None where it is not
    clear) and the votes behind it. Blocking: call it from an executor thread.
    """
    seen: dict[str, set[str]] = {}
    for n, interface in enumerate(interfaces):
        if n:
            time.sleep(pause)  # the box ends the one recording before it starts the next
        path = directory / f"detect-{interface_slug(interface)}.pcap"
        try:
            client.capture(
                interface, path, seconds, DETECT_MAX_BYTES, threading.Event(), lambda _: None
            )
            seen[interface] = set(pcap.macs(path, senders=False))
        except ValueError:  # the box sent nothing: nobody is on that access point just now
            seen[interface] = set()
        finally:
            path.unlink(missing_ok=True)
    result: dict[str, str | None] = {}
    votes: dict[str, dict[str, int]] = {}
    for interface, macs in seen.items():
        elsewhere = set().union(*(m for i, m in seen.items() if i != interface))
        votes[interface] = count_bands(dict.fromkeys(macs - elsewhere, 1), bands)
        result[interface] = decide_band(votes[interface])
    return result, votes


class SegmentWriter:
    """Cuts the pcap stream of a capture into segment files and keeps only the newest.

    Segments end at a packet boundary and each carries the pcap header, so any run of them is
    a capture of its own. What is older than the window, or beyond the size limit, is deleted.
    Thread-safe: the stream is fed from one thread, a save may come from another.
    """

    def __init__(
        self,
        directory: Path,
        window_seconds: float,
        max_bytes: int,
        segment_seconds: float = RING_SEGMENT_SECONDS,
        clock: Any = time.monotonic,
    ) -> None:
        self.directory = directory
        self.window_seconds = window_seconds
        self.max_bytes = max_bytes
        self.segment_seconds = segment_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._buffer = b""
        self._record_size = 16
        self._header: bytes | None = None
        self._segments: list[dict[str, Any]] = []  # path, start, end, bytes
        self._handle: Any = None
        self._count = 0

    def new_stream(self) -> None:
        """A new capture of the box begins: its header comes first again."""
        with self._lock:
            self._buffer = b""
            self._header = None
            self._close_current()

    def feed(self, chunk: bytes) -> None:
        with self._lock:
            self._buffer += chunk
            if self._header is None:
                if len(self._buffer) < 24:
                    return
                head = self._buffer[:24]
                if head[:4] not in pcap.MAGICS:
                    raise ValueError("not a pcap stream")
                order, _nano, extended = pcap.MAGICS[head[:4]]
                self._order = order
                self._record_size = 24 if extended else 16
                self._header = head
                self._buffer = self._buffer[24:]
            record = struct.Struct(f"{self._order}IIII")
            position = 0
            while len(self._buffer) - position >= self._record_size:
                captured = record.unpack_from(self._buffer, position)[2]
                end = position + self._record_size + captured
                if len(self._buffer) < end:
                    break
                self._write(self._buffer[position:end])
                position = end
            self._buffer = self._buffer[position:]

    def _write(self, data: bytes) -> None:
        now = self._clock()
        current = self._segments[-1] if self._handle else None
        if current and (
            now - current["start"] >= self.segment_seconds
            or current["bytes"] >= max(1024 * 1024, self.max_bytes // 10)
        ):
            self._close_current()
            current = None
        if current is None:
            self._count += 1
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.directory / f"seg-{self._count:08d}.pcap"
            self._handle = path.open("wb")
            self._handle.write(self._header)
            current = {"path": path, "start": now, "end": now, "bytes": 24}
            self._segments.append(current)
        self._handle.write(data)
        current["bytes"] += len(data)
        current["end"] = now
        self._prune(now)

    def _close_current(self) -> None:
        if self._handle:
            self._handle.close()
            self._handle = None

    def _prune(self, now: float) -> None:
        # the segment being written always stays; the others go when too old or too many bytes
        while len(self._segments) > 1:
            total = sum(seg["bytes"] for seg in self._segments)
            oldest = self._segments[0]
            if now - oldest["end"] <= self.window_seconds and total <= self.max_bytes:
                break
            self._segments.pop(0)["path"].unlink(missing_ok=True)

    def status(self) -> dict[str, Any]:
        """How much is held: seconds of traffic and bytes."""
        with self._lock:
            if not self._segments:
                return {"seconds": 0.0, "bytes": 0}
            span = self._clock() - self._segments[0]["start"]
            return {
                "seconds": round(min(span, self.window_seconds + self.segment_seconds), 1),
                "bytes": sum(seg["bytes"] for seg in self._segments),
            }

    def save(self, target: Path) -> int:
        """Join what is held into one pcap file; the number of bytes written.

        Raises ValueError when nothing has arrived yet.
        """
        with self._lock:
            if self._handle:
                self._handle.flush()
            segments = list(self._segments)
            if not segments:
                raise ValueError("the ring buffer holds nothing yet")
            written = 0
            with target.open("wb") as out:
                for index, seg in enumerate(segments):
                    with seg["path"].open("rb") as source:
                        data = source.read()
                    if index:
                        data = data[24:]  # one header is enough
                    out.write(data)
                    written += len(data)
            return written

    def close(self, *, delete: bool = True) -> None:
        with self._lock:
            self._close_current()
            if delete:
                for seg in self._segments:
                    seg["path"].unlink(missing_ok=True)
                self._segments = []


@dataclass
class Ring:
    """The ring buffer that runs now: what it records and how long it holds."""

    interface: str
    minutes: int
    max_bytes: int
    writer: SegmentWriter
    device: str | None = None
    ips: tuple[str, ...] = ()
    error: str | None = None
    stop: Any = field(default_factory=threading.Event, repr=False)


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
        self.bands: dict[str, str] = {}  # interface -> band, as last found
        self._store: Store | None = None
        self.detecting = False
        self._interfaces: list[dict[str, str]] | None = None
        self._interfaces_at = 0.0
        self._task: asyncio.Task[None] | None = None
        self.ring: Ring | None = None
        self._ring_task: asyncio.Task[None] | None = None
        self._listeners: list[Callable[[], None]] = []

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Be told when the ring buffer starts, stops or saves; returns the way to stop."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    @callback
    def _notify(self) -> None:
        for listener in list(self._listeners):
            listener()

    @classmethod
    async def async_load(cls, hass: HomeAssistant, entry_id: str, client: Any) -> CaptureManager:
        """The manager with the bands found earlier, which are kept over restarts."""
        manager = cls(hass, entry_id, client)
        manager._store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.capture.{entry_id}")  # noqa: SLF001
        stored = await manager._store.async_load()  # noqa: SLF001
        if isinstance(stored, dict) and isinstance(stored.get("bands"), dict):
            manager.bands = {k: v for k, v in stored["bands"].items() if INTERFACE_RE.match(k)}
        return manager

    def save_bands(self) -> None:
        """Keep the bands found; in the event loop, the thread that found them may not save."""
        if self._store is not None:
            self._store.async_delay_save(lambda: {"bands": self.bands}, HISTORY_SAVE_DELAY)

    async def async_flush(self) -> None:
        if self._store is not None:
            await self._store.async_save({"bands": self.bands})
        # an ended ring buffer drops its segments before the box is gone
        if self._ring_task is not None and not self._ring_task.done():
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(self._ring_task), RING_STOP_WAIT)

    def begin_detection(self) -> None:
        """Claim the box for the detection; call it in the event loop, before the executor job.

        Refused while a capture runs or another detection does. The flag is set here, in the same
        step as the check, so no capture can be started in between.
        """
        if self.busy:
            raise ValueError("busy")
        self.detecting = True

    def detect_bands(self, wifi: dict[str, str], *, claimed: bool = False) -> dict[str, Any]:
        """Find out which band the Wi-Fi access points of the box carry; blocking, for an executor.

        ``wifi`` are the devices of the mesh on Wi-Fi at the box itself, {mac: band}. Refused while
        a capture runs. What is found is kept; an access point it is not clear for is left unnamed.
        ``claimed`` says that ``begin_detection`` was called before.
        """
        if not claimed:
            self.begin_detection()
        directory = self.directory
        try:
            interfaces = [i["id"] for i in self.interfaces() if WIFI_AP_RE.match(i["id"])]
            if not interfaces:
                raise ValueError("no access points")
            directory.mkdir(parents=True, exist_ok=True)
            result, votes = detect_wifi_bands(self._client, interfaces, wifi, directory)
        finally:
            self.detecting = False
        found = {i: band for i, band in result.items() if band}
        # an access point that is clear now replaces the old answer, an unclear one keeps none
        self.bands = {**{k: v for k, v in self.bands.items() if k not in result}, **found}
        return {
            "bands": found,
            "undecided": [i for i, band in result.items() if not band],
            "votes": votes,
        }

    @property
    def directory(self) -> Path:
        return Path(self._hass.config.path(DIR_NAME)) / self._entry_id

    @property
    def running(self) -> bool:
        return self.job is not None and self.job.state == "running"

    @property
    def ring_active(self) -> bool:
        return self.ring is not None

    @property
    def busy(self) -> bool:
        """The box records one thing at a time: a capture, the detection or the ring buffer."""
        return self.running or self.detecting or self.ring_active

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
        if self.busy:
            raise ValueError("busy")
        seconds = max(MIN_SECONDS, min(MAX_SECONDS, seconds))
        max_bytes = max(1024 * 1024, min(MAX_BYTES, max_bytes))
        stamp = dt_util.now().strftime("%Y%m%d-%H%M%S")
        suffix = f"-{device.replace(':', '')}" if device else ""
        name = f"{interface_slug(interface)}_{stamp}{suffix}.pcap"
        if not FILE_RE.match(name):
            raise ValueError("invalid device")
        job = Job(
            interface=interface,
            name=name,
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

    def ring_start(
        self,
        interface: str,
        minutes: int,
        max_bytes: int,
        device: str | None = None,
        ips: tuple[str, ...] = (),
    ) -> Ring:
        """Begin the ring buffer; raises ValueError for a bad request or when the box is busy."""
        if not INTERFACE_RE.match(interface):
            raise ValueError("unknown interface")
        if self.busy:
            raise ValueError("busy")
        minutes = max(RING_MIN_MINUTES, min(RING_MAX_MINUTES, minutes))
        max_bytes = max(1024 * 1024, min(RING_MAX_MB * 1048576, max_bytes))
        if device and not re.fullmatch(r"([0-9a-f]{2}:){5}[0-9a-f]{2}", device):
            raise ValueError("invalid device")
        writer = SegmentWriter(self.directory / RING_DIR, minutes * 60, max_bytes)
        ring = Ring(interface, minutes, max_bytes, writer, device, ips)
        self.ring = ring
        # a background task: it runs for as long as the ring buffer does, and nothing waits for it
        self._ring_task = self._hass.async_create_background_task(
            self._ring_run(ring), f"{DOMAIN}_ring_buffer"
        )
        self._notify()
        return ring

    def ring_stop(self) -> None:
        """End the ring buffer; what it holds is dropped, so save before."""
        if self.ring is not None:
            self.ring.stop.set()

    async def _ring_run(self, ring: Ring) -> None:
        def work() -> None:
            shutil.rmtree(ring.writer.directory, ignore_errors=True)  # leftovers of a crash
            failures = 0
            while not ring.stop.is_set():
                ring.writer.new_stream()
                try:
                    self._client.capture(
                        ring.interface,
                        None,
                        10**9,
                        10**12,
                        ring.stop,
                        lambda _: None,
                        ring.writer.feed,
                    )
                except (OSError, ValueError, PermissionError, http.client.HTTPException) as err:
                    ring.error = str(err)
                    delay = RING_RETRY_SECONDS[min(failures, len(RING_RETRY_SECONDS) - 1)]
                    failures += 1
                    ring.stop.wait(delay)
                else:
                    ring.error = None
                    failures = 0
                    ring.stop.wait(2)  # the box ends one recording before it starts the next

        try:
            await self._hass.async_add_executor_job(work)
        except Exception:  # noqa: BLE001 - the thread must not take the loop with it
            _LOGGER.exception("The ring buffer on %s stopped", ring.interface)
        finally:
            await self._hass.async_add_executor_job(ring.writer.close)
            if self.ring is ring:
                self.ring = None
            self._notify()

    def ring_state(self) -> dict[str, Any]:
        ring = self.ring
        if ring is None:
            return {"active": False}
        return {
            "active": True,
            "interface": ring.interface,
            "device": ring.device.replace(":", "") if ring.device else None,
            "minutes": ring.minutes,
            "max_mb": ring.max_bytes // 1048576,
            "error": ring.error,
            **ring.writer.status(),
        }

    def _save_ring(self) -> str:
        ring = self.ring
        if ring is None:
            raise ValueError("not running")
        stamp = dt_util.now().strftime("%Y%m%d-%H%M%S")
        suffix = f"-{ring.device.replace(':', '')}" if ring.device else ""
        name = f"{interface_slug(ring.interface)}_{stamp}{suffix}-ring.pcap"
        path = self.directory / name
        self.directory.mkdir(parents=True, exist_ok=True)
        if ring.device:
            joined = path.with_suffix(".tmp")
            try:
                ring.writer.save(joined)
                kept = pcap.filter_device(joined, path, ring.device, set(ring.ips))
            finally:
                joined.unlink(missing_ok=True)
            if kept == 0:
                path.unlink(missing_ok=True)
                raise ValueError("the device sent or received nothing in that time")
        else:
            ring.writer.save(path)
        self._prune()
        return name

    async def async_ring_save(self) -> str:
        """Keep what the ring buffer holds as a capture file; the ring goes on recording."""
        name = await self._hass.async_add_executor_job(self._save_ring)
        self._notify()
        return name

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
                "device": (m := FILE_PARTS_RE.match(f["name"])) and m.group(2),
                "ring": bool((m := FILE_PARTS_RE.match(f["name"])) and m.group(3)),
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

    def is_recording(self, name: str) -> bool:
        """Whether the file is the one a running capture writes."""
        return bool(self.running and self.job and self.job.name == name)

    def delete(self, name: str) -> bool:
        if not FILE_RE.match(name):
            return False
        path = self.directory / name
        if not path.is_file() or self.is_recording(name):
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
        if not await hass.async_add_executor_job(path.is_file):
            return web.Response(status=404)
        if manager.is_recording(name):
            return web.Response(status=409)  # still being written: not a file to take yet
        return web.FileResponse(
            path,
            headers={
                "Content-Type": "application/vnd.tcpdump.pcap",
                "Content-Disposition": f'attachment; filename="{name}"',
            },
        )


@callback
def async_setup_ring(hass: HomeAssistant, entry: ConfigEntry, manager: CaptureManager) -> None:
    """Start the ring buffer if the options say so, and watch the entity that triggers a save.

    A change of the trigger entity (to the chosen state, or any) saves what the ring buffer
    holds after the wait set in the options; a second change in the meantime does not add one.
    """
    options = entry.options
    if options.get(CONF_RING_AUTOSTART):
        try:
            manager.ring_start(
                options.get(CONF_RING_INTERFACE, DEFAULT_RING_INTERFACE),
                options.get(CONF_RING_MINUTES, DEFAULT_RING_MINUTES),
                options.get(CONF_RING_MB, DEFAULT_RING_MB) * 1048576,
            )
        except ValueError as err:
            _LOGGER.warning("The ring buffer did not start: %s", err)
    entity = options.get(CONF_RING_TRIGGER)
    if not entity:
        return
    wanted = options.get(CONF_RING_TRIGGER_STATE) or None
    after = options.get(CONF_RING_AFTER, DEFAULT_RING_AFTER)
    pending: list[Callable[[], None]] = []

    async def save(_now: Any) -> None:
        pending.clear()
        try:
            await manager.async_ring_save()
        except ValueError as err:
            _LOGGER.debug("The ring buffer was not saved: %s", err)

    @callback
    def changed(event: Event) -> None:
        old, new = event.data.get("old_state"), event.data.get("new_state")
        if old is None or new is None or old.state == new.state:
            return  # only a change of the state counts, not of an attribute
        if wanted and new.state != wanted:
            return
        if manager.ring_active and not pending:
            pending.append(async_call_later(hass, after, save))

    @callback
    def cancel() -> None:
        for undo in pending:
            undo()
        pending.clear()

    entry.async_on_unload(async_track_state_change_event(hass, [entity], changed))
    entry.async_on_unload(cancel)
