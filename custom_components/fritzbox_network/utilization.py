"""CPU load, temperature and RAM use over a week and a month: recorded while switched on.

The box keeps about the last day itself (the page "ecoStat" of the web interface), so the panel
reads that live. For the week and the month Home Assistant writes the newest values down every
few minutes, while the recording is on, and keeps them for a month. Off until the user switches it
on in the panel, like the course of the connection: it is a request to the box every few minutes.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
import logging
import time
from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
import requests

from .const import DOMAIN, HISTORY_SAVE_DELAY

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
INTERVAL = timedelta(minutes=5)
KEPT_SECONDS = 31 * 86400
# the span the box keeps itself, and the spans the recording shows: how many points of what size
DAY_SECONDS = 86400
RANGES = {"day": (240, 360), "week": (336, 1800), "month": (360, 7200)}
# the order of the values in a sample and in a point: [epoch seconds, cpu, temp, ram]
FIELDS = ("cpu", "temp", "ram")
_ERRORS = (
    FritzConnectionException,
    OSError,
    requests.RequestException,
    PermissionError,
    ValueError,
)


def stretch(values: list[int | None], size: int) -> list[int | None]:
    """A series spread over ``size`` points, the short ones (the RAM) by repeating their values."""
    if not values:
        return [None] * size
    return [values[min(len(values) - 1, i * len(values) // size)] for i in range(size)]


def day_points(series: dict[str, list[int | None]], now: float) -> list[list[Any]]:
    """The day the box keeps, as points [epoch seconds, cpu, temp, ram] ending now."""
    size, step = RANGES["day"]
    columns = [stretch(series.get(key, []), size) for key in FIELDS]
    # the newest value is last; the box keeps the span evenly, so one step is day / count
    return [[round(now - (size - 1 - i) * step), *(col[i] for col in columns)] for i in range(size)]


class UtilizationMonitor:
    """Reads CPU load, temperature and RAM every few minutes and keeps them for a month."""

    def __init__(
        self, hass: HomeAssistant, store: Store, data: dict[str, Any], client: Any
    ) -> None:
        self._hass = hass
        self._store = store
        self._client = client
        self.data: dict[str, Any] = {"enabled": False, "samples": [], **data}
        self._unsubscribe: Callable[[], None] | None = None
        self._running = False

    @classmethod
    async def async_load(
        cls, hass: HomeAssistant, entry_id: str, client: Any
    ) -> UtilizationMonitor:
        store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.utilization.{entry_id}")
        stored = await store.async_load()
        monitor = cls(hass, store, stored if isinstance(stored, dict) else {}, client)
        monitor._schedule()  # noqa: SLF001 - switched on before the restart: carry on
        return monitor

    @property
    def enabled(self) -> bool:
        return bool(self.data["enabled"])

    @property
    def since(self) -> int | None:
        """When the oldest value kept was taken."""
        samples = self.data["samples"]
        return samples[0][0] if samples else None

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
        """One read; never two at once, and nothing once it is switched off."""
        if not self.enabled or self._running:
            return
        self._running = True
        try:
            series = await self._hass.async_add_executor_job(self._client.get_utilization_history)
        except _ERRORS as err:
            _LOGGER.debug("CPU load and RAM could not be recorded: %s", err)
            return
        finally:
            self._running = False
        if not series:
            return
        stamp = round(time.time())
        samples = self.data["samples"]
        samples.append([stamp, *((series.get(key) or [None])[-1] for key in FIELDS)])
        self.data["samples"] = [s for s in samples if s[0] >= stamp - KEPT_SECONDS]
        self._save()

    def points(self, span: str, now: float | None = None) -> list[list[Any]]:
        """The recording over a week or a month: [epoch seconds, cpu, temp, ram] per bucket.

        The mean of the samples in a bucket, whole numbers; None where nothing was recorded.
        """
        count, size = RANGES[span]
        now = time.time() if now is None else now
        end = int(now // size + 1) * size  # the bucket of now ends here
        start = end - count * size
        sums = [[0, 0] for _ in range(count * len(FIELDS))]  # [sum, number] per bucket and field
        for sample in self.data["samples"]:
            n = int((sample[0] - start) // size)
            if not 0 <= n < count:
                continue
            for k, value in enumerate(sample[1 : 1 + len(FIELDS)]):
                if isinstance(value, (int, float)):
                    cell = sums[n * len(FIELDS) + k]
                    cell[0] += value
                    cell[1] += 1
        points = []
        for n in range(count):
            row = [start + (n + 1) * size]
            for k in range(len(FIELDS)):
                total, number = sums[n * len(FIELDS) + k]
                row.append(round(total / number) if number else None)
            points.append(row)
        return points

    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, HISTORY_SAVE_DELAY)

    async def async_flush(self) -> None:
        self.stop()
        await self._store.async_save(self.data)
