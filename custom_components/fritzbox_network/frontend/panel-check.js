/* The connection card of the diagnosis page: the check from Home Assistant, and below it the course over the day. */

import { escapeHtml, noteHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { latencyHint, latencySection } from "./panel-latency.js";

function stepTiles(check, c) {
  return `<div class="checktiles">${check.steps
    .map((s) => {
      const state = s.ok ? "ok" : s.key === "ipv6" ? "off" : "bad";
      const value = s.ok ? fill(c.ms, { ms: s.ms }) : s.key === "ipv6" ? c.noIpv6 : fill(c.failed, { error: s.error ?? "" });
      const title = [c.steps[s.key], s.key === "ipv6" && !s.ok ? c.noIpv6Title : ""].filter(Boolean).join(": ");
      return `<div class="checktile ${state}" title="${escapeHtml(title)}"><span class="ico" aria-hidden="true">${ic(s.ok ? "check" : "alert")}</span>
        <span class="who"><small>${escapeHtml(c.short[s.key])}</small><b>${escapeHtml(value)}</b></span></div>`;
    })
    .join("")}</div>
    <p class="hintline ${check.verdict === "ok" ? "info" : "bad"}">${escapeHtml(c.verdicts[check.verdict])}</p>`;
}

/**
 * The card: the button for the check, the result of the last check as one tile
 * per step with a verdict, and the course of the day as one strip per step.
 */
export function renderConnection(check, latency, ctx) {
  const { t } = ctx;
  const c = t.diag.check;
  const running = check === "running";
  const result = check && check !== "running" && check !== "failed" ? stepTiles(check, c) : "";
  return `<section class="card sec"><div class="chead"><span class="label">${escapeHtml(t.diag.connection)}</span>
    <div class="btn-row tight"><button class="btn p" data-act="check-run"${running ? " disabled" : ""}>${escapeHtml(running ? c.running : c.run)}</button></div></div>
    ${check === "failed" ? `<p class="hint">${escapeHtml(c.error)}</p>` : result}
    ${latencySection(latency, ctx)}
    ${noteHtml(t.diag.note, c.hint, latencyHint(latency, t))}</section>`;
}
