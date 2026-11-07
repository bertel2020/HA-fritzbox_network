/* The device page of the panel: a page of its own with the connection, the actions and the master data, as HTML. */

import { BANDS, escapeHtml, formatBytes, isBlocked, isWeak, pointColumn, seriesStats, sparkLine, trafficSum, uplinkStyle } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { weakPercent, whenText } from "./panel-network.js";

/** The state of an entity of the integration, or null where it does not exist or is gone. */
export function entityState(hass, entityId) {
  const state = entityId ? hass?.states?.[entityId] : null;
  return state && state.state !== "unavailable" ? state : null;
}

/**
 * What an action offers: its entity, or the reason it cannot be used. The box user needs the
 * right to change things, and most actions go by the IPv4 address of the device. An entity the
 * device has but Home Assistant shows no state for is switched off in Home Assistant.
 */
export function actionStatus(client, name, hass, canWrite, { needsIp = true } = {}) {
  const entity = client.actions?.[name];
  if (!canWrite) return { entity, state: null, reason: "noRights" };
  if (needsIp && !client.ip) return { entity, state: null, reason: "noIp" };
  const state = entityState(hass, entity);
  if (state) return { entity, state, reason: null };
  if (entity && hass?.states && !(entity in hass.states)) return { entity, state: null, reason: "disabled" };
  return { entity, state: null, reason: "noEntity" };
}

// the actions of the page: name in the topology, and whether it goes by the IPv4 address
const ACTIONS = [
  ["internet_access", true],
  ["priority", true],
  ["access_profile", true],
  ["wake_on_lan", false],
];

/** The entities of the device that are off in Home Assistant and could be switched on now. */
export function enablePlan(client, hass, canWrite, enabling = new Set()) {
  if (!client) return [];
  return ACTIONS.map(([name, needsIp]) => actionStatus(client, name, hass, canWrite, { needsIp }))
    .filter((status) => status.reason === "disabled" && !enabling.has(status.entity))
    .map((status) => status.entity);
}

/** The reason a control cannot be used, or "": the box user needs the right, and most actions an IPv4 address. */
function blockedReason(client, canWrite, t, { needsIp = true } = {}) {
  if (!canWrite) return t.noRights;
  if (needsIp && !client.ip) return t.noIp;
  return "";
}

function controlRow(label, hint, control) {
  return `<div class="action"><div>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></div><div class="ctl">${control}</div></div>`;
}

function switchButton(id, label, on, reason) {
  return `<button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" data-sw="${id}" data-k="sw-${id}" ${reason ? "disabled" : ""}></button>`;
}

/** The controls of the device. They work at the box itself, so they need no entity in Home Assistant. */
function controlsCard(client, data, canWrite, t) {
  const reason = blockedReason(client, canWrite, t);
  const blocked = isBlocked(client);
  const status = `<div class="inet-status ${blocked ? "bad" : "ok"}"><span class="dot" aria-hidden="true"></span><span>${escapeHtml(
    blocked ? t.internetOff : t.internetOn
  )}</span>${switchButton("internet_access", t.internet, !blocked, reason)}</div>${reason ? `<p class="hint">${escapeHtml(reason)}</p>` : ""}`;
  const profiles = data.profiles ?? [];
  const profile = profiles.length
    ? controlRow(
        t.profile,
        t.profileHint,
        `<select data-profile data-k="profile" aria-label="${escapeHtml(t.profile)}" ${reason ? "disabled" : ""}>${profiles
          .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === client.filter_profile_id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
          .join("")}</select>`
      )
    : "";
  const priority = controlRow(t.priority, t.priorityHint, switchButton("priority", t.priority, Boolean(client.priority), reason));
  const wolReason = blockedReason(client, canWrite, t, { needsIp: false });
  const wol = controlRow(
    t.wol,
    t.wolHint,
    `<button class="btn sm" data-act="wol" data-k="wol" ${wolReason || client.online ? "disabled" : ""}>${escapeHtml(t.wake)}</button>`
  );
  return `<section class="card sec"><span class="label">${escapeHtml(t.controls)}</span>${status}${profile}${priority}${wol}</section>`;
}

