/*
 * The page Box › Phone: calls, answering machines, phone books, block list and statistics of the
 * integration FRITZ!Box Telefon (fritzbox_phone). It reads what that integration answers to its
 * websocket commands, or its entities with an older version without them (phone-model.js), and
 * calls its services from the panel; it never talks to the box itself.
 */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { BOOK_ROWS, CALL_FILTERS, digits, HISTORY_PERIODS, PERIODS, PERIOD_DAYS, SERIES, callKind, dialable, displayName, filterCalls, filterCounts, foldHeat, heatGrid, isOutgoing, onBlocklist, phoneStats, searchBook, shortNumber, wsStats } from "./phone-model.js";

const esc = escapeHtml;
const KIND_ICON = { in: "callIn", out: "callOut", miss: "callMissed", spam: "shield", tam: "tam" };

/** Minutes as "12 Min." or "1 Std. 5 Min.". */
export function fmtMinutes(n, t) {
  const m = Math.max(0, Math.round(n || 0));
  return m >= 60 ? fill(t.phone.hoursMinutes, { h: Math.floor(m / 60), m: m % 60 }) : fill(t.phone.minutes, { n: m });
}

/** Seconds as "0:38". */
export const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;

const hhmm = (d, language) => d.toLocaleTimeString(language || "en", { hour: "2-digit", minute: "2-digit" });

/** "Today", "Yesterday", or the weekday and date; "Without a date" where the box wrote none we can read. */
export function dayLabel(d, now, t, language) {
  const c = t.phone.calls;
  if (!d) return c.noDate;
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff === 0) return c.today;
  if (diff === -1) return c.yesterday;
  return d.toLocaleDateString(language || "en", { weekday: "long", day: "numeric", month: "long" });
}

const masked = (ui, privacy, key) => privacy && !ui.revealed?.has(key);
const hiddenName = (t) => `<span class="ph-masked" aria-hidden="true">••••••</span><span class="sr">${esc(t.phone.privacy.hidden)}</span>`;
const ratingText = (code, t) => (code ? t.phone.rating[code] ?? code : "");

/** Actions are locked while the box is away (the page shows the last state) or where a field is missing. */
const off = (model, extra = false) => (model.offline || extra ? " disabled" : "");

// ---------- head, notices, live band ----------

function sourceLine(model, ctx) {
  const { t } = ctx;
  const p = t.phone;
  const { pick, entry, monitor } = model;
  const entryText =
    pick.how === "choose"
      ? `<label class="sr" for="ph-entry">${esc(p.chooseEntry)}</label><select id="ph-entry" class="ph-entry" data-k="ph-entry">${pick.entries
          .map((e) => `<option value="${esc(e.key)}"${e.key === entry.key ? " selected" : ""}>${esc(e.title || e.key)}</option>`)
          .join("")}</select>`
      : `${esc(fill(p.entry, { title: entry.title || "–" }))}${pick.how === "only" ? ` <span class="chip warn" title="${esc(p.otherBoxHint)}">${esc(p.otherBox)}</span>` : ""}`;
  const mon = !monitor.present
    ? `<span class="chip">${esc(p.monitorNone)}</span>`
    : monitor.connected
      ? `<span class="chip ok"><i class="dot on" aria-hidden="true"></i>${esc(p.monitorOn)}</span>`
      : `<span class="chip warn"><i class="dot warn" aria-hidden="true"></i>${esc(p.monitorOff)}</span>`;
  return `<p class="ph-src">${esc(p.source)} · ${entryText} · ${esc(p.monitor)} ${mon} · <a href="/config/integrations/integration/fritzbox_phone" data-act="integration" data-k="ph-int">${esc(p.openIntegration)}</a></p>`;
}

/** Seconds since an ISO time, as m:ss (with hours from one hour on); "" when the time is unknown. */
export function sinceText(iso, now = new Date()) {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(ms)) return "";
  const sec = Math.max(0, Math.floor((now.getTime() - ms) / 1000));
  const h = Math.floor(sec / 3600);
  const rest = sec % 3600;
  return `${h ? `${h}:` : ""}${String(Math.floor(rest / 60)).padStart(h ? 2 : 1, "0")}:${String(rest % 60).padStart(2, "0")}`;
}

