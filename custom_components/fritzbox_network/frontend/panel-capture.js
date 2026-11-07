/* The packet capture of the internet page: choose an interface and a time, record, download the pcap. */

import { escapeHtml, formatBytes, hintNote, noteHtml } from "./shared.js";
import { fill } from "./texts.js";

/** The form values to start with. */
export function captureDefaults(limits) {
  return { interface: "", seconds: limits?.seconds ?? 60, mb: limits?.mb ?? 50, mac: "" };
}

/** The interface to start with: the LAN when the box has one, else the first. */
export function defaultInterface(interfaces) {
  return (interfaces.find((i) => i.id === "1-lan") ?? interfaces[0])?.id ?? "";
}

// The usual order of the boxes (the 7590 AX measured): the first access point is 2.4 GHz, the second 5 GHz.
// Used until the detection has measured it.
const USUAL_BANDS = { "1-vap0": "2_4ghz", "1-vap1": "5ghz" };

/** The name of an interface: a plain one made from its id, the box's own name where the id says nothing. */
export function interfaceName(i, t) {
  const c = t.inet.capture;
  const n = c.names;
  const known = i.band ?? null;
  const usual = known ? null : (USUAL_BANDS[i.id] ?? null);
  const band = known || usual ? (t.bandGroups[known ?? usual] ?? known ?? usual) : "";
  let match;
  let name = i.label;
  if (i.id === "1-lan") name = n.lan;
  else if ((match = /^1-eth(\d+)$/.exec(i.id))) name = fill(n.eth, { n: Number(match[1]) + 1 });
  else if ((match = /^1-vap(\d+)$/.exec(i.id))) name = band ? fill(usual ? n.apUsual : n.apBand, { band }) : fill(n.ap, { n: Number(match[1]) + 1 });
  else if ((match = /^1-guest(\d?)$/.exec(i.id)))
    name = match[1] === "4" ? fill(n.guestBand, { band: t.bandGroups["2_4ghz"] }) : match[1] === "5" ? fill(n.guestBand, { band: t.bandGroups["5ghz"] }) : n.guest;
  else if ((match = /^1-wg(\d+)$/.exec(i.id))) name = fill(n.wg, { n: match[1] });
  else if (i.id === "3-0") name = n.routingAll;
  else if (/^3-\d+$/.test(i.id)) name = fill(n.routing, { name: i.label });
  return name;
}

/** The name with the id of the box behind it, for the choice. */
export function interfaceLabel(i, t) {
  return `${interfaceName(i, t)} (${i.id})`;
}

/** The select of the interfaces, in groups; the name is the one the box gives, with its id. */
function interfaceOptions(interfaces, chosen, c, t) {
  const groups = [...new Set(interfaces.map((i) => i.group))];
  return groups
    .map(
      (group) =>
        `<optgroup label="${escapeHtml(c.groups[group] ?? group)}">${interfaces
          .filter((i) => i.group === group)
          .map((i) => option(i.id, interfaceLabel(i, t), chosen))
          .join("")}</optgroup>`
    )
    .join("");
}

