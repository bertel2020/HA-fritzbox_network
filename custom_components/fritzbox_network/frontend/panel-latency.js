/* The course of the connection on the diagnosis page: the check run every few minutes, as one strip per step over 24 hours. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";

export const BUCKET_SECONDS = 900; // 96 buckets of 15 minutes make a day
export const BUCKETS = 96;
// the two spans the strips can show: the day, and the three days the times are kept; 96 bars each
export const RANGES = { day: { bucket: BUCKET_SECONDS, seconds: BUCKETS * BUCKET_SECONDS }, days3: { bucket: 3 * 3 * BUCKET_SECONDS, seconds: BUCKETS * 3 * 3 * BUCKET_SECONDS } };
// a step that takes longer than this (ms) is slow, a step that fails is down; IPv6 may be absent
const SLOW_MS = { box: 100, internet: 150, dns: 300, web: 500, ipv6: 500 };

/**
 * The samples of one step in 96 buckets (15 minutes each unless `size` says otherwise) ending now: "none" where nothing was
 * measured, "ok", "slow" or "fail" by the worst sample in it. `samples` are [seconds, ms…] in the
 * order of `steps`; a failed step has null.
 */
export function latencyBuckets(samples, steps, step, now, size = BUCKET_SECONDS) {
  const index = steps.indexOf(step) + 1;
  const end = Math.ceil(now / size) * size;
  const start = end - BUCKETS * size;
  const buckets = Array.from({ length: BUCKETS }, (_, n) => ({ state: "none", from: start + n * size, ms: null }));
  const rank = { none: 0, ok: 1, slow: 2, fail: 3 };
  for (const sample of samples) {
    const n = Math.floor((sample[0] - start) / size);
    if (n < 0 || n >= BUCKETS) continue;
    const ms = sample[index];
    // no IPv6 on a line is not a failure of the connection
    const state = ms === null || ms === undefined ? (step === "ipv6" ? "none" : "fail") : ms > (SLOW_MS[step] ?? 500) ? "slow" : "ok";
    if (rank[state] > rank[buckets[n].state]) buckets[n].state = state;
    if (typeof ms === "number") buckets[n].ms = Math.max(buckets[n].ms ?? 0, ms);
  }
  return buckets;
}

/** What a step did over the samples: the last time, the median and how many runs failed. */
export function latencySummary(samples, steps, step) {
  const index = steps.indexOf(step) + 1;
  const values = samples.map((s) => s[index]);
  const times = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  return {
    last: values.length ? (values.at(-1) ?? null) : null,
    median: times.length ? times[Math.floor(times.length / 2)] : null,
    failed: step === "ipv6" ? 0 : values.filter((v) => v === null || v === undefined).length,
    runs: values.length,
  };
}

function strip(buckets, label, language, t) {
  const c = t.diag.latency;
  const width = BUCKETS * 6;
  const rects = buckets
    .map((b, n) => {
      const when = new Date(b.from * 1000).toLocaleTimeString(language || "en", { hour: "2-digit", minute: "2-digit" });
      const tip = `${when} · ${b.state === "none" ? c.none : b.state === "fail" ? c.fail : b.ms === null ? "" : fill(c.ms, { ms: Math.round(b.ms) })}`;
      return `<rect class="lat ${b.state}" x="${n * 6}" y="0" width="4.6" height="14" rx="1.5"><title>${escapeHtml(tip)}</title></rect>`;
    })
    .join("");
  return `<svg class="latstrip" viewBox="0 0 ${width} 14" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">${rects}</svg>`;
}

/** The switch of the recording, with what it is doing now written beside it. */
export function latencySwitch(latency, t) {
  const c = t.diag.latency;
  const on = Boolean(latency && latency !== "failed" && latency.enabled);
  const minutes = Math.round((latency && latency !== "failed" ? latency.interval : 300) / 60);
  return `<span class="swstate${on ? " on" : ""}">${escapeHtml(on ? fill(c.stateOn, { minutes }) : c.stateOff)}</span><button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(c.switchLabel)}" data-act="latency-switch" data-on="${on ? "0" : "1"}"></button>`;
}

