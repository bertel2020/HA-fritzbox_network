"""A repair that offers to hide the devices that have been offline for long."""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.repairs import RepairsFlow
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import (
    entity_registry as er,
    issue_registry as ir,
    selector,
)
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .const import (
    CONF_HIDDEN_MACS,
    CONF_STALE_DAYS,
    DEFAULT_STALE_DAYS,
    DOMAIN,
    INTERNET_LOW_MARGIN_SECONDS,
    INTERNET_RECONNECTS_WARN,
    KEY_LAST_ONLINE,
    MESH_REPEATER_LOST_SECONDS,
)
from .coordinator import FritzNetworkConfigEntry
from .models import Host

ISSUE_STALE_DEVICES = "stale_devices"
ISSUE_INTERNET_LINE = "internet_line"
ISSUE_INTERNET_RECONNECTS = "internet_reconnects"
ISSUE_MESH_REPEATER_LOST = "mesh_repeater_lost"
ISSUE_UPNP_DISABLED = "upnp_disabled"


def last_online(hass: HomeAssistant, host: Host) -> datetime | None:
    """When the device was last online, from its "Last online" sensor; None if unknown."""
    registry = er.async_get(hass)
    entity_id = registry.async_get_entity_id("sensor", DOMAIN, f"{host.mac}_{KEY_LAST_ONLINE}")
    state = hass.states.get(entity_id) if entity_id else None
    return dt_util.parse_datetime(state.state) if state else None


def stale_hosts(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> list[tuple[Host, datetime]]:
    """The offline devices whose last time online is longer ago than the limit.

    A device with no time on record (never online since it was added) is not stale.
    """
    coordinator = entry.runtime_data
    limit = timedelta(days=entry.options.get(CONF_STALE_DAYS, DEFAULT_STALE_DAYS))
    mesh = coordinator.data.mesh
    now = dt_util.utcnow()
    stale = []
    for host in coordinator.data.hosts.values():
        if coordinator.is_connected(host) or (mesh and mesh.node_of(host)):
            continue
        last = last_online(hass, host)
        if last is not None and now - last > limit:
            stale.append((host, last))
    stale.sort(key=lambda item: item[1])
    return stale


async def async_update_stale_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """Raise the repair while there are such devices, take it away when there are none."""
    issue_id = f"{ISSUE_STALE_DEVICES}_{entry.entry_id}"
    stale = stale_hosts(hass, entry)
    if not stale:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=True,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_STALE_DEVICES,
        translation_placeholders={
            "count": str(len(stale)),
            "days": str(entry.options.get(CONF_STALE_DAYS, DEFAULT_STALE_DAYS)),
        },
        data={"entry_id": entry.entry_id},
    )


def async_remove_stale_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_STALE_DEVICES}_{entry.entry_id}")


@callback
def async_remove_mesh_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_MESH_REPEATER_LOST}_{entry.entry_id}")


@callback
def async_update_mesh_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """Raise a repair for a repeater the box has not listed for a while, remove it when it is back.

    Not at once: a repeater that restarts or updates is gone for a few minutes. A repeater that is
    meant to be gone is removed as a device by hand, which also takes the repair away.
    """
    coordinator = entry.runtime_data
    now = dt_util.utcnow()
    lost = dict(coordinator.lost_repeaters())
    since = coordinator.repeaters_lost_since
    for mac in [m for m in since if m not in lost]:
        del since[mac]
    for mac in lost:
        since.setdefault(mac, now)
    names = sorted(
        (
            name
            for mac, name in lost.items()
            if (now - since[mac]).total_seconds() >= MESH_REPEATER_LOST_SECONDS
        ),
        key=str.lower,
    )
    issue_id = f"{ISSUE_MESH_REPEATER_LOST}_{entry.entry_id}"
    if not names:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_MESH_REPEATER_LOST,
        translation_placeholders={"count": str(len(names)), "names": ", ".join(names)},
    )


@callback
def async_remove_upnp_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_UPNP_DISABLED}_{entry.entry_id}")


