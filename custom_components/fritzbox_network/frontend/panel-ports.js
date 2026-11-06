/** The port forwardings card of the internet page: by device, one row per forwarding, IPv4 and IPv6 as one. */

import { escapeHtml, formatDuration } from "./shared.js";
import { fill } from "./texts.js";

export const PORT_FILTERS = ["all", "open", "closed", "ipv6", "upnp"];

/** A port or a range of ports: "5000" or "5000–5010". */
function portText(port, end) {
  if (port === null || port === undefined) return "–";
  return end ? `${port}–${end}` : String(port);
}

/** The device a forwarding leads to: its id where the box lists it, else the address it leads to. */
const deviceKey = (entry) => entry.device_id ?? entry.client ?? "";

/**
 * The forwardings as rows: the same forwarding for IPv4 and for IPv6 (same device, name, protocol and
 * ports) is one row with both families. A row is "open" where all of its families are on, "closed"
 * where none is, "part" otherwise.
 */
export function mergePortRules(entries) {
  const rows = [];
  for (const entry of entries ?? []) {
    const family = { family: entry.family === "ipv6" ? "ipv6" : "ipv4", enabled: Boolean(entry.enabled) };
    const id = [deviceKey(entry), entry.description ?? "", entry.protocol ?? "", entry.external_port, entry.external_port_end, entry.internal_port, entry.internal_port_end, entry.source ?? ""].join("|");
    const found = rows.find((row) => row.id === id && !row.families.some((f) => f.family === family.family));
    if (found) found.families.push(family);
    else rows.push({ ...entry, id, families: [family] });
  }
  for (const row of rows) {
    const on = row.families.filter((f) => f.enabled).length;
    row.state = on === 0 ? "closed" : on === row.families.length ? "open" : "part";
    row.hasIpv6 = row.families.some((f) => f.family === "ipv6");
  }
  return rows;
}

/** Whether a row passes the chosen filter. */
export function passesPortFilter(row, filter) {
  if (filter === "open") return row.state !== "closed";
  if (filter === "closed") return row.state === "closed";
  if (filter === "ipv6") return row.hasIpv6;
  if (filter === "upnp") return row.source === "upnp";
  return true;
}

/** The rows, the counts the tiles and filters show, and the rows by device. */
export function portsModel(entries, filter = "all") {
  const rows = mergePortRules(entries);
  const open = rows.filter((r) => r.state !== "closed").length;
  const counts = Object.fromEntries(PORT_FILTERS.map((f) => [f, rows.filter((r) => passesPortFilter(r, f)).length]));
  const shown = rows.filter((r) => passesPortFilter(r, filter));
  const groups = [];
  for (const row of shown) {
    const key = deviceKey(row);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) {
    // open ones first, the order of the box otherwise
    group.rows = [...group.rows.keys()].sort((a, b) => (group.rows[a].state === "closed") - (group.rows[b].state === "closed") || a - b).map((i) => group.rows[i]);
    const first = group.rows[0];
    group.deviceId = first.device_id ?? null;
    group.name = first.device_name ?? first.client ?? null;
    group.address = (group.rows.find((r) => r.family !== "ipv6") ?? first).client ?? null;
    group.online = first.device_online ?? null;
  }
  const devices = new Set(rows.map(deviceKey)).size;
  return { rows, open, closed: rows.length - open, devices, counts, groups };
}

function stateChip(row, p) {
  const text = { open: p.stateOpen, closed: p.stateClosed, part: p.statePart }[row.state];
  const tone = { open: "open", closed: "", part: "part" }[row.state];
  return `<span class="chip ${tone}"><i class="dot ${row.state === "closed" ? "" : "warn"}" aria-hidden="true"></i>${escapeHtml(text)}</span>`;
}