function bandName(band, t) {
  return t.bandGroups[band] ?? BANDS[band] ?? band ?? "";
}

/** How the device itself is linked, in words: the port and speed, or the band and the signal. */
function ownLink(client, t) {
  if (client.link_type === "lan") return [client.port ?? "LAN", client.speed ? `${client.speed} Mbit/s` : ""].filter(Boolean).join(" · ");
  if (client.link_type === "wlan") {
    const signal = client.online && typeof client.signal_dbm === "number" ? `${client.signal_dbm} dBm` : "";
    return [`WLAN ${bandName(client.band, t)}`.trim(), signal].filter(Boolean).join(" · ");
  }
  return t.linkUnknown;
}

/**
 * The way from the internet to the device: the box, the repeater in between if there is one,
 * and the lines between them with how they look in the map.
 */
export function connectionPath(client, data, t, threshold) {
  const nodes = data?.nodes ?? [];
  const master = nodes.find((n) => n.role === "master");
  const ap = nodes.find((n) => n.mac === client.ap_mac);
  const steps = [
    { kind: "internet", name: t.internetNode },
    { style: "plain", text: "" },
    { kind: "box", name: master?.name ?? "FRITZ!Box" },
  ];
  if (ap && ap.role !== "master") {
    const style = uplinkStyle(ap);
    const up = ap.uplink;
    const text =
      style === "lan"
        ? "LAN"
        : style === "wlan"
          ? [`WLAN ${bandName(up.band, t)}`.trim(), typeof up.signal_dbm === "number" ? `${up.signal_dbm} dBm` : ""].filter(Boolean).join(" · ")
          : t.linkUnknown;
    steps.push({ style, text }, { kind: "ap", name: ap.name });
  }
  const own = client.link_type === "lan" ? "lan" : client.link_type === "wlan" ? "wlan" : "unknown";
  steps.push(
    { style: own, weak: isWeak(client, threshold), text: client.online ? ownLink(client, t) : t.linkOffline },
    { kind: "device", name: client.name }
  );
  return steps;
}

function pathHtml(client, data, t, threshold) {
  const steps = connectionPath(client, data, t, threshold);
  const icons = { internet: "globe", box: "router", ap: "ap", device: client.link_type === "lan" ? "lan" : "wifi" };
  const html = steps
    .map((s) =>
      s.kind
        ? `<div class="pn ${s.kind === "device" ? "me" : ""}">${ic(icons[s.kind])}<b>${escapeHtml(s.name)}</b></div>`
        : `<div class="pl ${s.style} ${s.weak ? "weak" : ""}"><i></i><span>${escapeHtml(s.text)}</span></div>`
    )
    .join("");
  const names = steps.filter((s) => s.kind).map((s) => s.name);
  names[names.length - 1] = fill(t.pathVia, { name: client.name, link: steps.at(-2).text });
  return `<div class="path" role="img" aria-label="${escapeHtml(fill(t.pathLabel, { path: names.join(", ") }))}">${html}</div>`;
}

function tilesHtml(client, data, t) {
  if (!client.online) return `<p class="muted spaced">${escapeHtml(t.offlineNoData)}</p>`;
  const rate = (down, up) => `${Math.round(down ?? 0)} / ${Math.round(up ?? 0)}`;
  const node = (data?.nodes ?? []).find((n) => n.mac === client.ap_mac);
  const tile = (label, value, small = "") =>
    `<div class="tile"><span class="label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${small ? `<small>${escapeHtml(small)}</small>` : ""}</div>`;
  const tiles = [
    client.rate_download || client.rate_upload ? tile(t.rate, rate(client.rate_download, client.rate_upload), "Mbit/s") : "",
    client.rate_max_download || client.rate_max_upload
      ? tile(t.maxRate, rate(client.rate_max_download, client.rate_max_upload), "Mbit/s")
      : "",
  ];
  if (client.link_type === "wlan") {
    const channel = node?.radios?.[client.band]?.channel;
    tiles.push(
      tile(t.signal, typeof client.signal_dbm === "number" ? `${client.signal_dbm} dBm` : "–"),
      tile(t.band, client.band ? bandName(client.band, t) : "–", typeof channel === "number" ? fill(t.channel, { n: channel }) : "")
    );
  } else if (client.port) {
    tiles.push(tile(t.port, client.port, client.speed ? `${client.speed} Mbit/s` : ""));
  }
  const body = tiles.filter(Boolean).join("");
  return body ? `<div class="tiles">${body}</div>` : "";
}

