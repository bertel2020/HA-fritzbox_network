/* The connection check of the diagnosis page: the box, the internet, names and the web, tried from Home Assistant. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

/** The card: a button, and after a run the steps with the time they took and a verdict. */
export function renderCheck(check, ctx) {
  const { t } = ctx;
  const c = t.diag.check;
  const running = check === "running";
  const steps =
    check && check !== "running" && check !== "failed"
      ? `<ul class="ports checksteps">${check.steps
          .map(
            (s) =>
              `<li class="${s.ok ? "" : "bad"}"><span class="pdesc"><span aria-hidden="true">${ic(s.ok ? "check" : "alert")}</span> ${escapeHtml(c.steps[s.key])}</span>
                <span class="pmap">${escapeHtml(s.ok ? fill(c.ms, { ms: s.ms }) : s.key === "ipv6" ? c.noIpv6 : fill(c.failed, { error: s.error ?? "" }))}</span></li>`
          )
          .join("")}</ul>
        <p class="hintline ${check.verdict === "ok" ? "info" : "bad"}">${escapeHtml(c.verdicts[check.verdict])}</p>`
      : "";
  return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span>
    <div class="btn-row tight"><button class="btn p" data-act="check-run"${running ? " disabled" : ""}>${escapeHtml(running ? c.running : c.run)}</button></div>
    ${check === "failed" ? `<p class="hint">${escapeHtml(c.error)}</p>` : steps}
    <p class="hint">${escapeHtml(c.hint)}</p></section>`;
}
