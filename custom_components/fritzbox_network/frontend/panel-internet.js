/* The internet page of the panel: the connection of the box, its load and, on a DSL line, its quality. */

import { dailyTotals, escapeHtml, formatBytes, formatDuration, formatRate, sparkPaths, trafficByDevice, trafficMonth, trafficSummary, usedPercent } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { whenText } from "./panel-network.js";

const CHART = { width: 300, height: 72 };

/**
 * The name of the access type the box reports ("DSL", "Ethernet", "X_AVM-DE_Fiber" …): a known one
 * in the language of the page, an unknown one as the box wrote it, nothing where it says nothing.
 */
export function accessLabel(type, t) {
  if (!type) return "";
  const key = String(type).toLowerCase().replace(/^x_avm-de_/, "");
  return t.inet.access[key] ?? type;
}

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
  // the rates are kbit/s: the tooltip reads them as rates
  return `<div class="plot" data-mode="time" data-fmt="rate" data-range="day" data-pts="${escapeHtml(JSON.stringify(internet.samples))}">
    <svg class="spark" viewBox="0 0 ${CHART.width} ${CHART.height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(`${t.inet.history}, ${fill(t.inet.historySpan, { time: span })}`)}">
      <line x1="0" y1="${CHART.height - 0.5}" x2="${CHART.width}" y2="${CHART.height - 0.5}"/>
      <path class="dn-area" d="${paths.area}"/><path class="dn" d="${paths.down}"/><path class="upl" d="${paths.up}"/></svg>
    <i class="cursor" hidden></i><b class="tip" hidden></b></div>
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
    ${spectrum(dsl, t, language)}
    <p class="hint">${escapeHtml(i.lineHint)}</p></section>`;
}

// the box gives the signal to noise per tone group in tenths of a dB (assumed, the unit is not documented)
const DB_PER_UNIT = 0.1;
// the highest frequency of a VDSL profile in MHz; a profile that is not known has no frequency axis
const PROFILE_MHZ = { 8: 8.832, 12: 12, 17: 17.664, 30: 30, 35: 35.328 };
// the bands of the plan 998 (profiles 8, 12, 17): [name, from, to] in MHz
const BANDS = { down: [["DS1", 0.138, 3.75], ["DS2", 5.2, 8.5], ["DS3", 12, 17.664]], up: [["US1", 3.75, 5.2], ["US2", 8.5, 12]] };
// a tone group this far under the average is a dip
const DIP_DB = 4;