/** Back to where the device was opened, and paging through the devices that are shown there. */
function headHtml(client, ctx) {
  const { t, pager, view } = ctx;
  const p = pager ?? { index: -1, total: 0, prev: null, next: null };
  const go = (dir, other, label, key) =>
    `<button class="icon-btn" data-go="${escapeHtml(other?.id ?? "")}" data-k="${dir}" aria-label="${escapeHtml(other ? `${label}: ${other.name}` : label)}" title="${escapeHtml(`${label} (${key})`)}" ${other ? "" : "disabled"}>${ic(dir === "prev" ? "left" : "right")}</button>`;
  const count = p.index >= 0 ? `<span aria-hidden="true">${escapeHtml(fill(t.pager, { i: p.index + 1, n: p.total }))}</span>` : "";
  return `<div class="dhead"><button class="back" data-act="back" data-k="back">${ic("back")}${escapeHtml(t.views[view] ?? t.views.list)}</button>
    ${client ? `<span class="pager">${count}${go("prev", p.prev, t.prevDevice, "k")}${go("next", p.next, t.nextDevice, "j")}</span>` : ""}
    ${client ? `<h1 id="dtitle" tabindex="-1">${escapeHtml(client.name)}</h1>` : ""}</div>`;
}

export function renderDevice(client, ctx) {
  const { t, now, data, hass } = ctx;
  const enabling = ctx.enabling ?? new Set();
  if (!client) {
    return `${headHtml(null, ctx)}<div class="card empty">${ic("wifi")}<b>${escapeHtml(t.noSelection)}</b><span>${escapeHtml(t.noSelectionHint)}</span></div>`;
  }
  const canWrite = Boolean(data?.can_write);
  const node = (data?.nodes ?? []).find((n) => n.mac === client.ap_mac);
  const when = whenText(client.last_online, now, t);
  const weak = isWeak(client, ctx.threshold);
  const chips = [
    `<span class="chip ${client.online ? "ok" : ""}"><span class="dot ${client.online ? "on" : ""}"></span>${escapeHtml(
      client.online ? t.onlineChip : fill(t.offlineChip, { when })
    )}</span>`,
    client.link_type ? `<span class="chip">${client.link_type === "wlan" ? "WLAN" : "LAN"}</span>` : "",
    client.guest ? `<span class="chip info">${escapeHtml(t.guestChip)}</span>` : "",
    isBlocked(client) ? `<span class="chip bad">${escapeHtml(t.blockedChip)}</span>` : "",
    weak ? `<span class="chip warn">${escapeHtml(fill(t.weakChip, { percent: weakPercent(client) }))}</span>` : "",
    client.private_mac ? `<span class="chip">${escapeHtml(t.privateMac)}</span>` : "",
    client.vpn ? `<span class="chip">${escapeHtml(t.vpn)}</span>` : "",
  ].join("");

  const master = [
    [t.mac, `<span class="mono">${escapeHtml(client.mac)}</span>`],
    [t.ip, `<span class="mono">${escapeHtml(client.ip ?? t.unknown)}</span>${ipBadge(ctx.ip, client, t)}`],
    client.hostname && client.hostname.toLowerCase() !== client.name.toLowerCase()
      ? [t.hostname, `<span class="mono">${escapeHtml(client.hostname)}</span>`]
      : null,
    [t.vendor, escapeHtml(client.vendor ?? (client.private_mac ? t.vendorPrivate : t.unknown))],
    [t.accessPoint, escapeHtml(node?.name ?? t.notAssigned)],
    client.ssid ? [t.network, escapeHtml(client.ssid)] : null,
    client.filter_profile ? [t.profile, escapeHtml(client.filter_profile)] : null,
    client.created_at ? [t.knownSince, escapeHtml(whenText(client.created_at, now, t))] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`)
    .join("");

  const off = enablePlan(client, hass, canWrite, enabling);
  const note = off.length
    ? `<div class="entities-note"><span>${escapeHtml(fill(t.entitiesNote, { n: off.length }))}</span><button class="btn sm" data-enable="all" data-k="en-all">${escapeHtml(t.entitiesEnable)}</button></div>`
    : "";
  return `${headHtml(client, ctx)}
    <div class="chips-row">${chips}</div>
    <div class="dsecs">
      <section class="card sec wide"><span class="label">${escapeHtml(t.connection)}</span>${pathHtml(client, data, t, ctx.threshold)}${tilesHtml(client, data, t)}</section>
      ${trendSection(client, ctx)}
      ${controlsCard(client, data, canWrite, t)}
      <section class="card sec"><span class="label">${escapeHtml(t.master)}</span><dl>${master}</dl>
        ${groupsSection(client, data, t)}
        ${historySection(client, t)}</section>
      <section class="card sec wide"><span class="label">${escapeHtml(t.deviceTools)}</span>
        <div class="btn-row">
          <button class="btn" data-act="rename" data-k="rename" ${client.entity_id ? "" : "disabled"}>${escapeHtml(t.rename)}</button>
          <button class="btn" data-act="ha" data-k="ha" ${client.device_id ? "" : "disabled"}>${ic("external")}${escapeHtml(t.openInHa)}</button>
          <button class="btn" data-act="show-map" data-k="show-map">${ic("map")}${escapeHtml(t.showInMap)}</button>
          <button class="btn" data-act="cap-device" data-k="cap-device">${escapeHtml(t.inet.capture.ofDevice)}</button>
        </div>${note}</section>
    </div>`;
}

/** "fixed" or "automatic" next to the address, once the box has said; nothing before or where it does not. */
function ipBadge(state, client, t) {
  const reservation = state?.mac === client.mac ? state.reservation : null;
  if (!reservation) return "";
  return ` <span class="chip ${reservation.fixed ? "info" : ""}" title="${escapeHtml(reservation.fixed ? t.ipFixedTitle : t.ipAutoTitle)}">${escapeHtml(reservation.fixed ? t.ipFixed : t.ipAuto)}</span>`;
}

/** Signal scale of the chart: fixed, so the colour means the same strength at any time. */
const SIGNAL_TONE = { min: -90, max: -50 };

/** A vertical gradient that colours a signal line by strength: good from -60, medium from -70, weak from -80 dBm. */
function signalGradient(id, { min, max }) {
  const at = (dbm) => (((max - dbm) / (max - min)) * 100).toFixed(1);
  const bands = [[max, "good"], [-60, "good"], [-60, "mid"], [-70, "mid"], [-70, "weak"], [-80, "weak"], [-80, "bad"], [min, "bad"]];
  const stops = bands.map(([dbm, tone]) => `<stop offset="${at(dbm)}%" style="stop-color:var(--sig-${tone})"/>`).join("");
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="88">${stops}</linearGradient></defs>`;
}

/** One chart of the trend: the line, the area below and the lowest, mean and highest value. */
function trendChart(title, values, unit, t, times, range, tone = null) {
  const path = sparkLine(values, 300, 90, tone ? { min: tone.min, max: tone.max } : {});
  const stats = seriesStats(values);
  if (!path || !stats) return "";
  const round = (n) => Math.round(n);
  const gid = tone ? `tone-${range}` : "";
  const defs = tone ? signalGradient(gid, tone) : "";
  return `<div class="trend"><span class="label">${escapeHtml(title)}</span>
    <div class="plot" data-pts="${escapeHtml(JSON.stringify(values.map((v, i) => [times[i], typeof v === "number" ? Math.round(v * 10) / 10 : null])))}" data-unit="${escapeHtml(unit)}" data-range="${range}">
      <svg viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">${defs}<path class="area" d="${path.area}"${tone ? ` style="fill:url(#${gid})"` : ""}/><path d="${path.line}"${tone ? ` style="stroke:url(#${gid})"` : ""}/></svg>
      <i class="cursor" hidden></i><b class="tip" hidden></b></div>
    <span class="hint">${escapeHtml(fill(t.trendStats, { min: round(stats.min), mean: round(stats.mean), max: round(stats.max), unit }))}</span></div>`;
}

/** Signal and rate of the last day or week, from the history the box keeps. */
function trendSection(client, ctx) {
  const { t, trend } = ctx;
  if (!trend || trend.mac !== client.mac) return "";
  const range = trend.range === "week" ? "week" : "day";
  const points = trend.data?.[range] ?? [];
  const times = points.map((p) => p[0]);
  const charts = [
    client.link_type === "wlan" ? trendChart(t.trendSignal, pointColumn(points, 2), "dBm", t, times, range, SIGNAL_TONE) : "",
    trendChart(t.trendRate, pointColumn(points, 3), "Mbit/s", t, times, range),
  ].join("");
  const days = trend.data?.traffic;
  const volume = Object.keys(days ?? {}).length
    ? (() => {
        const sums = [1, 7, 30].map((n) => ({ n, sum: trafficSum(days, n) }));
        const top = Math.max(...sums.map(({ sum }) => sum[0]), 1);
        const tiles = sums
          .map(({ n, sum: [down, up] }) => `<div class="vol"><span class="hint">${escapeHtml(t.trafficRanges[n])}</span><b><i class="vd">↓</i> ${escapeHtml(formatBytes(down, ctx.language))}</b><span class="vbar" aria-hidden="true"><i style="width:${((down / top) * 100).toFixed(1)}%"></i></span><small><i class="vu">↑</i> ${escapeHtml(formatBytes(up, ctx.language))}</small></div>`)
          .join("");
        return `<div class="volume"><span class="label">${escapeHtml(t.trafficTitle)}</span><div class="vols">${tiles}</div></div>`;
      })()
    : "";
  const buttons = ["day", "week"]
    .map((r) => `<button data-range="${r}" aria-pressed="${r === range}">${escapeHtml(t.trendRanges[r])}</button>`)
    .join("");
  return `<section class="card sec wide"><div class="trendhead"><span class="label">${escapeHtml(t.trendTitle)}</span><div class="seg" role="group" aria-label="${escapeHtml(t.trendTitle)}">${buttons}</div></div>
    ${charts ? `<div class="trends">${charts}</div>` : `<p class="hint">${escapeHtml(t.trendNone)}</p>`}${volume}</section>`;
}

/** The groups of a device: the labels of Home Assistant, put on its "Internet access" entity. */
function groupsSection(client, data, t) {
  const labels = data?.labels ?? [];
  const body = client.actions?.internet_access
    ? `<div class="chips-row" role="group" aria-label="${escapeHtml(t.groupsTitle)}">${labels
        .map(
          (l) =>
            `<button class="fchip" data-label="${escapeHtml(l.id)}" aria-pressed="${(client.labels ?? []).includes(l.id)}" data-k="lb-${escapeHtml(l.id)}">${escapeHtml(l.name)}</button>`
        )
        .join("")}<button class="fchip" data-act="new-group" data-k="new-group">+ ${escapeHtml(t.newGroup)}</button></div>
      <p class="hint">${escapeHtml(t.groupsHint)}</p>`
    : `<p class="hint">${escapeHtml(t.noGroupEntity)}</p>`;
  return `<div class="section"><span class="label">${escapeHtml(t.groupsTitle)}</span>${body}</div>`;
}

/** Links to what Home Assistant already records about the device. */
function historySection(client, t) {
  if (!client.entity_id) return "";
  return `<div class="section"><span class="label">${escapeHtml(t.historyTitle)}</span>
    <div class="btn-row"><button class="btn sm" data-act="logbook" data-k="logbook">${escapeHtml(t.logbook)}</button><button class="btn sm" data-act="history" data-k="history">${escapeHtml(t.history)}</button></div>
    <p class="hint">${escapeHtml(t.historyHint)}</p></div>`;
}