function ruleRow(row, t) {
  const p = t.inet.ports;
  const families = row.families
    .map((f) => `<span class="chip info${f.enabled ? "" : " dim"}">${f.family === "ipv6" ? "IPv6" : "IPv4"}</span>`)
    .join("");
  const upnp = row.source === "upnp"
    ? `<span class="chip">${escapeHtml(row.lease ? `${p.upnpChip} · ${fill(p.lease, { time: formatDuration(row.lease, t.inet.units) })}` : p.upnpChip)}</span>`
    : "";
  const same = row.external_port === row.internal_port && (row.external_port_end ?? null) === (row.internal_port_end ?? null);
  const ports = same
    ? `<span class="mono">${escapeHtml(portText(row.external_port, row.external_port_end))}</span><small>${escapeHtml(p.portSame)}</small>`
    : `<span class="mono">${escapeHtml(portText(row.external_port, row.external_port_end))}</span><span class="arrow" aria-hidden="true">→</span><span class="mono">${escapeHtml(portText(row.internal_port, row.internal_port_end))}</span><small>${escapeHtml(p.portDiff)}</small>`;
  const name = row.description ? `<b>${escapeHtml(row.description)}</b>` : `<b class="muted">${escapeHtml(p.noName)}</b>`;
  return `<div class="pfrule ${row.state === "closed" ? "closed" : ""}">
    <div>${stateChip(row, p)}</div>
    <div class="pfname">${name}${families}${upnp}</div>
    <div class="pfproto"><span class="chip proto">${escapeHtml(row.protocol ?? "")}</span></div>
    <div class="pfports">${ports}</div></div>`;
}

function groupCard(group, t) {
  const p = t.inet.ports;
  const name = escapeHtml(group.name ?? p.noClient);
  const title = group.deviceId ? `<button class="linklike" data-dev="${escapeHtml(group.deviceId)}">${name}</button>` : name;
  const online = group.online === null ? "" : `<span class="chip"><i class="dot ${group.online ? "on" : ""}" aria-hidden="true"></i>${escapeHtml(group.online ? p.online : p.offline)}</span>`;
  return `<div class="pfdev"><div class="pfhead"><b>${title}</b>${group.address && group.address !== group.name ? `<span class="mono muted">${escapeHtml(group.address)}</span>` : ""}<span class="sp"></span>${online}</div>
    <div class="pfcols" aria-hidden="true"><span>${escapeHtml(p.cols.state)}</span><span>${escapeHtml(p.cols.rule)}</span><span>${escapeHtml(p.cols.protocol)}</span><span class="r">${escapeHtml(p.cols.port)}</span></div>
    ${group.rows.map((row) => ruleRow(row, t)).join("")}</div>`;
}

/** The card; messages where the box tells nothing or no forwarding is set. */
export function renderPorts(state, ctx) {
  const { t } = ctx;
  const p = t.inet.ports;
  const filter = PORT_FILTERS.includes(ctx.filter) ? ctx.filter : "all";
  const head = `<span class="label">${escapeHtml(p.title)}</span>`;
  const card = (body) => `<section class="card sec pfcard">${head}${body}</section>`;
  if (state === "failed") return card(`<p class="hint">${escapeHtml(p.failed)}</p>`);
  if (!state) return card(`<p class="hint">${escapeHtml(t.loading)}</p>`);
  const m = portsModel(state.entries, filter);
  const gap = state.manual_known === false;
  if (!m.rows.length) {
    return card(`<div class="empty"><b>${escapeHtml(gap ? p.noneUnknown : p.none)}</b></div><p class="pfnote">${escapeHtml(p.hint)}</p>`);
  }
  const tiles = `<div class="pftiles">
    <div class="pftile${m.open ? " open" : ""}"><b>${m.open}</b><small>${escapeHtml(p.tileOpen)}</small></div>
    <div class="pftile"><b>${m.closed}</b><small>${escapeHtml(p.tileClosed)}</small></div>
    <div class="pftile"><b>${m.devices}</b><small>${escapeHtml(m.devices === 1 ? p.tileDevice : p.tileDevices)}</small></div></div>`;
  const warn = gap ? `<p class="pfnote warn">${escapeHtml(p.manualUnknown)}</p>` : "";
  const filters = `<div class="pffilters" role="group" aria-label="${escapeHtml(p.filterLabel)}">${PORT_FILTERS.map(
    (f) => `<button class="fchip" data-act="ports-filter" data-f="${f}" data-k="pf-${f}" aria-pressed="${f === filter}">${escapeHtml(p.filters[f])}<em>${m.counts[f]}</em></button>`
  ).join("")}</div>`;
  const body = m.groups.length ? m.groups.map((g) => groupCard(g, t)).join("") : `<div class="empty"><b>${escapeHtml(p.noMatch)}</b></div>`;
  return card(`${tiles}${warn}${filters}${body}<p class="pfnote">${escapeHtml(p.hint)}</p>`);
}
