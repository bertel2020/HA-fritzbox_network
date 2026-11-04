"""What the user notes about the address space: notes, own names, entries and groups."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, HISTORY_SAVE_DELAY

STORAGE_VERSION = 1


def empty_notes() -> dict[str, Any]:
    """Nothing noted yet."""
    return {"notes": {}, "names": {}, "marks": [], "muted": [], "blocks": [], "entries": []}


class AddressNotes:
    """The own data of the address page, kept over restarts; it never touches the box.

    notes: {ip: text}, names: {mac: display name}, marks: [ips planned; older data, the panel turns
    them into entries], muted: [ids of the hints the user switched off], blocks: [{id, name, from,
    to, color}] the address groups, entries: [{id, name, from, to, kind, note}] the manual entries,
    all as last octets.
    """

    def __init__(self, store: Store, data: dict[str, Any]) -> None:
        self._store = store
        self.data = {**empty_notes(), **data}

    @classmethod
    async def async_load(cls, hass: HomeAssistant, entry_id: str) -> AddressNotes:
        store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.addresses.{entry_id}")
        stored = await store.async_load()
        return cls(store, stored if isinstance(stored, dict) else {})

    def replace(self, data: dict[str, Any]) -> None:
        """Take over what the page sends, all of it, and save it a moment later."""
        self.data = {**empty_notes(), **data}
        self._store.async_delay_save(lambda: self.data, HISTORY_SAVE_DELAY)

    async def async_flush(self) -> None:
        await self._store.async_save(self.data)
