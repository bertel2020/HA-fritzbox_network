/* The packet capture of the internet page: choose an interface and a time, record, download the pcap. */

import { errorCard, escapeHtml, loadingCard, formatBytes, hintNote, noteHtml } from "./shared.js";
import { fill } from "./texts.js";

/** The form of the ring buffer, from what the options say. */
export function ringDefaults(capture) {
  const o = capture?.ring_options ?? {};
  const l = capture?.limits ?? {};
  return { interface: o.interface ?? "1-lan", minutes: o.minutes ?? l.ring_minutes ?? 5, mb: o.mb ?? l.ring_mb ?? 100, mac: "" };
}

/** How soon the capture page reads again: every second while one records, every 3 s with the ring buffer, else every 15 s. */
export function captureRefreshMs(capture) {
  if (capture?.job?.state === "running") return 1000;
  if (capture?.ring?.active) return 3000;
  return 15000;
}

/** The form values to start with. */
export function captureDefaults(limits) {
  return { interface: "", seconds: limits?.seconds ?? 60, mb: limits?.mb ?? 50, mac: "" };
}

/** The interface to start with: the LAN when the box has one, else the first. */
export function defaultInterface(interfaces) {
  return (interfaces.find((i) => i.id === "1-lan") ?? interfaces[0])?.id ?? "";
}

/**
 * The form with one device chosen (from its page, the command palette or a link "#/capture?mac=…").
 * The traffic of one device is only on the interfaces of the home network: an interface of the
 * internet side ("2-…") gives way to the usual one, as far as the interfaces are known.
 */
