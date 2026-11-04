/* The event log of the box on the diagnosis page: DSL, network, Wi-Fi, phone and system messages, by group. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";

export const LOG_GROUPS = ["", "net", "wlan", "sys", "fon", "usb"];
const SHOWN = 100;

/** The card: group buttons, then the messages newest first. `log` is null before the first read. */
export function renderLog(log, ctx) {
  const { t, group } = ctx;
  const c = t.diag.log;
  const groups = LOG_GROUPS.map(
    (g) => `<button role="radio" aria-checked="${g === group}" aria-pressed="${g === group}" data-log-group="${g}">${escapeHtml(c.groups[g || "all"])}</button>`
  ).join("");
  let body;
  if (log === "failed") body = `<p class="hint">${escapeHtml(c.failed)}</p>`;
  else if (!log) body = `<p class="hint">${escapeHtml(t.loading)}</p>`;
  else if (!log.events.length) body = `<p class="hint">${escapeHtml(c.none)}</p>`;
  else {
    const rows = log.events
      .slice(0, SHOWN)
      .map(
        (e) =>
          `<li><span class="pdesc">${escapeHtml(e.msg)}</span><span class="pmap">${escapeHtml(e.date)} ${escapeHtml(e.time)}${e.group ? ` · ${escapeHtml(c.groups[e.group] ?? e.group)}` : ""}</span></li>`
      )
      .join("");
    const more = log.events.length > SHOWN ? `<p class="hint">${escapeHtml(fill(c.more, { n: SHOWN }))}</p>` : "";
    body = `<ul class="ports logrows">${rows}</ul>${more}`;
  }
  return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span>
    <div class="seg" role="radiogroup" aria-label="${escapeHtml(c.title)}">${groups}</div>
    ${body}
    <p class="hint">${escapeHtml(c.hint)}</p></section>`;
}
