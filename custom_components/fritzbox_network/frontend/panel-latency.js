/* The course of the connection on the diagnosis page: the check run every few minutes, as one strip per step over 24 hours. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";

export const BUCKET_SECONDS = 900; // 96 buckets of 15 minutes make a day
export const BUCKETS = 96;
// a step that takes longer than this (ms) is slow, a step that fails is down; IPv6 may be absent
const SLOW_MS = { box: 100, internet: 150, dns: 300, web: 500, ipv6: 500 };

/**
 * The samples of one step in 96 buckets of 15 minutes ending now: "none" where nothing was
 * measured, "ok", "slow" or "fail" by the worst sample in it. `samples` are [seconds, ms…] in the
 * order of `steps`; a failed step has null.
 */
export function latencyBuckets(samples, steps, step, now) {
  const index = steps.indexOf(step) + 1;
  const end = Math.ceil(now / BUCKET_SECONDS) * BUCKET_SECONDS;
  const start = end - BUCKETS * BUCKET_SECONDS;
  const buckets = Array.from({ length: BUCKETS }, (_, n) => ({ state: "none", from: start + n * BUCKET_SECONDS, ms: null }));
  const rank = { none: 0, ok: 1, slow: 2, fail: 3 };
  for (const sample of samples) {
    const n = Math.floor((sample[0] - start) / BUCKET_SECONDS);
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

/** The button that switches the recording on or off. */
export function latencyButton(latency, t) {
  const c = t.diag.latency;
  const on = Boolean(latency && latency !== "failed" && latency.enabled);
  return `<button class="btn" data-act="latency-switch" data-on="${on ? "0" : "1"}">${escapeHtml(on ? c.stop : c.start)}</button>`;
}

/** What the recording shows: a message, or one strip per step with the last time, the median and the failures. */
export function latencyBody(latency, ctx) {
  const { t, language, now } = ctx;
  const c = t.diag.latency;
  if (latency === "failed") return `<p class="hint">${escapeHtml(c.failed)}</p>`;
  if (!latency) return `<p class="hint">${escapeHtml(t.loading)}</p>`;
  if (!latency.samples.length) return `<p class="hint">${escapeHtml(latency.enabled ? c.waiting : c.off)}</p>`;
  const rows = latency.steps
    .map((step) => {
      const summary = latencySummary(latency.samples, latency.steps, step);
      const label = t.diag.check.steps[step];
      const facts = [
        summary.last === null ? "" : fill(c.last, { ms: Math.round(summary.last) }),
        summary.median === null ? "" : fill(c.median, { ms: Math.round(summary.median) }),
        summary.failed ? fill(c.failures, { n: summary.failed, runs: summary.runs }) : "",
      ].filter(Boolean);
      return `<div class="latrow"><div class="lathead"><b>${escapeHtml(label)}</b><small>${escapeHtml(facts.join(" · "))}</small></div>${strip(latencyBuckets(latency.samples, latency.steps, step, now), label, language, t)}</div>`;
    })
    .join("");
  const legend = `<div class="legend2"><span><i class="lat ok"></i>${escapeHtml(c.legendOk)}</span><span><i class="lat slow"></i>${escapeHtml(c.legendSlow)}</span><span><i class="lat fail"></i>${escapeHtml(c.legendFail)}</span><span><i class="lat none"></i>${escapeHtml(c.legendNone)}</span><span class="grow">${escapeHtml(c.span)}</span></div>`;
  return rows + legend;
}

/** The text on how the recording works. */
export function latencyHint(latency, t) {
  const minutes = Math.round((latency && latency !== "failed" ? latency.interval : 300) / 60);
  return fill(t.diag.latency.hint, { minutes });
}
