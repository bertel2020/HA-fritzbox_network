"""Internet access switch per client device."""

from __future__ import annotations

from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, KEY_INTERNET_ACCESS
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if not entry.runtime_data.can_write:
        return
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [FritzNetworkInternetAccess(coordinator, host)],
    )


class FritzNetworkInternetAccess(FritzNetworkClientEntity, SwitchEntity):
    """On = the device may use the internet."""

    _attr_translation_key = KEY_INTERNET_ACCESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_INTERNET_ACCESS)

    @property
    def available(self) -> bool:
        # The box blocks by IPv4 address, a host without one cannot be switched.
        return super().available and bool(self.host and self.host.ip)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None or host.wan_access is None else host.wan_access

    async def _set(self, allowed: bool) -> None:
        host = self.host
        if host is None or not host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_ipv4_address")
        try:
            await self.coordinator.async_set_internet_access(host, allowed)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
