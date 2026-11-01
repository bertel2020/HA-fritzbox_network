"""The vendor behind a MAC address, from the list that ships with Home Assistant."""

from __future__ import annotations

import aiooui

from .models import is_private_mac


async def async_load() -> None:
    """Load the vendor list (once, from disk, no network)."""
    if not aiooui.is_loaded():
        await aiooui.async_load()


def vendor_of(mac: str) -> str | None:
    """The vendor of a MAC address, None where it has none or the list is not loaded.

    A private (randomized) address belongs to no vendor.
    """
    if not aiooui.is_loaded() or is_private_mac(mac):
        return None
    return aiooui.get_vendor(mac)
