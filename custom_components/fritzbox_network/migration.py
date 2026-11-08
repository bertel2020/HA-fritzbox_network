"""Preview of taking the entities of the core integration "FRITZ!Box Tools" over (read only).

The core integration (domain ``fritz``) and this one make entities for the same things. A user who
wants to drop the core integration and keep the entity ids, the history and the automations needs
the entities moved from one to the other. This module only works out what would happen: which core
entity has which counterpart here, and which has none. It changes nothing; the move itself is a
separate step the user starts on purpose.

The counterpart is only taken where it exists in the entity registry of this integration: an
entity that is not made here (no right, no hardware, off by default and never turned on) would
leave the moved entity orphaned.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import format_mac

from .const import DOMAIN
from .coordinator import FritzNetworkConfigEntry
from .models import client_uid

CORE_DOMAIN = "fritz"

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
    # the rate of the line as the box syncs it; here the DSL sensors say the same
    "max_kb_s_sent": "dsl_rate_up",
    "max_kb_s_received": "dsl_rate_down",
    # the rate the line could reach
    "link_kb_s_sent": "dsl_max_rate_up",
    "link_kb_s_received": "dsl_max_rate_down",
    "link_noise_margin_sent": "dsl_noise_margin_up",
    "link_noise_margin_received": "dsl_noise_margin_down",
    "link_attenuation_sent": "dsl_attenuation_up",
    "link_attenuation_received": "dsl_attenuation_down",
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
    "max_kb_s_sent",
    "max_kb_s_received",
    "link_kb_s_sent",
    "link_kb_s_received",
}
# no counterpart on purpose, by the key of the core integration or its start
NOT_COVERED_PREFIXES = ("port_forward_", "call_deflection_")
NOT_COVERED_KEYS = {"cleanup", "firmware_update"}
# a counterpart exists but the state means something else: moving it would break the history
INCOMPATIBLE_KEYS = {"connection_uptime"}
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
    rows: list[MigrationRow] = []
    claimed: dict[str, MigrationRow] = {}
    same_box = False
    for core_entry in core:
        for core_entity in er.async_entries_for_config_entry(registry, core_entry.entry_id):
            target_uid, group, reason, notes = counterpart(core_entity.unique_id, serial)
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
