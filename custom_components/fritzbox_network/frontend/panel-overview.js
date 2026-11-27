/* The overview, the start page: a tile per area that leads to its page, what stands out on all pages in one list, and quick actions. */

import { NEW_DAYS, STALE_DAYS, escapeHtml, formatBytes, formatDuration, formatRate, pageHash, panelCounts, sparkLine, trafficByDevice } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { ON_WLAN, networkHints } from "./panel-hints.js";
import { internetHints } from "./panel-internet.js";
import { radioCheck, radioFindingText, utilizationLevel } from "./panel-radio.js";
import { routesModel } from "./panel-routes.js";
import { mergePortRules } from "./panel-ports.js";
import { shortNumber } from "./phone-model.js";

const LEVELS = { bad: 0, warn: 1, info: 2 };

/** An own number as it is shown: shortened where privacy mode hides numbers. */
const lineNumber = (number, lines) => (lines?.privacy ? shortNumber(number) : number);

/** A text with a number: its "…One" form for one where the texts have it ("1 new device", "2 new devices"). */
function counted(texts, key, n, values = {}) {
  return fill(n === 1 && texts[`${key}One`] ? texts[`${key}One`] : texts[key], { n, ...values });
}

/** The uptime of the box in seconds, from what box/info told: its own count, else since its last restart. */
function boxUptime(info, now) {
  if (typeof info?.uptime_seconds === "number") return info.uptime_seconds;
  const last = Date.parse(info?.last_restart ?? "");
  return Number.isNaN(last) ? null : Math.max(0, (now - last) / 1000);
}

/**
 * What stands out on all pages, in one list, most serious first: [{ level, key, title, detail, href,
 * link }] with the level "bad", "warn" or "info", a short title, the text the page itself shows as
 * the detail, and the page where it is dealt with. It asks the same functions the pages ask, so a
 * note shows here exactly when it shows there; what a page has not read yet (routes, port
 * forwardings, the box) is left out until it is read.
 */