const oneDecimal = (n, language) => n.toLocaleString(language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** The tone groups of one direction as points [MHz or null, dB or null, band or ""] and the mean of the used ones. */
function spectrumPoints(values, mhz, plan, direction) {
  const dB = values.map((v) => (v > 0 ? v * DB_PER_UNIT : null));
  const used = dB.filter((v) => v !== null);
  const average = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
  const points = dB.map((v, i) => {
    const f = mhz ? ((i + 0.5) / values.length) * mhz : null;
    const band = f !== null && plan ? (BANDS[direction].find(([, a, z]) => f >= a && f < z)?.[0] ?? "") : "";
    return [f === null ? null : Math.round(f * 100) / 100, v === null ? null : Math.round(v * 10) / 10, band];
  });
  return { points, average };
}

/** The stretches of frequency where the signal is far under the average: [[from, to], ...]. */
function dipRuns(points, average) {
  const runs = [];
  let run = null;
  for (const [f, v] of points) {
    if (f !== null && v !== null && v < average - DIP_DB) {
      if (!run) run = [f, f];
      run[1] = f;
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** One chart of the signal over the frequency: dB on the left, MHz below, the average dashed, dips marked. */
function spectrumChart({ points, average }, { max, mhz, label, cls, t, language }) {
  const n = points.length;
  const bars = points
    .map(([, v], i) =>
      v === null ? "" : `<rect${v < average - DIP_DB ? ' class="dip"' : ""} x="${i}" y="${(100 - (v / max) * 100).toFixed(1)}" width="0.85" height="${((v / max) * 100).toFixed(1)}"/>`
    )
    .join("");
  const ticks = [0, 10, 20, 30, 40, 50, 60].filter((v) => v <= max);
  const grid = ticks.map((v) => `<line x1="0" x2="${n}" y1="${(100 - (v / max) * 100).toFixed(1)}" y2="${(100 - (v / max) * 100).toFixed(1)}"/>`).join("");
  const y = ticks.map((v) => `<span style="bottom:${(v / max) * 100}%">${v}</span>`).join("");
  const step = mhz > 20 ? 5 : 2;
  const x = mhz ? [...Array(Math.floor(mhz / step) + 1).keys()].map((k) => `<span style="left:${((k * step) / mhz) * 100}%">${k * step}</span>`).join("") + `<em>MHz</em>` : "";
  const avgY = (100 - (average / max) * 100).toFixed(1);
  return `<figure class="spec ${cls}"><figcaption>${escapeHtml(label)} <small>${escapeHtml(fill(t.inet.spectrumAverage, { n: oneDecimal(average, language) }))}</small></figcaption>
    <div class="specbox"><div class="yax" aria-hidden="true">${y}</div>
      <div class="plot" data-mode="bars" data-fmt="spec" data-unused="${escapeHtml(t.inet.spectrumUnused)}" data-pts="${escapeHtml(JSON.stringify(points))}">
        <svg viewBox="0 0 ${n} 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><g class="sgrid">${grid}</g>${bars}<line class="savg" x1="0" x2="${n}" y1="${avgY}" y2="${avgY}"/></svg>
        <i class="cursor" hidden></i><b class="tip" hidden></b></div></div>
    <div class="xax" aria-hidden="true">${x}</div></figure>`;
}

function spectrum(dsl, t, language) {
  const down = dsl.spectrum_down ?? [];
  const up = dsl.spectrum_up ?? [];
  if (!down.some(Boolean) && !up.some(Boolean)) return "";
  const profile = Number.parseInt(dsl.profile ?? "", 10);
  const mhz = PROFILE_MHZ[profile] ?? null;
  const plan = [8, 12, 17].includes(profile);
  const charts = [
    ["down", down, t.inet.spectrumDown, "sd"],
    ["up", up, t.inet.spectrumUp, "su"],
  ]
    .filter(([, values]) => values.some(Boolean))
    .map(([direction, values, label, cls]) => ({ direction, label, cls, ...spectrumPoints(values, mhz, plan, direction) }));
  const peak = Math.max(...charts.flatMap((c) => c.points.map((p) => p[1] ?? 0)));
  const max = Math.max(10, Math.ceil(peak / 10) * 10);
  const verdict = charts
    .map((c) => ({ c, runs: mhz ? dipRuns(c.points, c.average) : [] }))
    .filter(({ runs }) => runs.length);
  const where = (runs) => runs.map(([a, z]) => (z - a > 0.1 ? `${oneDecimal(a, language)}–${oneDecimal(z, language)}` : oneDecimal(a, language))).join(", ");
  const summary = verdict.length
    ? `<p class="specverdict bad">${verdict.map(({ c, runs }) => escapeHtml(fill(t.inet.spectrumDips, { direction: c.label, n: runs.length, where: where(runs) }))).join("<br>")}</p>`
    : mhz
      ? `<p class="specverdict">${escapeHtml(t.inet.spectrumClean)}</p>`
      : "";
  return `<div class="spectrum"><span class="label">${escapeHtml(t.inet.spectrum)}</span>
    ${charts.map((c) => spectrumChart(c, { max, mhz, label: c.label, cls: c.cls, t, language })).join("")}${summary}
    <p class="hint">${escapeHtml(t.inet.spectrumHint)}</p></div>`;
}

const TOP_DEVICES = 10;

/** The bars of the days: down below, up above, with a tooltip per day. */
function dayBars(rows, language, t) {
  const top = Math.max(1, ...rows.map((r) => r.down + r.up));
  const width = 300 / rows.length;
  const bars = rows
    .map((r, i) => {
      const down = (r.down / top) * 86;
      const up = (r.up / top) * 86;
      const x = (i * width + width * 0.15).toFixed(1);
      const w = (width * 0.7).toFixed(1);
      return `<rect class="bd" x="${x}" y="${(88 - down).toFixed(1)}" width="${w}" height="${down.toFixed(1)}"/><rect class="bu" x="${x}" y="${(88 - down - up).toFixed(1)}" width="${w}" height="${up.toFixed(1)}"/>`;
    })
    .join("");
  const first = new Date(rows[0].ts * 1000).toLocaleDateString(language, { day: "numeric", month: "short" });
  const last = new Date(rows[rows.length - 1].ts * 1000).toLocaleDateString(language, { day: "numeric", month: "short" });
  return `<div class="plot" data-mode="bars" data-fmt="bytes" data-range="date" data-pts="${escapeHtml(JSON.stringify(rows.map((r) => [r.ts, r.down, r.up])))}">
    <svg class="spark days" viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t.inet.perDay)}"><line x1="0" y1="89.5" x2="300" y2="89.5"/>${bars}</svg>
    <i class="cursor" hidden></i><b class="tip" hidden></b></div>
    <div class="legend2"><span><i></i>${escapeHtml(t.inet.down)}</span><span><i class="upl"></i>${escapeHtml(t.inet.up)}</span>
      <span class="grow">${escapeHtml(`${first} – ${last}`)} · max ${escapeHtml(formatBytes(top, language))}</span></div>`;
}

/** The small bars of a tile: one per day, the days before the history as one dashed box. */
function miniBars(rows, since, language) {
  const top = Math.max(1, ...rows.map((r) => r.down + r.up));
  const gap = rows.filter((r) => r.ts < since).length;
  const empty = gap ? `<rect class="gap" x="0.5" y="2" width="${gap * 10 - 1}" height="31" rx="2"/>` : "";
  const bars = rows
    .map((r, k) => {
      if (r.ts < since) return "";
      const down = (r.down / top) * 30;
      const up = (r.up / top) * 30;
      return `<rect class="bd" x="${k * 10 + 1}" y="${(33 - down).toFixed(1)}" width="8" height="${down.toFixed(1)}"/><rect class="bu" x="${k * 10 + 1}" y="${(33 - down - up).toFixed(1)}" width="8" height="${up.toFixed(1)}"/>`;
    })
    .join("");
  return `<svg class="spark mini" viewBox="0 0 ${rows.length * 10} 34" preserveAspectRatio="none" aria-hidden="true">${empty}${bars}</svg>`;
}

/** The data volume of the line: today, 7 and 30 days, the bars per day and who used the most. */
function volumeCard(ctx) {
  const { t, language, traffic, clients, range } = ctx;
  const i = t.inet;
  const known = Object.keys(traffic ?? {}).length > 0;
  const short = (ts) => new Date(ts * 1000).toLocaleDateString(language, { day: "numeric", month: "numeric" });
  const tile = (n) => {
    const s = trafficSummary(traffic, n);
    const note = n === 1 ? "" : s.available < n ? fill(i.trafficSinceDays, { date: short(s.since), n: s.available }) : "";
    let compare = "";
    if (s.change) {
      const pct = Math.round(Math.abs(s.change.ratio) * 100);
      const cls = pct >= 25 ? (s.change.ratio > 0 ? " hi" : " lo") : "";
      const against = n === 1 ? fill(i.trafficVsAverage, { size: formatBytes(s.change.base, language) }) : fill(i.trafficVsDays, { n });
      compare = `<span class="chip${cls}">${s.change.ratio >= 0 ? "↑" : "↓"} ${pct} %</span> ${escapeHtml(s.change.ratio >= 0 ? i.trafficMore : i.trafficLess)} ${escapeHtml(against)}`;
    } else if (n > 1 && s.available) {
      compare = `<span class="chip">${escapeHtml(fill(i.trafficAverage, { size: formatBytes(s.average, language) }))}</span>`;
    }
    const spark = n > 1 && s.available ? miniBars(s.rows, s.since, language) : "";
    const peak = n > 1 && s.peak ? `<div class="peak">${escapeHtml(fill(i.trafficPeak, { size: formatBytes(s.peak.down + s.peak.up, language), date: short(s.peak.ts) }))}</div>` : "";
    return `<div class="tile"><span class="label">${escapeHtml(t.trafficRanges[n])}${note ? ` <span class="since">${escapeHtml(note)}</span>` : ""}</span><b>${escapeHtml(formatBytes(s.down + s.up, language))}</b><small>↓ ${escapeHtml(formatBytes(s.down, language))} · ↑ ${escapeHtml(formatBytes(s.up, language))}</small>${compare ? `<div class="cmp">${compare}</div>` : ""}${spark}${peak}</div>`;
  };
  const monthBlock = () => {
    const m = trafficMonth(traffic);
    const total = m.down + m.up;
    const name = new Date().toLocaleDateString(language, { month: "long" });
    return `<div class="month"><div class="row"><span>${escapeHtml(fill(i.trafficMonth, { month: name }))}</span><b>${escapeHtml(formatBytes(total, language))}</b></div>
      <div class="meter" role="img" aria-label="↓ ${escapeHtml(formatBytes(m.down, language))} · ↑ ${escapeHtml(formatBytes(m.up, language))}"><i class="d" style="width:${total ? ((m.down / total) * 100).toFixed(1) : 0}%"></i><i class="u" style="width:${total ? ((m.up / total) * 100).toFixed(1) : 0}%"></i></div>
      <div class="legend2"><span><i></i>↓ ${escapeHtml(formatBytes(m.down, language))}</span><span><i class="upl"></i>↑ ${escapeHtml(formatBytes(m.up, language))}</span></div></div>`;
  };
  const days = range === 30 ? 30 : 14;
  const names = new Map((clients ?? []).map((c) => [c.mac, c]));
  const rows = Object.entries(trafficByDevice(traffic, range))
    .map(([mac, [down, up]]) => ({ mac, down, up, total: down + up, client: names.get(mac) }))
    .sort((a, b) => b.total - a.total);
  const top = rows[0]?.total || 1;
  const buttons = [1, 7, 30]
    .map((n) => `<button data-trange="${n}" aria-pressed="${n === range}">${escapeHtml(t.trafficRanges[n])}</button>`)
    .join("");
  const list = rows
    .slice(0, TOP_DEVICES)
    .map((r, k) => {
      const name = escapeHtml(r.client?.name ?? r.mac);
      const who = r.client ? `<button class="tlink" data-dev="${escapeHtml(r.client.id)}">${name}</button>` : `<span>${name}</span>`;
      return `<li><span class="rank" aria-hidden="true">${k + 1}</span>${who}<span class="bar" aria-hidden="true"><i class="bd" style="width:${((r.down / top) * 100).toFixed(1)}%"></i><i class="bu" style="width:${((r.up / top) * 100).toFixed(1)}%"></i></span>
        <span class="amount"><b>${escapeHtml(formatBytes(r.total, language))}</b> <small>↓ ${escapeHtml(formatBytes(r.down, language))} · ↑ ${escapeHtml(formatBytes(r.up, language))}</small></span></li>`;
    })
    .join("");
  const rest = rows.slice(TOP_DEVICES);
  const more = rest.length ? `<p class="hint">${escapeHtml(fill(i.topMore, { n: rest.length, size: formatBytes(rest.reduce((a, r) => a + r.total, 0), language) }))}</p>` : "";
  return `<section class="card sec"><div class="trendhead"><span class="label">${escapeHtml(i.volume)}</span><div class="seg" role="group" aria-label="${escapeHtml(i.volume)}">${buttons}</div></div>
    ${known ? `<div class="tiles">${[1, 7, 30].map(tile).join("")}</div>${monthBlock()}
    <div class="subhead">${escapeHtml(i.perDay)}</div>${dayBars(dailyTotals(traffic, days), language, t)}
    <div class="subhead">${escapeHtml(fill(i.topTitle, { range: t.trafficRanges[range] }))}</div>
    ${rows.length ? `<ol class="topdev">${list}</ol>${more}` : `<p class="hint">${escapeHtml(i.topNone)}</p>`}` : `<p class="hint">${escapeHtml(i.topNone)}</p>`}
    <p class="hint">${escapeHtml(i.topHint)}</p></section>`;
}

/** The DNS servers of the box as a tile under the connection: the IPv4 ones left, the IPv6 ones right. */
function dnsTile(servers, t) {
  if (!servers?.length) return "";
  const items = servers.map((server) => `<li><code>${escapeHtml(server)}</code></li>`).join("");
  return `<div class="tile dnstile"><span class="tlabel">${escapeHtml(t.inet.dns)}</span><ul class="dnslist">${items}</ul><small>${escapeHtml(t.inet.dnsNote)}</small></div>`;
}

const SAME_DIAL_MS = 10 * 60 * 1000;
const KINDS = ["ipv4", "ipv6", "prefix"];

/** The periods of all kinds as one row per dial-in: they change together, so their starts lie close. */
export function addressRows(addresses) {
  const periods = KINDS.flatMap((kind) => (addresses?.[kind] ?? []).map((p) => ({ ...p, kind, at: Date.parse(p.since) })))
    .filter((p) => !Number.isNaN(p.at))
    .sort((a, b) => a.at - b.at);
  const rows = [];
  for (const p of periods) {
    const row = rows[rows.length - 1];
    if (row && p.at - row.at < SAME_DIAL_MS && !row[p.kind]) row[p.kind] = p;
    else rows.push({ at: p.at, [p.kind]: p });
  }
  return rows.reverse();
}

/** One table of the addresses that were in use, the newest dial-in first; the one in use now is marked. */
function addressHistory(addresses, language, t) {
  const i = t.inet;
  const day = (ms) => new Date(ms).toLocaleDateString(language, { day: "numeric", month: "short" });
  const rows = addressRows(addresses);
  const head = `<div class="trendhead"><span class="label">${escapeHtml(i.addressHistory)}</span></div>`;
  if (rows.length < 2) return `<section class="card sec">${head}<p class="hint">${escapeHtml(i.addressNone)}</p><p class="hint">${escapeHtml(i.addressHint)}</p></section>`;
  const body = rows
    .map((row, n) => {
      const current = KINDS.some((kind) => row[kind] && !row[kind].until);
      const until = KINDS.map((kind) => row[kind]?.until).find(Boolean);
      const when = `${escapeHtml(day(row.at))}${current ? `<span class="badge">${escapeHtml(i.addressNow)}</span>` : until ? `<small>${escapeHtml(fill(i.addressUntil, { to: day(Date.parse(until)) }))}</small>` : ""}`;
      const cells = KINDS.map((kind) => `<td data-label="${escapeHtml(i.addressKinds[kind])}"><code>${escapeHtml(row[kind]?.value ?? "–")}</code></td>`).join("");
      return `<tr class="${current ? "now" : ""}"><td class="when">${when}</td>${cells}</tr>`;
    })
    .join("");
  return `<section class="card sec">${head}
    <table class="addrtable"><thead><tr><th>${escapeHtml(i.addressSince)}</th>${KINDS.map((kind) => `<th>${escapeHtml(i.addressKinds[kind])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
    <p class="hint">${escapeHtml(i.addressHint)}</p></section>`;
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
const RECONNECTS_WARN = 5;
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

/** One port forwarding as a line: "TCP 443 → Living room TV:8443", the device a link to its page. */
function portLine(entry, t) {
  const p = t.inet.ports;
  const target = entry.device_id
    ? `<button class="linklike" data-dev="${escapeHtml(entry.device_id)}">${escapeHtml(entry.device_name ?? entry.client)}</button>`
    : escapeHtml(entry.client ?? p.noClient);
  const notes = [
    entry.enabled ? "" : p.off,
    entry.lease ? fill(p.lease, { time: formatDuration(entry.lease, t.inet.units) }) : "",
  ].filter(Boolean);
  return `<li class="${entry.enabled ? "" : "off"}"><span class="pdesc">${escapeHtml(entry.description ?? p.noName)}</span>
    <span class="pmap">${escapeHtml(entry.protocol ?? "")} ${escapeHtml(String(entry.external_port ?? "–"))} → ${target}:${escapeHtml(String(entry.internal_port ?? "–"))}</span>
    ${notes.length ? `<small>${escapeHtml(notes.join(" · "))}</small>` : ""}</li>`;
}

/** The port forwardings and UPnP openings: loading, an error, none, or the list. Read only. */
function ports(state, t) {
  const p = t.inet.ports;
  let body;
  if (state === "failed") body = `<p class="hint">${escapeHtml(p.failed)}</p>`;
  else if (!state) body = `<p class="hint">${escapeHtml(t.loading)}</p>`;
  else if (!state.entries.length) body = `<p class="hint">${escapeHtml(p.none)}</p>`;
  else body = `<ul class="ports">${state.entries.map((e) => portLine(e, t)).join("")}</ul>`;
  return `<section class="card sec"><span class="label">${escapeHtml(p.title)}</span>${body}
    <p class="hint">${escapeHtml(p.hint)}</p></section>`;
}

/** The two actions that interrupt the network; without the right to change settings they say why they are off. */
function actions(canWrite, t) {
  const a = t.inet.actions;
  const off = canWrite ? "" : " disabled";
  return `<section class="card sec"><span class="label">${escapeHtml(a.title)}</span>
    <div class="btn-row tight">
      <button class="btn" data-act="reconnect" data-k="reconnect"${off}>${escapeHtml(a.reconnect)}</button>
      <button class="btn dp" data-act="reboot" data-k="reboot"${off}>${escapeHtml(a.reboot)}</button></div>
    <p class="hint">${escapeHtml(canWrite ? a.hint : a.noRights)}</p></section>`;
}

/** The whole page. Without data from the box it says so and offers the way back. */
export function renderInternet(internet, ctx) {
  const { t, language, now, canWrite, ports: portState } = ctx;
  const i = t.inet;
  const back = `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(i.title)}</h1></div>`;
  if (!internet) return `${back}<div class="card"><div class="empty"><b>${escapeHtml(i.noData)}</b></div></div>`;
  const up = internet.connected !== false;
  const sub = [
    accessLabel(internet.access_type, t),
    internet.uptime !== null && up ? fill(i.since, { time: formatDuration(internet.uptime, i.units) }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const prefix = internet.ipv6_prefix ? `${internet.ipv6_prefix}/${internet.ipv6_prefix_length ?? ""}`.replace(/\/$/, "") : "–";
  const rate = internet.throughput;
  return `${back}
    ${hintsHtml(internet, t, now)}
    <section class="card sec hero">
      <div class="ihead"><span class="ico">${ic("globe")}</span>
        <span class="who"><b>${escapeHtml(i.connection)}</b><small>${escapeHtml(sub)}</small></span>
        <span class="stat ${up ? "ok" : "warn"}">${escapeHtml(up ? i.state.up : i.state.down)}</span></div>
      <div class="tiles">
        ${tile(i.ipv4, internet.external_ipv4 ?? "–")}
        ${tile(i.ipv6, prefix)}
        ${tile(i.lastError, internet.last_error && internet.last_error !== "ERROR_NONE" ? internet.last_error : i.noError)}
      </div>
      ${dnsTile(internet.dns, t)}</section>
    <div class="two">
    <section class="card sec"><span class="label">${escapeHtml(i.load)}</span>
      <div class="live"><div class="dn"><span class="gl">↓ ${escapeHtml(i.down)}</span><b>${escapeHtml(formatRate(rate?.down ?? null, language))}</b></div>
        <div class="upl"><span class="gl">↑ ${escapeHtml(i.up)}</span><b>${escapeHtml(formatRate(rate?.up ?? null, language))}</b></div></div>
      ${gauge("dn", i.down, rate?.down, internet.rate_down, language, t)}
      ${gauge("upl", i.up, rate?.up, internet.rate_up, language, t)}
      ${chart(internet, language, t)}
      <p class="hint">${escapeHtml(i.measureNote)}</p></section>
    ${volumeCard({ t, language, traffic: ctx.traffic, clients: ctx.clients, range: ctx.trafficRange ?? 7 })}
    </div>
    ${internet.dsl ? lineQuality(internet.dsl, language, t) : ""}
    ${addressHistory(internet.addresses, language, t)}
    ${events(internet, t, now)}
    ${ports(portState, t)}
    ${actions(canWrite, t)}`;
}
