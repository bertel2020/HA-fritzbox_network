/* The radio check of the diagnosis page: every access point with its radios, how busy they are and who hangs on them. */

import { BUSY_UTILIZATION, escapeHtml, isWeak } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { UPLINK_WEAK_DBM } from "./panel-hints.js";

// a radio this busy slows every device on it down
export const VERY_BUSY_UTILIZATION = 85;

/** "ok", "warn" or "bad" for the load of a radio; "ok" where the box tells no load. */
export function utilizationLevel(percent) {
  if (typeof percent !== "number") return "ok";
  if (percent >= VERY_BUSY_UTILIZATION) return "bad";
  return percent >= BUSY_UTILIZATION ? "warn" : "ok";
}

/**
 * The access points with their radios: how busy, how noisy, how many devices and how many of them
 * on a weak link. `issues` counts what stands out: a busy radio, devices on a weak link, a weak
 * uplink of a repeater.
 */
export function radioCheck(data) {
  const clients = (data?.clients ?? []).filter((c) => c.online);
  const nodes = (data?.nodes ?? []).map((node) => {
    const here = clients.filter((c) => c.ap_mac === node.mac);
    const radios = Object.entries(node.radios ?? {}).map(([band, radio]) => {
      const on = here.filter((c) => c.link_type === "wlan" && c.band === band);
      return {
        band,
        channel: radio.channel ?? null,
        utilization: radio.utilization ?? null,
        noise: radio.noise_dbm ?? null,
        devices: on.length,
        weak: on.filter((c) => isWeak(c)).length,
        level: utilizationLevel(radio.utilization),
      };
    });
    const uplink = node.uplink ?? null;
    const uplinkWeak = uplink?.type === "wlan" && typeof uplink.signal_dbm === "number" && uplink.signal_dbm <= UPLINK_WEAK_DBM;
    return { mac: node.mac, name: node.name, role: node.role, uplink, uplinkWeak, radios, wired: here.filter((c) => c.link_type === "lan").length };
  });
  const issues = nodes.reduce(
    (sum, n) => sum + Number(n.uplinkWeak) + n.radios.filter((r) => r.level !== "ok" || r.weak > 0).length,
    0
  );
  return { nodes, issues };
}

function uplinkText(node, t, language) {
  const r = t.diag.radio;
  if (node.role === "master") return r.master;
  const uplink = node.uplink;
  if (!uplink) return r.noUplink;
  if (uplink.type !== "wlan") return r.cable;
  const band = t.bandGroups[uplink.band] ?? uplink.band ?? "";
  const dbm = typeof uplink.signal_dbm === "number" ? `, ${uplink.signal_dbm} dBm` : "";
  return fill(r.wifi, { band, dbm });
}

function radioLine(radio, t) {
  const r = t.diag.radio;
  const parts = [
    radio.channel !== null ? fill(r.channel, { n: radio.channel }) : "",
    radio.noise !== null ? fill(r.noise, { dbm: radio.noise }) : "",
    fill(r.devices, { n: radio.devices }),
    radio.weak ? fill(r.weak, { n: radio.weak }) : "",
  ].filter(Boolean);
  const load = radio.utilization === null ? "–" : `${radio.utilization} %`;
  return `<li class="${radio.level}"><span class="pdesc">${escapeHtml(t.bandGroups[radio.band] ?? radio.band)}<small> ${escapeHtml(parts.join(" · "))}</small></span>
    <span class="pmap"><span class="stat ${radio.level === "ok" ? "ok" : "warn"}" title="${escapeHtml(r.loadTitle)}">${escapeHtml(load)}</span></span></li>`;
}

/** The card; nothing where the box tells no access points. */
export function renderRadio(data, ctx) {
  const { t, language } = ctx;
  const r = t.diag.radio;
  const check = radioCheck(data);
  if (!check.nodes.length) return "";
  const blocks = check.nodes
    .map((node) => {
      const wired = node.wired ? ` · ${fill(r.wired, { n: node.wired })}` : "";
      const lines = node.radios.length ? `<ul class="ports">${node.radios.map((radio) => radioLine(radio, t)).join("")}</ul>` : `<p class="hint">${escapeHtml(r.noRadio)}</p>`;
      return `<div class="apblock"><div class="aphead"><b>${escapeHtml(node.name)}</b>
        <small class="${node.uplinkWeak ? "weak" : ""}">${escapeHtml(uplinkText(node, t, language))}${escapeHtml(wired)}</small></div>${lines}</div>`;
    })
    .join("");
  const verdict = check.issues
    ? `<p class="hintline warn"><span aria-hidden="true">${ic("alert")}</span><span>${escapeHtml(fill(r.issues, { n: check.issues }))}</span></p>`
    : `<p class="hintline info"><span aria-hidden="true">${ic("check")}</span><span>${escapeHtml(r.ok)}</span></p>`;
  return `<section class="card sec"><span class="label">${escapeHtml(r.title)}</span>
    ${verdict}${blocks}
    <p class="hint">${escapeHtml(r.hint)}</p></section>`;
}