export function collectIssues(state, t, now = Date.now()) {
  const o = t.overview.issues;
  const data = state?.data ?? null;
  const issues = [];
  const add = (level, key, title, detail, page, link, params) =>
    issues.push({ level, key, title, detail, href: pageHash(page, params), link });
  // the internet connection
  for (const h of internetHints(data?.internet ?? null, now)) {
    add(h.level, `inet-${h.key}`, o[h.key], fill(t.inet.hints[h.key], h.values), "internet", t.tabs.internet);
  }
  // the box: a restart that takes too long, or one under way
  const restart = state?.boxRestart?.phase;
  if (restart === "late") add("bad", "box-late", o.restartLate, t.boxPage.restart.late, "box", t.tabs.box);
  else if (restart === "down") add("info", "box-restart", o.restarting, t.boxPage.restart.inProgress, "box", t.tabs.box);
  // the radios and the mesh, as the radio check on the Wi-Fi page sees them
  for (const f of radioCheck(data).findings) {
    const level = f.kind === "busy" ? utilizationLevel(f.percent) : f.kind === "weak" ? "info" : "warn";
    const band = t.bandGroups[f.band] ?? f.band ?? "";
    add(level === "ok" ? "warn" : level, `radio-${f.kind}`, fill(o[f.kind], { band, n: f.n }), radioFindingText(f, t), "wlan", t.tabs.wlan);
  }
  // the other notes of the network page (the new firmware); those about radios came with the check
  for (const h of networkHints(data, t).filter((h) => !ON_WLAN.has(h.key))) {
    add(h.level, `net-${h.key}`, o[h.key], fill(t.netHints[h.key], h.values), "box", t.tabs.box);
  }
  // routes whose gateway is offline, once the routes page (or this one) has read them
  const routes = state?.routes;
  if (routes && typeof routes === "object" && Array.isArray(routes.entries)) {
    for (const r of routesModel(routes.entries).down) {
      const name = r.device_name || r.gateway;
      add("warn", "route-down", o.routeDown, fill(t.routesPage.downHint, { name, net: r.network }), "routes", t.tabs.routes);
    }
  }
  // port forwardings open from the internet; a note to look when one leads to a device that is offline
  const ports = state?.ports;
  if (ports && typeof ports === "object" && Array.isArray(ports.entries)) {
    const open = mergePortRules(ports.entries).filter((r) => r.state !== "closed");
    if (open.length) {
      const offline = open.filter((r) => r.device_online === false).length;
      const detail = offline ? counted(o, "portsOffline", offline) : o.portsDetail;
      add(offline ? "warn" : "info", "ports-open", counted(o, "ports", open.length), detail, "ports", t.tabs.ports);
    }
  }
  // devices: new ones in the network, and ones gone for long
  const counts = data ? panelCounts(data, now, state?.threshold) : null;
  if (counts?.new) {
    const names = (data.clients ?? [])
      .filter((c) => c.created_at && now - Date.parse(c.created_at) < NEW_DAYS * 86400000)
      .map((c) => c.name)
      .slice(0, 3);
    const more = counts.new > names.length ? ` ${fill(t.netHintsMore, { n: counts.new - names.length })}` : "";
    add("info", "devices-new", counted(o, "fresh", counts.new), `${names.join(", ")}${more}`, "net", t.tabs.netDevices, { filter: "new" });
  }
  if (counts?.stale) {
    add("info", "devices-stale", counted(o, "stale", counts.stale), fill(o.staleDetail, { days: STALE_DAYS }), "cleanup", t.tabs.cleanup);
  }
  // the phone, while FRITZ!Box Telefon is there
  if (state?.phoneFound) {
    const missed = Number(state.phoneMissed) || 0;
    const unread = Number(state.phoneUnread) || 0;
    if (missed) add("info", "phone-missed", counted(o, "missed", missed), o.missedDetail, "phone", t.tabs.phone);
    if (unread) add("info", "phone-messages", counted(o, "messages", unread), o.messagesDetail, "phone", t.tabs.phone);
    // a number the provider has not registered: calls to it do not arrive
    for (const l of state.phoneLines?.down ?? []) {
      const number = lineNumber(l.number, state.phoneLines);
      add("bad", "phone-line", fill(o.lineDown, { number }), l.status ? fill(o.lineDownStatus, { status: l.status }) : o.lineDownDetail, "phone", t.tabs.phone);
    }
  }
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => LEVELS[a.issue.level] - LEVELS[b.issue.level] || a.i - b.i).map((x) => x.issue);
}

/**
 * How many devices were online, hour by hour over the last day, from the history of the devices:
 * the sum of their share online. An hour without a value of any device stays a gap (null); in an
 * hour with some, a device without a value counts as offline. null without a history.
 */
export function onlineCounts(history, macs) {
  if (!history || typeof history !== "object") return null;
  const series = [...macs].map((mac) => history[mac]?.online).filter(Array.isArray);
  if (!series.length) return null;
  const length = Math.max(...series.map((v) => v.length));
  const sums = Array.from({ length }, (_, i) => {
    const known = series.map((v) => v[i]).filter((v) => typeof v === "number");
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  });
  return sums.filter((v) => v !== null).length >= 2 ? sums : null;
}

const DAY_MS = 86400000;
const TOP_CONSUMERS = 5;

/**
 * The devices that moved the most data over the last day or the last 7 days, the most first:
 * [{ mac, name, id, down, up, total }]. Names come from the clients; a device the box no longer
 * lists keeps its MAC and has no page (id null).
 */
