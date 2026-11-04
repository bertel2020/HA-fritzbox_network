/* The packet capture of the internet page: choose an interface and a time, record, download the pcap. */

import { escapeHtml, formatBytes } from "./shared.js";
import { fill } from "./texts.js";

/** The form values to start with. */
export function captureDefaults(limits) {
  return { interface: "internet", seconds: limits?.seconds ?? 60, mb: limits?.mb ?? 50 };
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

function fileLine(file, t, language) {
  const c = t.inet.capture;
  const when = new Date(file.time).toLocaleString(language || "en", { dateStyle: "short", timeStyle: "medium" });
  return `<li><span class="pdesc">${escapeHtml(c.interfaces[file.interface] ?? file.interface)}<small> ${escapeHtml(when)} · ${escapeHtml(formatBytes(file.bytes, language))}</small></span>
    <span class="capbtns"><button class="btn" data-act="cap-dl" data-name="${escapeHtml(file.name)}">${escapeHtml(c.download)}</button>
    <button class="btn dp" data-act="cap-del" data-name="${escapeHtml(file.name)}" aria-label="${escapeHtml(fill(c.deleteLabel, { name: file.name }))}">${escapeHtml(c.delete)}</button></span></li>`;
}

/** The card: the form, or the running capture, and the kept files. `capture` is null while loading. */
export function renderCapture(capture, ctx) {
  const { t, language, canWrite, form } = ctx;
  const c = t.inet.capture;
  if (capture === "failed") return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span><p class="hint">${escapeHtml(c.unavailable)}</p></section>`;
  if (!capture) return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span><p class="hint">${escapeHtml(t.loading)}</p></section>`;
  const job = capture.job;
  const busy = job?.state === "running";
  const lim = capture.limits;
  const off = busy ? " disabled" : "";
  const controls = `<div class="capform">
      <label class="field"><span class="label">${escapeHtml(c.interface)}</span><select id="cap-if"${off}>${capture.interfaces.map((i) => option(i, c.interfaces[i] ?? i, form.interface)).join("")}</select></label>
      <label class="field"><span class="label">${escapeHtml(c.seconds)}</span><input type="number" id="cap-sec" min="${lim.min_seconds}" max="${lim.max_seconds}" value="${escapeHtml(form.seconds)}"${off} /></label>
      <label class="field"><span class="label">${escapeHtml(c.size)}</span><input type="number" id="cap-mb" min="1" max="${lim.max_mb}" value="${escapeHtml(form.mb)}"${off} /></label>
      <button class="btn p" data-act="cap-start"${busy ? " disabled" : ""}>${escapeHtml(c.start)}</button></div>`;
  const files = capture.files.length
    ? `<ul class="ports capfiles">${capture.files.map((f) => fileLine(f, t, language)).join("")}</ul>`
    : `<p class="hint">${escapeHtml(c.none)}</p>`;
  return `<section class="card sec"><span class="label">${escapeHtml(c.title)}</span>
    ${controls}
    ${busy ? running(job, t, language) : result(job, t, language)}
    ${files}
    <p class="hint">${escapeHtml(c.hint)}</p></section>`;
}
