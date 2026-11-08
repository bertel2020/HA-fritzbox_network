"""The FRITZ!Box network integration: the devices of the home network, by MAC address."""

from __future__ import annotations

from datetime import timedelta
import logging

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, DeviceEntry
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.typing import ConfigType

from .addresses import AddressNotes
from .api import FritzNetworkClient
from .capture import KEY_CAPTURES, CaptureDownloadView, CaptureManager
from .connection_check import box_port
from .const import (
    CONF_HIDDEN_MACS,
    CONF_STALE_REPAIR,
    CONF_USE_TLS,
    CONF_VERIFY_TLS,
    DEFAULT_STALE_REPAIR,
    DOMAIN,
    options_reload_signal,
    vpn_identifier,
)
from .coordinator import FritzNetworkConfigEntry, FritzNetworkCoordinator
from .history import DeviceHistory
from .latency import LatencyMonitor
from .models import client_uid, legacy_client_uid
from .panel import async_drop_panel, async_ensure_panel, async_serve_frontend
from .repairs import (
    async_remove_internet_issues,
    async_remove_mesh_issue,
    async_remove_stale_issue,
    async_remove_upnp_issue,
    async_update_internet_issues,
    async_update_mesh_issue,
    async_update_stale_issue,
    async_update_upnp_issue,
)
from .repeater import RepeaterCoordinator, repeater_macs
from .services import async_register as async_register_services
from .vendor import async_load as async_load_vendors
from .websocket_api import async_register as async_register_websocket

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.DEVICE_TRACKER,
    Platform.IMAGE,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.UPDATE,
]

ISSUE_MISSING_RIGHTS = "missing_rights"

STALE_CHECK_INTERVAL = timedelta(hours=1)
STALE_FIRST_CHECK_SECONDS = 60

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register what is shared by all entries: the topology command and card."""
    async_register_websocket(hass)
    async_register_services(hass)
    await async_serve_frontend(hass)
    if getattr(hass, "http", None) is not None:
        hass.http.register_view(CaptureDownloadView())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> bool:
    """Set up FRITZ!Box network from a config entry."""
    client = FritzNetworkClient(
        host=entry.data[CONF_HOST],
        port=entry.data.get(CONF_PORT),
        username=entry.data[CONF_USERNAME],
        password=entry.data[CONF_PASSWORD],
        use_tls=entry.data.get(CONF_USE_TLS, False),
        verify_tls=entry.data.get(CONF_VERIFY_TLS, False),
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

    # the list comes from disk and costs nothing; the panel shows vendors whatever the option says
    await async_load_vendors()

    history = await DeviceHistory.async_load(hass, entry.entry_id)
    coordinator = FritzNetworkCoordinator(hass, entry, client, serial, can_write, box.id, history)
    await coordinator.async_config_entry_first_refresh()
    coordinator.addresses = await AddressNotes.async_load(hass, entry.entry_id)
    coordinator.latency = await LatencyMonitor.async_load(
        hass, entry.entry_id, entry.data[CONF_HOST], box_port(entry.data)
    )
    entry.runtime_data = coordinator
    captures = await CaptureManager.async_load(hass, entry.entry_id, client)
    hass.data.setdefault(KEY_CAPTURES, {})[entry.entry_id] = captures
    entry.async_on_unload(captures.async_flush)
    entry.async_on_unload(lambda: _drop_capture(hass, entry))

    entry.async_on_unload(history.async_flush)
    entry.async_on_unload(coordinator.addresses.async_flush)
    entry.async_on_unload(coordinator.latency.async_flush)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    entry.async_on_unload(
        coordinator.async_add_listener(lambda: async_update_internet_issues(hass, entry))
    )
    entry.async_on_unload(lambda: async_remove_internet_issues(hass, entry))
    entry.async_on_unload(
        coordinator.async_add_listener(lambda: async_update_mesh_issue(hass, entry))
    )
    entry.async_on_unload(lambda: async_remove_mesh_issue(hass, entry))
    entry.async_on_unload(
        coordinator.async_add_listener(lambda: async_update_upnp_issue(hass, entry))
    )
    entry.async_on_unload(lambda: async_remove_upnp_issue(hass, entry))
    if can_write:
        # the repeaters the user chose to control: each asks its own repeater, slowly, on its own
        for mac in repeater_macs(entry):
            coordinator.repeaters[mac] = RepeaterCoordinator(hass, entry, coordinator, mac)
    await _async_migrate_client_unique_ids(hass, entry, serial)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_ensure_panel(hass)
    for repeater in coordinator.repeaters.values():
        entry.async_create_background_task(
            hass, repeater.async_refresh(), f"fritzbox_network_repeater_{repeater.mac}"
        )
    # the first poll left out what the web interface of the box tells; read it now, not 30 s later
    entry.async_create_task(hass, coordinator.async_refresh(), "fritzbox_network_second_poll")
    _setup_stale_check(hass, entry)
    return True


async def _async_migrate_client_unique_ids(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry, serial: str
) -> None:
    """Give the entities of devices the box in their unique id.

    They were "<mac>" and "<mac>_<key>", so a device that two boxes know could be set up for one
    box only. Entities of the box itself start with its serial number and stay as they are.
    """

    @callback
    def _renamed(registry_entry: er.RegistryEntry) -> dict[str, str] | None:
        if (parts := legacy_client_uid(registry_entry.unique_id)) is None:
            return None
        mac, key = parts
        new = client_uid(serial, mac, key)
        if er.async_get(hass).async_get_entity_id(registry_entry.domain, DOMAIN, new):
            return None  # already there: leave the old one for the user to remove
        return {"new_unique_id": new}

    await er.async_migrate_entries(hass, entry.entry_id, _renamed)


def _drop_capture(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """End a capture that still runs when the box is unloaded."""
    if manager := hass.data.get(KEY_CAPTURES, {}).pop(entry.entry_id, None):
        manager.stop()


def _setup_stale_check(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """Look for long-offline devices now and then, if the option is on.

    The first look comes a minute after the start: the times they were last online
    are restored by the sensors, which are only there once the platforms are set up.
    """
    if not entry.options.get(CONF_STALE_REPAIR, DEFAULT_STALE_REPAIR):
        async_remove_stale_issue(hass, entry)
        return

    async def _check(now: object = None) -> None:
        await async_update_stale_issue(hass, entry)

    entry.async_on_unload(async_track_time_interval(hass, _check, STALE_CHECK_INTERVAL))
    entry.async_on_unload(async_call_later(hass, STALE_FIRST_CHECK_SECONDS, _check))


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
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        # the panel is told: its subscription belongs to the coordinator that goes,
        # whatever the reason (options, reload by hand, reauth, reconfigure)
        async_dispatcher_send(hass, options_reload_signal(entry.entry_id))
    if unloaded and not any(
        e.entry_id != entry.entry_id for e in hass.config_entries.async_loaded_entries(DOMAIN)
    ):
        async_drop_panel(hass)
    return unloaded


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
    if (DOMAIN, vpn_identifier(coordinator.serial)) in device_entry.identifiers:
        # the WireGuard device goes with its connections: while the box lists one it would be back
        return not coordinator.data.vpn
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
