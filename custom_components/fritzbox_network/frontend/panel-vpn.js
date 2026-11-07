/* The VPN page: the WireGuard connections of the box with their state, and the devices that are dialled in. */

import { escapeHtml, formatDuration } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

/** "up" for a tunnel that stands, "idle" for a connection that is on but not dialled in, "off" for one switched off. */
export function vpnState(connection) {
  if (connection.connected) return "up";
  return connection.enabled ? "idle" : "off";
}

/**
 * The connections in groups (devices, then links between sites) and what the page counts:
 * how many are switched on, how many are up, and the devices of the home network that come in by VPN.
 */
export function vpnModel(data) {
  const connections = (data?.vpn ?? []).map((c) => ({ ...c, state: vpnState(c) }));
  const remote = (data?.clients ?? []).filter((c) => c.vpn);
  return {
    connections,
    devices: connections.filter((c) => c.kind === "device"),
    sites: connections.filter((c) => c.kind === "site"),
    enabled: connections.filter((c) => c.enabled).length,
    up: connections.filter((c) => c.connected).length,
    remote,
    remoteOnline: remote.filter((c) => c.online).length,
  };
}

/** The seconds the chart reaches back for each range. */
export const VPN_RANGES = { day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 };

/**
 * One connection as a run of states from `from` to `to` (unix seconds): "up" while a session
 * stood, "off" while it was switched off, "none" before anything was recorded, else "idle" (on
 * but not dialled in). Neighbours of the same state are merged.
 */
export function vpnSegments(stats, from, to) {
  const sessions = (stats.sessions ?? []).map(([a, b]) => [a, b ?? to]);
  const periods = stats.enabled_periods ?? [];
  const tracked = stats.tracked_since ?? from;
  const enabledFrom = periods.length ? periods[0][0] : null;
  // switched off: after the first note of the switch, outside the periods it was on
  const off = [];
  if (enabledFrom !== null) {
    let at = enabledFrom;
    for (const [a, b] of periods) {
      if (a > at) off.push([at, a]);
      at = b ?? to;
    }
    if (at < to) off.push([at, to]);
  }
  const cuts = new Set([from, to]);
  const add = (t) => {
    if (t > from && t < to) cuts.add(t);
  };
  [...sessions.flat(), ...off.flat(), tracked].forEach(add);
  const points = [...cuts].sort((x, y) => x - y);
  const inside = (list, t) => list.some(([a, b]) => t >= a && t < b);
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const mid = (points[i] + points[i + 1]) / 2;
    const state = mid < tracked ? "none" : inside(sessions, mid) ? "up" : inside(off, mid) ? "off" : "idle";
    const last = out[out.length - 1];
    if (last && last[2] === state) last[1] = points[i + 1];
    else out.push([points[i], points[i + 1], state]);
  }
  return out;
}

/** The share of the recorded time a connection stood, in percent; null before anything is recorded. */
export function vpnShare(segments) {
  const known = segments.filter(([, , s]) => s !== "none");
  const total = known.reduce((n, [a, b]) => n + b - a, 0);
  if (!total) return null;
  return Math.round((known.filter(([, , s]) => s === "up").reduce((n, [a, b]) => n + b - a, 0) / total) * 100);
}

function statsSection(m, ctx) {
  const { t, now } = ctx;
  const v = t.vpnPage;
  const rows = m.connections.filter((c) => c.stats).map((c) => ({ ...c, stats: { ...c.stats, ...(ctx.vpnHistory?.[c.key] ?? {}) } }));
  if (!rows.length) return "";
  // the sessions come with their own request: until they are there the chart says so
  if (!ctx.vpnHistory) return `<section class="card sec"><span class="label">${escapeHtml(v.statsTitle)}</span><div class="empty"><span>${escapeHtml(t.loading)}</span></div></section>`;
  const range = VPN_RANGES[ctx.vpnRange] ? ctx.vpnRange : "week";
  const to = Math.round(now);
  const from = to - VPN_RANGES[range];
  const buttons = Object.keys(VPN_RANGES)
    .map((r) => `<button data-vrange="${r}" aria-pressed="${r === range}">${escapeHtml(v.ranges[r])}</button>`)
    .join("");
  const bars = rows
    .map((c) => {
      const segs = vpnSegments(c.stats, from, to);
      const share = vpnShare(segs);
      const spans = segs
        .filter(([, , s]) => s === "up" || s === "off" || s === "none")
        .map(([a, b, s]) => `<i class="${s}" style="left:${(((a - from) / (to - from)) * 100).toFixed(3)}%;width:${(((b - a) / (to - from)) * 100).toFixed(3)}%"></i>`)
        .join("");
      const tone = { up: "ok", idle: "info", off: "" }[c.state];
      return `<div class="vrow"><div class="vhead"><b>${escapeHtml(c.name)}</b><span class="chip ${tone}">${escapeHtml(v.state[c.state])}</span>${share === null ? "" : `<span class="vshare">${escapeHtml(fill(v.share, { percent: share }))}</span>`}</div>
        <div class="vbar" role="img" aria-label="${escapeHtml(fill(v.barLabel, { name: c.name }))}" data-from="${from}" data-to="${to}" data-segs="${escapeHtml(JSON.stringify(segs))}">${spans}<b class="tip" hidden></b><i class="cursor" hidden></i></div></div>`;
    })
    .join("");
  const legend = ["up", "idle", "off"].map((s) => `<span><i class="vl ${s}"></i>${escapeHtml(v.legend[s])}</span>`).join("");
  const since = rows.map((c) => c.stats.tracked_since).filter(Boolean).sort((a, b) => a - b)[0];
  const note = since ? fill(v.statSince, { time: formatDuration(Math.max(0, now - since), t.inet.units) }) : "";
  return `<section class="card sec"><div class="trendhead"><span class="label">${escapeHtml(v.statsTitle)}</span><div class="seg" role="group" aria-label="${escapeHtml(v.statsTitle)}">${buttons}</div></div>
    <div class="vbars">${bars}</div>
    <div class="vaxis"><span>${escapeHtml(v.axis[range])}</span><span>${escapeHtml(v.now)}</span></div>
    <div class="vlegend">${legend}</div>
    <p class="hint">${escapeHtml(note)} ${escapeHtml(v.statHint)}</p></section>`;
}