/** The running call as a card of its own: who, how long, where it stands, what can be done. */
export function liveCard(model, ctx) {
  const { t, ui, now } = ctx;
  const l = t.phone.live;
  const m = model.monitor;
  const ownDial = ui.dial && now.getTime() - ui.dial.at < 90000 ? ui.dial : null;
  const talking = m.state === "talking";
  const ringing = m.state === "ringing";
  const dialing = m.state === "dialing" || (!ringing && !talking && Boolean(ownDial));
  if (!ringing && !talking && !dialing) return "";
  const spamText = m.isSpam ? fill(l.spam, { p: m.spamConfidence ?? "–" }) + (m.spamRating ? ` (${ratingText(m.spamRating, t)})` : "") : "";
  let name;
  let number;
  let since;
  let sinceLabel;
  let step;
  let head;
  let tone;
  let icon;
  const info = [];
  const acts = [];
  if (ringing) {
    name = m.fromName || m.from || t.phone.calls.unknown;
    number = m.fromName ? m.from : "";
    since = m.initiated;
    sinceLabel = l.ringingFor;
    step = 0;
    head = m.isSpam ? l.headSpam : l.headIn;
    tone = m.isSpam ? "spam" : "ring";
    icon = "phone";
    if (m.to) info.push([l.called, m.to]);
    if (m.area) info.push([l.place, m.area]);
    if (spamText) info.push([l.rating, spamText]);
    if (m.from && dialable(m.from)) acts.push(`<button class="btn sm" data-act="ph-block" data-ph-num="${esc(m.from)}" data-ph-name="${esc(m.fromName)}" data-k="ph-live-block"${off(model)}>${ic("ban")}${esc(l.block)}</button>`);
    if (m.from && dialable(m.from) && !m.fromName) acts.push(`<button class="btn sm" data-act="ph-contact" data-ph-num="${esc(m.from)}" data-ph-name="" data-k="ph-live-contact" aria-haspopup="dialog"${off(model)}>${ic("userPlus")}${esc(t.phone.calls.addContact)}</button>`);
  } else if (talking) {
    name = m.withName || m.with || t.phone.calls.unknown;
    number = m.withName ? m.with : "";
    since = m.accepted || m.initiated;
    sinceLabel = l.talkFor;
    step = 1;
    head = l.headTalk;
    tone = "talk";
    icon = "phone";
    if (m.device) info.push([l.device, m.device]);
    if (m.to) info.push([l.called, m.to]);
    if (m.initiated && m.accepted) {
      const wait = Math.max(0, Math.round((new Date(m.accepted).getTime() - new Date(m.initiated).getTime()) / 1000));
      if (Number.isFinite(wait)) info.push([l.acceptedAfter, mmss(wait)]);
    }
    if (m.with && dialable(m.with)) acts.push(`<button class="btn sm" data-act="ph-block" data-ph-num="${esc(m.with)}" data-ph-name="${esc(m.withName)}" data-k="ph-live-block"${off(model)}>${ic("ban")}${esc(l.blockNumber)}</button>`);
  } else {
    const number0 = m.state === "dialing" ? m.to || ownDial?.number || "" : ownDial.number;
    name = (m.state === "dialing" ? m.toName : "") || ownDial?.name || number0;
    number = name !== number0 ? number0 : "";
    since = m.state === "dialing" ? m.initiated : new Date(ownDial.at).toISOString();
    sinceLabel = l.waitingFor;
    step = 0;
    head = ownDial ? l.headHelper : l.headOut;
    tone = "ring";
    icon = "callOut";
    info.push(ownDial ? [l.process, fill(l.helperBody, { number: number0 })] : [l.device, m.device].filter(Boolean));
    if (ownDial) acts.push(`<button class="btn sm" data-act="ph-hangup" data-k="ph-hangup">${esc(l.cancelDial)}</button>`);
  }
  const steps = [dialing ? l.stepPick : l.stepRing, l.stepTalk, l.stepEnd]
    .map((x, i) => `<li class="${i < step ? "dn" : i === step ? "cur" : ""}"><i aria-hidden="true"></i>${esc(x)}</li>`)
    .join("");
  const tags = [
    talking ? `<span class="chip ok"><i class="dot on" aria-hidden="true"></i>${esc(l.running)}</span>` : "",
    m.isSpam ? `<span class="chip bad">${esc(spamText)}</span>` : "",
  ].join("");
  const star = m.vip ? ` ${ic("star")}<span class="sr">${esc(t.phone.calls.vip)}</span>` : "";
  const initial = ringing && !m.fromName ? ic(icon) : esc([...name][0]?.toUpperCase() ?? "?");
  const infoHtml = info.filter((x) => x.length > 1 && x[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  return `<section class="card ph-now ${tone}" role="status" aria-live="${m.isSpam ? "assertive" : "polite"}" aria-label="${esc(l.label)}">
    <div class="ph-now-head"><span><i class="dot pulse" aria-hidden="true"></i>${esc(l.title)}</span><span>${esc(head)}</span></div>
    <div class="ph-now-body">
      <span class="ph-av${ringing ? " ring" : ""}">${initial}</span>
      <div class="ph-who"><b>${esc(name)}${star}</b>${number ? `<span class="ph-whonum">${esc(number)}</span>` : ""}${tags ? `<div class="ph-tags">${tags}</div>` : ""}</div>
      <div class="ph-timer"><b data-ph-since="${esc(since ?? "")}">${esc(sinceText(since, now) || "–")}</b><small>${esc(sinceLabel)}</small></div>
    </div>
    <ol class="ph-steps" aria-label="${esc(l.steps)}">${steps}</ol>
    ${infoHtml ? `<dl class="ph-now-info">${infoHtml}</dl>` : ""}
    ${acts.length ? `<div class="ph-now-act">${acts.join("")}</div>` : ""}</section>`;
}

/** The row for the running call at the top of the call list. */
function liveRow(model, ctx) {
  const { t, now } = ctx;
  const l = t.phone.live;
  const m = model.monitor;
  const talking = m.state === "talking";
  if (!talking && m.state !== "ringing" && m.state !== "dialing") return "";
  const dial = m.state === "dialing";
  const name = (talking ? m.withName || m.with : dial ? m.toName || m.to : m.fromName || m.from) || t.phone.calls.unknown;
  const sub = [talking ? l.talkingShort : dial ? l.dialingShort : l.ringingShort, talking ? m.device : m.area].filter(Boolean).join(" · ");
  const since = talking ? m.accepted || m.initiated : m.initiated;
  return `<div class="ph-row ph-livrow${talking ? " talk" : ""}"><div class="ph-line"><span class="ph-ico ${talking ? "in" : "tam"}">${ic(dial ? "callOut" : "phone")}</span><div class="ph-main"><b>${esc(name)}</b><small>${esc(sub)}</small></div><span class="ph-livtime" data-ph-since="${esc(since ?? "")}">${esc(sinceText(since, now) || "–")}</span></div></div>`;
}

/** The band of the call monitor: ringing, dialling, talking; nothing while idle. Never masked. */
export function liveBand(model, ctx) {
  const { t, ui, language, now } = ctx;
  const l = t.phone.live;
  const m = model.monitor;
  const ownDial = ui.dial && now.getTime() - ui.dial.at < 90000 ? ui.dial : null;
  const time = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : hhmm(d, language);
  };
  if (m.state === "ringing") {
    const name = m.fromName || m.from || t.phone.calls.unknown;
    const parts = [
      m.fromName && m.from ? m.from : "",
      m.area,
      m.isSpam ? fill(l.spam, { p: m.spamConfidence ?? "–" }) + (m.spamRating ? ` (${ratingText(m.spamRating, t)})` : "") : "",
      m.to ? fill(l.to, { number: m.to }) : "",
      m.initiated ? fill(l.since, { time: time(m.initiated) }) : "",
    ].filter(Boolean);
    const block = m.from && dialable(m.from) ? `<button class="btn sm" data-act="ph-block" data-ph-num="${esc(m.from)}" data-ph-name="${esc(m.fromName)}" data-k="ph-live-block"${off(model)}>${ic("ban")}${esc(l.block)}</button>` : "";
    return `<section class="ph-live${m.isSpam ? " spam" : ""}" role="status" aria-live="assertive" aria-label="${esc(l.label)}">
      <span class="ico ring">${ic("phone")}</span>
      <div><b>${esc(fill(l.ringing, { name }))}${m.vip ? ` ${ic("star")}<span class="sr">${esc(t.phone.calls.vip)}</span>` : ""}</b><small>${esc(parts.join(" · "))}</small></div>${block}</section>`;
  }
  if (m.state === "talking") {
    const name = m.withName || m.with || t.phone.calls.unknown;
    const parts = [m.withName && m.with ? m.with : "", m.device, m.accepted ? fill(l.since, { time: time(m.accepted) }) : ""].filter(Boolean);
    return `<section class="ph-live talk" role="status" aria-live="polite" aria-label="${esc(l.label)}">
      <span class="ico">${ic("phone")}</span>
      <div><b>${esc(fill(l.talking, { name }))}${m.vip ? ` ${ic("star")}<span class="sr">${esc(t.phone.calls.vip)}</span>` : ""}</b><small>${esc(parts.join(" · "))}</small></div>
      <span class="ph-bartime" data-ph-since="${esc(m.accepted || m.initiated || "")}">${esc(sinceText(m.accepted || m.initiated, now))}</span></section>`;
  }
  if (m.state === "dialing" || ownDial) {
    const number = m.state === "dialing" ? m.to || ownDial?.number || "" : ownDial.number;
    const name = (m.state === "dialing" ? m.toName : "") || ownDial?.name || number;
    const cancel = ownDial ? `<button class="btn sm" data-act="ph-hangup" data-k="ph-hangup">${esc(l.cancelDial)}</button>` : "";
    return `<section class="ph-live" role="status" aria-live="polite" aria-label="${esc(l.label)}">
      <span class="ico ring">${ic("callOut")}</span>
      <div><b>${esc(fill(ownDial ? l.helper : l.dialing, { name }))}</b><small>${esc(ownDial ? fill(l.helperBody, { number }) : [m.device].filter(Boolean).join(" · "))}</small></div>${cancel}</section>`;
  }
  return "";
}

function notices(model, ctx) {
  const { t, ui } = ctx;
  const p = t.phone;
  const out = [];
  if (model.privacy) out.push(["info", "eye", p.privacy.notice]);
  if (ui.rights) out.push(["warn", "alert", `${fill(p.rights.refused, { error: ui.rights })} ${p.rights.needed}`]);
  if (model.pick.how === "only") out.push(["info", "help", p.otherBoxHint]);
  if (model.pick.how === "choose") out.push(["info", "help", p.chooseHint]);
  if (!out.length) return "";
  return `<section class="card sec ph-notes">${out.map(([l, icon, text]) => `<p class="hintline ${l}"><span aria-hidden="true">${ic(icon)}</span><span>${esc(text)}</span></p>`).join("")}</section>`;
}

function staleNote(model, ctx) {
  if (!model.offline) return "";
  const time = model.staleAt ? hhmm(new Date(model.staleAt), ctx.language) : "–";
  return `<div class="ph-stale" role="status">${ic("unplug")}<span>${esc(fill(ctx.t.phone.stale, { time }))}</span></div>`;
}

// ---------- today ----------

function todayCard(model, ctx) {
  const { t } = ctx;
  const d = t.phone.today;
  const na = `<b class="na">${esc(t.phone.part)}</b>`;
  const tile = (label, value, small = "", cls = "") => `<div class="tile${cls ? ` ${cls}` : ""}"><span class="label">${esc(label)}</span>${value}${small ? `<small>${esc(small)}</small>` : ""}</div>`;
  const c = model.today.calls;
  const tiles = [
    c && c.n !== null ? tile(d.calls, `<b>${c.n}</b>`, c.in !== null && c.out !== null ? fill(d.inOut, { in: c.in, out: c.out }) : "") : tile(d.calls, na),
    c && c.missed !== null ? tile(d.missed, `<b>${c.missed}</b>`, c.missed ? d.missedHint : d.allAnswered, c.missed ? "bad" : "") : tile(d.missed, na),
    model.today.talk !== null ? tile(d.talk, `<b>${esc(fmtMinutes(model.today.talk, t))}</b>`, d.talkHint) : tile(d.talk, na),
    model.today.hasSpam
      ? tile(d.spam, model.today.spamToday !== null ? `<b>${model.today.spamToday}</b>` : na, model.today.spamTotal !== null ? fill(d.spamTotal, { n: model.today.spamTotal }) : "")
      : "",
  ].join("");
  return `<section class="card sec" aria-labelledby="ph-today-h"><div class="ph-chead"><span class="label" id="ph-today-h">${esc(d.title)}</span><span class="ph-src">${esc(d.window)}</span></div><div class="tiles">${tiles}</div></section>`;
}

// ---------- call list ----------

function callRow(c, model, ctx) {
  const { t, ui, language } = ctx;
  const p = t.phone;
  const key = `c:${c.id}`;
  const kind = callKind(c);
  const hide = masked(ui, model.privacy, key);
  const open = ui.expanded?.has(key) && !hide;
  const out = isOutgoing(c.type);
  const name = displayName(c) || p.calls.unknown;
  const action = out ? p.calls.redial : p.calls.callback;
  const canDial = dialable(c.number);
  const blocked = ui.blocked?.has(c.number) || onBlocklist(model.blocked, c.number);
  const canUnblock = blocked && onBlocklist(model.blocked, c.number);
  const chips = [
    c.vip ? `${ic("star")}<span class="sr">${esc(p.calls.vip)}</span>` : "",
    c.isSpam ? `<span class="chip bad">${esc(c.spamConfidence !== null ? fill(p.calls.spamChip, { p: c.spamConfidence }) : p.calls.filters.spam)}</span>` : "",
    blocked ? `<span class="chip">${esc(p.calls.blocked)}</span>` : "",
    c.isTam ? `<span class="chip ph-tamchip">${esc(p.calls.tam)}</span>` : "",
  ].join("");
  const meta = [
    c.date ? hhmm(c.date, language) : c.dateText,
    p.calls.type[c.type],
    hide ? "" : c.area,
    c.device && !c.isTam ? c.device : "",
    c.minutes && c.type !== "missed" ? fmtMinutes(c.minutes, t) : "",
  ].filter(Boolean).join(" · ");
  const dialBtn = canDial && !hide
    ? `<button class="icon-btn ph-call" data-act="ph-dial" data-ph-num="${esc(c.number)}" data-ph-name="${esc(c.name)}" data-k="ph-cd-${esc(c.id)}" aria-label="${esc(fill(p.calls.callLabel, { action, name }))}"${off(model)}>${ic("phone")}</button>`
    : "";
  const tamHas = c.isTam && c.tamIndex !== null && c.tamMessageIndex !== null && model.tams.some((x) => x.tamIndex === c.tamIndex);
  const detail = open
    ? `<div class="ph-detail" id="ph-d-${esc(c.id)}">
        <dl class="kv">
          ${c.number ? `<dt>${esc(p.calls.number)}</dt><dd class="mono">${esc(c.number)}</dd>` : ""}
          ${c.own ? `<dt>${esc(out ? p.calls.ownFrom : p.calls.ownTo)}</dt><dd class="mono">${esc(c.own)}</dd>` : ""}
          ${c.device ? `<dt>${esc(p.calls.device)}</dt><dd>${esc(c.device)}</dd>` : ""}
          ${c.durationText ? `<dt>${esc(p.calls.duration)}</dt><dd>${esc(fmtMinutes(c.minutes, t))}</dd>` : ""}
          ${c.spamRating || c.spamConfidence !== null ? `<dt>${esc(p.calls.phoneblock)}</dt><dd>${esc([ratingText(c.spamRating, t), c.spamConfidence !== null ? `${c.spamConfidence} %` : "", c.spamLocation].filter(Boolean).join(", "))}</dd>` : ""}
          ${c.reverseName ? `<dt>${esc(p.calls.reverse)}</dt><dd>${esc(fill(p.calls.reverseValue, { name: c.reverseName, category: c.reverseCategory || "–" }))}</dd>` : ""}
        </dl>
        <div class="btn-row">
          ${canDial ? `<button class="btn sm pri" data-act="ph-dial" data-ph-num="${esc(c.number)}" data-ph-name="${esc(c.name)}" data-k="ph-cdd-${esc(c.id)}"${off(model)}>${ic("phone")}${esc(action)}</button>` : ""}
          ${!c.name && canDial ? `<button class="btn sm" data-act="ph-contact" data-ph-num="${esc(c.number)}" data-ph-name="${esc(c.reverseName)}" data-k="ph-cc-${esc(c.id)}" aria-haspopup="dialog"${off(model)}>${ic("userPlus")}${esc(p.calls.addContact)}</button>` : ""}
          ${canDial ? `<button class="btn sm" data-act="ph-lookup" data-ph-num="${esc(c.number)}" data-k="ph-cl-${esc(c.id)}" aria-haspopup="dialog"${off(model)}>${ic("search")}${esc(p.calls.lookup)}</button>` : ""}
          ${canUnblock ? `<button class="btn sm" data-act="ph-unblock" data-ph-num="${esc(c.number)}" data-k="ph-cu-${esc(c.id)}" aria-haspopup="dialog"${off(model)}>${ic("ban")}${esc(p.calls.unblock)}</button>` : ""}
          ${canDial && !blocked ? `<button class="btn sm d" data-act="ph-block" data-ph-num="${esc(c.number)}" data-ph-name="${esc(c.name || c.reverseName)}" data-k="ph-cb-${esc(c.id)}" aria-haspopup="dialog"${off(model)}>${ic("ban")}${esc(p.calls.block)}</button>` : ""}
          ${tamHas ? `<button class="btn sm" data-act="ph-jump" data-ph-tam="${c.tamIndex}" data-ph-idx="${c.tamMessageIndex}" data-k="ph-cj-${esc(c.id)}">${ic("tam")}${esc(p.calls.toMessage)}</button>` : ""}
        </div></div>`
    : "";
  return `<div class="ph-row ${kind}">
    <div class="ph-line"><span class="ph-ico ${kind}" title="${esc(p.calls.type[c.type])}">${ic(KIND_ICON[kind])}</span>
      <button class="ph-main" data-act="ph-row" data-ph-key="${esc(key)}" data-k="ph-r-${esc(key)}" aria-expanded="${open}" aria-controls="ph-d-${esc(c.id)}"${hide ? ` aria-label="${esc(p.privacy.hidden)}"` : ""}>
        <span class="ph-name"><span>${hide ? hiddenName(t) : esc(name)}</span>${hide ? "" : chips}</span>
        <span class="ph-meta">${esc(meta)}</span></button>
      <span class="ph-act">${dialBtn}<span class="ph-chev" aria-hidden="true">${ic("chev")}</span></span></div>${detail}</div>`;
}

function callCard(model, ctx) {
  const { t, ui, now, language } = ctx;
  const p = t.phone;
  const head = `<div class="ph-chead"><span class="label" id="ph-calls-h">${esc(p.calls.title)}</span><button class="btn sm p" data-act="ph-dial" data-k="ph-dialopen" aria-haspopup="dialog"${off(model)}>${ic("phone")}${esc(p.calls.dial)}</button></div>`;
  if (!model.list.ok) {
    const why = model.api === "ws" ? p.part : fill(p.tooOld, { attr: "calls" });
    return `<section class="card sec" aria-labelledby="ph-calls-h">${head}<div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${esc(why)}</b></div></section>`;
  }
  const all = model.list.calls;
  if (!all.length) {
    return `<section class="card sec" aria-labelledby="ph-calls-h">${head}${staleNote(model, ctx)}<div class="empty">${ic("phone")}<b>${esc(p.calls.none)}</b><span>${esc(p.calls.noneBody)}</span></div></section>`;
  }
  // the chip "blocked" only where the box's block list is known
  const isBlocked = model.blocked?.ok && model.blocked.supported ? (n) => onBlocklist(model.blocked, n) || Boolean(ui.blocked?.has(n)) : null;
  const filters = isBlocked ? [...CALL_FILTERS, "blocked"] : CALL_FILTERS;
  const filter = filters.includes(ui.filter) ? ui.filter : "all";
  const counts = filterCounts(all, isBlocked);
  const list = filterCalls(all, filter, ui.query, isBlocked);
  let rows = "";
  let last = null;
  for (const c of list) {
    const label = dayLabel(c.date, now, t, language);
    if (label !== last) {
      rows += `<div class="ph-day" role="heading" aria-level="3">${esc(label)}</div>`;
      last = label;
    }
    rows += callRow(c, model, ctx);
  }
  if (!list.length) rows = `<div class="empty"><b>${esc(p.calls.noMatch)}</b><button class="btn sm" data-act="ph-reset" data-k="ph-reset">${esc(p.calls.reset)}</button></div>`;
  const legend = ["in", "out", "miss", "tam", "spam"].map((k) => `<span><span class="ph-ico ${k} sm">${ic(KIND_ICON[k])}</span>${esc(p.calls.legend[k])}</span>`).join("");
  return `<section class="card sec" aria-labelledby="ph-calls-h">${head}${staleNote(model, ctx)}
    <div class="ph-tools">
      <span class="seg ph-seg" role="group" aria-label="${esc(p.calls.filterLabel)}">${filters.map((f) => `<button data-act="ph-filter" data-ph-val="${f}" data-k="ph-f-${f}" aria-pressed="${filter === f}">${esc(p.calls.filters[f])}<span class="n">${counts[f]}</span></button>`).join("")}</span>
      <label class="search ph-search"><span class="sr">${esc(p.calls.searchLabel)}</span>${ic("search")}<input type="search" id="ph-q" value="${esc(ui.query)}" placeholder="${esc(p.calls.search)}" autocomplete="off"></label>
    </div>
    <p class="sr" role="status">${esc(fill(p.calls.shown, { n: list.length, total: all.length }))}</p>
    <div class="ph-rows">${ui.query || filter === "spam" || filter === "missed" || filter === "blocked" ? "" : liveRow(model, ctx)}${rows}</div>
    <div class="ph-legend" aria-hidden="true">${legend}</div>
    <p class="hint">${esc(callHint(model, all.length, t))}</p></section>`;
}

/** What the list holds: with the commands the real window of fritzbox_phone, else only the count. */
function callHint(model, n, t) {
  const w = model.list.window;
  if (model.api !== "ws" || !w) return fill(t.phone.calls.hint, { n });
  if (w.source === "history") return fill(t.phone.calls.windowHistory, { n, days: w.days || "–" });
  if (w.days && w.max) return fill(t.phone.calls.windowHint, { n, days: w.days, max: w.max });
  return fill(t.phone.calls.hint, { n });
}

// ---------- answering machines ----------

function playerRow(msg, tam, ctx) {
  const { t, ui } = ctx;
  const play = ui.play;
  const total = play.total || 0;
  const pos = play.pos || 0;
  return `<div class="ph-player"><span class="t" id="ph-pt">${mmss(pos)}</span>
    <input type="range" id="ph-seek" min="0" max="${Math.max(1, Math.round(total))}" value="${Math.floor(pos)}" aria-label="${esc(t.phone.tam.seek)}" aria-valuetext="${esc(fill(t.phone.tam.seekText, { pos: mmss(pos), total: mmss(total) }))}">
    <span class="t" id="ph-ptotal">${mmss(total)}</span></div>`;
}

function messageRow(msg, tam, model, ctx) {
  const { t, ui, now, language } = ctx;
  const a = t.phone.tam;
  const key = `m:${tam.entityId}:${msg.index}`;
  const hide = masked(ui, model.privacy, key);
  const name = msg.name || msg.reverseName || msg.number || t.phone.calls.unknown;
  const playing = ui.play && ui.play.entityId === tam.entityId && ui.play.index === msg.index;
  const sounding = playing && !ui.play.paused;
  const when = msg.date ? `${dayLabel(msg.date, now, t, language)}, ${hhmm(msg.date, language)}` : msg.dateText;
  const meta = [when, msg.duration, hide ? "" : msg.area].filter(Boolean).join(" · ");
  const usableIdx = msg.index !== null && tam.target !== false;
  const playBtn = msg.hasRecording
    ? `<button class="icon-btn" data-act="ph-play" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-p-${esc(key)}" aria-pressed="${Boolean(sounding)}" aria-label="${esc(sounding ? a.pause : a.play)}"${off(model, !usableIdx)}>${ic(sounding ? "pause" : "play")}</button>`
    : `<span class="ph-norec">${esc(a.noRecording)}</span>`;
  const mainAct = hide ? "ph-row" : msg.hasRecording ? "ph-play" : "ph-open";
  const open = !hide && (playing || ui.expanded?.has(key));
  const btns = open
    ? `<div class="ph-detail">${playing ? playerRow(msg, tam, ctx) : ""}
        <div class="btn-row">
          ${msg.hasRecording ? `<button class="btn sm" data-act="ph-speaker" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-ms-${esc(key)}" aria-haspopup="dialog"${off(model, !usableIdx)}>${ic("speaker")}${esc(a.speaker)}</button>
          <button class="btn sm" data-act="ph-download" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-md-${esc(key)}"${off(model, !usableIdx)}>${ic("download")}${esc(a.download)}</button>` : ""}
          <button class="btn sm" data-act="ph-mark" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-mm-${esc(key)}"${off(model, !usableIdx)}>${ic("mail")}${esc(msg.isNew ? a.markRead : a.markUnread)}</button>
          ${!msg.inPhonebook && dialable(msg.number) ? `<button class="btn sm" data-act="ph-contact" data-ph-num="${esc(msg.number)}" data-ph-name="${esc(msg.reverseName)}" data-k="ph-mc-${esc(key)}" aria-haspopup="dialog"${off(model)}>${ic("userPlus")}${esc(t.phone.calls.addContact)}</button>` : ""}
          <button class="btn sm d" data-act="ph-delete" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-mx-${esc(key)}" aria-haspopup="dialog"${off(model, !usableIdx)}>${ic("trash")}${esc(a.delete)}</button>
        </div></div>`
    : "";
  return `<div class="ph-row ph-msg${msg.isNew ? " new" : ""}" id="ph-msg-${tam.tamIndex ?? "x"}-${msg.index}">
    <div class="ph-line"><span class="ph-ico tam">${msg.isNew ? '<i class="dot ph-new" aria-hidden="true"></i>' : ic("tam")}</span>
      <button class="ph-main" data-act="${mainAct}" data-ph-key="${esc(key)}" data-ph-ent="${esc(tam.entityId)}" data-ph-idx="${msg.index}" data-k="ph-r-${esc(key)}" aria-expanded="${Boolean(open)}" aria-label="${esc(hide ? a.hidden : fill(a.playLabel, { action: sounding ? a.pause : a.play, name, duration: msg.duration || "–" }))}">
        <span class="ph-name"><span>${hide ? hiddenName(t) : esc(name)}</span>${msg.isNew ? `<span class="chip info">${esc(a.newChip)}</span>` : ""}</span>
        <span class="ph-meta">${esc(meta)}</span></button>
      <span class="ph-act">${hide ? "" : playBtn}</span></div>${btns}</div>`;
}

function tamCard(tam, model, ctx) {
  const { t, ui } = ctx;
  const a = t.phone.tam;
  if (tam.loading) return `<section class="card sec" aria-busy="true"><div class="ph-chead"><span class="label">${esc(a.title)}</span></div><p class="hint">${esc(t.loading)}</p></section>`;
  if (!tam.ok) return `<section class="card sec"><div class="ph-chead"><span class="label">${esc(tam.name)}</span></div><p class="hint">${esc(tam.offline || model.api === "ws" ? t.phone.part : fill(t.phone.tooOld, { attr: "messages" }))}</p></section>`;
  const newCount = tam.messages.filter((m) => m.isNew).length;
  const busy = ui.busy?.has(tam.switchId);
  const sw = tam.switchId && tam.switchOn !== null
    ? `<button class="switch${busy ? " busy" : ""}" role="switch" aria-checked="${tam.switchOn}" aria-label="${esc(fill(a.switchLabel, { name: tam.name }))}" data-act="ph-tamsw" data-ph-ent="${esc(tam.switchId)}" data-ph-val="${tam.switchOn ? "0" : "1"}" data-ph-name="${esc(tam.name)}" data-k="ph-sw-${esc(tam.switchId)}"${off(model, busy || tam.offline)}></button>`
    : "";
  const enabled = tam.switchOn ?? tam.enabled;
  const facts = [enabled === null ? "" : enabled ? a.on : a.off, tam.capacity !== null ? fill(a.capacity, { n: tam.capacity }) : "", a.playHint].filter(Boolean).join(" · ");
  const rows = tam.messages.length ? tam.messages.map((m) => messageRow(m, tam, model, ctx)).join("") : `<div class="empty ph-small">${ic("tam")}<b>${esc(a.noMessages)}</b></div>`;
  return `<section class="card sec" aria-labelledby="ph-tam-${esc(tam.entityId)}">
    <div class="ph-chead"><span class="label" id="ph-tam-${esc(tam.entityId)}">${esc(tam.name)}</span>${newCount ? `<span class="chip info">${esc(fill(a.nNew, { n: newCount }))}</span>` : `<span class="chip ok">${esc(a.allHeard)}</span>`}${sw}</div>
    ${tam.offline ? staleNote({ offline: true, staleAt: tam.staleAt }, ctx) : ""}
    ${rows}
    <p class="hint">${esc(facts)}</p></section>`;
}

function tamCards(model, ctx) {
  const a = ctx.t.phone.tam;
  const head = `<div class="ph-chead"><span class="label">${esc(a.title)}</span></div>`;
  if (model.tamsState === "loading") return `<section class="card sec" aria-busy="true">${head}<p class="hint">${esc(ctx.t.loading)}</p></section>`;
  if (model.tamsState === "na") return `<section class="card sec">${head}<p class="hint">${esc(ctx.t.phone.part)}</p></section>`;
  if (!model.tams.length) {
    return `<section class="card sec"><div class="ph-chead"><span class="label">${esc(a.title)}</span></div><div class="empty ph-small">${ic("tam")}<b>${esc(a.none)}</b><span>${esc(a.noneBody)}</span></div></section>`;
  }
  return model.tams.map((tam) => tamCard(tam, model, ctx)).join("");
}

// ---------- phone books ----------

function bookCard(model, ctx) {
  const { t, ui } = ctx;
  const b = t.phone.book;
  if (model.booksState === "loading") return `<section class="card sec" aria-busy="true"><div class="ph-chead"><span class="label">${esc(b.title)}</span></div><p class="hint">${esc(t.loading)}</p></section>`;
  if (model.booksState === "na") return `<section class="card sec"><div class="ph-chead"><span class="label">${esc(b.title)}</span></div><p class="hint">${esc(t.phone.part)}</p></section>`;
  if (!model.books.length) return `<section class="card sec"><div class="ph-chead"><span class="label">${esc(b.title)}</span></div><div class="empty ph-small"><b>${esc(b.none)}</b><span>${esc(b.noneBody)}</span></div></section>`;
  const book = model.books.find((x) => x.entityId === ui.book) ?? model.books[0];
  const open = ui.bookOpen === true;
  const head = `<div class="ph-chead"><button class="ph-fold" data-act="ph-bookopen" data-k="ph-bookopen" aria-expanded="${open}" aria-controls="ph-book-body"><span class="label" id="ph-book-h">${esc(b.title)}</span><span class="ph-chev" aria-hidden="true">${ic("chev")}</span></button>${book.ok ? `<span class="chip">${esc(fill(b.count, { n: book.count }))}</span>` : ""}</div>`;
  if (!open) {
    const vips = book.ok ? book.contacts.filter((c) => c.vip).length : 0;
    return `<section class="card sec ph-folded" aria-labelledby="ph-book-h">${head}${book.ok && book.count ? `<p class="hint">${esc(vips ? fill(b.summaryVip, { n: vips }) : b.summary)}</p>` : ""}</section>`;
  }
  const choose = model.books.length > 1
    ? `<span class="seg ph-seg" role="group" aria-label="${esc(b.choose)}">${model.books.map((x) => `<button data-act="ph-book" data-ph-ent="${esc(x.entityId)}" data-k="ph-b-${esc(x.entityId)}" aria-pressed="${x === book}">${esc(x.name)}</button>`).join("")}</span>`
    : "";
  if (book.loading) return `<section class="card sec" aria-busy="true" aria-labelledby="ph-book-h">${head}<div class="ph-tools">${choose}</div><p class="hint">${esc(t.loading)}</p></section>`;
  if (!book.ok) return `<section class="card sec" aria-labelledby="ph-book-h">${head}<div class="ph-tools">${choose}</div><p class="hint">${esc(book.offline || model.api === "ws" ? t.phone.part : fill(t.phone.tooOld, { attr: "contacts" }))}</p></section>`;
  // how often each number called or was called, from the calls the page has
  const seen = new Map();
  for (const call of model.calls ?? []) {
    const d = digits(call.number);
    if (!d) continue;
    const e = seen.get(d) ?? { n: 0, last: null };
    e.n += 1;
    if (call.date && (!e.last || call.date > e.last)) e.last = call.date;
    seen.set(d, e);
  }
  const statsOf = (c) => {
    let n = 0;
    let last = null;
    for (const num of c.numbers) {
      const e = seen.get(digits(num.number));
      if (!e) continue;
      n += e.n;
      if (e.last && (!last || e.last > last)) last = e.last;
    }
    return { n, last };
  };
  const mode = ui.bookFilter ?? "all";
  const counts = { all: book.contacts.length, vip: book.contacts.filter((c) => c.vip).length, calls: book.contacts.filter((c) => statsOf(c).n).length };
  const found = searchBook(book.contacts, ui.bookQuery).filter((c) => (mode === "vip" ? c.vip : mode === "calls" ? statsOf(c).n > 0 : true));
  const shown = found.slice(0, BOOK_ROWS);
  let group = null;
  const rows = shown
    .map((c) => {
      const letter = c.vip ? "★" : (c.name || "?").slice(0, 1).toUpperCase();
      const label = letter === group ? "" : `<div class="ph-group" role="presentation">${letter === "★" ? esc(b.vip) : esc(letter)}</div>`;
      group = letter;
      // the key holds no name: in privacy mode nothing of the contact is in the page
      const key = `b:${book.entityId}:${book.contacts.indexOf(c)}`;
      const hide = masked(ui, model.privacy, key);
      const initial = hide ? "" : c.vip ? ic("star") : esc((c.name || "?").slice(0, 1).toUpperCase());
      const body = hide
        ? `<button class="ph-main" data-act="ph-row" data-ph-key="${esc(key)}" data-k="ph-r-${esc(key)}" aria-label="${esc(b.hidden)}"><span class="ph-name"><span>${hiddenName(t)}</span></span></button>`
        : `<span class="ph-name"><span>${esc(c.name || t.phone.calls.unknown)}</span>${c.vip ? `<span class="sr">${esc(t.phone.calls.vip)}</span>` : ""}</span>
          <div class="ph-nums">${c.numbers
            .map((n) => {
              const type = b.numType[n.type] ?? n.type;
              const fax = n.type.startsWith("fax");
              return `<span class="ph-num"><span class="mono">${esc(n.number)}</span>${type ? `<small>${esc(type)}</small>` : ""}${fax || !dialable(n.number) ? "" : `<button class="icon-btn" data-act="ph-dial" data-ph-num="${esc(n.number)}" data-ph-name="${esc(c.name)}" data-k="ph-bd-${esc(key)}-${esc(n.number)}" aria-label="${esc(fill(b.call, { name: c.name, type: type || "–" }))}"${off(model)}>${ic("phone")}</button>`}</span>`;
            })
            .join("")}</div>`;
      const st = hide ? { n: 0, last: null } : statsOf(c);
      const stat = st.n ? `<small class="ph-cstat">${esc(fill(b.calls, { n: st.n }))}${st.last ? `, ${esc(fill(b.last, { when: dayLabel(st.last, ctx.now, t, ctx.language) }))}` : ""}</small>` : "";
      return `${label}<div class="ph-row ph-contact"><div class="ph-line two"><span class="ph-ico">${initial}</span><div class="ph-cbody">${body}${stat}</div></div></div>`;
    })
    .join("");
  const more = found.length > shown.length ? `<p class="hint">${esc(fill(b.more, { n: found.length - shown.length }))}</p>` : "";
  return `<section class="card sec" aria-labelledby="ph-book-h">${head}
    <div id="ph-book-body">
    <div class="ph-tools">${choose}<span class="seg ph-seg" role="group" aria-label="${esc(b.filter)}">${["all", "vip", "calls"].map((f) => `<button data-act="ph-bookfilter" data-ph-val="${f}" data-k="ph-bf-${f}" aria-pressed="${f === mode}">${esc(b.filters[f])}<span class="n">${counts[f]}</span></button>`).join("")}</span>${!model.offline ? `<button class="btn sm" data-act="ph-newcontact" data-k="ph-newcontact" aria-haspopup="dialog">${ic("userPlus")}${esc(b.newContact)}</button>` : ""}</div>
    <div class="ph-tools"><label class="search ph-search"><span class="sr">${esc(b.searchLabel)}</span>${ic("search")}<input type="search" id="ph-bq" value="${esc(ui.bookQuery)}" placeholder="${esc(b.search)}" autocomplete="off"></label></div>
    <p class="sr" role="status">${esc(fill(b.found, { n: found.length }))}</p>
    ${book.contacts.length ? (found.length ? rows : `<div class="empty ph-small"><b>${esc(b.noMatch)}</b></div>`) : `<div class="empty ph-small"><b>${esc(b.empty)}</b></div>`}${more}
    <p class="hint">${esc(b.hint)}</p></div></section>`;
}

// ---------- block list (only with the commands) ----------

/** The block list of the box: shown where the box has one, with a release per number; nothing otherwise. */
export function blockCard(model, ctx) {
  const { t, ui } = ctx;
  const k = t.phone.block;
  const bl = model.blocked;
  if (model.api !== "ws" || !bl?.known || (bl.ok && !bl.supported)) return "";
  const head = `<div class="ph-chead"><span class="label" id="ph-bl-h">${esc(k.listTitle)}</span>${bl.ok ? `<span class="chip">${esc(fill(k.listCount, { n: bl.numbers.size }))}</span>` : ""}</div>`;
  if (!bl.ok) return `<section class="card sec" aria-labelledby="ph-bl-h">${head}<p class="hint">${esc(t.phone.part)}</p></section>`;
  if (!bl.entries.length) return `<section class="card sec" aria-labelledby="ph-bl-h">${head}<div class="empty ph-small"><b>${esc(k.listEmpty)}</b></div><p class="hint">${esc(k.listHint)}</p></section>`;
  const shown = bl.entries.slice(0, BOOK_ROWS);
  const rows = shown
    .map((e, i) => {
      const key = `bl:${i}`;
      const hide = masked(ui, model.privacy, key);
      if (hide) return `<div class="ph-row"><div class="ph-line two"><span class="ph-ico">${ic("ban")}</span><button class="ph-main" data-act="ph-row" data-ph-key="${esc(key)}" data-k="ph-r-${esc(key)}" aria-label="${esc(k.hidden)}"><span class="ph-name"><span>${hiddenName(t)}</span></span></button></div></div>`;
      const nums = e.numbers
        .map((n) => `<span class="ph-num"><span class="mono">${esc(n)}</span><button class="icon-btn" data-act="ph-unblock" data-ph-num="${esc(n)}" data-k="ph-bu-${i}-${esc(n)}" aria-haspopup="dialog" aria-label="${esc(fill(k.unblockLabel, { number: n }))}"${off(model)}>${ic("close")}</button></span>`)
        .join("");
      return `<div class="ph-row ph-contact"><div class="ph-line two"><span class="ph-ico">${ic("ban")}</span><div class="ph-cbody"><span class="ph-name"><span>${esc(e.name || k.noName)}</span></span><div class="ph-nums">${nums}</div></div></div></div>`;
    })
    .join("");
  const more = bl.entries.length > shown.length ? `<p class="hint">${esc(fill(t.phone.book.more, { n: bl.entries.length - shown.length }))}</p>` : "";
  return `<section class="card sec" aria-labelledby="ph-bl-h">${head}${rows}${more}<p class="hint">${esc(k.listHint)}</p></section>`;
}

// ---------- statistics ----------

function deltaHtml(cur, prev, kind, t) {
  if (prev === null || prev === undefined) return "";
  const d = kind === "pp" ? Math.round((cur - prev) * 100) : cur - prev;
  const pts = t.phone.stats.points;
  if (Math.abs(d) < (kind === "pp" ? 1 : 0.5)) return `<span class="ph-delta">± 0${kind === "pp" ? ` ${pts}` : ""}</span>`;
  const up = d > 0;
  const val = kind === "pp" ? `${Math.abs(d)} ${pts}` : kind === "min" ? fmtMinutes(Math.abs(d), t) : Math.round(Math.abs(d));
  return `<span class="ph-delta">${up ? "▲ +" : "▼ −"}${esc(val)}<span class="sr"> ${esc(t.phone.stats.deltaVs)}</span></span>`;
}

function barLabel(b, unit, ctx) {
  const { t, language } = ctx;
  const s = t.phone.stats;
  if (unit === "hour") return { short: String(b.hour), long: fill(s.hourLabel, { h: b.hour, h2: b.hour + 1 }) };
  const short = b.start.toLocaleDateString(language || "en", { day: "2-digit", month: "2-digit" });
  if (unit === "week") return { short, long: fill(s.weekFrom, { date: b.start.toLocaleDateString(language || "en", { day: "numeric", month: "long" }) }) };
  return { short: b.days <= 7 ? b.start.toLocaleDateString(language || "en", { weekday: "short" }) : short, long: b.start.toLocaleDateString(language || "en", { weekday: "short", day: "numeric", month: "long" }) };
}

/** Stacked columns as inline SVG, as wide as the page; labels thinned out instead of overlapping. */
export function barChart(bars, width, ctx) {
  const { t } = ctx;
  const s = t.phone.stats;
  const W = Math.max(260, Math.round(width));
  const H = 170;
  const L = 30;
  const B = 22;
  const T = 8;
  const iw = W - L - 4;
  const ih = H - B - T;
  const list = bars.list;
  const max = Math.max(4, ...list.map((b) => b.total));
  const step = max <= 8 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : 20;
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + ih - (v / top) * ih;
  const bw = iw / list.length;
  const w = Math.max(2, Math.min(28, bw - 2));
  const every = Math.ceil(list.length / Math.max(1, Math.floor(iw / 44)));
  let g = "";
  for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${L}" x2="${W - 4}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  list.forEach((b, i) => {
    const x = L + i * bw + (bw - w) / 2;
    const lbl = barLabel({ ...b, days: list.length }, bars.unit, ctx);
    let acc = 0;
    let segs = "";
    for (const k of SERIES) {
      if (!b[k]) continue;
      const h = (b[k] / top) * ih;
      const yy = y(acc + b[k]);
      segs += `<rect class="s-${k}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, h - (acc ? 1 : 0)).toFixed(1)}" rx="${acc + b[k] === b.total ? 2 : 0}"/>`;
      acc += b[k];
    }
    const label = fill(s.barLabel, { when: lbl.long, n: b.total, parts: SERIES.map((k) => `${b[k]} ${s.series[k]}`).join(", ") });
    g += `<g class="bar" tabindex="0" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}"><rect class="hit" x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}"/>${segs}</g>`;
    if (i % every === 0) g += `<text class="ax" x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(lbl.short)}</text>`;
  });
  g += `<line class="base" x1="${L}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}"/>`;
  return `<svg class="ph-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(fill(s.chartLabel, { title: s.chart[bars.unit] }))}">${g}</svg>`;
}

function barTable(bars, ctx) {
  const s = ctx.t.phone.stats;
  const rows = bars.list.filter((b) => b.total || bars.list.length <= 31);
  return `<table class="ph-table"><caption class="sr">${esc(s.chart[bars.unit])}</caption><thead><tr><th scope="col">${esc(s.unit[bars.unit])}</th>${SERIES.map((k) => `<th scope="col">${esc(s.series[k])}</th>`).join("")}<th scope="col">${esc(s.total)}</th></tr></thead><tbody>${rows
    .map((b) => `<tr><th scope="row">${esc(barLabel({ ...b, days: bars.list.length }, bars.unit, ctx).long)}</th>${SERIES.map((k) => `<td>${b[k]}</td>`).join("")}<td><b>${b.total}</b></td></tr>`)
    .join("")}</tbody></table>`;
}

/**
 * The heat map shape for a width: 24 hours where each column gets 20 px, else blocks of three
 * hours (as in stage 1). grid is 7 × 24 (an older 7 × 8 grid is drawn as it is).
 */
export function heatShape(grid, width) {
  const W = Math.max(260, Math.min(760, Math.round(width)));
  const hourly = grid[0]?.length === 24 && (W - 32) / 24 >= 20;
  const shown = hourly || grid[0]?.length !== 24 ? grid : foldHeat(grid);
  return { W, hourly: shown[0]?.length === 24, grid: shown };
}

/** The labels of the columns: hours ("9", "9–10") or the blocks of three hours of the texts. */
function heatSlots(hourly, s) {
  return hourly ? Array.from({ length: 24 }, (_, h) => ({ axis: String(h), slot: `${h}–${h + 1}` })) : s.slots.map((x) => ({ axis: x, slot: x }));
}

/** The heat map: one colour in six steps, the number in each cell where it fits. */
export function heatChart(grid, width, ctx) {
  const s = ctx.t.phone.stats;
  const shape = heatShape(grid, width);
  const W = shape.W;
  const rows = shape.grid;
  const slots = heatSlots(shape.hourly, s);
  const L = 30;
  const T = 20;
  const cw = (W - L - 2) / slots.length;
  const ch = 26;
  const H = T + 7 * ch + 2;
  const max = Math.max(1, ...rows.flat());
  const every = shape.hourly ? 3 : cw < 34 ? 2 : 1;
  let g = slots.map((x, j) => (j % every === 0 ? `<text class="ax" x="${(L + j * cw + cw / 2).toFixed(1)}" y="13" text-anchor="middle">${esc(x.axis)}</text>` : "")).join("");
  rows.forEach((row, i) => {
    g += `<text class="ax" x="${L - 6}" y="${T + i * ch + ch / 2 + 4}" text-anchor="end">${esc(s.weekdays[i])}</text>`;
    row.forEach((v, j) => {
      const lvl = v === 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
      const label = fill(s.heatLabel, { day: s.weekdays[i], slot: slots[j]?.slot ?? "", n: v });
      g += `<g class="cell" tabindex="0" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}"><rect class="h${lvl}" x="${(L + j * cw + 1).toFixed(1)}" y="${T + i * ch + 1}" width="${(cw - 2).toFixed(1)}" height="${ch - 2}" rx="4"/>${v && cw >= 18 ? `<text class="hv h${lvl}t" x="${(L + j * cw + cw / 2).toFixed(1)}" y="${T + i * ch + ch / 2 + 4}" text-anchor="middle">${v}</text>` : ""}</g>`;
    });
  });
  return `<svg class="ph-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(s.heatChart)}">${g}</svg>`;
}

