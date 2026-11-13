/* The box page: CPU load, temperature and RAM over a day, a week or a month, one chart each. */

import { escapeHtml, plotAttrs } from "./shared.js";
import { fill } from "./texts.js";

export const HISTORY_RANGES = ["day", "week", "month"];
// the order of the cards, the column of the point [epoch seconds, cpu, temp, ram] and the axis
export const HISTORY_METRICS = [
  { key: "cpu", column: 1, unit: "%", lo: 0, hi: 100, tone: "cpu" },
  { key: "temp", column: 2, unit: "°C", lo: 60, hi: 90, tone: "temp" },
  { key: "ram", column: 3, unit: "%", lo: 0, hi: 100, tone: "ram", steps: true },
];
const WIDTH = 300;
const HEIGHT = 100;

/** The axis of a metric: its usual span, widened in steps of 10 when the values leave it. */
export function historyAxis(metric, values) {
  const found = values.filter((v) => typeof v === "number");
  if (!found.length) return { lo: metric.lo, hi: metric.hi };
  return {
    lo: Math.min(metric.lo, Math.floor(Math.min(...found) / 10) * 10),
    hi: Math.max(metric.hi, Math.ceil(Math.max(...found) / 10) * 10),
  };
}

/** The lowest, the mean and the highest value, and the newest one; null for all without a value. */
export function historySummary(values) {
  const found = values.filter((v) => typeof v === "number");
  if (!found.length) return { min: null, avg: null, max: null, last: null };
  return {
    min: Math.min(...found),
    avg: Math.round(found.reduce((a, b) => a + b, 0) / found.length),
    max: Math.max(...found),
    last: found.at(-1),
  };
}

