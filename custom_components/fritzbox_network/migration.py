"""Preview of taking the entities of the core integration "FRITZ!Box Tools" over (read only).

The core integration (domain ``fritz``) and this one make entities for the same things. A user who
wants to drop the core integration and keep the entity ids, the history and the automations needs
the entities moved from one to the other. This module only works out what would happen: which core
entity has which counterpart here, and which has none. It changes nothing; the move itself is a
separate step the user starts on purpose.

The counterpart is only taken where it exists in the entity registry of this integration: an
entity that is not made here (no right, no hardware, off by default and never turned on) would
leave the moved entity orphaned.

``async_run`` carries over what the user set on the core entity (name, icon, area, labels, aliases)
and on its device to the counterpart here, and ``async_undo`` puts it back from the journal. It
deletes, moves and switches off nothing: the entities here keep their ids, the core integration
keeps running, and the automations that name the core entities are the user's to change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import format_mac
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util, slugify

from .const import DOMAIN, KEY_PORT_PREFIX
from .coordinator import FritzNetworkConfigEntry
from .models import client_uid

CORE_DOMAIN = "fritz"
_LOGGER = logging.getLogger(__name__)

# the entities of a box, by the key in the unique id of the core integration ("<serial>-<key>");
# the value is the key here, or None where there is none
BOX_KEYS: dict[str, str | None] = {
    "is_connected": "internet_connected",
    "is_linked": "internet_linked",
    "reboot": "reboot",
    "reconnect": "reconnect",
    "external_ip": "external_ipv4",
    "external_ipv6": "external_ipv6",
    "kb_s_sent": "internet_upload",
    "kb_s_received": "internet_download",
    "gb_sent": "internet_bytes_sent",
    "gb_received": "internet_bytes_received",
    # the layer 1 maximum of the link as the box reports it, the very value
    "max_kb_s_sent": "internet_link_rate_up",
    "max_kb_s_received": "internet_link_rate_down",
    # the core integration reads this from the same action as the one above; the closest here
    # is the rate the line could reach
    "link_kb_s_sent": "dsl_max_rate_up",
    "link_kb_s_received": "dsl_max_rate_down",
    "link_noise_margin_sent": "dsl_noise_margin_up",
    "link_noise_margin_received": "dsl_noise_margin_down",
    "link_attenuation_sent": "dsl_attenuation_up",
    "link_attenuation_received": "dsl_attenuation_down",
    "connection_uptime": "internet_connected_since",
    "device_uptime": "box_uptime",
    "cpu_temperature": "cpu_temperature",
    "update": "firmware",
    "wi_fi_guest": "guest_wifi",
    "wi_fi_main_2_4ghz": "wifi_2_4ghz",
    "wi_fi_main_5ghz": "wifi_5ghz",
    "wi_fi_main_5ghz_high_6ghz": "wifi_6ghz",
    "guest_wifi_qr_code": "guest_wifi_qr",
}
# the keys whose values are about the same, not the same: the user is told
APPROXIMATE = {
    "link_kb_s_sent",
    "link_kb_s_received",
}
# no counterpart on purpose, by the key of the core integration or its start
NOT_COVERED_PREFIXES = ("call_deflection_",)
NOT_COVERED_KEYS = {"cleanup", "firmware_update"}
# the entities of a repeater the core integration made an entry for, by its key ("<serial>-<key>"):
# the key here. A repeater has no reconnect, no clean-up and none of the internet entities.
REPEATER_KEYS: dict[str, str] = {
    "reboot": "reboot",
    "device_uptime": "box_uptime",
    "cpu_temperature": "cpu_temperature",
    "update": "firmware",
    "wi_fi_guest": "guest_wifi",
    "guest_wifi_qr_code": "guest_wifi_qr",
}
REPEATER_KEY_PREFIXES = {"wi_fi_main_": "wifi_"}
REPEATER_NOT_COVERED = {"reconnect", "cleanup", "firmware_update"}
PORT_FORWARD_PREFIX = "port_forward_"
# a counterpart exists but the state means something else: moving it would break the history
INCOMPATIBLE_KEYS: set[str] = set()
# the entities of a device, by the key behind the MAC ("<mac>_<key>"); the tracker has no key
CLIENT_KEYS = {"tracker": None, "internet_access": "internet_access", "wake_on_lan": "wake_on_lan"}

STATUS_MIGRATE = "migrate"
STATUS_CONFLICT = "conflict"
STATUS_NONE = "none"
STATUS_SKIP = "skip"


@dataclass
class MigrationRow:
    """One entity of the core integration and what would become of it."""

    core_entity_id: str
    core_name: str | None
    group: str  # "box" or "client"
    status: str
    reason: str
    target_entity_id: str | None = None
    notes: list[str] = field(default_factory=list)
    used_by: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "core_entity_id": self.core_entity_id,
            "core_name": self.core_name,
            "group": self.group,
            "status": self.status,
            "reason": self.reason,
            "target_entity_id": self.target_entity_id,
            "notes": self.notes,
            "used_by": self.used_by,
        }


def core_entries(hass: HomeAssistant) -> list[Any]:
    """The config entries of the core integration, loaded or not."""
    return list(hass.config_entries.async_entries(CORE_DOMAIN))


def counterpart(unique_id: str, serial: str) -> tuple[str | None, str, str, list[str]]:
    """What a unique id of the core integration becomes here.

    Returns (unique id here or None, group, reason, notes). The reason says why there is none:
    ``other_box`` (the entity belongs to another box), ``not_covered`` (this integration has no
    such entity on purpose), ``incompatible`` (the state means something else here) or
    ``unknown`` (a key this code does not know, for example from a newer core version).
    """
    notes: list[str] = []
    if "-" in unique_id:
        prefix, _, key = unique_id.partition("-")
        if prefix != serial:
            return None, "box", "other_box", notes
        if key in INCOMPATIBLE_KEYS:
            return None, "box", "incompatible", notes
        if key in NOT_COVERED_KEYS or key.startswith(NOT_COVERED_PREFIXES):
            return None, "box", "not_covered", notes
        target = BOX_KEYS.get(key)
        if target is None:
            return None, "box", "unknown", notes
        if key in APPROXIMATE:
            notes.append("approximate")
        return f"{serial}_{target}", "box", "", notes
    if "_" in unique_id:
        mac, _, key = unique_id.partition("_")
        if key in CLIENT_KEYS:
            suffix = CLIENT_KEYS[key]
            wanted = format_mac(mac)
            return client_uid(serial, wanted, suffix or None), "client", "", notes
    return None, "client", "unknown", notes


def port_counterpart(unique_id: str, serial: str, rules: dict[str, Any]) -> str | None:
    """The unique id here of a port forwarding of the core integration, by its description.

    The core integration names the switch after the description of the forwarding; here the
    forwarding is named by protocol and port. The description is what both know, so it must tell
    exactly one forwarding. None where it tells none or several.
    """
    prefix = f"{serial}-{PORT_FORWARD_PREFIX}"
    if not unique_id.startswith(prefix):
        return None
    wanted = unique_id[len(prefix) :]
    found = [
        rule.key
        for rule in rules.values()
        if rule.description
        and (slug := slugify(rule.description))
        and (wanted == slug or wanted.startswith(f"{slug}_"))
    ]
    return f"{serial}_{KEY_PORT_PREFIX}{found[0]}" if len(found) == 1 else None


def repeater_counterpart(
    unique_id: str, serial: str, repeaters: dict[str, str]
) -> tuple[str | None, str]:
    """(unique id here, reason) of an entity of a repeater entry of the core integration.

    ``repeaters`` maps the MACs of the mesh nodes (as ``format_mac`` writes them) to the MAC the
    repeater is controlled by here. A repeater that is not controlled here has no entities to
    take it over; the reason says so.
    """
    prefix, _, key = unique_id.partition("-")
    mac = repeaters.get(format_mac(prefix))
    if mac is None:
        return None, "repeater_not_controlled"
    if key in REPEATER_NOT_COVERED:
        return None, "not_covered"
    target = REPEATER_KEYS.get(key)
    if target is None:
        for core_prefix, here in REPEATER_KEY_PREFIXES.items():
            if key.startswith(core_prefix):
                target = f"{here}{key[len(core_prefix) :]}"
    if target is None:
        return None, "unknown"
    return client_uid(serial, mac, target), ""


def _automations_using(hass: HomeAssistant, entity_id: str) -> list[str]:
    try:
        from homeassistant.components.automation import (  # noqa: PLC0415
            automations_with_entity,
        )

        return list(automations_with_entity(hass, entity_id))
    except Exception:  # noqa: BLE001 - a preview must work without the automation integration
        return []


def scan(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> dict[str, Any]:
    """The preview for a box: the core entry, a row for each of its entities, a token.

    Nothing is changed. The token covers what the preview is based on, so a later step can refuse
    to run when the registry has moved on since.
    """
    registry = er.async_get(hass)
    serial = entry.runtime_data.serial
    ours = {
        e.unique_id: e
        for e in er.async_entries_for_config_entry(registry, entry.entry_id)
        if e.platform == DOMAIN
    }
    core = core_entries(hass)
    coordinator = entry.runtime_data
    rules = (coordinator.data.port_rules if coordinator.data else None) or {}
    repeaters: dict[str, str] = {}
    for repeater in getattr(coordinator, "repeaters", {}).values():
        node = repeater.node
        for node_mac in (node.macs if node else None) or (repeater.mac,):
            repeaters[format_mac(node_mac)] = repeater.mac
    rows: list[MigrationRow] = []
    claimed: dict[str, MigrationRow] = {}
    same_box = False
    for core_entry in core:
        for core_entity in er.async_entries_for_config_entry(registry, core_entry.entry_id):
            target_uid, group, reason, notes = counterpart(core_entity.unique_id, serial)
            if reason == "unknown" and (
                port_uid := port_counterpart(core_entity.unique_id, serial, rules)
            ):
                target_uid, reason = port_uid, ""
            elif reason == "other_box" and (
                (found := repeater_counterpart(core_entity.unique_id, serial, repeaters))[0]
                or found[1] != "repeater_not_controlled"
            ):
                target_uid, reason = found
            if group == "box" and reason != "other_box" and target_uid is not None:
                same_box = True
            if core_entity.unique_id.startswith(f"{serial}-"):
                same_box = True
            row = MigrationRow(
                core_entity_id=core_entity.entity_id,
                core_name=core_entity.name or core_entity.original_name,
                group=group,
                status=STATUS_SKIP if reason in ("other_box", "incompatible") else STATUS_NONE,
                reason=reason,
                notes=notes,
                used_by=_automations_using(hass, core_entity.entity_id),
            )
            if target_uid is not None:
                target = ours.get(target_uid)
                if target is None:
                    row.reason = "not_made_here"
                else:
                    row.target_entity_id = target.entity_id
                    row.status = STATUS_MIGRATE
                    row.reason = ""
                    if target_uid in claimed:
                        row.status = STATUS_CONFLICT
                        row.reason = "claimed_twice"
                        claimed[target_uid].status = STATUS_CONFLICT
                        claimed[target_uid].reason = "claimed_twice"
                    else:
                        claimed[target_uid] = row
            rows.append(row)
    rows.sort(key=lambda r: (r.group, r.core_entity_id))
    token = hashlib.sha1(  # noqa: S324 - a fingerprint of the preview, not a secret
        "\n".join(f"{r.core_entity_id}|{r.target_entity_id}|{r.status}" for r in rows).encode()
    ).hexdigest()
    first = core[0] if core else None
    return {
        "core": (
            {
                "entry_id": first.entry_id,
                "title": first.title,
                "state": first.state.value,
                "same_box": same_box,
            }
            if first
            else None
        ),
        "rows": [r.as_dict() for r in rows],
        "token": token,
    }


STORE_VERSION = 1


class MigrationRefused(Exception):
    """The move was not started; ``code`` says why (the panel shows a text for it)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _store(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> Store[dict[str, Any]]:
    return Store(hass, STORE_VERSION, f"{DOMAIN}.core_migration.{entry.entry_id}")


async def async_journal(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry
) -> dict[str, Any] | None:
    """What a move did and can be taken back from, None where there was none."""
    return await _store(hass, entry).async_load()


def _texts(values: Any) -> set[str]:
    """The strings of a registry collection; aliases also hold a marker for the own name."""
    return {v for v in values if isinstance(v, str)}


def _entity_changes(core: er.RegistryEntry, target: er.RegistryEntry) -> dict[str, Any]:
    """What of the core entity the one here lacks; what is set here stays."""
    changes: dict[str, Any] = {}
    if core.name and not target.name:
        changes["name"] = core.name
    if core.icon and not target.icon:
        changes["icon"] = core.icon
    if core.area_id and not target.area_id:
        changes["area_id"] = core.area_id
    if set(core.labels) - set(target.labels):
        changes["labels"] = set(target.labels) | set(core.labels)
    if _texts(core.aliases) - _texts(target.aliases):
        # the target's own marker stays in the set
        changes["aliases"] = set(target.aliases) | _texts(core.aliases)
    return changes


def _entity_record(core: er.RegistryEntry, target: er.RegistryEntry, changes: dict) -> dict:
    """What was set on the entity here, to take back: the added labels and aliases by value."""
    return {
        "entity_id": target.entity_id,
        "set": [key for key in ("name", "icon", "area_id") if key in changes],
        "labels": sorted(set(changes.get("labels", ())) - set(target.labels)),
        "aliases": sorted(_texts(changes.get("aliases", ())) - _texts(target.aliases)),
    }


def _device_changes(
    hass: HomeAssistant, from_id: str | None, to_id: str | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """(changes, state before) of the device here when the core device's marks are carried over."""
    if not from_id or not to_id or from_id == to_id:
        return {}, {}
    devices = dr.async_get(hass)
    source, target = devices.async_get(from_id), devices.async_get(to_id)
    if source is None or target is None:
        return {}, {}
    changes: dict[str, Any] = {}
    if source.area_id and not target.area_id:
        changes["area_id"] = source.area_id
    if source.name_by_user and not target.name_by_user:
        changes["name_by_user"] = source.name_by_user
    if set(source.labels) - set(target.labels):
        changes["labels"] = set(target.labels) | set(source.labels)
    before = {
        "area_id": target.area_id,
        "name_by_user": target.name_by_user,
        "labels": sorted(target.labels),
    }
    return changes, before


async def async_run(
    hass: HomeAssistant, entry: FritzNetworkConfigEntry, token: str
) -> dict[str, Any]:
    """Carry over name, icon, area, labels and aliases; the preview with this token is what runs.

    Refused (``MigrationRefused``) when the preview has moved on since the token was made, when
    there is nothing to take over, or when an earlier run has not been undone. Only what is not
    set here is filled in, and nothing is deleted or switched off.
    """
    preview = scan(hass, entry)
    if preview["core"] is None:
        raise MigrationRefused("no_core")
    if preview["token"] != token:
        raise MigrationRefused("changed")
    rows = [r for r in preview["rows"] if r["status"] == STATUS_MIGRATE]
    if not rows:
        raise MigrationRefused("nothing")
    if await async_journal(hass, entry):
        raise MigrationRefused("already_done")

    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    entities: list[dict[str, Any]] = []
    device_records: dict[str, dict[str, Any]] = {}
    failed: list[dict[str, str]] = []
    for row in rows:
        core = registry.async_get(row["core_entity_id"])
        target = registry.async_get(row["target_entity_id"])
        if core is None or target is None or core.platform != CORE_DOMAIN:
            failed.append({"entity_id": row["core_entity_id"], "reason": "changed"})
            continue
        try:
            device_changes, device_before = _device_changes(hass, core.device_id, target.device_id)
            if device_changes and target.device_id not in device_records:
                devices.async_update_device(target.device_id, **device_changes)
                device_records[target.device_id] = device_before
            if changes := _entity_changes(core, target):
                record = _entity_record(core, target, changes)
                registry.async_update_entity(target.entity_id, **changes)
                entities.append(record)
        except (ValueError, KeyError) as err:
            _LOGGER.warning("Could not carry over to %s: %s", target.entity_id, err)
            failed.append({"entity_id": target.entity_id, "reason": "error"})
    await _store(hass, entry).async_save(
        {
            "time": dt_util.utcnow().isoformat(),
            "entities": entities,
            "devices": [{"device_id": k, "before": v} for k, v in device_records.items()],
        }
    )
    return {"updated": len(entities), "devices": len(device_records), "failed": failed}


async def async_undo(hass: HomeAssistant, entry: FritzNetworkConfigEntry) -> dict[str, Any]:
    """Put back what the carrying over changed, from the journal; best effort."""
    journal = await async_journal(hass, entry)
    if not journal:
        raise MigrationRefused("no_journal")
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    back = 0
    failed: list[str] = []
    for record in journal["entities"]:
        item = registry.async_get(record["entity_id"])
        if item is None:
            failed.append(record["entity_id"])
            continue
        # only what the carrying over set, and only while it is still what it set: a name changed
        # since then is the user's
        changes: dict[str, Any] = {key: None for key in record["set"]}
        if record["labels"]:
            changes["labels"] = set(item.labels) - set(record["labels"])
        if record["aliases"]:
            changes["aliases"] = set(item.aliases) - set(record["aliases"])
        registry.async_update_entity(item.entity_id, **changes)
        back += 1
    for record in journal["devices"]:
        if devices.async_get(record["device_id"]) is None:
            continue
        before = record["before"]
        devices.async_update_device(
            record["device_id"],
            area_id=before["area_id"],
            name_by_user=before["name_by_user"],
            labels=set(before["labels"]),
        )
    await _store(hass, entry).async_remove()
    return {"back": back, "failed": failed}
