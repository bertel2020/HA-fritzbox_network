"""The course of the connection: the diagnosis check, run now and then while switched on.

Off until the user switches it on in the panel, because it connects to a public address now and
then. Kept over restarts for a few days; the panel shows the last 24 hours or all three days.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .connection_check import run_checks
from .const import DOMAIN, HISTORY_SAVE_DELAY

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
INTERVAL = timedelta(minutes=5)
KEPT_SECONDS = 3 * 86400
# the order of the milliseconds in a sample: [epoch seconds, box, internet, dns, web, ipv6]
STEPS = ["box", "internet", "dns", "web", "ipv6"]


class LatencyMonitor:
    """Runs the connection check every few minutes and keeps the times; a failed step has None."""

    def __init__(
        self, hass: HomeAssistant, store: Store, data: dict[str, Any], host: str, port: int
    ) -> None:
        self._hass = hass
        self._store = store
        self._host = host
        self._port = port
        self.data: dict[str, Any] = {"enabled": False, "samples": [], **data}
        self._unsubscribe: Callable[[], None] | None = None
        self._running = False

    @classmethod
    async def async_load(
        cls, hass: HomeAssistant, entry_id: str, host: str, port: int
    ) -> LatencyMonitor:
        store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.latency.{entry_id}")
        stored = await store.async_load()
        monitor = cls(hass, store, stored if isinstance(stored, dict) else {}, host, port)
        monitor._schedule()  # noqa: SLF001 - switched on before the restart: carry on
        return monitor

    @property
    def enabled(self) -> bool:
        return bool(self.data["enabled"])

    def set_enabled(self, enabled: bool) -> None:
        self.data["enabled"] = enabled
        self._save()
        self._schedule()
        if enabled:
            self._hass.async_create_task(self.async_sample())

    def _schedule(self) -> None:
        self.stop()
        if self.enabled:
            self._unsubscribe = async_track_time_interval(self._hass, self.async_sample, INTERVAL)

    def stop(self) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None

    async def async_sample(self, now: object = None) -> None:
        """One run of the check; never two at once, and nothing once it is switched off."""
        if not self.enabled or self._running:
            return
        self._running = True
        try:
            result = await run_checks(self._host, self._port)
        except Exception:  # noqa: BLE001 - a monitor must outlive whatever one run did
            _LOGGER.debug("The connection check failed", exc_info=True)
            return
        finally:
            self._running = False
        times = {step["key"]: step["ms"] for step in result["steps"]}
        stamp = round(time.time())
        samples = self.data["samples"]
        samples.append([stamp, *(times.get(key) for key in STEPS)])
        self.data["samples"] = [s for s in samples if s[0] >= stamp - KEPT_SECONDS]
        self._save()

    def samples(self, seconds: int = 86400) -> list[list[Any]]:
        """The samples of the last ``seconds``."""
        limit = time.time() - seconds
        return [s for s in self.data["samples"] if s[0] >= limit]

    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, HISTORY_SAVE_DELAY)

    async def async_flush(self) -> None:
        self.stop()
        await self._store.async_save(self.data)
