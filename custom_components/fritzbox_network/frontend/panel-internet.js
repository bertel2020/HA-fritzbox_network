/* The internet page of the panel: the connection of the box, its load and, on a DSL line, its quality. */

import { escapeHtml, formatDuration, formatRate, sparkPaths, usedPercent } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { whenText } from "./panel-network.js";

const CHART = { width: 300, height: 72 };

/** The two rates at the internet node of the map, "↓ 38.2 Mbit/s ↑ 4.1 Mbit/s"; empty before the first rate. */
export function nodeRates(internet, language) {
  const rate = internet?.throughput;
  return rate ? { down: formatRate(rate.down, language), up: formatRate(rate.up, language) } : null;
}

/** What a screen reader says for the node: "Internet, connected, 38 Mbit/s down, 4 Mbit/s up". */
export function nodeLabel(internet, t, language) {
  const i = t.inet;
  const rates = nodeRates(internet, language);
  return [
    t.internetNode,
    internet.connected === false ? i.nodeDown : i.nodeUp,
    rates ? `${rates.down} ${i.down}, ${rates.up} ${i.up}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Two rates with one unit, "56.3 / 11.3 Mbit/s", as far as both are Mbit/s. */
function pairRate(down, up, language) {
  if (typeof down !== "number" || typeof up !== "number" || down < 1000 || up < 1000) {
    return `${formatRate(down, language)} / ${formatRate(up, language)}`;
  }
  const number = (kbit) => (kbit / 1000).toLocaleString(language || "en", { maximumFractionDigits: kbit >= 100000 ? 0 : 1 });
  return `${number(down)} / ${number(up)} Mbit/s`;
}

function tile(label, value, small = "") {
  return `<div class="tile"><span class="label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${small ? `<small>${escapeHtml(small)}</small>` : ""}</div>`;
}

function gauge(kind, label, rate, max, language, t) {
  const percent = usedPercent(rate, max);
  const sub = rate === null || rate === undefined ? t.inet.measuring : max ? fill(t.inet.ofSync, { rate: formatRate(max, language) }) : "";
  return `<div class="gauge ${kind}"><span class="gl">${escapeHtml(label)}</span>
    <span class="meter" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" ${percent === null ? "" : `aria-valuenow="${percent}"`}><i style="width:${percent ?? 0}%"></i></span>
    <b class="gv">${escapeHtml(formatRate(rate ?? null, language))}</b>${sub ? `<small class="gs">${escapeHtml(sub)}</small>` : ""}</div>`;
}

function chart(internet, language, t) {
  const paths = sparkPaths(internet.samples, CHART.width, CHART.height);
  if (!paths) return `<p class="hint">${escapeHtml(t.inet.historyNone)}</p>`;
  const span = formatDuration(paths.seconds, t.inet.units);
  return `<svg class="spark" viewBox="0 0 ${CHART.width} ${CHART.height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(`${t.inet.history}, ${fill(t.inet.historySpan, { time: span })}`)}">
      <line x1="0" y1="${CHART.height - 0.5}" x2="${CHART.width}" y2="${CHART.height - 0.5}"/>
      <path class="dn-area" d="${paths.area}"/><path class="dn" d="${paths.down}"/><path class="upl" d="${paths.up}"/></svg>
    <div class="legend2"><span><i class="dn"></i>${escapeHtml(t.inet.down)}</span><span><i class="upl"></i>${escapeHtml(t.inet.up)}</span>
      <span class="grow">${escapeHtml(fill(t.inet.historySpan, { time: span }))} · max ${escapeHtml(formatRate(paths.top, language))}</span></div>`;
}

function lineQuality(dsl, language, t) {
  const i = t.inet;
  const pair = (a, b, unit) => (a === null && b === null ? "–" : `${a ?? "–"} / ${b ?? "–"} ${unit}`);
  const errors = dsl.fec_errors === null && dsl.crc_errors === null ? "–" : `FEC ${dsl.fec_errors ?? "–"} · CRC ${dsl.crc_errors ?? "–"}`;
  const kind = [dsl.modulation, dsl.profile].filter(Boolean).length
    ? fill(i.lineProfile, { modulation: dsl.modulation ?? "", profile: dsl.profile ?? "–" })
    : "";
  return `<section class="card sec"><span class="label">${escapeHtml(i.line)}</span>
    ${kind ? `<p class="hint">${escapeHtml(kind)}</p>` : ""}
    <div class="tiles">
      ${tile(i.lineSync, pairRate(dsl.rate_down, dsl.rate_up, language), fill(i.lineMax, { down: formatRate(dsl.max_rate_down, language), up: formatRate(dsl.max_rate_up, language) }))}
      ${tile(i.lineNoise, pair(dsl.noise_margin_down, dsl.noise_margin_up, "dB"))}
      ${tile(i.lineAtt, pair(dsl.attenuation_down, dsl.attenuation_up, "dB"))}
      ${tile(i.lineErrors, errors)}
    </div>
    <p class="hint">${escapeHtml(i.lineHint)}</p></section>`;
}

function events(internet, t, now) {
  const i = t.inet;
  const items = (internet.events ?? [])
    .map(
      (e) =>
        `<li><time>${escapeHtml(whenText(e.time, now, t))}</time><span>${escapeHtml(fill(i.kinds[e.kind] ?? e.kind, { detail: e.detail ?? "" }))}</span></li>`
    )
    .join("");
  return `<section class="card sec"><span class="label">${escapeHtml(i.events)}</span>
    ${items ? `<ul class="events">${items}</ul>` : `<p class="hint">${escapeHtml(i.eventsNone)}</p>`}
    <p class="hint">${escapeHtml(i.eventsHint)}</p></section>`;
}

const DAY = 86400000;
// the noise margin in dB below which a DSL line gets unstable
const NOISE_WARN = 10;
const NOISE_BAD = 6;
const RECONNECTS_WARN = 3;
// the share of the line rate that counts as full, over the last samples
const SATURATED = 0.9;
const SATURATED_SAMPLES = 3;

/**
 * What stands out about the connection, most serious first: [{ level, key, values }] with the level
 * "bad", "warn" or "info" and the key of the text in t.inet.hints.
 */
export function internetHints(internet, now) {
  if (!internet) return [];
  const hints = [];
  if (internet.connected === false) hints.push({ level: "bad", key: "down", values: {} });
  const margins = [internet.dsl?.noise_margin_down, internet.dsl?.noise_margin_up].filter((n) => typeof n === "number");
  if (margins.length) {
    const margin = Math.min(...margins);
    if (margin < NOISE_BAD) hints.push({ level: "bad", key: "noiseVeryLow", values: { db: margin } });
    else if (margin < NOISE_WARN) hints.push({ level: "warn", key: "noiseLow", values: { db: margin } });
  }
  const drops = (internet.events ?? []).filter(
    (e) => (e.kind === "reconnected" || e.kind === "disconnected") && now - Date.parse(e.time) < DAY
  );
  // a loss followed by the new connection is one interruption, not two
  const lost = drops.filter((e) => e.kind === "reconnected").length || drops.length;
  if (lost >= RECONNECTS_WARN) hints.push({ level: "warn", key: "reconnects", values: { n: lost } });
  const recent = (internet.samples ?? []).slice(-SATURATED_SAMPLES);
  if (recent.length === SATURATED_SAMPLES) {
    const full = (index, max) => typeof max === "number" && max > 0 && recent.every((s) => s[index] >= max * SATURATED);
    if (full(1, internet.rate_down)) hints.push({ level: "info", key: "saturatedDown", values: {} });
    if (full(2, internet.rate_up)) hints.push({ level: "info", key: "saturatedUp", values: {} });
  }
  const order = { bad: 0, warn: 1, info: 2 };
  return hints.sort((a, b) => order[a.level] - order[b.level]);
}

function hintsHtml(internet, t, now) {
  const hints = internetHints(internet, now);
  if (!hints.length) return "";
  return `<section class="card sec hints" aria-label="${escapeHtml(t.inet.hintsLabel)}">${hints
    .map(
      (h) =>
        `<p class="hintline ${h.level}"><span aria-hidden="true">${ic(h.level === "info" ? "check" : "alert")}</span><span>${escapeHtml(fill(t.inet.hints[h.key], h.values))}</span></p>`
    )
    .join("")}</section>`;
}

/** The whole page. Without data from the box it says so and offers the way back. */
export function renderInternet(internet, ctx) {
  const { t, language, now } = ctx;
  const i = t.inet;
  const back = `<div class="dhead"><button class="back" data-act="back" data-k="back">${ic("back")}${escapeHtml(t.tabs.net)}</button>
    <h1 id="dtitle" tabindex="-1">${escapeHtml(i.title)}</h1></div>`;
  if (!internet) return `${back}<div class="card"><div class="empty"><b>${escapeHtml(i.noData)}</b></div></div>`;
  const up = internet.connected !== false;
  const sub = [
    internet.access_type,
    internet.uptime !== null && up ? fill(i.since, { time: formatDuration(internet.uptime, i.units) }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const dns = internet.dns?.length
    ? [internet.dns[0], internet.dns.length > 1 ? fill(i.more, { n: internet.dns.length - 1 }) : ""].filter(Boolean)
    : null;
  const prefix = internet.ipv6_prefix ? `${internet.ipv6_prefix}/${internet.ipv6_prefix_length ?? ""}`.replace(/\/$/, "") : "–";
  const rate = internet.throughput;
  return `${back}
    ${hintsHtml(internet, t, now)}
    <section class="card sec">
      <div class="ihead"><span class="ico">${ic("globe")}</span>
        <span class="who"><b>${escapeHtml(i.connection)}</b><small>${escapeHtml(sub)}</small></span>
        <span class="stat ${up ? "ok" : "warn"}">${escapeHtml(up ? i.state.up : i.state.down)}</span></div>
      <div class="tiles">
        ${tile(i.ipv4, internet.external_ipv4 ?? "–")}
        ${tile(i.ipv6, prefix)}
        ${tile(i.dns, dns?.[0] ?? "–", dns?.[1] ?? "")}
        ${tile(i.lastError, internet.last_error && internet.last_error !== "ERROR_NONE" ? internet.last_error : i.noError)}
      </div></section>
    <section class="card sec"><span class="label">${escapeHtml(i.load)}</span>
      ${gauge("dn", i.down, rate?.down, internet.rate_down, language, t)}
      ${gauge("upl", i.up, rate?.up, internet.rate_up, language, t)}
      ${chart(internet, language, t)}
      <p class="hint">${escapeHtml(i.measureNote)}</p></section>
    ${internet.dsl ? lineQuality(internet.dsl, language, t) : ""}
    ${events(internet, t, now)}`;
}