export function captureForDevice(form, mac, interfaces) {
  const wan = String(form.interface ?? "").startsWith("2-");
  const iface = mac && wan && interfaces?.length ? defaultInterface(interfaces) : form.interface;
  return { ...form, interface: iface, mac: String(mac ?? "").toLowerCase() };
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

/** A span of a capture: "12 s", "2 min 5 s". */
export function captureSpan(seconds, c) {
  if (typeof seconds !== "number" || seconds < 0) return "";
  const whole = Math.round(seconds);
  return whole < 60 ? fill(c.span.s, { s: whole }) : fill(c.span.ms, { m: Math.floor(whole / 60), s: whole % 60 });
}

/** The interface of a kept capture: by the id of the box where the file tells it, else by the part of its name. */
function fileInterface(file, interfaces) {
  return (file.interface_id && interfaces.find((i) => i.id === file.interface_id)) || interfaces.find((i) => i.slug === file.interface) || null;
}

/** The chips of a capture: where it came from (ring buffer, trigger) and the device it is narrowed to. */
function originChips(item, c, clients) {
  const device = item.device ? clients.find((d) => d.id === item.device) : null;
  const ring = item.ring ? `<span class="chip">${escapeHtml(item.trigger ? fill(c.ring.savedBy, { entity: item.trigger }) : c.ring.saved)}</span>` : "";
  const only = item.device ? `<span class="chip">${escapeHtml(device?.name ?? item.device_name ?? item.device)}</span>` : "";
  return ring + only;
}

function when(time, language) {
  return new Date(time).toLocaleString(language || "en", { dateStyle: "medium", timeStyle: "short" });
}

function fileLine(file, t, language, clients, interfaces) {
  const c = t.inet.capture;
  const known = fileInterface(file, interfaces);
  const name = escapeHtml(file.name);
  const facts = [when(file.time, language), formatBytes(file.bytes, language)];
  if (typeof file.packets === "number") facts.push(fill(c.packets, { n: file.packets.toLocaleString(language || "en") }));
  const span = captureSpan(file.seconds, c);
  if (span && file.packets > 1) facts.push(span);
  const ended = file.reason ? c.ended[file.reason] : "";
  if (ended) facts.push(ended);
  const meta = facts.map((x) => `<span>${escapeHtml(x)}</span>`).join("");
  const title = known ? interfaceName(known, t) : (file.interface_id ?? file.interface);
  const id = known?.id ?? file.interface_id;
  const live = file.recording ? `<span class="chip info">${escapeHtml(c.recording)}</span>` : "";
  const warn = file.reason === "error" ? `<span class="chip warn">${escapeHtml(c.ended.error)}</span>` : "";
  const buttons = file.recording
    ? ""
    : `<span class="capbtns"><button class="btn sm" data-act="cap-sum" data-name="${name}">${escapeHtml(c.analyse)}</button><button class="btn sm" data-act="cap-dl" data-name="${name}">${escapeHtml(c.download)}</button>
    <button class="btn sm d" data-act="cap-del" data-name="${name}" aria-label="${escapeHtml(fill(c.deleteLabel, { name: file.name }))}">${escapeHtml(c.delete)}</button></span>`;
  return `<li class="capfile"><div class="capmain"><b>${escapeHtml(title)}</b>${id ? `<code>${escapeHtml(id)}</code>` : ""}${live}${warn}${originChips(file, c, clients)}
      <div class="capmeta">${meta}</div></div>
    ${buttons}</li>`;
}

/** A capture that failed or kept nothing: it stays in the list with the reason until it is dismissed. */
function failureLine(failure, t, language, clients, interfaces) {
  const c = t.inet.capture;
  const known = interfaces.find((i) => i.id === failure.interface);
  const title = known ? interfaceName(known, t) : failure.interface;
  const meta = [when(failure.time, language), failure.error].map((x) => `<span>${escapeHtml(x)}</span>`).join("");
  return `<li class="capfile"><div class="capmain"><b>${escapeHtml(title)}</b><code>${escapeHtml(failure.interface)}</code><span class="chip bad">${escapeHtml(c.failedChip)}</span>${originChips(failure, c, clients)}
      <div class="capmeta">${meta}</div></div>
    <span class="capbtns"><button class="btn sm" data-act="cap-dismiss" data-id="${escapeHtml(failure.id)}">${escapeHtml(c.dismiss)}</button></span></li>`;
}

/** The kept captures and the failed ones, newest first. */
export function captureItems(capture) {
  const files = (capture.files ?? []).map((f) => ({ kind: "file", time: f.time, item: f }));
  const failures = (capture.failures ?? []).map((f) => ({ kind: "failure", time: f.time, item: f }));
  return [...files, ...failures].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
}

/** The card of the ring buffer: what it holds, the way to start, stop and save it, and what saves it by itself. */
function renderRing(capture, ctx) {
  const { t, language, form } = ctx;
  const clients = ctx.clients ?? [];
  const c = t.inet.capture;
  const r = c.ring;
  const ring = capture.ring ?? { active: false };
  const lim = capture.limits;
  const other = capture.job?.state === "running" || Boolean(ctx.detecting || capture.detecting);
  const off = ring.active ? " disabled" : "";
  const percent = ring.active ? Math.min(100, Math.round((ring.seconds / (ring.minutes * 60)) * 100)) : 0;
  const o = capture.ring_options ?? {};
  let trigger = escapeHtml(r.noTrigger);
  if (o.trigger) {
    const state = o.trigger_state ? fill(r.triggerTo, { state: o.trigger_state }) : r.triggerAny;
    trigger = escapeHtml(fill(r.trigger, { entity: o.trigger, state, after: o.after }));
  }
  const status = ring.active
    ? `<span class="chip ok">${escapeHtml(r.on)}</span>`
    : `<span class="chip">${escapeHtml(r.off)}</span>`;
  const running = ring.active
    ? `<span class="meter" role="progressbar" aria-label="${escapeHtml(r.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></span>
      <small>${escapeHtml(fill(r.held, { seconds: Math.round(ring.seconds), minutes: ring.minutes, size: formatBytes(ring.bytes, language) }))}</small>
      ${ring.error ? `<p class="hint">${escapeHtml(fill(r.error, { error: ring.error }))}</p>` : ""}
      <div class="capbtns"><button class="btn p" data-act="cap-ring-save">${escapeHtml(r.save)}</button><button class="btn" data-act="cap-ring-stop">${escapeHtml(r.stop)}</button></div>`
    : `<div class="capform">
      <label class="field"><span class="label">${escapeHtml(r.interface)}</span><select id="rg-if">${interfaceOptions(capture.interfaces, form.interface, c, t)}</select></label>
      <label class="field"><span class="label">${escapeHtml(r.device)}</span><select id="rg-dev">${option("", c.allDevices, form.mac)}${clients.map((d) => option(d.mac, d.name, form.mac)).join("")}</select></label>
      <label class="field"><span class="label">${escapeHtml(r.minutes)}</span><input type="number" id="rg-min" min="${lim.ring_min_minutes ?? 1}" max="${lim.ring_max_minutes ?? 30}" value="${escapeHtml(form.minutes)}" /></label>
      <label class="field"><span class="label">${escapeHtml(r.size)}</span><input type="number" id="rg-mb" min="1" max="${lim.ring_max_mb ?? 500}" value="${escapeHtml(form.mb)}" /></label>
      <button class="btn p" data-act="cap-ring-start"${other ? " disabled" : ""}>${escapeHtml(r.start)}</button></div>
      ${other ? `<p class="hint">${escapeHtml(r.busyHint)}</p>` : ""}`;
  return `<section class="card sec"><div class="chead"><span class="label">${escapeHtml(r.title)}</span>${status}</div>
    <p class="hint">${escapeHtml(r.lead)}</p>
    ${running}
    <p class="hint">${trigger}</p>
    ${noteHtml(t.diag.note, r.hint)}</section>`;
}

/** The card: the form, or the running capture, and the kept files. `capture` is null while loading. */
export function renderCapture(capture, ctx) {
  const { t, language, canWrite, form } = ctx;
  const clients = ctx.clients ?? [];
  const c = t.inet.capture;
  if (capture === "failed") return errorCard(t, c.unavailable, { retry: "cap-retry" });
  if (!capture) return loadingCard(t);
  const job = capture.job;
  const ringOn = Boolean(capture.ring?.active);
  const busy = job?.state === "running";
  const blocked = busy || ringOn;
  const detecting = Boolean(ctx.detecting || capture.detecting);
  const hasAccessPoints = capture.interfaces.some((i) => /^1-vap\d+$/.test(i.id));
  const lim = capture.limits;
  const off = blocked ? " disabled" : "";
  const controls = `<div class="capstart"><div class="capform">
      <label class="field"><span class="label">${escapeHtml(c.interface)}</span><select id="cap-if"${off}>${interfaceOptions(capture.interfaces, form.interface, c, t)}</select></label>
      <label class="field"><span class="label">${escapeHtml(c.device)}</span><select id="cap-dev"${off}>${option("", c.allDevices, form.mac)}${clients.map((d) => option(d.mac, d.name, form.mac)).join("")}</select></label>
      <label class="field"><span class="label">${escapeHtml(c.seconds)}</span><input type="number" id="cap-sec" min="${lim.min_seconds}" max="${lim.max_seconds}" value="${escapeHtml(form.seconds)}"${off} /></label>
      <label class="field"><span class="label">${escapeHtml(c.size)}</span><input type="number" id="cap-mb" min="1" max="${lim.max_mb}" value="${escapeHtml(form.mb)}"${off} /></label>
      <button class="btn p" data-act="cap-start"${blocked || detecting ? " disabled" : ""}>${escapeHtml(c.start)}</button></div></div>
    ${hasAccessPoints ? `<div class="detectrow"><button class="btn sm" data-act="cap-detect"${blocked || detecting ? " disabled" : ""}>${escapeHtml(detecting ? c.detecting : c.detect)}</button><small>${escapeHtml(c.detectHint)}</small></div>` : ""}`;
  const items = captureItems(capture);
  const list = items.length
    ? `<ul class="capfiles">${items
        .map(({ kind, item }) => (kind === "file" ? fileLine(item, t, language, clients, capture.interfaces) : failureLine(item, t, language, clients, capture.interfaces)))
        .join("")}</ul>`
    : `<p class="hint">${escapeHtml(c.none)}</p>`;
  const files = `<div class="capexisting"><span class="label">${escapeHtml(fill(c.existing, { n: capture.files.length }))}</span>${list}</div>`;
  return `<section class="card sec"><div class="chead"><span class="label">${escapeHtml(c.title)}</span></div>
    ${controls}
    ${busy ? running(job, t, language) : result(job, t, language)}
    ${files}
    ${ctx.summary ? summaryBlock(ctx.summary, t, language) : ""}
    ${noteHtml(t.diag.note, c.hint)}${form.mac ? `${hintNote(c.deviceHint, t)}` : ""}</section>
    ${renderRing(capture, { ...ctx, form: ctx.ringForm ?? ringDefaults(capture) })}`;
}
