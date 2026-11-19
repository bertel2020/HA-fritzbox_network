/* The card "In Home Assistant" of the device page: what Home Assistant knows of the device. */

import { escapeHtml, noteOpen } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

const PLATFORM = "fritzbox_network";
// the order of the rows: the tracker, what changes something, then what only reads
const DOMAIN_ORDER = ["device_tracker", "switch", "button", "select", "update", "image", "binary_sensor", "sensor"];
// what search/related answers with, and what the panel names of it
const USED_KINDS = ["automation", "script", "scene", "group", "person"];

/** The entities of this integration that sit on the device of the client, in the order of the card. */
export function deviceEntities(registry, client) {
  if (!client?.device_id || !Array.isArray(registry)) return [];
  const rank = (domain) => {
    const i = DOMAIN_ORDER.indexOf(domain);
    return i < 0 ? DOMAIN_ORDER.length : i;
  };
  return registry
    .filter((e) => e.device_id === client.device_id && e.platform === PLATFORM)
    .map((e) => ({
      entity_id: e.entity_id,
      domain: e.entity_id.split(".")[0],
      name: e.name || e.original_name || e.entity_id,
      disabled_by: e.disabled_by ?? null,
      labels: e.labels ?? [],
      area_id: e.area_id ?? null,
    }))
    .sort((a, b) => rank(a.domain) - rank(b.domain) || a.name.localeCompare(b.name));
}

/** The rows that are off because the integration made them so: what "Enable all" turns on. */
export function offRows(rows, enabling = new Set()) {
  return (rows ?? []).filter((r) => r.disabled_by === "integration" && !enabling.has(r.entity_id));
}

/** Where the entities are used: automations, scripts, scenes, groups and persons, each once, by name. */
export function usedBy(related, hass) {
  const seen = new Map();
  for (const result of Object.values(related ?? {})) {
    for (const kind of USED_KINDS) {
      for (const id of result?.[kind] ?? []) {
        const key = `${kind}:${id}`;
        if (!seen.has(key)) seen.set(key, { kind, id, name: hass?.states?.[id]?.attributes?.friendly_name ?? id });
      }
    }
  }
  return [...seen.values()].sort((a, b) => USED_KINDS.indexOf(a.kind) - USED_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** How many places use one entity: the number the confirmation names before it is turned off. */
export function usesOf(related, entityId) {
  const result = related?.[entityId];
  return USED_KINDS.flatMap((kind) => result?.[kind] ?? []);
}

function stateText(row, hass, enabling, t) {
  const e = t.ents;
  if (enabling.has(row.entity_id)) return { text: e.enabling, tone: "" };
  if (row.disabled_by === "user") return { text: e.offByUser, tone: "" };
  if (row.disabled_by) return { text: e.off, tone: "" };
  // "active" says the entity is on in Home Assistant, which the switch of the row sets; its own
  // state (an internet switch is on or off) is the business of the card of the controls. Only the
  // tracker's state, home or away, is what the row is about.
  const state = hass?.states?.[row.entity_id]?.state;
  if (row.domain !== "device_tracker" || state === undefined) return { text: e.active, tone: "ok" };
  return { text: `${e.active} · ${e.states[state] ?? state}`, tone: state === "unavailable" ? "" : "ok" };
}

function areaName(client, hass) {
  const device = hass?.devices?.[client.device_id];
  const area = device?.area_id ? hass?.areas?.[device.area_id] : null;
  return area?.name ?? null;
}

function labelNames(rows, client, hass, labels) {
  const ids = new Set(hass?.devices?.[client.device_id]?.labels ?? []);
  for (const row of rows) for (const id of row.labels) ids.add(id);
  const names = new Map((labels ?? []).map((l) => [l.label_id, l.name]));
  return [...ids].map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b));
}

/**
 * The card. ctx.ents is what the panel read (rows, related, labels) or null while it is read;
 * a device without a device in Home Assistant has none.
 */
