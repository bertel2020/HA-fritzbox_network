"""The FRITZ!Box network integration: the devices of the home network, by MAC address."""

from __future__ import annotations

import logging

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import device_registry as dr, issue_registry as ir
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, DeviceEntry

from .api import FritzNetworkClient
from .const import CONF_HIDDEN_MACS, CONF_USE_TLS, DOMAIN
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.DEVICE_TRACKER,
    Platform.SENSOR,
    Platform.SWITCH,
]

ISSUE_MISSING_RIGHTS = "missing_rights"


async def async_setup_entry(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> bool:
    """Set up FRITZ!Box network from a config entry."""
    client = FritzNetworkClient(
        host=entry.data[CONF_HOST],
        port=entry.data.get(CONF_PORT),
        username=entry.data[CONF_USERNAME],
        password=entry.data[CONF_PASSWORD],
        use_tls=entry.data.get(CONF_USE_TLS, False),
    )

    def _connect() -> tuple[str | None, bool]:
        client.connect()
        return client.serial_number, client.can_write()

    try:
        serial, can_write = await hass.async_add_executor_job(_connect)
    except (FritzAuthorizationError, FritzSecurityError) as err:
        raise ConfigEntryAuthFailed(str(err)) from err
    except (FritzConnectionException, OSError) as err:
        raise ConfigEntryNotReady(
            f"Connection to the FRITZ!Box {entry.data[CONF_HOST]} failed: {err}"
        ) from err

    serial = serial or entry.unique_id or entry.data[CONF_HOST]
    _update_rights_issue(hass, entry, can_write)

    box = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, serial)},
        name=entry.title,
        manufacturer="AVM",
        model=client.model_name,
        sw_version=client.system_version,
        serial_number=serial,
        configuration_url=f"http://{entry.data[CONF_HOST]}",
    )

    coordinator = FritzNetworkCoordinator(hass, entry, client, serial, can_write, box.id)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


def _update_rights_issue(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry, can_write: bool
) -> None:
    issue_id = f"{ISSUE_MISSING_RIGHTS}_{entry.entry_id}"
    if can_write:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_MISSING_RIGHTS,
        translation_placeholders={"user": entry.data[CONF_USERNAME]},
    )


async def _async_update_listener(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """Reload the entry when its options change.

    Deleting a device by hand only adds it to the hidden list. That needs no
    reload, and a reload racing with the removal in the device registry would
    make the removal fail.
    """
    coordinator = entry.runtime_data
    old, new = coordinator.options_snapshot, dict(entry.options)
    old_hidden, new_hidden = set(old.get(CONF_HIDDEN_MACS, [])), set(new.get(CONF_HIDDEN_MACS, []))
    old.pop(CONF_HIDDEN_MACS, None)
    new_without_hidden = {k: v for k, v in new.items() if k != CONF_HIDDEN_MACS}
    if old == new_without_hidden and old_hidden <= new_hidden:
        coordinator.options_snapshot = new
        return
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry, device_entry: DeviceEntry
) -> bool:
    """Allow deleting a client device by hand.

    Refused for the box and for devices that are online right now: they would
    be back with the next poll. A removed device is put on the hidden list, the
    box keeps offline devices forever and would bring it back otherwise.
    """
    coordinator = entry.runtime_data
    if (DOMAIN, coordinator.serial) in device_entry.identifiers:
        return False
    mesh = coordinator.data.mesh
    if mesh and any((DOMAIN, n.mac) in device_entry.identifiers for n in mesh.nodes.values()):
        return False
    mac = next((m for kind, m in device_entry.connections if kind == CONNECTION_NETWORK_MAC), None)
    if mac is None:
        return True
    host = coordinator.all_hosts.get(mac)
    if host is not None and host.active:
        return False
    hidden = list(entry.options.get(CONF_HIDDEN_MACS, []))
    if mac not in hidden:
        hidden.append(mac)
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_HIDDEN_MACS: hidden}
        )
    return True