function heatTable(grid, width, ctx) {
  const s = ctx.t.phone.stats;
  const shape = heatShape(grid, width);
  const slots = heatSlots(shape.hourly, s);
  return `<table class="ph-table"><caption class="sr">${esc(s.heatChart)}</caption><thead><tr><th scope="col">${esc(s.day)}</th>${slots.map((x) => `<th scope="col">${esc(x.slot)}</th>`).join("")}</tr></thead><tbody>${shape.grid
    .map((r, i) => `<tr><th scope="row">${esc(s.weekdays[i])}</th>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function rankList(items, title, prefix, model, ctx, own = false) {
  const { t, ui } = ctx;
  const s = t.phone.stats;
  if (!items.length) return `<p class="hint">${esc(s.noneInPeriod)}</p>`;
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<ol class="ph-rank" aria-label="${esc(title)}">${items
    .map((x, i) => {
      const key = `${prefix}:${x.key}`;
      const hide = !own && masked(ui, model.privacy, key);
      const who = x.name ? (hide ? hiddenName(t) : esc(x.name)) : `<span class="mono">${esc(hide ? shortNumber(x.number) : x.number)}</span>`;
      const sub = own ? s.ownNumber : x.name ? (hide ? shortNumber(x.number) : x.number) : x.spam ? s.spamSuspect : x.area || s.notInBook;
      const inner = `<span class="rn">${i + 1}.</span><span class="rw"><span class="rt">${who}${x.vip && !hide ? ic("star") : ""}</span><small>${esc(sub)}</small><span class="rb" aria-hidden="true"><i style="width:${((x.n / max) * 100).toFixed(0)}%"></i></span></span><span class="rv">${x.n}<span class="sr"> ${esc(fill(s.callsN, { n: "" }).trim())}</span>${x.talk ? `<small>${esc(fmtMinutes(x.talk, t))}</small>` : ""}</span>`;
      return `<li>${hide ? `<button class="rk" data-act="ph-row" data-ph-key="${esc(key)}" data-k="ph-r-${esc(key)}" aria-label="${esc(fill(s.rankHidden, { n: i + 1 }))}">${inner}</button>` : `<div class="rk">${inner}</div>`}</li>`;
    })
    .join("")}</ol>`;
}

/** The statistics as fritzbox_phone counts them (command stats), with what the page needs to say about them. */
function wsStatsParts(model, period, ctx) {
  const { t, now, language } = ctx;
  const s = t.phone.stats;
  const part = model.stats && model.stats.days === PERIOD_DAYS[period] ? model.stats : null;
  const st = wsStats(part, { period, now, calls: model.list.calls ?? [] });
  if (!st.ok || st.empty) return { st };
  const day = (d) => d.toLocaleDateString(language || "en", { day: "2-digit", month: "2-digit", year: "numeric" });
  const notes = [
    fill(s.wsBasis, { n: st.count, from: day(st.from), to: day(new Date(st.to.getTime() - 1)) }),
    st.source === "history" ? s.sourceHistory : s.sourceList,
    fill(s.held, { oldest: day(st.oldest), newest: st.newest ? day(st.newest) : "–" }),
    st.short ? fill(s.reachShort, { date: day(st.oldest) }) : "",
    st.undated ? fill(s.undated, { n: st.undated }) : "",
    model.historyDays > 0 ? "" : s.historyHint,
  ].filter(Boolean);
  const unheard = model.tams.reduce((n, x) => n + (x.newCount ?? x.messages.filter((m) => m.isNew).length), 0);
  const held = model.tams.reduce((n, x) => n + (x.total ?? x.messages.length), 0);
  const tamTile = model.tamsState === "ok" && model.tams.length ? { label: s.tamBox, value: unheard, small: fill(s.tamBoxSub, { n: held }) } : null;
  return { st, notes, tamTile, sourceText: s.wsSource };
}

/** The statistics as the page counts them from the call list it holds (older versions, stage 1). */
function listStatsParts(model, period, ctx) {
  const { t, now, language } = ctx;
  const s = t.phone.stats;
  const st = phoneStats(model.list.calls, { period, now });
  if (st.empty) return { st: { ok: true, ...st } };
  const first = st.first.toLocaleDateString(language || "en", { day: "2-digit", month: "2-digit" });
  const unheard = model.tams.reduce((n, x) => n + x.messages.filter((m) => m.isNew).length, 0);
  const notes = [fill(s.basis, { n: st.total - st.undated, date: first }), s.basisBody, st.short ? fill(s.sameAsAll, { n: st.spanDays }) : "", st.undated ? fill(s.undated, { n: st.undated }) : ""].filter(Boolean);
  return { st: { ok: true, ...st }, notes, tamTile: { label: s.tam, value: st.sum.tam, small: fill(s.tamSub, { n: unheard }) }, sourceText: s.source };
}

/**
 * The statistics view. With the commands fritzbox_phone counts (over its call history where that
 * is switched on) and the page says from what and how far back; with an older version the page
 * counts what the call list holds and says how far that reaches.
 */
export function statsView(model, ctx) {
  const { t, ui, language } = ctx;
  const s = t.phone.stats;
  const ws = model.api === "ws";
  const periods = ws && model.historyDays > 0 ? HISTORY_PERIODS : PERIODS;
  const period = periods.includes(ui.period) ? ui.period : "7";
  const head = `<div class="ph-chead"><span class="label" id="ph-stat-h">${esc(s.title)}</span><span class="seg ph-seg" role="group" aria-label="${esc(s.periodLabel)}">${periods.map((p) => `<button data-act="ph-period" data-ph-val="${p}" data-k="ph-per-${p}" aria-pressed="${period === p}">${esc(s.period[p])}</button>`).join("")}</span></div>`;
  const card = (body, busy = false) => `<section class="card sec"${busy ? ' aria-busy="true"' : ""} aria-labelledby="ph-stat-h">${head}${body}</section>`;
  if (!ws && !model.list.ok) return card(`<div class="empty"><b>${esc(fill(t.phone.tooOld, { attr: "calls" }))}</b></div>`);
  const parts = ws ? wsStatsParts(model, period, ctx) : listStatsParts(model, period, ctx);
  const st = parts.st;
  if (!st.ok && st.reason === "loading") return card(`<p class="hint" role="status">${esc(s.loading)}</p>`, true);
  if (!st.ok) return card(`<div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${esc(s.title)}: ${esc(t.phone.part)}</b></div>`);
  if (st.empty) return card(`<div class="empty">${ic("phone")}<b>${esc(s.noData)}</b><span>${esc(s.noDataBody)}</span></div>${ws && !model.historyDays ? `<p class="hint">${esc(s.historyHint)}</p>` : ""}`);
  const sum = st.sum;
  const prev = st.prev;
  const fmt1 = (n) => n.toLocaleString(language || "en", { maximumFractionDigits: 1 });
  const tile = (label, value, small) => `<div class="tile"><span class="label">${esc(label)}</span><b>${value}</b><small>${small}</small></div>`;
  const spamTile = model.today.hasSpam || sum.spam
    ? tile(s.spam, sum.spam, esc(fill(s.spamSub, { today: model.today.spamToday ?? "–", total: model.today.spamTotal ?? "–" })))
    : "";
  const compare = st.compare;
  const compareText =
    compare.kind === "noneAll" ? s.compareNoneAll
      : compare.kind === "none" ? s.compareNone
        : compare.kind === "partial" ? (compare.only ? fill(s.compareOnly, { cover: compare.cover, len: compare.len }) : fill(s.compareIncomplete, { cover: compare.cover, len: compare.len }))
          : period === "today" ? s.compareToday : fill(s.compareFull, { n: compare.len });
  const width = Math.max(260, Math.min(1100, (ctx.width || 640) - 34));
  const legend = `<div class="ph-legend ph-vleg">${SERIES.map((k) => `<span><i class="sw s-${k}" aria-hidden="true"></i>${esc(s.series[k])} <b>${st.bars.list.reduce((n, b) => n + b[k], 0)}</b></span>`).join("")}</div>`;
  const toggle = (id) => `<button class="btn sm" data-act="ph-table" data-ph-val="${id}" data-k="ph-tb-${id}" aria-pressed="${Boolean(ui.tables?.[id])}">${esc(ui.tables?.[id] ? s.asChart : s.asTable)}</button>`;
  const notes = parts.notes;
  const heat = st.heat ?? heatGrid([]);
  const hourly = heatShape(heat, width).hourly;
  const tamTile = parts.tamTile ? tile(parts.tamTile.label, parts.tamTile.value, esc(parts.tamTile.small)) : "";
  return `<section class="card sec" aria-labelledby="ph-stat-h">${head}
    <p class="ph-limit">${ic("help")}<span><b>${esc(notes[0])}</b> ${esc(notes.slice(1).join(" "))}</span></p>
    ${staleNote(model, ctx)}
    <div class="tiles">
      ${tile(s.calls, sum.n, `${deltaHtml(sum.n, prev?.n, "n", t)}${st.perDay !== null ? ` · ${esc(fill(s.perDay, { n: fmt1(st.perDay) }))}` : ""}`)}
      ${tile(s.talk, esc(fmtMinutes(sum.talk, t)), `${deltaHtml(sum.talk, prev?.talk, "min", t)} · ${esc(fill(s.avgTalk, { n: sum.conn ? fmtMinutes(sum.avg, t) : "–" }))}`)}
      ${tile(s.missedRate, `${Math.round(sum.rate * 100)} %`, `${esc(fill(s.missedOf, { n: sum.missed, total: sum.inbound }))} ${deltaHtml(sum.rate, prev?.rate, "pp", t)}`)}
      ${spamTile}
      ${tamTile}
    </div>
    <p class="hint">${esc(compareText)}</p>
    <div class="ph-vsec"><div class="ph-chead"><span class="label">${esc(s.chart[st.bars.unit])}</span>${toggle("bars")}</div>${legend}
      <div class="ph-vwrap">${ui.tables?.bars ? barTable(st.bars, ctx) : barChart(st.bars, width, ctx)}<div class="ph-tip" role="tooltip" hidden></div></div></div>
    <div class="ph-vsec"><div class="ph-chead"><span class="label">${esc(s.heat)}</span>${toggle("heat")}</div>
      <div class="ph-vwrap">${ui.tables?.heat ? heatTable(heat, width, ctx) : heatChart(heat, width, ctx)}<div class="ph-tip" role="tooltip" hidden></div></div>
      <p class="hint">${esc(hourly ? s.heatHintHours : s.heatHint)}</p></div>
    <div class="two ph-two">
      <div class="ph-vsec"><div class="ph-chead"><span class="label">${esc(s.topIn)}</span></div>${rankList(st.topIn, s.topIn, "tin", model, ctx)}</div>
      <div class="ph-vsec"><div class="ph-chead"><span class="label">${esc(s.topOut)}</span></div>${rankList(st.topOut, s.topOut, "tout", model, ctx)}</div>
    </div>
    <div class="ph-vsec"><div class="ph-chead"><span class="label">${esc(s.perLine)}</span></div>${rankList(st.lines.map((l) => ({ ...l, name: "", talk: 0 })), s.perLine, "own", model, ctx, true)}<p class="hint">${esc(s.perLineHint)}</p></div>
    ${model.privacy ? `<p class="hint">${esc(s.privacy)}</p>` : ""}
    <p class="hint">${esc(parts.sourceText)}</p></section>`;
}

// ---------- the page ----------

function skeleton(ctx) {
  const tiles = [1, 2, 3, 4].map(() => `<div class="tile"><b class="ph-skel">00</b><small class="ph-skel">…</small></div>`).join("");
  return `<section class="card sec" aria-busy="true"><div class="tiles">${tiles}</div><p class="sr" role="status">${esc(ctx.t.phone.loading)}</p></section>
    <section class="card sec" aria-busy="true">${[1, 2, 3, 4].map(() => `<div class="ph-row"><div class="ph-line"><span class="ph-ico ph-skel"></span><span><b class="ph-skel ph-w60">.</b><small class="ph-skel ph-w40">.</small></span><span></span></div></div>`).join("")}</section>`;
}

/**
 * The page. model is what readPhone made of Home Assistant; ctx: t, language, now (a Date), ui
 * (filter, query, view, period, tables, book, bookQuery, expanded, revealed, play, dial, blocked,
 * busy, rights) and width (of the page, for the charts).
 */
export function renderPhone(model, ctx) {
  const { t, ui } = ctx;
  const p = t.phone;
  const legacy = model?.legacy ? `<p class="ph-src ph-legacy">${esc(p.legacy)}</p>` : "";
  const head = `<div class="phead"><h1 id="dtitle" tabindex="-1">${esc(p.title)}</h1>${model?.entry ? sourceLine(model, ctx) : ""}${legacy}</div>`;
  if (!model?.found) return `${head}<div class="card"><div class="empty"><b>${esc(p.missing)}</b></div></div>`;
  const view = `<div class="seg ph-seg ph-view" role="group" aria-label="${esc(p.view.label)}"><button data-act="ph-view" data-ph-val="list" data-k="ph-v-list" aria-pressed="${ui.view !== "stats"}">${esc(p.view.list)}</button><button data-act="ph-view" data-ph-val="stats" data-k="ph-v-stats" aria-pressed="${ui.view === "stats"}">${esc(p.view.stats)}</button></div>`;
  const integration = `<div class="btn-row"><a class="btn" href="/config/integrations/integration/fritzbox_phone" data-act="integration" data-k="ph-int2">${esc(p.openIntegration)}</a></div>`;
  if (model.missing) return `${head}<div class="card"><div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${esc(p.missing)}</b><span>${esc(p.missingBody)}</span>${integration}</div></div>`;
  if (model.notLoaded) return `${head}<div class="card"><div class="empty"><span class="bad-ico">${ic("unplug")}</span><b>${esc(p.notLoaded)}</b><span>${esc(p.notLoadedBody)}</span>${integration}</div></div>`;
  if (model.loading) return `${head}${view}${skeleton(ctx)}`;
  const offline = model.offline && !model.list.ok
    ? `<section class="card"><div class="empty"><span class="bad-ico">${ic("unplug")}</span><b>${esc(p.offline)}</b><span>${esc(p.offlineBody)}</span>${integration}</div></section>`
    : "";
  if (offline) return `${head}${liveCard(model, ctx)}${offline}`;
  const body = ui.view === "stats"
    ? statsView(model, ctx)
    : `${todayCard(model, ctx)}<div class="two ph-two">${callCard(model, ctx)}<div class="ph-col">${tamCards(model, ctx)}${bookCard(model, ctx)}${blockCard(model, ctx)}</div></div>`;
  return `${head}${view}${liveCard(model, ctx)}${notices(model, ctx)}${body}`;
}

// ---------- dialog bodies ----------

/** Suggestions for the dial dialog: contacts whose name matches; without numbers in privacy mode. */
export function dialSuggestions(contacts, query, privacy, t) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q || /\d/.test(q)) return "";
  const seen = new Set();
  const hits = [];
  for (const c of contacts) {
    if (!c.name.toLowerCase().includes(q)) continue;
    for (const n of c.numbers) {
      if (n.type.startsWith("fax") || !dialable(n.number) || seen.has(n.number)) continue;
      seen.add(n.number);
      hits.push({ name: c.name, number: n.number, type: t.phone.book.numType[n.type] ?? n.type });
    }
    if (hits.length >= 6) break;
  }
  if (!hits.length) return "";
  return `<ul class="ph-sugg" role="listbox" id="ph-sugg-list" aria-label="${esc(t.phone.dial.suggestions)}">${hits
    .slice(0, 6)
    .map((h) => `<li role="option" aria-selected="false"><button type="button" data-pick="${esc(h.number)}" data-pname="${esc(h.name)}"><span>${esc(h.name)}</span><span class="mono muted">${esc(privacy ? "•••" : h.number)} ${esc(h.type)}</span></button></li>`)
    .join("")}</ul>`;
}

export function lookupBody(res, t) {
  const l = t.phone.lookup;
  const r = res && typeof res === "object" ? res : {};
  const spam = r.spam && typeof r.spam === "object"
    ? r.spam.is_spam || r.spam.rating ? fill(l.spam, { rating: ratingText(r.spam.rating, t) || "–", p: r.spam.confidence ?? "–" }) + (r.spam.location ? `, ${r.spam.location}` : "") : l.notFound
    : l.notFound;
  const rev = r.reverse_lookup && typeof r.reverse_lookup === "object"
    ? [r.reverse_lookup.name, r.reverse_lookup.category, r.reverse_lookup.score !== null && r.reverse_lookup.score !== undefined ? fill(l.score, { n: r.reverse_lookup.score }) : ""].filter(Boolean).join(", ") || l.off
    : l.off;
  const contact = r.contact && typeof r.contact === "object" && r.contact.name ? `${r.contact.name}${r.contact.vip ? ` (${t.phone.calls.vip})` : ""}` : l.none;
  return `<p class="hint">${esc(l.intro)}</p><dl class="kv ph-kv">
    <dt>${esc(l.canonical)}</dt><dd class="mono">${esc(r.number ?? "–")}</dd>
    <dt>${esc(l.contact)}</dt><dd>${esc(contact)}</dd>
    <dt>${esc(l.area)}</dt><dd>${esc(r.area_name || "–")}</dd>
    <dt>${esc(l.phoneblock)}</dt><dd>${esc(spam)}</dd>
    <dt>${esc(l.tellows)}</dt><dd>${esc(rev)}</dd></dl>
    <p class="hint">${esc(l.privacy)}</p>`;
}