export function entitiesCard(client, ctx) {
  const { t, hass } = ctx;
  const e = t.ents;
  if (!client?.device_id) return "";
  const ents = ctx.ents?.mac === client.mac ? ctx.ents : null;
  const head = (small, button = "") =>
    `<div class="chead"><span class="grow"><span class="label">${escapeHtml(e.title)}</span><small>${escapeHtml(small)}</small></span>${button}</div>`;
  if (!ents) return `<section class="card sec wide entcard" aria-busy="true">${head(e.loading)}</section>`;
  if (!ents.rows) return `<section class="card sec wide entcard">${head(e.failed)}</section>`;
  if (!ents.rows.length) return `<section class="card sec wide entcard">${head(e.none)}</section>`;
  const enabling = ctx.enabling ?? new Set();
  const off = offRows(ents.rows, enabling);
  const used = usedBy(ents.related, hass);
  const area = areaName(client, hass);
  const labels = labelNames(ents.rows, client, hass, ents.labels);
  const summary = off.length
    ? fill(e.summaryOff, { n: ents.rows.length, off: off.length })
    : fill(e.summaryAll, { n: ents.rows.length });
  const button = off.length ? `<button class="btn sm p" data-enable="all" data-k="en-all">${escapeHtml(e.enableAll)}</button>` : "";
  const key = "dev-ents";
  const open = off.length > 0 || noteOpen(key);
  const rows = ents.rows
    .map((row) => {
      const s = stateText(row, hass, enabling, t);
      const on = !row.disabled_by;
      const busy = enabling.has(row.entity_id) || row.disabled_by === "config_entry";
      return `<li class="ent">
        <div class="en"><b>${escapeHtml(row.name)}</b><small>${escapeHtml(e.kinds[row.domain] ?? row.domain)}</small></div>
        <div class="id"><span class="mono">${escapeHtml(row.entity_id)}</span><button class="icon-btn sm" data-act="copy-value" data-value="${escapeHtml(row.entity_id)}" data-k="en-copy-${escapeHtml(row.entity_id)}" title="${escapeHtml(e.copy)}" aria-label="${escapeHtml(`${e.copy}: ${row.entity_id}`)}">${ic("copy")}</button></div>
        <span class="chip stat ${s.tone}">${escapeHtml(s.text)}</span>
        <button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(`${row.name}: ${on ? e.turnOff : e.turnOn}`)}" data-ent-toggle="${escapeHtml(row.entity_id)}" data-k="en-${escapeHtml(row.entity_id)}" ${busy ? "disabled" : ""}></button>
      </li>`;
    })
    .join("");
  const usedHtml = used.length
    ? `<ul class="used">${used.map((u) => `<li>${escapeHtml(e.kindsUsed[u.kind] ?? u.kind)} <b>${escapeHtml(u.name)}</b></li>`).join("")}</ul>`
    : `<span class="muted">${escapeHtml(e.notUsed)}</span>`;
  const note = client.private_mac && ents.rows.some((r) => r.domain === "device_tracker" && r.disabled_by)
    ? `<div class="note warn"><b>${escapeHtml(e.trackerOffTitle)}</b><p>${escapeHtml(e.trackerOffBody)}</p></div>`
    : "";
  return `<section class="card sec wide entcard">
    ${head(summary, button)}
    ${note}
    <details class="entlist" data-note="${key}"${open ? " open" : ""}><summary>${escapeHtml(e.show)}</summary><ul class="ents">${rows}</ul></details>
    <dl class="entmore"><dt>${escapeHtml(e.area)}</dt><dd>${area ? escapeHtml(area) : `<span class="muted">${escapeHtml(e.noArea)}</span>`}</dd>
      <dt>${escapeHtml(e.labels)}</dt><dd>${labels.length ? labels.map((l) => `<span class="chip">${escapeHtml(l)}</span>`).join("") : `<span class="muted">${escapeHtml(e.noLabels)}</span>`}</dd>
      <dt>${escapeHtml(e.usedIn)}</dt><dd>${usedHtml}</dd></dl>
    <p class="hint">${escapeHtml(e.hint)}</p>
    <div class="foot"><button class="btn sm" data-act="ha" data-k="en-ha">${ic("external")}${escapeHtml(t.openInHa)}</button></div>
  </section>`;
}
