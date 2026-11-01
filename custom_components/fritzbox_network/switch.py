"""Internet access switch per client device."""

from __future__ import annotations

from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, KEY_INTERNET_ACCESS, KEY_PRIORITY
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
        lambda coordinator, host: [
            FritzNetworkInternetAccess(coordinator, host),
            FritzNetworkPriority(coordinator, host),
        ],
    )


class _HostSwitch(FritzNetworkClientEntity, SwitchEntity):
    """A switch the box takes by IPv4 address."""

    @property
    def available(self) -> bool:
        # The box acts by IPv4 address, a host without one cannot be switched.
        return super().available and bool(self.host and self.host.ip)

    async def _call(self, host: Host, value: bool) -> None:
        raise NotImplementedError

    async def _set(self, value: bool) -> None:
        host = self.host
        if host is None or not host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_ipv4_address")
        try:
            await self._call(host, value)
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


class FritzNetworkInternetAccess(_HostSwitch):
    """On = the device may use the internet."""

    _attr_translation_key = KEY_INTERNET_ACCESS

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_INTERNET_ACCESS)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None or host.wan_access is None else host.wan_access

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_internet_access(host, value)


class FritzNetworkPriority(_HostSwitch):
    """On = the router prefers the device when the line is busy."""

    _attr_translation_key = KEY_PRIORITY
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "switch", KEY_PRIORITY)

    @property
    def is_on(self) -> bool | None:
        host = self.host
        return None if host is None else host.priority

    async def _call(self, host: Host, value: bool) -> None:
        await self.coordinator.async_set_priority(host, value)
