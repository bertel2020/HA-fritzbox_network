/* The event log of the box on the diagnosis page: DSL, network, Wi-Fi, phone and system messages, by group. */

import { escapeHtml, noteHtml } from "./shared.js";
import { fill } from "./texts.js";

export const LOG_GROUPS = ["", "net", "wlan", "sys", "fon", "usb"];
const SHOWN = 100;
const DAY = 86400000;

/**
 * What stands out in the messages of the box, by what they say (the box writes in its own
 * language; German and English are known). `level` is how it is drawn, "warn" or "info".
 */
export const LOG_KINDS = [
  { id: "radar", level: "warn", pattern: /radar|DFS/i },
  { id: "dsl", level: "warn", pattern: /DSL|synchronisation|synchronization|Synchronisierung/i },
  { id: "login", level: "warn", pattern: /(Anmeldung|login|logged in)[^.]*(fehlgeschlagen|failed|abgelehnt|rejected)|(fehlgeschlagen|failed)[^.]*(Anmeldung|login)/i },
  { id: "prefix", level: "info", pattern: /IPv6-Pr[aä]fix|IPv6 prefix/i },
  { id: "connection", level: "info", pattern: /Internetverbindung|Internet connection/i },
];

/** The kind of a message, or null. A message is of the first kind that fits. */
export function classify(message) {
  return LOG_KINDS.find((kind) => kind.pattern.test(message ?? ""))?.id ?? null;
}

/** The time of an entry ("04.11.26", "13:34:20" in the time of the box) as milliseconds; NaN where it is not one. */
export function eventTime(event) {
  const day = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(event.date ?? "");
  const time = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(event.time ?? "");
  if (!day || !time) return Number.NaN;
  const year = Number(day[3]) < 100 ? 2000 + Number(day[3]) : Number(day[3]);
  return new Date(year, Number(day[2]) - 1, Number(day[1]), Number(time[1]), Number(time[2]), Number(time[3])).getTime();
}

/** For each kind that occurs: how many messages of it are in the log and how many in the last 24 hours. */
export function logHighlights(events, now) {
  return LOG_KINDS.map((kind) => {
    const of = events.filter((e) => classify(e.msg) === kind.id);
    return { ...kind, total: of.length, recent: of.filter((e) => now - eventTime(e) <= DAY).length };
  }).filter((k) => k.total > 0);
}

/** The card: group buttons, then the messages newest first. `log` is null before the first read. */
export function renderLog(log, ctx) {
  const { t, group, kind = null, now = Date.now() } = ctx;
  const c = t.diag.log;
  const groups = LOG_GROUPS.map(
    (g) => `<button role="radio" aria-checked="${g === group}" aria-pressed="${g === group}" data-log-group="${g}">${escapeHtml(c.groups[g || "all"])}</button>`
  ).join("");
  let body;
  if (log === "failed") body = `<p class="hint">${escapeHtml(c.failed)}</p>`;
  else if (!log) body = `<p class="hint">${escapeHtml(t.loading)}</p>`;
  else if (!log.events.length) body = `<p class="hint">${escapeHtml(c.none)}</p>`;
  else {
    const marks = logHighlights(log.events, now);
    const chips = marks.length
      ? `<div class="logkinds" role="group" aria-label="${escapeHtml(c.kindsLabel)}">${marks
          .map(
            (m) =>
              `<button class="chip ${m.level}" data-log-kind="${m.id}" aria-pressed="${m.id === kind}" title="${escapeHtml(fill(c.kindTitle, { total: m.total }))}">${escapeHtml(fill(c.kinds[m.id], { n: m.recent }))}</button>`
          )
          .join("")}</div>`
      : "";
    const shown = kind ? log.events.filter((e) => classify(e.msg) === kind) : log.events;
    const rows = shown
      .slice(0, SHOWN)
      .map(
        (e) =>
          `<li class="${classify(e.msg) ? "mark" : ""}"><span class="pdesc">${escapeHtml(e.msg)}</span><span class="pmap">${escapeHtml(e.date)} ${escapeHtml(e.time)}${e.group ? ` · ${escapeHtml(c.groups[e.group] ?? e.group)}` : ""}</span></li>`
      )
      .join("");
    const more = shown.length > SHOWN ? `<p class="hint">${escapeHtml(fill(c.more, { n: SHOWN }))}</p>` : "";
    body = `${chips}${shown.length ? `<ul class="ports logrows">${rows}</ul>${more}` : `<p class="hint">${escapeHtml(c.none)}</p>`}`;
  }
  return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span>
    <div class="seg logseg" role="radiogroup" aria-label="${escapeHtml(c.title)}">${groups}</div>
    ${body}
    ${noteHtml(t.diag.note, c.hint)}</section>`;
}