function card(connection, ctx) {
  const { t, now } = ctx;
  const v = t.vpnPage;
  const facts = [];
  if (connection.connected && connection.since) facts.push(fill(v.since, { time: formatDuration(Math.max(0, now - connection.since), t.inet.units) }));
  if (connection.remote_endpoint) facts.push(fill(v.endpoint, { address: connection.remote_endpoint }));
  if (connection.remote_net) facts.push(fill(v.network, { net: connection.remote_net }));
  const tone = { up: "ok", idle: "info", off: "" }[connection.state];
  const busy = ctx.busy?.has(connection.key);
  const control =
    ctx.canWrite && connection.editable
      ? `<button class="btn vpnswitch" data-act="vpn-switch" data-key="${escapeHtml(connection.key)}" data-on="${connection.enabled ? "0" : "1"}"${busy ? " disabled" : ""}>${escapeHtml(connection.enabled ? v.turnOff : v.turnOn)}</button>`
      : "";
  return `<li class="vpnrow ${connection.state}">
    <span aria-hidden="true">${ic(connection.kind === "site" ? "network" : "shield")}</span>
    <div class="vpnname"><b>${escapeHtml(connection.name)}</b><small>${escapeHtml(facts.join(" · "))}</small></div>
    <span class="chip ${tone}">${escapeHtml(v.state[connection.state])}</span>${control}</li>`;
}

function group(title, list, ctx) {
  if (!list.length) return "";
  return `<section class="card sec"><span class="label">${escapeHtml(title)}</span><ul class="vpnlist">${list.map((c) => card(c, ctx)).join("")}</ul></section>`;
}

/** The page; a message where the box tells no WireGuard connections. */
export function renderVpn(data, ctx) {
  const { t } = ctx;
  const v = t.vpnPage;
  const head = `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(v.title)}</h1><p class="lead">${escapeHtml(v.lead)}</p></div>`;
  if (!Array.isArray(data?.vpn)) return `${head}<div class="card"><div class="empty"><b>${escapeHtml(v.noData)}</b></div></div>`;
  const m = vpnModel(data);
  if (!m.connections.length) return `${head}<div class="card"><div class="empty"><b>${escapeHtml(v.none)}</b><p>${escapeHtml(v.noneHint)}</p></div></div>`;
  const tiles = [
    [fill(v.upOf, { up: m.up, n: m.connections.length }), v.tileConnections],
    [String(m.remoteOnline), v.tileRemote],
  ]
    .map(([value, label]) => `<div class="tile"><span class="label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`)
    .join("");
  const remote = m.remote.length
    ? `<section class="card sec"><span class="label">${escapeHtml(v.remoteTitle)}</span><ul class="vpnlist">${m.remote
        .map(
          (c) => `<li class="vpnrow ${c.online ? "up" : "off"}"><span aria-hidden="true">${ic("shield")}</span>
            <div class="vpnname"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.ip ?? "")}</small></div>
            <span class="chip ${c.online ? "ok" : ""}">${escapeHtml(c.online ? t.onlineChip : v.state.off)}</span></li>`
        )
        .join("")}</ul></section>`
    : "";
  return `${head}<div class="tiles vpntiles">${tiles}</div>${group(v.devices, m.devices, ctx)}${group(v.sites, m.sites, ctx)}${remote}${statsSection(m, ctx)}<p class="hint">${escapeHtml(v.hint)}</p>`;
}