/** The choice between the last day and the last three days. */
export function latencyRangeSwitch(range, t) {
  const c = t.diag.latency;
  const button = (key, label) => `<button data-act="latency-range" data-range="${key}" aria-pressed="${range === key}">${escapeHtml(label)}</button>`;
  return `<div class="seg" role="group" aria-label="${escapeHtml(c.rangeLabel)}">${button("day", c.range.day)}${button("days3", c.range.days3)}</div>`;
}

/** What the recording shows: a message, or one strip per step with the last time, the median and the failures. */
export function latencyBody(latency, ctx) {
  const { t, language, now } = ctx;
  const c = t.diag.latency;
  const range = RANGES[ctx.range] ? ctx.range : "day";
  const { bucket, seconds } = RANGES[range];
  if (latency === "failed") return `<p class="hint">${escapeHtml(c.failed)}</p>`;
  if (!latency) return `<p class="hint">${escapeHtml(t.loading)}</p>`;
  const minutes = Math.round((latency.interval ?? 300) / 60);
  if (!latency.enabled && !latency.samples.length) {
    const ghosts = ["box", "internet", "dns"]
      .map((step) => `<div class="latrow ghost"><div class="lathead"><b>${escapeHtml(t.diag.check.steps[step])}</b></div>${strip(latencyBuckets([], latency.steps, step, now, bucket), "", language, t)}</div>`)
      .join("");
    return `${ghosts}<div class="latcta"><b>${escapeHtml(c.previewTitle)}</b> ${escapeHtml(c.previewText)}<p class="hint">${escapeHtml(fill(c.privacy, { minutes }))}</p></div>`;
  }
  if (!latency.samples.length) return `<p class="hint">${escapeHtml(c.waiting)}</p>`;
  const samples = latency.samples.filter((s) => s[0] >= now - seconds);
  const rows = latency.steps
    .map((step) => {
      const summary = latencySummary(samples, latency.steps, step);
      const label = t.diag.check.steps[step];
      const facts = [
        summary.last === null ? "" : fill(c.last, { ms: Math.round(summary.last) }),
        summary.median === null ? "" : fill(c.median, { ms: Math.round(summary.median) }),
        summary.failed ? fill(c.failures, { n: summary.failed, runs: summary.runs }) : "",
      ].filter(Boolean);
      return `<div class="latrow"><div class="lathead"><b>${escapeHtml(label)}</b><small>${escapeHtml(facts.join(" · "))}</small></div>${strip(latencyBuckets(latency.samples, latency.steps, step, now, bucket), label, language, t)}</div>`;
    })
    .join("");
  const legend = `<div class="legend2"><span><i class="lat ok"></i>${escapeHtml(c.legendOk)}</span><span><i class="lat slow"></i>${escapeHtml(c.legendSlow)}</span><span><i class="lat fail"></i>${escapeHtml(c.legendFail)}</span><span><i class="lat none"></i>${escapeHtml(c.legendNone)}</span><span class="grow">${escapeHtml(range === "day" ? c.span : c.spanDays)}</span></div>`;
  return rows + legend;
}

/** The part of the card for the course: its heading, the choice of the span and the switch, then the strips or the preview. */
export function latencySection(latency, ctx) {
  const { t } = ctx;
  const on = Boolean(latency && latency !== "failed" && latency.enabled);
  return `<div class="course"><div class="chead"><span class="sub">${escapeHtml(t.diag.latency.heading)}</span><div class="coursectl">${on ? latencyRangeSwitch(ctx.range === "days3" ? "days3" : "day", t) : ""}${latencySwitch(latency, t)}</div></div>${latencyBody(latency, ctx)}</div>`;
}

/** The text on how the recording works. */
export function latencyHint(latency, t) {
  const minutes = Math.round((latency && latency !== "failed" ? latency.interval : 300) / 60);
  return fill(t.diag.latency.hint, { minutes });
}
