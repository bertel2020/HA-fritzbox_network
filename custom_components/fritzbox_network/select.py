"""Access profile of a client device."""

from __future__ import annotations

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, KEY_ACCESS_PROFILE
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkClientEntity, async_setup_client_entities
from .models import Host

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    if not coordinator.can_write or not coordinator.filter_profiles:
        return
    async_setup_client_entities(
        entry,
        async_add_entities,
        lambda coordinator, host: [FritzNetworkAccessProfile(coordinator, host)],
    )


class FritzNetworkAccessProfile(FritzNetworkClientEntity, SelectEntity):
    """The access profile of the box the device is in, for example "Kids"."""

    _attr_translation_key = KEY_ACCESS_PROFILE
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: FritzNetworkCoordinator, host: Host) -> None:
        super().__init__(coordinator, host, "select", KEY_ACCESS_PROFILE)

    def _names(self) -> dict[str, str]:
        """Profile id -> name shown; a name two profiles share gets the id added."""
        profiles = self.coordinator.filter_profiles
        counts = list(profiles.values())
        return {
            pid: f"{name} ({pid})" if counts.count(name) > 1 else name
            for pid, name in profiles.items()
        }

    @property
    def available(self) -> bool:
        # The box sets the profile by IPv4 address, like the internet access.
        return super().available and bool(self.host and self.host.ip)

    @property
    def options(self) -> list[str]:
        return list(self._names().values())

    @property
    def current_option(self) -> str | None:
        host = self.host
        return self._names().get(host.filter_profile) if host and host.filter_profile else None

    async def async_select_option(self, option: str) -> None:
        host = self.host
        if host is None or not host.ip:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_ipv4_address")
        profile_id = next((p for p, name in self._names().items() if name == option), None)
        if profile_id is None:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="unknown_profile")
        try:
            await self.coordinator.async_set_filter_profile(host, profile_id)
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err
