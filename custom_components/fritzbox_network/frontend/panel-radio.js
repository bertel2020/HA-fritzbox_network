/* The radio check of the diagnosis page: every access point with its radios, how busy they are and who hangs on them. */

import { BUSY_UTILIZATION, escapeHtml, isWeak, noteHtml } from "./shared.js";
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
  // what stands out, one entry each, so the card can say what it is and where
  const findings = nodes.flatMap((n) => [
    ...(n.uplinkWeak ? [{ kind: "uplink", node: n.name, dbm: n.uplink.signal_dbm }] : []),
    ...n.radios.flatMap((r) => [
      ...(r.level !== "ok" ? [{ kind: "busy", node: n.name, band: r.band, percent: r.utilization }] : []),
      ...(r.weak > 0 ? [{ kind: "weak", node: n.name, band: r.band, n: r.weak }] : []),
    ]),
  ]);
  return { nodes, issues: findings.length, findings };
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
  const width = Math.max(0, Math.min(100, radio.utilization ?? 0));
  return `<li class="radiorow ${radio.level}"><div class="rtop"><b>${escapeHtml(t.bandGroups[radio.band] ?? radio.band)}</b><span class="rpct" title="${escapeHtml(r.loadTitle)}">${escapeHtml(load)}</span></div>
    <span class="meter" role="progressbar" aria-label="${escapeHtml(r.loadTitle)}" aria-valuemin="0" aria-valuemax="100"${radio.utilization === null ? "" : ` aria-valuenow="${width}"`}><i class="${radio.level}" style="width:${width}%"></i></span>
    <small>${escapeHtml(parts.join(" · "))}</small></li>`;
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
      const lines = node.radios.length ? `<ul class="radios">${node.radios.map((radio) => radioLine(radio, t)).join("")}</ul>` : `<p class="hint">${escapeHtml(r.noRadio)}</p>`;
      return `<div class="apblock"><div class="aphead"><b>${escapeHtml(node.name)}</b>
        <span class="chip ${node.uplinkWeak ? "warn" : ""}">${escapeHtml(uplinkText(node, t, language))}</span>${wired ? `<small>${escapeHtml(wired.replace(/^ · /, ""))}</small>` : ""}</div>${lines}</div>`;
    })
    .join("");
  const finding = (f) => {
    const band = t.bandGroups[f.band] ?? f.band ?? "";
    return fill(r.findings[f.kind], { node: f.node, band, percent: f.percent, dbm: f.dbm, n: f.n });
  };
  const verdict = check.issues
    ? `<p class="hintline warn"><span aria-hidden="true">${ic("alert")}</span><span>${escapeHtml(fill(r.issues, { n: check.issues }))}</span></p>
      <ul class="ports">${check.findings.map((f) => `<li><span class="pdesc">${escapeHtml(finding(f))}</span></li>`).join("")}</ul>`
    : `<p class="hintline info"><span aria-hidden="true">${ic("check")}</span><span>${escapeHtml(r.ok)}</span></p>`;
  return `<section class="card sec"><span class="label">${escapeHtml(r.title)}</span>
    ${verdict}${blocks}
    ${noteHtml(t.diag.note, r.hint)}</section>`;
}