export function topConsumers(traffic, clients, days, now = new Date(), limit = TOP_CONSUMERS) {
  const known = new Map((clients ?? []).map((c) => [c.mac, c]));
  return Object.entries(trafficByDevice(traffic, days, now))
    .map(([mac, [down, up]]) => ({ mac, name: known.get(mac)?.name || mac, id: known.get(mac)?.id ?? null, down, up, total: down + up }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * What happened in the last 24 hours, newest first: [{ at, kind, text, href }] with the kind
 * "internet", "device" or "box". From what the pages know already: the events of the connection,
 * the devices that came new, a restart of the box (from its uptime, once it is read).
 */
export function todayEvents(state, t, now = Date.now()) {
  const o = t.overview.today;
  const data = state?.data ?? null;
  const since = now - DAY_MS;
  const items = [];
  for (const e of data?.internet?.events ?? []) {
    const at = Date.parse(e.time);
    if (Number.isNaN(at) || at < since || at > now + 60000) continue;
    items.push({ at, kind: "internet", text: fill(t.inet.kinds[e.kind] ?? e.kind, { detail: e.detail ?? "" }), href: pageHash("internet") });
  }
  const fresh = (data?.clients ?? [])
    .map((c) => ({ name: c.name, at: Date.parse(c.created_at ?? "") }))
    .filter((c) => !Number.isNaN(c.at) && c.at >= since && c.at <= now + 60000)
    .sort((a, b) => b.at - a.at);
  for (const c of fresh.slice(0, 3)) items.push({ at: c.at, kind: "device", text: fill(o.newDevice, { name: c.name || "?" }), href: pageHash("net", { filter: "new" }) });
  if (fresh.length > 3) items.push({ at: fresh[3].at, kind: "device", text: fill(o.newMore, { n: fresh.length - 3 }), href: pageHash("net", { filter: "new" }) });
  // the last change of each telephone number: registered by the provider, or not any more
  for (const c of state?.phoneLines?.changes ?? []) {
    if (c.at < since || c.at > now + 60000) continue;
    items.push({ at: c.at, kind: "phone", bad: !c.registered, text: fill(c.registered ? o.lineUp : o.lineDown, { number: lineNumber(c.number, state.phoneLines) }), href: pageHash("phone") });
  }
  const info = state?.box && typeof state.box === "object" ? state.box : null;
  const up = info ? boxUptime(info, now) : null;
  if (up !== null && up * 1000 < DAY_MS) items.push({ at: now - up * 1000, kind: "box", text: o.boxRestarted, href: pageHash("box") });
  return items.sort((a, b) => b.at - a.at);
}

/** The span a course of counts is drawn in: a little wider than its own range, so a few devices more or less show, and not below 0. */
function spread(values) {
  const known = values.filter((v) => typeof v === "number");
  if (!known.length) return { min: 0 };
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = Math.max(1, (hi - lo) * 0.25);
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

/**
 * The status tiles: [{ id, href, label, value, unit, sub, tone }] for Internet, Devices, Wi-Fi, Box
 * and, while FRITZ!Box Telefon is found, Phone; the two about the clients come together, the box
 * with what it only reports comes after them. tone is the dot before the line below the value:
 * "ok", "warn", "bad" or "" for none. spark is the course of the value ({ values, min }) for the
 * line below it, seg the parts of a whole ([{ key, n }]) for the phone, bar a share in percent.
 */
export function overviewTiles(state, t, { now = Date.now(), language } = {}) {
  const o = t.overview.tiles;
  const data = state?.data ?? {};
  const tiles = [];
  const split = (text) => {
    const cut = text.lastIndexOf(" ");
    return text !== "–" && cut > 0 ? [text.slice(0, cut), text.slice(cut + 1)] : [text, ""];
  };
  // internet: the download now, connected since
  const line = data.internet ?? null;
  if (line) {
    const up = line.connected !== false;
    const [value, unit] = split(formatRate(line.throughput?.down, language));
    const since = up && typeof line.uptime === "number" ? fill(o.upSince, { time: formatDuration(line.uptime, t.inet.units) }) : up ? o.up : o.down;
    const samples = Array.isArray(line.samples) ? line.samples.map((p) => [p[0], p[1]]) : [];
    tiles.push({ id: "internet", href: pageHash("internet"), label: t.tabs.internet, value, unit, sub: since, tone: up ? "ok" : "bad", ...(samples.length > 1 ? { spark: { values: samples.map((p) => p[1]), min: 0, pts: samples, fmt: "rate" } } : {}) });
  } else tiles.push({ id: "internet", href: pageHash("internet"), label: t.tabs.internet, value: "–", unit: "", sub: o.noData, tone: "" });
  // devices: online of all, new and blocked ones
  const counts = panelCounts(data, now, state?.threshold);
  const extra = [counts.new ? fill(o.fresh, { n: counts.new }) : "", counts.blocked ? fill(o.blocked, { n: counts.blocked }) : ""].filter(Boolean);
  const clients = data.clients ?? [];
  const course = onlineCounts(state?.history, clients.map((c) => c.mac));
  const hourly = (values) => ({ values, ...spread(values), pts: values.map((v, i) => [Math.round(now / 1000) - (values.length - 1 - i) * 3600, v === null ? null : Math.round(v)]), unit: o.clients });
  tiles.push({ id: "net", href: pageHash("net"), label: t.tabs.netDevices, value: String(counts.online), unit: `/ ${counts.all}`, sub: [o.online, ...extra].join(" · "), tone: "", ...(course ? { spark: hourly(course) } : { bar: counts.all ? (counts.online / counts.all) * 100 : null }) });
  // Wi-Fi: devices on it, and the verdict of the radio check
  const wlan = clients.filter((c) => c.online && c.link_type === "wlan").length;
  const check = radioCheck(data);
  const wlanCourse = onlineCounts(state?.history, clients.filter((c) => c.link_type === "wlan").map((c) => c.mac));
  tiles.push({
    id: "wlan",
    href: pageHash("wlan"),
    label: t.tabs.wlan,
    value: String(wlan),
    unit: o.clients,
    sub: check.nodes.length ? (check.issues ? counted(o, "radioIssues", check.issues) : o.radioOk) : "",
    tone: check.nodes.length ? (check.issues ? "warn" : "ok") : "",
    ...(wlanCourse ? { spark: hourly(wlanCourse) } : {}),
  });
  // the box: up for how long, its load and temperature where it tells them
  const info = state?.box && typeof state.box === "object" ? state.box : null;
  const restarting = state?.boxRestart && state.boxRestart.phase !== "back";
  if (restarting) tiles.push({ id: "box", href: pageHash("box"), label: t.tabs.box, value: "–", unit: "", sub: t.boxPage.restarting, tone: "warn" });
  else {
    const uptime = info ? boxUptime(info, now) : null;
    const loads = info
      ? [
          typeof info.cpu_load === "number" ? fill(o.cpu, { n: info.cpu_load.toLocaleString(language || "en") }) : "",
          typeof info.cpu_temperature === "number" ? fill(o.temp, { n: info.cpu_temperature.toLocaleString(language || "en", { maximumFractionDigits: 0 }) }) : "",
        ].filter(Boolean)
      : [];
    const model = (data.nodes ?? []).find((n) => n.role === "master")?.model ?? "";
    const [value, unit] = uptime === null ? ["–", ""] : split(formatDuration(uptime, t.inet.units).split(" ").slice(0, 2).join(" "));
    tiles.push({ id: "box", href: pageHash("box"), label: t.tabs.box, value, unit, sub: loads.join(" · ") || model || o.notRead, tone: "", ...(Array.isArray(state?.boxSpark) && state.boxSpark.filter((p) => typeof p[1] === "number").length > 1 ? { spark: { values: state.boxSpark.map((p) => p[1]), min: 0, max: 100, pts: state.boxSpark, unit: "%" } } : { bar: typeof info?.cpu_load === "number" ? info.cpu_load : null }) });
  }
  // the phone: the calls of today by kind and the new messages; the missed ones where today is not known
  if (state?.phoneFound) {
    const missed = typeof state.phoneMissed === "number" ? state.phoneMissed : null;
    const unread = Number(state.phoneUnread) || 0;
    const today = state.phoneToday;
    const messages = unread ? counted(o, "messages", unread) : o.noMessages;
    // numbers the provider has not registered come first in the line below the value, and turn the dot red
    const lines = state.phoneLines;
    const down = lines?.down ?? [];
    const lineNote = down.length ? (down.length === 1 ? fill(o.lineDownOne, { number: lineNumber(down[0].number, lines) }) : fill(o.lineDownN, { n: down.length })) : "";
    if (today && typeof today.n === "number") {
      const parts = [
        { key: "in", n: today.in ?? 0 },
        { key: "out", n: today.out ?? 0 },
        { key: "miss", n: today.missed ?? 0 },
      ];
      tiles.push({
        id: "phone",
        href: pageHash("phone"),
        label: t.tabs.phone,
        value: String(today.n),
        unit: o.callsToday,
        sub: [lineNote, today.missed ? counted(o, "missedN", today.missed) : "", messages].filter(Boolean).join(" · "),
        tone: down.length ? "bad" : today.missed ? "warn" : "",
        seg: parts,
      });
    } else {
      tiles.push({ id: "phone", href: pageHash("phone"), label: t.tabs.phone, value: missed === null ? "–" : String(missed), unit: o.missed, sub: [lineNote, messages].filter(Boolean).join(" · "), tone: down.length ? "bad" : "" });
    }
  }
  return tiles;
}

const ISSUE_ICONS = { bad: "alert", warn: "alert", info: "info" };

function consumersHtml(state, t, language, now) {
  const o = t.overview.consumers;
  const days = [7, 30].includes(state?.ovTrafficDays) ? state.ovTrafficDays : 1;
  const buttons = [1, 7, 30].map((n) => `<button data-act="ov-traffic" data-ovdays="${n}" aria-pressed="${n === days}">${escapeHtml(t.trafficSwitch[n])}</button>`).join("");
  const head = `<div class="chead"><h2 class="label" id="ov-consumers">${escapeHtml(o.title)}</h2><div class="seg" role="group" aria-label="${escapeHtml(o.range)}">${buttons}</div></div>`;
  if (!state?.traffic) return `<section class="card sec" aria-labelledby="ov-consumers">${head}<p class="hint">${escapeHtml(t.loading)}</p></section>`;
  const rows = topConsumers(state.traffic, state.data?.clients, days, new Date(now));
  const top = rows[0]?.total || 1;
  const list = rows
    .map((r) => {
      const name = escapeHtml(r.name);
      const who = r.id ? `<a class="tlink" href="#/device/${escapeHtml(r.id)}">${name}</a>` : `<span>${name}</span>`;
      return `<li class="consumer"><span class="cn">${who}</span><span class="cv"><i class="vdn">↓</i> ${escapeHtml(formatBytes(r.down, language))} <i class="vup">↑</i> ${escapeHtml(formatBytes(r.up, language))}</span>
        <span class="cbar" aria-hidden="true"><i class="d" style="width:${((r.down / top) * 100).toFixed(1)}%"></i><i class="u" style="width:${((r.up / top) * 100).toFixed(1)}%"></i></span></li>`;
    })
    .join("");
  return `<section class="card sec" aria-labelledby="ov-consumers">${head}${list ? `<ul class="consumers">${list}</ul>` : `<p class="hint">${escapeHtml(o.none)}</p>`}<p class="more"><a class="tlink" href="${escapeHtml(pageHash("internet"))}">${escapeHtml(o.more)} ›</a></p></section>`;
}

const TODAY_ICONS = { internet: "globe", device: "network", box: "router", phone: "phone" };

/** The time of an event: the clock for today, the weekday with it for the day before. */
function eventClock(at, now, language) {
  const same = new Date(at).toDateString() === new Date(now).toDateString();
  return new Date(at).toLocaleString(language || undefined, same ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** The events of the last 24 hours as a timeline: the time, the mark of the kind, what happened; each leads to its page. */
function todayHtml(events, t, now, language) {
  const o = t.overview.today;
  const list = events.length
    ? `<ul class="timeline">${events
        .slice(0, 6)
        .map((e) => `<li><a class="tev ${escapeHtml(e.kind)}${e.bad ? " bad" : ""}" href="${escapeHtml(e.href)}"><time datetime="${new Date(e.at).toISOString()}">${escapeHtml(eventClock(e.at, now, language))}</time><span class="ic" aria-hidden="true">${ic(TODAY_ICONS[e.kind] ?? "info")}</span><span class="tx">${escapeHtml(e.text)}</span></a></li>`)
        .join("")}</ul>`
    : `<p class="hint">${escapeHtml(o.none)}</p>`;
  return `<div class="evsec" role="group" aria-labelledby="ov-today"><h3 class="label" id="ov-today">${escapeHtml(o.title)}</h3>${list}</div>`;
}

const TILE_ICONS = { internet: "globe", net: "network", box: "router", wlan: "wifi", phone: "phone" };

const SPARK = { width: 120, height: 34 };

/**
 * The course of a tile as a line over a faint area, drawn the size of the tile, with the points the
 * pointer reads like any chart of the panel (a tip with the time and the value); nothing for fewer
 * than two values.
 */
function sparkHtml(spark) {
  const path = spark ? sparkLine(spark.values, SPARK.width, SPARK.height, { min: spark.min, max: spark.max }) : null;
  if (!path) return "";
  const svg = `<svg class="tspark" viewBox="0 0 ${SPARK.width} ${SPARK.height}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="ta" d="${path.area}"/><path class="tl" d="${path.line}"/></svg>`;
  if (!spark.pts) return svg;
  return `<span class="plot tplot" data-pts="${escapeHtml(JSON.stringify(spark.pts))}" data-unit="${escapeHtml(spark.unit ?? "")}" data-fmt="${escapeHtml(spark.fmt ?? "")}" data-range="day">${svg}<i class="cursor" hidden></i><b class="tip" hidden></b></span>`;
}

/** The parts of a whole as one bar in segments, each as wide as its share. */
function segHtml(seg) {
  if (!Array.isArray(seg)) return "";
  const total = seg.reduce((n, p) => n + p.n, 0);
  if (!total) return `<span class="tseg none" aria-hidden="true"><i></i></span>`;
  return `<span class="tseg" aria-hidden="true">${seg.filter((p) => p.n > 0).map((p) => `<i class="${escapeHtml(p.key)}" style="flex:${p.n}"></i>`).join("")}</span>`;
}

function tileHtml(tile) {
  const dot = tile.tone ? `<i class="dot ${tile.tone === "ok" ? "on" : tile.tone}" aria-hidden="true"></i>` : "";
  const bar = typeof tile.bar === "number" ? `<span class="sbar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, tile.bar))}%"></i></span>` : "";
  const course = sparkHtml(tile.spark) || segHtml(tile.seg) || bar;
  return `<a class="stile t-${escapeHtml(tile.id)}" href="${escapeHtml(tile.href)}" data-k="ov-${tile.id}"><span class="sico" aria-hidden="true">${ic(TILE_ICONS[tile.id] ?? "info")}</span><span class="label">${escapeHtml(tile.label)}</span>
    <span class="v">${escapeHtml(tile.value)}${tile.unit ? `<small>${escapeHtml(tile.unit)}</small>` : ""}</span>${course}
    <span class="s">${dot}<span>${escapeHtml(tile.sub)}</span></span><span class="sgo" aria-hidden="true">${ic("chev")}</span></a>`;
}

function issueHtml(issue) {
  return `<li class="issue"><span class="ic ${issue.level}" aria-hidden="true">${ic(ISSUE_ICONS[issue.level])}</span>
    <span class="what"><b>${escapeHtml(issue.title)}</b>${issue.detail ? `<small>${escapeHtml(issue.detail)}</small>` : ""}</span>
    <a class="tlink" href="${escapeHtml(issue.href)}">${escapeHtml(issue.link)} ›</a></li>`;
}

/**
 * The page. ctx: t, language, now, canWrite (for reconnecting), and the panel state the tiles and
 * notes read (data, box, boxRestart, routes, ports, phone).
 */
export function renderOverview(state, ctx) {
  const { t } = ctx;
  const o = t.overview;
  const issues = collectIssues(state, t, ctx.now);
  const tiles = overviewTiles(state, t, ctx);
  const head = `<div class="phead"><div class="pheadrow"><h1 id="dtitle" tabindex="-1" class="sr">${escapeHtml(o.title)}</h1>
    <button class="btn" data-act="ov-refresh" data-k="ov-refresh"${ctx.busy ? " disabled" : ""}>${escapeHtml(o.refresh)}</button></div></div>`;
  const list = issues.length
    ? `<ul class="issues">${issues.map(issueHtml).join("")}</ul>`
    : `<p class="allgood"><span class="chip ok"><i class="dot on" aria-hidden="true"></i>${escapeHtml(o.allGood)}</span></p>`;
  const row = (icon, act, key, label, aria = "") => `<li><button class="qrow" data-act="${act}" data-k="${key}"${aria}><span class="ic" aria-hidden="true">${ic(icon)}</span><span class="qt">${escapeHtml(label)}</span><span class="qgo" aria-hidden="true">${ic("chev")}</span></button></li>`;
  const guest = state?.wlan && typeof state.wlan === "object" ? state.wlan.guest : null;
  const guestRow = guest
    ? `<li class="qrow qswitch"><span class="ic" aria-hidden="true">${ic("guest")}</span><span class="qt">${escapeHtml(o.quick.guest)}<small>${escapeHtml(guest.enabled ? o.quick.guestOn : o.quick.guestOff)}${guest.ssid ? ` · ${escapeHtml(guest.ssid)}` : ""}</small></span>
        <button class="switch${ctx.guestBusy ? " busy" : ""}" role="switch" aria-checked="${guest.enabled}" aria-label="${escapeHtml(o.quick.guest)}" data-act="wlan-switch" data-key="guest" data-on="${guest.enabled ? "0" : "1"}" data-k="ov-guest"${!ctx.canWrite || ctx.guestBusy ? " disabled" : ""}></button></li>`
    : "";
  const reconnect = ctx.canWrite && state?.data?.internet ? row("restart", "reconnect", "ov-reconnect", o.quick.reconnect, ' aria-haspopup="dialog"') : "";
  const rescan = row("search", "ov-rescan", "ov-rescan", o.quick.rescan, ctx.rescanBusy ? " disabled aria-busy=\"true\"" : "");
  // a box that restarts cannot be asked to do it again
  const reboot = ctx.canWrite && state?.boxRestart?.phase !== "down" ? row("unplug", "reboot", "ov-reboot", o.quick.reboot, ' aria-haspopup="dialog"') : "";
  const quick = `<section class="card sec"><h2 class="label">${escapeHtml(o.quickTitle)}</h2>
    <ul class="quick">${row("check", "ov-check", "ov-check", o.quick.check)}${rescan}${reconnect}${guestRow}${reboot}</ul></section>`;
  return `${head}
    <section class="tiles5" aria-label="${escapeHtml(o.tilesLabel)}">${tiles.map(tileHtml).join("")}</section>
    <div class="ovcols">
      <section class="card sec" aria-labelledby="ov-issues"><h2 class="label" id="ov-issues">${escapeHtml(o.issuesTitle)}${issues.length ? ` <span class="chip">${issues.length}</span>` : ""}</h2>${list}
        ${todayHtml(todayEvents(state, t, ctx.now ?? Date.now()), t, ctx.now ?? Date.now(), ctx.language)}</section>
      <div class="ovside">${consumersHtml(state, t, ctx.language, ctx.now ?? Date.now())}${quick}</div>
    </div>`;
}