/** The line and the area of a series as paths, one piece for each run of values; gaps stay empty. */
export function historyPaths(values, axis, steps = false) {
  const n = values.length;
  const x = (i) => (n > 1 ? (i * WIDTH) / (n - 1) : 0);
  const y = (v) => HEIGHT - ((v - axis.lo) / (axis.hi - axis.lo)) * (HEIGHT - 8) - 4;
  const runs = [];
  let run = [];
  values.forEach((v, i) => {
    if (typeof v !== "number") {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    // the RAM is one value an hour: a step, not a slope
    if (steps && run.length) run.push([x(i), run.at(-1)[1]]);
    run.push([x(i), y(v)]);
  });
  if (run.length) runs.push(run);
  const point = ([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`;
  return {
    line: runs.map((r) => `M${r.map(point).join(" L")}`).join(" "),
    area: runs.map((r) => `M${r[0][0].toFixed(1)},${HEIGHT} L${r.map(point).join(" L")} L${r.at(-1)[0].toFixed(1)},${HEIGHT} Z`).join(" "),
    gridY: [axis.lo, (axis.lo + axis.hi) / 2, axis.hi].map(y),
  };
}

function card(metric, history, ctx) {
  const { t, language } = ctx;
  const h = t.boxPage.history;
  const values = history.points.map((p) => p[metric.column]);
  const axis = historyAxis(metric, values);
  const sum = historySummary(values);
  const paths = historyPaths(values, axis, metric.steps);
  const label = `${h.metrics[metric.key]}, ${h.ranges[history.range]}`;
  const pts = history.points.map((p) => [p[0], p[metric.column]]);
  const number = (v) => (typeof v === "number" ? v.toLocaleString(language || "en") : "–");
  const grid = paths.gridY.map((gy) => `<line x1="0" y1="${gy.toFixed(1)}" x2="${WIDTH}" y2="${gy.toFixed(1)}"/>`).join("");
  const stat = (name, v) => `<span>${escapeHtml(name)} <b>${escapeHtml(typeof v === "number" ? `${number(v)} ${metric.unit}` : "–")}</b></span>`;
  const axisLabels = [axis.hi, (axis.lo + axis.hi) / 2, axis.lo].map((v) => `<span>${number(v)}</span>`).join("");
  const xAxis = h.axis[history.range].map((text) => `<span>${escapeHtml(text)}</span>`).join("");
  return `<section class="card bhm hm-${metric.tone}">
    <div class="bhhead"><span class="label">${escapeHtml(h.metrics[metric.key])}</span><span class="bhnow">${escapeHtml(typeof sum.last === "number" ? `${number(sum.last)} ${metric.unit}` : "–")}</span></div>
    <div class="bhplot"><div class="bhy" aria-hidden="true">${axisLabels}</div>
      <div class="plot" ${plotAttrs(label)} data-mode="time" data-unit="${escapeHtml(metric.unit)}" data-range="${history.range === "day" ? "day" : "week"}" data-pts="${escapeHtml(JSON.stringify(pts))}">
        <svg class="hspark" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><g class="hgrid">${grid}</g>
          ${paths.area ? `<path class="harea" d="${paths.area}"/>` : ""}${paths.line ? `<path class="hline" d="${paths.line}"/>` : ""}</svg>
        <i class="cursor" hidden></i><b class="tip" hidden></b></div></div>
    <div class="bhx" aria-hidden="true">${xAxis}</div>
    <div class="bhstats">${stat(h.min, sum.min)}${stat(h.avg, sum.avg)}${stat(h.max, sum.max)}</div>
  </section>`;
}

/** The switch of the recording, with what it is doing now written beside it. */
export function historySwitch(history, t) {
  const h = t.boxPage.history;
  const on = Boolean(history && history !== "failed" && history.enabled);
  const minutes = Math.round((history && history !== "failed" ? history.interval : 300) / 60);
  return `<span class="swstate${on ? " on" : ""}">${escapeHtml(on ? fill(h.stateOn, { minutes }) : h.stateOff)}</span><button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(h.switchLabel)}" data-act="box-history-switch" data-k="box-history-switch" data-on="${on ? "0" : "1"}"></button>`;
}

function rangeSwitch(range, t) {
  const h = t.boxPage.history;
  const button = (key) => `<button data-act="box-history-range" data-range="${key}" aria-pressed="${range === key}">${escapeHtml(h.ranges[key])}</button>`;
  return `<div class="seg" role="group" aria-label="${escapeHtml(h.rangeLabel)}">${HISTORY_RANGES.map(button).join("")}</div>`;
}

/** The note under the charts of a week or a month: why they are empty, or since when they have values. */
function recordingNote(history, ctx) {
  const { t, language } = ctx;
  const h = t.boxPage.history;
  if (history.range === "day") return `<p class="hint">${escapeHtml(h.dayHint)}</p>`;
  const since = history.since ? new Date(history.since * 1000).toLocaleString(language || "en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  if (!history.enabled && !history.since) return `<p class="bhnote">${escapeHtml(h.off)}</p>`;
  if (!history.enabled) return `<p class="bhnote">${escapeHtml(fill(h.pausedSince, { time: since }))}</p>`;
  return `<p class="bhnote">${escapeHtml(history.since ? fill(h.recordingSince, { time: since }) : h.recordingNew)}</p>`;
}

/** The part of the box page for the course: heading, choice of span and switch, then the three charts. */
export function renderHistory(history, ctx) {
  const { t } = ctx;
  const h = t.boxPage.history;
  const range = HISTORY_RANGES.includes(ctx.historyRange) ? ctx.historyRange : "day";
  const head = `<div class="vhead"><div><span class="label">${escapeHtml(h.title)}</span><small class="muted">${escapeHtml(h.lead)}</small></div>
      <div class="coursectl">${rangeSwitch(range, t)}${historySwitch(history, t)}</div></div>`;
  if (history === null || history === undefined) return `<section class="bhist">${head}<p class="hint">${escapeHtml(t.loading)}</p></section>`;
  if (history === "failed") return `<section class="bhist">${head}<p class="hint">${escapeHtml(h.failed)}</p></section>`;
  if (!history.points?.length) return `<section class="bhist">${head}<div class="card empty"><b>${escapeHtml(h.none)}</b><span>${escapeHtml(h.noneHint)}</span></div></section>`;
  return `<section class="bhist">${head}<div class="bhgrid">${HISTORY_METRICS.map((m) => card(m, history, ctx)).join("")}</div>${recordingNote(history, ctx)}</section>`;
}