function option(value, label, chosen) {
  return `<option value="${escapeHtml(value)}"${value === chosen ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function running(job, t, language) {
  const c = t.inet.capture;
  const percent = Math.min(100, Math.round(((job.elapsed ?? 0) / job.seconds) * 100));
  return `<div class="caprun"><span class="meter" role="progressbar" aria-label="${escapeHtml(c.running)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></span>
    <small>${escapeHtml(fill(c.progress, { elapsed: Math.round(job.elapsed ?? 0), seconds: job.seconds, size: formatBytes(job.bytes, language) }))}</small>
    <button class="btn" data-act="cap-stop">${escapeHtml(c.stop)}</button></div>`;
}

function result(job, t, language) {
  const c = t.inet.capture;
  if (!job || job.state === "running") return "";
  if (job.state === "failed") return `<p class="hint">${escapeHtml(fill(c.failed, { error: job.reason ?? "" }))}</p>`;
  return `<p class="hint">${escapeHtml(fill(c.done, { size: formatBytes(job.bytes, language), reason: c.reasons[job.reason] ?? "" }))}</p>`;
}

/** A summary of one capture: the volume, the protocols, the biggest conversations and the DNS names. */
function summaryBlock(summary, t, language) {
  const c = t.inet.capture.summary;
  const who = (ip, name) => (name ? `${name} (${ip})` : ip);
  const protocols = Object.entries(summary.data.protocols)
    .map(([name, n]) => `${name.toUpperCase()} ${n}`)
    .join(" · ");
  const flows = summary.data.flows
    .map(
      (f) =>
        `<li><span class="pdesc">${escapeHtml(who(f.a, f.a_name))} ↔ ${escapeHtml(who(f.b, f.b_name))}<small> ${escapeHtml(f.protocol.toUpperCase())}${f.port ? ` ${f.port}` : ""}</small></span><span class="pmap">${escapeHtml(formatBytes(f.bytes, language))}</span></li>`
    )
    .join("");
  const dns = summary.data.dns.map((d) => `<li><span class="pdesc">${escapeHtml(d.name)}</span><span class="pmap">${d.count}×</span></li>`).join("");
  return `<div class="capsum"><span class="label">${escapeHtml(fill(c.title, { name: summary.name }))}</span>
    <p class="hint">${escapeHtml(fill(c.totals, { packets: summary.data.packets, size: formatBytes(summary.data.bytes, language), seconds: summary.data.seconds }))} · ${escapeHtml(protocols)}</p>
    <span class="label">${escapeHtml(c.flows)}</span>${flows ? `<ul class="ports">${flows}</ul>` : `<p class="hint">${escapeHtml(c.none)}</p>`}
    <span class="label">${escapeHtml(c.dns)}</span>${dns ? `<ul class="ports">${dns}</ul>` : `<p class="hint">${escapeHtml(c.noDns)}</p>`}
    <p class="hint">${escapeHtml(c.hint)}</p></div>`;
}

function fileLine(file, t, language, clients, interfaces) {
  const c = t.inet.capture;
  const device = file.device ? clients.find((d) => d.id === file.device) : null;
  const known = interfaces.find((i) => i.slug === file.interface);
  const when = new Date(file.time).toLocaleString(language || "en", { dateStyle: "medium", timeStyle: "short" });
  const name = escapeHtml(file.name);
  const meta = [when, formatBytes(file.bytes, language)].map((x) => `<span>${escapeHtml(x)}</span>`).join("");
  const only = file.device ? `<span class="chip">${escapeHtml(device?.name ?? file.device)}</span>` : "";
  return `<li class="capfile"><div class="capmain"><b>${escapeHtml(known ? interfaceName(known, t) : file.interface)}</b>${known ? `<code>${escapeHtml(known.id)}</code>` : ""}${only}
      <div class="capmeta">${meta}</div></div>
    <span class="capbtns"><button class="btn sm" data-act="cap-sum" data-name="${name}">${escapeHtml(c.analyse)}</button><button class="btn sm" data-act="cap-dl" data-name="${name}">${escapeHtml(c.download)}</button>
    <button class="btn sm d" data-act="cap-del" data-name="${name}" aria-label="${escapeHtml(fill(c.deleteLabel, { name: file.name }))}">${escapeHtml(c.delete)}</button></span></li>`;
}

/** The card: the form, or the running capture, and the kept files. `capture` is null while loading. */
export function renderCapture(capture, ctx) {
  const { t, language, canWrite, form } = ctx;
  const clients = ctx.clients ?? [];
  const c = t.inet.capture;
  if (capture === "failed") return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span><p class="hint">${escapeHtml(c.unavailable)}</p></section>`;
  if (!capture) return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span><p class="hint">${escapeHtml(t.loading)}</p></section>`;
  const job = capture.job;
  const busy = job?.state === "running";
  const detecting = Boolean(ctx.detecting || capture.detecting);
  const hasAccessPoints = capture.interfaces.some((i) => /^1-vap\d+$/.test(i.id));
  const lim = capture.limits;
  const off = busy ? " disabled" : "";
  const controls = `<div class="capstart"><div class="capform">
      <label class="field"><span class="label">${escapeHtml(c.interface)}</span><select id="cap-if"${off}>${interfaceOptions(capture.interfaces, form.interface, c, t)}</select></label>
      <label class="field"><span class="label">${escapeHtml(c.device)}</span><select id="cap-dev"${off}>${option("", c.allDevices, form.mac)}${clients.map((d) => option(d.mac, d.name, form.mac)).join("")}</select></label>
      <label class="field"><span class="label">${escapeHtml(c.seconds)}</span><input type="number" id="cap-sec" min="${lim.min_seconds}" max="${lim.max_seconds}" value="${escapeHtml(form.seconds)}"${off} /></label>
      <label class="field"><span class="label">${escapeHtml(c.size)}</span><input type="number" id="cap-mb" min="1" max="${lim.max_mb}" value="${escapeHtml(form.mb)}"${off} /></label>
      <button class="btn p" data-act="cap-start"${busy || detecting ? " disabled" : ""}>${escapeHtml(c.start)}</button></div></div>
    ${hasAccessPoints ? `<div class="detectrow"><button class="btn sm" data-act="cap-detect"${busy || detecting ? " disabled" : ""}>${escapeHtml(detecting ? c.detecting : c.detect)}</button><small>${escapeHtml(c.detectHint)}</small></div>` : ""}`;
  const list = capture.files.length
    ? `<ul class="capfiles">${capture.files.map((f) => fileLine(f, t, language, clients, capture.interfaces)).join("")}</ul>`
    : `<p class="hint">${escapeHtml(c.none)}</p>`;
  const files = `<div class="capexisting"><span class="label">${escapeHtml(fill(c.existing, { n: capture.files.length }))}</span>${list}</div>`;
  return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span>
    ${controls}
    ${busy ? running(job, t, language) : result(job, t, language)}
    ${files}
    ${ctx.summary ? summaryBlock(ctx.summary, t, language) : ""}
    ${noteHtml(t.diag.note, c.hint)}${form.mac ? `${hintNote(c.deviceHint, t)}` : ""}</section>`;
}
