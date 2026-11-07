"""The firmware of the box: whether a newer one is on offer."""

from __future__ import annotations

from typing import Any

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.update import UpdateEntity, UpdateEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, KEY_FIRMWARE
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """The entity, once the box has answered about its firmware (some models never do)."""
    coordinator = entry.runtime_data
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or coordinator.data.firmware is None:
            return
        added = True
        async_add_entities([FritzNetworkFirmware(coordinator)])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


class FritzNetworkFirmware(CoordinatorEntity[FritzNetworkCoordinator], UpdateEntity):
    """Shows a new firmware and, with the right to change settings, lets the box install it."""

    _attr_has_entity_name = True
    _attr_translation_key = KEY_FIRMWARE

    def __init__(self, coordinator: FritzNetworkCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.serial}_{KEY_FIRMWARE}"
        self.entity_id = f"update.fritz_network_{KEY_FIRMWARE}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})
        if coordinator.can_write:
            self._attr_supported_features = UpdateEntityFeature.INSTALL

    @property
    def installed_version(self) -> str | None:
        return self.coordinator.client.system_version

    @property
    def latest_version(self) -> str | None:
        firmware = self.coordinator.data.firmware
        if firmware is not None and firmware.update_available and firmware.version:
            return firmware.version
        return self.installed_version

    @property
    def release_url(self) -> str | None:
        firmware = self.coordinator.data.firmware
        return firmware.info_url if firmware and firmware.update_available else None

    async def async_install(self, version: str | None, backup: bool, **kwargs: Any) -> None:
        """Start the installation; the box restarts, so the next polls fail for a few minutes."""
        try:
            await self.coordinator.async_install_firmware()
        except FritzConnectionException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="action_failed",
                translation_placeholders={"error": str(err)},
            ) from err
