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

/** What the tunnels did in the last 30 days, summed up from what was recorded per connection. */
export function vpnStatsModel(connections) {
  const rows = connections.filter((c) => c.stats);
  return {
    rows,
    sessions: rows.reduce((n, c) => n + c.stats.sessions_30d, 0),
    seconds: rows.reduce((n, c) => n + c.stats.seconds_30d, 0),
    longest: rows.reduce((n, c) => Math.max(n, c.stats.longest), 0),
    trackedSince: rows.map((c) => c.stats.tracked_since).filter(Boolean).sort((a, b) => a - b)[0] ?? null,
  };
}

function statsSection(m, ctx) {
  const { t, now } = ctx;
  const v = t.vpnPage;
  const s = vpnStatsModel(m.connections);
  if (!s.rows.length) return "";
  const dur = (sec) => (sec > 0 ? formatDuration(sec, t.inet.units) : "–");
  const tiles = [
    [String(s.sessions), v.statSessions],
    [dur(s.seconds), v.statTime],
    [dur(s.longest), v.statLongest],
  ]
    .map(([value, label]) => `<div class="tile"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`)
    .join("");
  const head = [v.statName, v.statSessions7, v.statSessions30, v.statTime30, v.statLongest, v.statLast]
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const body = s.rows
    .map((c) => {
      const st = c.stats;
      const last = c.connected ? v.state.up : st.last_end ? fill(v.ago, { time: formatDuration(Math.max(0, now - st.last_end), t.inet.units) }) : "–";
      return `<tr><td>${escapeHtml(c.name)}</td><td>${st.sessions_7d}</td><td>${st.sessions_30d}</td><td>${escapeHtml(dur(st.seconds_30d))}</td><td>${escapeHtml(dur(st.longest))}</td><td>${escapeHtml(last)}</td></tr>`;
    })
    .join("");
  const since = s.trackedSince ? `<p class="hint">${escapeHtml(fill(v.statSince, { time: formatDuration(Math.max(0, now - s.trackedSince), t.inet.units) }))}</p>` : "";
  return `<section class="card sec"><span class="label">${escapeHtml(v.statsTitle)}</span>
    <div class="vpntiles">${tiles}</div>
    <div class="tablewrap"><table class="vpnstats"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${since}</section>`;
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
    .map(([value, label]) => `<div class="tile"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`)
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
  return `${head}<div class="vpntiles">${tiles}</div>${group(v.devices, m.devices, ctx)}${group(v.sites, m.sites, ctx)}${remote}${statsSection(m, ctx)}<p class="hint">${escapeHtml(v.hint)}</p>`;
}
