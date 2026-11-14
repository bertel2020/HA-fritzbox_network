/* The overview, the start page: a tile per area that leads to its page, what stands out on all pages in one list, and quick actions. */

import { NEW_DAYS, STALE_DAYS, escapeHtml, formatDuration, formatRate, pageHash, panelCounts } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { ON_WLAN, networkHints } from "./panel-hints.js";
import { internetHints } from "./panel-internet.js";
import { radioCheck, radioFindingText, utilizationLevel } from "./panel-radio.js";
import { routesModel } from "./panel-routes.js";
import { mergePortRules } from "./panel-ports.js";

const LEVELS = { bad: 0, warn: 1, info: 2 };

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
  }
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => LEVELS[a.issue.level] - LEVELS[b.issue.level] || a.i - b.i).map((x) => x.issue);
}

/**
 * The status tiles: [{ id, href, label, value, unit, sub, tone }] for Internet, Devices, Box, Wi-Fi
 * and, while FRITZ!Box Telefon is found, Phone. tone is the dot before the line below the value:
 * "ok", "warn", "bad" or "" for none.
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
    tiles.push({ id: "internet", href: pageHash("internet"), label: t.tabs.internet, value, unit, sub: since, tone: up ? "ok" : "bad" });
  } else tiles.push({ id: "internet", href: pageHash("internet"), label: t.tabs.internet, value: "–", unit: "", sub: o.noData, tone: "" });
  // devices: online of all, new and blocked ones
  const counts = panelCounts(data, now, state?.threshold);
  const extra = [counts.new ? fill(o.fresh, { n: counts.new }) : "", counts.blocked ? fill(o.blocked, { n: counts.blocked }) : ""].filter(Boolean);
  tiles.push({ id: "net", href: pageHash("net"), label: t.tabs.netDevices, value: String(counts.online), unit: `/ ${counts.all}`, sub: [o.online, ...extra].join(" · "), tone: "" });
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
    tiles.push({ id: "box", href: pageHash("box"), label: t.tabs.box, value, unit, sub: loads.join(" · ") || model || o.notRead, tone: "" });
  }
  // Wi-Fi: devices on it, and the verdict of the radio check
  const wlan = (data.clients ?? []).filter((c) => c.online && c.link_type === "wlan").length;
  const check = radioCheck(data);
  tiles.push({
    id: "wlan",
    href: pageHash("wlan"),
    label: t.tabs.wlan,
    value: String(wlan),
    unit: o.clients,
    sub: check.nodes.length ? (check.issues ? counted(o, "radioIssues", check.issues) : o.radioOk) : "",
    tone: check.nodes.length ? (check.issues ? "warn" : "ok") : "",
  });
  // the phone: missed calls today and new messages
  if (state?.phoneFound) {
    const missed = typeof state.phoneMissed === "number" ? state.phoneMissed : null;
    const unread = Number(state.phoneUnread) || 0;
    tiles.push({
      id: "phone",
      href: pageHash("phone"),
      label: t.tabs.phone,
      value: missed === null ? "–" : String(missed),
      unit: o.missed,
      sub: unread ? counted(o, "messages", unread) : o.noMessages,
      tone: "",
    });
  }
  return tiles;
}

const ISSUE_ICONS = { bad: "alert", warn: "alert", info: "info" };

function tileHtml(tile) {
  const dot = tile.tone ? `<i class="dot ${tile.tone === "ok" ? "on" : tile.tone}" aria-hidden="true"></i>` : "";
  return `<a class="stile" href="${escapeHtml(tile.href)}" data-k="ov-${tile.id}"><span class="label">${escapeHtml(tile.label)}</span>
    <span class="v">${escapeHtml(tile.value)}${tile.unit ? `<small>${escapeHtml(tile.unit)}</small>` : ""}</span>
    <span class="s">${dot}<span>${escapeHtml(tile.sub)}</span></span></a>`;
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
  const head = `<div class="phead"><div class="pheadrow"><h1 id="dtitle" tabindex="-1">${escapeHtml(o.title)}</h1>
    <button class="btn" data-act="ov-refresh" data-k="ov-refresh"${ctx.busy ? " disabled" : ""}>${escapeHtml(o.refresh)}</button></div>
    <p class="lead">${escapeHtml(o.lead)}</p></div>`;
  const list = issues.length
    ? `<ul class="issues">${issues.map(issueHtml).join("")}</ul>`
    : `<p class="allgood"><span class="chip ok"><i class="dot on" aria-hidden="true"></i>${escapeHtml(o.allGood)}</span></p>`;
  const reconnect = ctx.canWrite && state?.data?.internet
    ? `<button class="btn" data-act="reconnect" data-k="ov-reconnect" aria-haspopup="dialog">${escapeHtml(o.quick.reconnect)}</button>`
    : "";
  const quick = `<section class="card sec"><h2 class="label">${escapeHtml(o.quickTitle)}</h2>
    <div class="quick">
      <button class="btn" data-act="ov-check" data-k="ov-check">${escapeHtml(o.quick.check)}</button>
      ${reconnect}
      <a class="btn" href="${pageHash("wlan")}" data-k="ov-guest">${escapeHtml(o.quick.guest)}</a>
      <a class="btn" href="${pageHash("capture")}" data-k="ov-capture">${escapeHtml(o.quick.capture)}</a>
    </div></section>`;
  return `${head}
    <section class="tiles5" aria-label="${escapeHtml(o.tilesLabel)}">${tiles.map(tileHtml).join("")}</section>
    <div class="ovcols">
      <section class="card sec" aria-labelledby="ov-issues"><h2 class="label" id="ov-issues">${escapeHtml(o.issuesTitle)}${issues.length ? ` <span class="chip">${issues.length}</span>` : ""}</h2>${list}</section>
      ${quick}
    </div>`;
}
