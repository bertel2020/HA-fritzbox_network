"""The recent past of the devices: online, signal and rate, kept over restarts."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    HISTORY_COARSE_SECONDS,
    HISTORY_DAYS,
    HISTORY_FINE_SECONDS,
    HISTORY_OFFLINE_SECONDS,
    HISTORY_SAVE_DELAY,
    INTERNET_ADDRESSES_KEPT,
    INTERNET_EVENTS_KEPT,
    TRAFFIC_DAYS,
    VPN_SESSIONS_KEPT,
)

STORAGE_VERSION = 1

_HOUR = 3600
_DAY = 86400
_VPN_CHART_DAYS = 365  # how far back the chart of a tunnel reaches

# one point: [epoch seconds, online 0..1, signal in dBm or None, rate in Mbit/s or None]
type Point = list[float | None]


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def _aggregate(points: list[Point], ts: float) -> Point:
    """One point for a stretch of points: the share of time online and the means."""
    return [
        ts,
        _mean([p[1] for p in points if p[1] is not None]),
        _mean([p[2] for p in points if p[2] is not None]),
        _mean([p[3] for p in points if p[3] is not None]),
    ]


class DeviceHistory:
    """A day in small steps and a week in hours, per device.

    A device that is offline is noted only now and then: it would fill the file with nothing.
    """

    def __init__(
        self,
        store: Store,
        data: dict[str, dict[str, list[Point]]],
        traffic: dict[str, dict[str, Any]] | None = None,
        connection: dict[str, Any] | None = None,
        vpn: dict[str, Any] | None = None,
    ) -> None:
        self._store = store
        self._data = data
        # per device: the last counters and the bytes per day, [received, sent]
        self._traffic = traffic if traffic is not None else {}
        # the internet connection: the events, and per kind of address when it was in use
        self._connection = connection if connection is not None else {}
        self._connection.setdefault("events", [])
        self._connection.setdefault("addresses", {})
        # the WireGuard connections: per key the sessions [start, end or None], and since when noted
        self._vpn = vpn if vpn is not None else {}
        self._vpn.setdefault("sessions", {})

    @classmethod
    async def async_load(cls, hass: HomeAssistant, entry_id: str) -> DeviceHistory:
        store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.history.{entry_id}")
        stored = await store.async_load()
        data = stored.get("devices") if isinstance(stored, dict) else None
        traffic = stored.get("traffic") if isinstance(stored, dict) else None
        connection = stored.get("connection") if isinstance(stored, dict) else None
        vpn = stored.get("vpn") if isinstance(stored, dict) else None
        return cls(
            store,
            data if isinstance(data, dict) else {},
            traffic if isinstance(traffic, dict) else {},
            connection if isinstance(connection, dict) else {},
            vpn if isinstance(vpn, dict) else {},
        )

    def record_connection_event(self, time: str, kind: str, detail: str | None) -> None:
        """Keep an event of the internet connection, the newest last."""
        events = self._connection["events"]
        events.append({"time": time, "kind": kind, "detail": detail})
        del events[:-INTERNET_EVENTS_KEPT]
        self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def connection_events(self) -> list[dict[str, Any]]:
        """The kept events of the connection, the newest first."""
        return list(reversed(self._connection["events"]))

    def note_address(self, now: str, kind: str, value: str | None) -> None:
        """Note the address of a kind in use: a new value closes the one before.

        A box that has no address of the kind (None) closes the one before as well.
        """
        periods = self._connection["addresses"].setdefault(kind, [])
        last = periods[-1] if periods else None
        if last and last["until"] is None:
            if last["value"] == value:
                return
            last["until"] = now
        elif last is None and value is None:
            return
        if value is not None:
            periods.append({"value": value, "since": now, "until": None})
            del periods[:-INTERNET_ADDRESSES_KEPT]
        self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def addresses(self) -> dict[str, list[dict[str, Any]]]:
        """Per kind the addresses that were in use, the newest first."""
        return {
            kind: list(reversed(periods)) for kind, periods in self._connection["addresses"].items()
        }

    def note_vpn(
        self,
        now: float,
        key: str,
        connected: bool,
        since: int | None,
        enabled: bool | None = None,
    ) -> None:
        """Note whether a WireGuard tunnel stands; a session runs from its start to its end.

        The box tells when a tunnel came up (``since``); a different time while a session is open
        means the tunnel was down and up again between two polls. ``enabled`` is whether the
        connection is switched on in the box; its periods are noted the same way, for the chart.
        """
        self._vpn.setdefault("since", now)
        sessions = self._vpn["sessions"].setdefault(key, [])
        last = sessions[-1] if sessions else None
        is_open = last is not None and last[1] is None
        changed = False
        if connected:
            start = float(since or now)
            if is_open and since and abs(last[0] - since) > 60:
                last[1] = min(float(since), now)
                is_open = False
                changed = True
            if not is_open:
                sessions.append([start, None])
                del sessions[:-VPN_SESSIONS_KEPT]
                changed = True
        elif is_open:
            last[1] = now
            changed = True
        if enabled is not None:
            periods = self._vpn.setdefault("enabled", {}).setdefault(key, [])
            open_period = bool(periods) and periods[-1][1] is None
            if enabled and not open_period:
                periods.append([now, None])
                del periods[:-VPN_SESSIONS_KEPT]
                changed = True
            elif not enabled and open_period:
                periods[-1][1] = now
                changed = True
        if changed:
            self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def vpn_stats(self, key: str, now: float) -> dict[str, Any]:
        """What was noted of a tunnel: sessions and time connected in 7 and 30 days, the longest."""
        limit30, limit7 = now - 30 * _DAY, now - 7 * _DAY
        sessions = self._vpn["sessions"].get(key) or []
        seconds = {7: 0.0, 30: 0.0}
        count = {7: 0, 30: 0}
        longest = 0.0
        for start, end in sessions:
            end = now if end is None else end
            longest = max(longest, end - start)
            for days, limit in ((7, limit7), (30, limit30)):
                if end > limit:
                    seconds[days] += end - max(start, limit)
                    count[days] += 1
        last_end = next((e for _, e in reversed(sessions) if e is not None), None)
        horizon = now - _VPN_CHART_DAYS * _DAY
        return {
            # for the chart: the sessions and the periods the connection was on, as far back as it shows
            "sessions": [[round(a), None if b is None else round(b)] for a, b in sessions if b is None or b > horizon],
            "enabled_periods": [
                [round(a), None if b is None else round(b)]
                for a, b in (self._vpn.get("enabled", {}).get(key) or [])
                if b is None or b > horizon
            ],
            "sessions_7d": count[7],
            "sessions_30d": count[30],
            "seconds_7d": round(seconds[7]),
            "seconds_30d": round(seconds[30]),
            "longest": round(longest),
            "last_end": round(last_end) if last_end else None,
            "tracked_since": round(self._vpn["since"]) if "since" in self._vpn else None,
        }

    def record_traffic(self, day: str, mac: str, received: int, sent: int) -> None:
        """Add what a device moved since the last counters to its day; a fallen one starts anew."""
        entry = self._traffic.setdefault(mac, {"last": None, "days": {}})
        last = entry["last"]
        entry["last"] = [received, sent]
        if last is None:
            self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)
            return
        delta = [
            now - before if now >= before else now
            for now, before in ((received, last[0]), (sent, last[1]))
        ]
        if any(delta):
            total = entry["days"].setdefault(day, [0, 0])
            total[0] += delta[0]
            total[1] += delta[1]
            for old in sorted(entry["days"])[:-TRAFFIC_DAYS]:
                del entry["days"][old]
            self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def traffic_all(self) -> dict[str, dict[str, list[int]]]:
        """The bytes of every device per day: {mac: {date: [received, sent]}}."""
        return {
            mac: dict(entry.get("days", {}))
            for mac, entry in self._traffic.items()
            if entry.get("days")
        }

    def traffic(self, mac: str) -> dict[str, list[int]]:
        """The bytes a device moved per day: {date: [received, sent]}."""
        return dict((self._traffic.get(mac) or {}).get("days", {}))

    def record(
        self, now: float, mac: str, online: bool, signal: float | None, rate: float | None
    ) -> None:
        """Note the state of a device, unless a point of it is recent enough."""
        series = self._data.setdefault(mac, {"f": [], "c": []})
        fine, coarse = series["f"], series["c"]
        step = HISTORY_FINE_SECONDS if online else HISTORY_OFFLINE_SECONDS
        # a device that just went offline is noted at once, so the end of its time online shows
        changed = bool(fine) and bool(fine[-1][1]) != online
        if fine and now - fine[-1][0] < step and not changed:
            return
        fine.append([now, 1.0 if online else 0.0, signal, rate])
        del fine[: next((i for i, p in enumerate(fine) if p[0] >= now - _DAY), len(fine))]
        if not coarse or now - coarse[-1][0] >= HISTORY_COARSE_SECONDS:
            since = coarse[-1][0] if coarse else 0
            coarse.append(_aggregate([p for p in fine if p[0] > since], now))
            limit = now - HISTORY_DAYS * _DAY
            del coarse[: next((i for i, p in enumerate(coarse) if p[0] >= limit), len(coarse))]
        self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def _snapshot(self) -> dict[str, Any]:
        return {
            "devices": self._data,
            "traffic": self._traffic,
            "connection": self._connection,
            "vpn": self._vpn,
        }

    async def async_flush(self) -> None:
        await self._store.async_save(self._snapshot())

    def prune(self, now: float) -> None:
        """Forget devices that have not been noted for the whole period."""
        limit = now - HISTORY_DAYS * _DAY
        for mac in [m for m, s in self._data.items() if not s["f"] or s["f"][-1][0] < limit]:
            del self._data[mac]
            self._traffic.pop(mac, None)
        old = now - (_VPN_CHART_DAYS + 5) * _DAY
        sessions = self._vpn["sessions"]
        for key in list(sessions):
            sessions[key] = [x for x in sessions[key] if x[1] is None or x[1] > old]
            if not sessions[key]:
                del sessions[key]
        enabled = self._vpn.get("enabled", {})
        for key in list(enabled):
            enabled[key] = [x for x in enabled[key] if x[1] is None or x[1] > old]
            if not enabled[key]:
                del enabled[key]

    def forget(self, mac: str) -> None:
        if (self._data.pop(mac, None) is not None) | (self._traffic.pop(mac, None) is not None):
            self._store.async_delay_save(self._snapshot, HISTORY_SAVE_DELAY)

    def device(self, mac: str) -> dict[str, list[Point]]:
        """The points of one device: the day in small steps and the week in hours."""
        series = self._data.get(mac) or {}
        return {
            "day": series.get("f", []),
            "week": series.get("c", []),
            "traffic": self.traffic(mac),
        }

    def summary(self, now: float, buckets: int = 24) -> dict[str, dict[str, list[float | None]]]:
        """Per device the last day in hours: share online, signal and rate (None: no data)."""
        result: dict[str, dict[str, list[float | None]]] = {}
        for mac, series in self._data.items():
            slots: list[list[Point]] = [[] for _ in range(buckets)]
            for point in series["f"]:
                age = int((now - point[0]) // _HOUR)
                if 0 <= age < buckets:
                    slots[buckets - 1 - age].append(point)
            result[mac] = {
                key: [_aggregate(slot, 0)[i] for slot in slots]
                for key, i in (("online", 1), ("signal", 2), ("rate", 3))
            }
        return result