@callback
def async_update_upnp_issue(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """A repair while the box does not pass status information over UPnP.

    The values of the internet connection come from there; without them the internet card and
    the reconnect are missing or incomplete. Nothing is refused, the integration works on.
    """
    issue_id = f"{ISSUE_UPNP_DISABLED}_{entry.entry_id}"
    if entry.runtime_data.upnp_enabled is not False:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_UPNP_DISABLED,
    )


@callback
def async_remove_internet_issues(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    for key in (ISSUE_INTERNET_LINE, ISSUE_INTERNET_RECONNECTS):
        ir.async_delete_issue(hass, DOMAIN, f"{key}_{entry.entry_id}")


@callback
def async_update_internet_issues(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> None:
    """Raise a repair for a line that stays weak or a connection that keeps dropping.

    Only what lasts counts: a weak noise margin for an hour, or several new connections within
    a day. A repair goes away on its own when the problem does. It tells, it cannot fix.
    """
    coordinator = entry.runtime_data
    now = dt_util.utcnow()
    issues: dict[str, dict[str, str]] = {}
    since = coordinator.internet_low_margin_since
    info = coordinator.data.internet
    if since and info and info.dsl and (now - since).total_seconds() >= INTERNET_LOW_MARGIN_SECONDS:
        margins = [
            m for m in (info.dsl.noise_margin_down, info.dsl.noise_margin_up) if m is not None
        ]
        issues[ISSUE_INTERNET_LINE] = {"margin": f"{min(margins):g}"}
    recent = [
        e
        for e in coordinator.internet_events
        if e["kind"] == "reconnected"
        and (dt_util.parse_datetime(e["time"]) or now) > now - timedelta(days=1)
    ]
    if len(recent) >= INTERNET_RECONNECTS_WARN:
        issues[ISSUE_INTERNET_RECONNECTS] = {"count": str(len(recent))}
    for key in (ISSUE_INTERNET_LINE, ISSUE_INTERNET_RECONNECTS):
        issue_id = f"{key}_{entry.entry_id}"
        if key not in issues:
            ir.async_delete_issue(hass, DOMAIN, issue_id)
            continue
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=key,
            translation_placeholders=issues[key],
        )


class StaleDevicesFlow(RepairsFlow):
    """Pick the devices to hide; all of them are ticked."""

    def __init__(self, entry_id: str) -> None:
        self._entry_id = entry_id

    async def async_step_init(self, user_input: dict[str, list[str]] | None = None) -> FlowResult:
        entry = self.hass.config_entries.async_get_entry(self._entry_id)
        if entry is None or entry.state is not ConfigEntryState.LOADED:
            return self.async_abort(reason="not_loaded")
        stale = stale_hosts(self.hass, entry)
        if user_input is not None:
            # only what is still gone: a device that came back while the form was open stays
            still_stale = {host.mac for host, _ in stale}
            hidden = set(entry.options.get(CONF_HIDDEN_MACS, [])) | (set(user_input["macs"]) & still_stale)
            self.hass.config_entries.async_update_entry(
                entry, options={**entry.options, CONF_HIDDEN_MACS: sorted(hidden)}
            )
            await entry.runtime_data.async_request_refresh()
            await async_update_stale_issue(self.hass, entry)
            return self.async_create_entry(data={})
        options = [
            selector.SelectOptionDict(
                value=host.mac, label=f"{host.name} ({dt_util.as_local(last):%Y-%m-%d})"
            )
            for host, last in stale
        ]
        schema = vol.Schema(
            {
                vol.Required(
                    "macs", default=[o["value"] for o in options]
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=options, multiple=True, mode=selector.SelectSelectorMode.LIST
                    )
                )
            }
        )
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            description_placeholders={
                "count": str(len(stale)),
                "days": str(entry.options.get(CONF_STALE_DAYS, DEFAULT_STALE_DAYS)),
            },
        )


async def async_create_fix_flow(
    hass: HomeAssistant, issue_id: str, data: dict[str, str | int | float | None] | None
) -> RepairsFlow:
    return StaleDevicesFlow(str((data or {})["entry_id"]))
