"""The QR code of the guest Wi-Fi: scan it to join."""

from __future__ import annotations

import logging
import time

from fritzconnection.core.exceptions import FritzConnectionException
from homeassistant.components.image import ImageEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import UpdateFailed
from homeassistant.util import dt as dt_util
import requests

from .const import AREA_WIFI, DOMAIN, KEY_GUEST_WIFI_QR
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .entity import FritzNetworkRepeaterEntity, async_remove_entities, switch_areas
from .repeater import RepeaterCoordinator

_LOGGER = logging.getLogger(__name__)

PARALLEL_UPDATES = 1
# the code is made again now and then and at once when the password was set from here: the
# network name or password may also be changed in the box
QR_REFRESH_SECONDS = 3600


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """The image, for a box that has a guest network and a user who may read its password."""
    coordinator = entry.runtime_data
    if not coordinator.can_write:
        return
    if AREA_WIFI not in switch_areas(entry):
        async_remove_entities(
            hass, entry, "image", lambda uid: uid.endswith(f"_{KEY_GUEST_WIFI_QR}")
        )
        return
    for repeater in coordinator.repeaters.values():
        _async_setup_repeater(hass, repeater, entry, async_add_entities)
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or coordinator.data.guest_wifi is None:
            return
        added = True
        async_add_entities([FritzNetworkGuestWifiQr(hass, coordinator)])

    _add()
    entry.async_on_unload(coordinator.async_add_listener(_add))


@callback
def _async_setup_repeater(
    hass: HomeAssistant,
    repeater: RepeaterCoordinator,
    entry: FritzNetworkConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """The image of a repeater that has a guest network, once it has told so."""
    added = False

    @callback
    def _add() -> None:
        nonlocal added
        if added or repeater.data is None or repeater.data.guest is None:
            return
        added = True
        async_add_entities([FritzNetworkRepeaterGuestQr(hass, repeater)])

    _add()
    entry.async_on_unload(repeater.async_add_listener(_add))


class FritzNetworkRepeaterGuestQr(FritzNetworkRepeaterEntity, ImageEntity):
    """The QR code of the guest Wi-Fi of a repeater; off by default, like the one of the box."""

    _attr_translation_key = KEY_GUEST_WIFI_QR
    _attr_content_type = "image/png"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, hass: HomeAssistant, coordinator: RepeaterCoordinator) -> None:
        FritzNetworkRepeaterEntity.__init__(self, coordinator, "image", KEY_GUEST_WIFI_QR)
        ImageEntity.__init__(self, hass)
        self._image: bytes | None = None
        self._refreshed = 0.0
        self._busy = False

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        await self._async_refresh()

    @callback
    def _handle_coordinator_update(self) -> None:
        if time.monotonic() - self._refreshed >= QR_REFRESH_SECONDS:
            self.hass.async_create_task(self._async_refresh())
        super()._handle_coordinator_update()

    async def _async_refresh(self) -> None:
        if self._busy:
            return
        self._busy = True
        try:
            image = await self.coordinator.async_guest_qr()
        except (FritzConnectionException, requests.RequestException, OSError, UpdateFailed) as err:
            # the text of the error holds no password
            _LOGGER.debug("The QR code of a repeater is unavailable: %s", type(err).__name__)
            image = None
        finally:
            self._busy = False
        self._refreshed = time.monotonic()
        if image != self._image:
            self._image = image
            self._attr_image_last_updated = dt_util.utcnow() if image else None
            self.async_write_ha_state()

    async def async_image(self) -> bytes | None:
        return self._image


class FritzNetworkGuestWifiQr(ImageEntity):
    """The QR code of the guest Wi-Fi; off by default, because it shows the password.

    Everyone who may look at the entity can join the network: that is why it is off until
    someone turns it on. It is made when the entity is added, hourly and after the password
    was set from here. The image changes (and with it the time of the last change) only when
    its bytes do.
    """

    _attr_has_entity_name = True
    _attr_translation_key = KEY_GUEST_WIFI_QR
    _attr_content_type = "image/png"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, coordinator: FritzNetworkCoordinator) -> None:
        ImageEntity.__init__(self, hass)
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.serial}_{KEY_GUEST_WIFI_QR}"
        self.entity_id = f"image.fritz_network_{KEY_GUEST_WIFI_QR}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, coordinator.serial)})
        self._image: bytes | None = None
        self._refreshed = 0.0
        self._seen_change = coordinator.guest_password_changed
        self._busy = False

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self._coordinator.async_add_listener(self._on_update))
        await self._async_refresh()

    @callback
    def _on_update(self) -> None:
        changed = self._coordinator.guest_password_changed != self._seen_change
        if changed or time.monotonic() - self._refreshed >= QR_REFRESH_SECONDS:
            self.hass.async_create_task(self._async_refresh())

    async def _async_refresh(self) -> None:
        if self._busy:
            return
        self._busy = True
        self._seen_change = self._coordinator.guest_password_changed
        try:
            image = await self.hass.async_add_executor_job(
                self._coordinator.client.get_guest_wifi_qr
            )
        except (FritzConnectionException, requests.RequestException, OSError) as err:
            # no value is shown, but the reason is: the text of the error holds no password
            _LOGGER.debug("The QR code of the guest Wi-Fi is unavailable: %s", type(err).__name__)
            image = None
        finally:
            self._busy = False
        self._refreshed = time.monotonic()
        if image != self._image:
            self._image = image
            self._attr_image_last_updated = dt_util.utcnow() if image else None
            self.async_write_ha_state()

    async def async_image(self) -> bytes | None:
        return self._image
