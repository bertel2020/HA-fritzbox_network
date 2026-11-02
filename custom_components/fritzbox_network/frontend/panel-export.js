/* The address space as a file or on paper: CSV, JSON and an A4 sheet to print or save as PDF. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";
import { addressHints, blockOf, displayName, linkText } from "./panel-addresses.js";

// the colours of the own blocks, as hex, for the sheet (a printer has no theme)
const BLOCK_HEX = { "--b1": "#0f8b8d", "--b2": "#d9730d", "--b3": "#c2417c", "--b4": "#4f8a10", "--b5": "#6b5b95" };

// more hints than this do not fit a sheet; the rest is counted
const MAX_HINTS = 4;

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-02" in the local time of the viewer, for file names and the sheet. */
export function dateStamp(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isoLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${dateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A file name like "adressraum-192-168-79-0-24-2026-11-02.csv". */
export function fileName(m, extension, now = new Date()) {
  return `adressraum-${m.baseText.replace(/\./g, "-")}0-${m.prefix}-${dateStamp(now)}.${extension}`;
}

const areaOf = (m, n, a) => (m.cells[n].pool ? a.areaPool : m.hasPool ? (n < m.poolFrom ? a.areaLow : a.areaHigh) : a.areaWhole);

/**
 * One row per address that is not unusable: free addresses only when asked for. The kind is
 * "box", "fixed", "dynamic", "reserved", "planned" or "free".
 */
export function addressRows(m, own, t, { free = false } = {}) {
  const a = t.addr;
  const rows = [];
  for (const cell of m.cells) {
    if (cell.state === "na") continue;
    const d = cell.device;
    if (!d && cell.state === "free" && !free) continue;
    const ip = `${m.baseText}${cell.n}`;
    const kind = d ? (d.kind === "box" ? "box" : d.kind === "dyn" ? "dynamic" : "fixed") : { res: "reserved", plan: "planned", free: "free" }[cell.state];
    rows.push({
      n: cell.n,
      ip,
      kind,
      kindText: a.export.kinds[kind],
      name: d ? displayName(d, own) : "",
      boxName: d && own.names[d.mac] ? d.name : "",
      online: d ? d.online : null,
      vendor: d?.vendor ?? "",
      mac: d?.mac ?? "",
      link: d ? linkText(d, t) : "",
      lastOnline: d && !d.online ? isoLocal(d.lastOnline) : "",
      block: blockOf(own, cell.n)?.name ?? "",
      area: areaOf(m, cell.n, a),
      note: own.notes[ip] ?? "",
    });
  }
  return rows;
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The rows as CSV for a spreadsheet: semicolon between the cells, a byte order mark in front so
 * that Excel reads the umlauts, CRLF at the line ends.
 */
export function toCsv(rows, t, { mac = true } = {}) {
  const c = t.addr.export.columns;
  const columns = [
    ["ip", c.ip],
    ["name", c.name],
    ["kindText", c.kind],
    ["status", c.status],
    ["vendor", c.vendor],
    ...(mac ? [["mac", c.mac]] : []),
    ["link", c.link],
    ["lastOnline", c.lastOnline],
    ["block", c.block],
    ["area", c.area],
    ["note", c.note],
  ];
  const status = (r) => (r.online === null ? "" : r.online ? t.addr.online : t.addr.offline);
  const lines = [columns.map(([, label]) => csvCell(label)).join(";")];
  for (const r of rows) {
    lines.push(columns.map(([key]) => csvCell(key === "status" ? status(r) : r[key])).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The whole picture as JSON: the network, the numbers, every address and what the user noted. */
export function toJson(m, own, rows, { mac = true, now = new Date() } = {}) {
  const addresses = rows.map((r) => ({
    address: r.ip,
    kind: r.kind,
    name: r.name || null,
    box_name: r.boxName || null,
    online: r.online,
    vendor: r.vendor || null,
    ...(mac ? { mac: r.mac || null } : {}),
    connection: r.link || null,
    last_online: r.lastOnline || null,
    block: r.block || null,
    note: r.note || null,
  }));
  return `${JSON.stringify(
    {
      generated: now.toISOString(),
      network: {
        address: `${m.baseText}0/${m.prefix}`,
        mask: m.mask,
        gateway: m.gateway,
        dhcp: m.dhcp,
        dhcp_range: m.hasPool ? { from: `${m.baseText}${m.poolFrom}`, to: `${m.baseText}${m.poolTo}` } : null,
      },
      summary: { usable: m.usable, used: m.used, online: m.online, fixed: m.fixed, free: m.free },
      addresses,
      own: { notes: own.notes, names: mac ? own.names : {}, planned: own.marks, hidden_hints: own.muted, blocks: own.blocks },
    },
    null,
    2
  )}\n`;
}

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 15mm 13mm 17mm;
    @bottom-left { content: "FRITZ!Box · Adressraum"; font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #6b7280; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #6b7280; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: #e8ebf0; }
  body { margin: 0; color: #1b1f24; font: 9pt/1.4 "Helvetica Neue", Arial, sans-serif; }
  .toolbar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: #1b1f24; color: #fff; font-size: 13px; }
  .toolbar span { opacity: .75; flex: 1; }
  .toolbar button { background: #5bb2ea; color: #0b1a26; border: 0; border-radius: 18px; font: inherit; font-weight: 600; padding: 8px 18px; cursor: pointer; }
  .sheet { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 15mm 13mm 17mm; background: #fff; box-shadow: 0 4px 24px rgb(0 0 0 / 25%); }
  @media print {
    html { background: #fff; }
    .toolbar { display: none; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  }
  h1 { font-size: 22pt; font-weight: 600; letter-spacing: -.01em; margin: 0; line-height: 1.1; }
  h2 { font-size: 10.5pt; font-weight: 600; margin: 0 0 2.5mm; padding-bottom: 1.2mm; border-bottom: .4mm solid #0a6aa8; color: #0a4f7e; break-after: avoid; }
  section { margin-top: 6.5mm; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding-bottom: 4mm; border-bottom: .9mm solid #0a6aa8; }
  .top p { margin: 1.5mm 0 0; color: #4b5563; font-size: 10pt; }
  .when { text-align: right; color: #4b5563; font-size: 8.5pt; white-space: nowrap; }
  .when b { display: block; font-size: 9.5pt; color: #1b1f24; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 6mm; }
  .stat { border: .3mm solid #d7dce3; border-radius: 2mm; padding: 2.4mm 3.2mm; background: #f7f9fb; break-inside: avoid; }
  .stat .k { font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
  .stat b { display: block; font-size: 13pt; font-weight: 600; line-height: 1.25; }
  .stat small { color: #6b7280; font-size: 7.5pt; }
  .hints { margin: 0; padding: 0; list-style: none; display: grid; gap: 1.6mm; }
  .hints li { padding: 2mm 3mm; border-radius: 1.5mm; border-left: 1.2mm solid #0a6aa8; background: #eaf3fa; break-inside: avoid; }
  .hints li.warn { border-color: #b36a00; background: #fff1de; }
  .hints li.more { border-color: #9aa4b1; background: #f1f3f5; color: #4b5563; }
  .hints li.bad { border-color: #a1261b; background: #fdecea; }
  .none { color: #6b7280; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 8.4pt; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 7pt; letter-spacing: .07em; text-transform: uppercase; color: #6b7280; font-weight: 600; padding: 1.4mm 2mm; border-bottom: .3mm solid #9aa4b1; }
  td { padding: 1.5mm 2mm; border-bottom: .2mm solid #e3e7ec; vertical-align: top; }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f8fafb; }
  td small { display: block; color: #6b7280; font-size: 7.3pt; }
  td.r, th.r { text-align: right; }
  .mono { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 8pt; white-space: nowrap; }
  .tag { display: inline-block; border-radius: 1mm; padding: 0 1.6mm; font-size: 7.3pt; font-weight: 600; white-space: nowrap; }
  .tag.dynamic { background: #e1eef8; color: #0a4f7e; }
  .tag.fixed, .tag.box { background: #ece4f8; color: #5b34a0; }
  .tag.reserved { background: #fff1de; color: #8a4b00; }
  .tag.planned { background: #e6f4ea; color: #1e6b34; }
  .off { color: #6b7280; }
  .bar { display: flex; height: 7mm; border: .3mm solid #c9d0d9; border-radius: 1.5mm; overflow: hidden; margin-bottom: 3mm; }
  .bar div { display: grid; place-items: center; font-size: 7.3pt; color: #4b5563; white-space: nowrap; overflow: hidden; }
  .bar .low, .bar .high { background: #ece4f8; color: #5b34a0; }
  .bar .pool { background: #dfeaf5; color: #0a4f7e; }
  .bar .whole { background: #eef1f4; }
  .meter { display: inline-block; vertical-align: middle; width: 26mm; height: 2.4mm; border-radius: 1.2mm; background: #e5e9ee; overflow: hidden; margin-right: 2mm; }
  .meter i { display: inline-block; height: 100%; }
  .map { break-inside: avoid; }
  .grid { display: grid; grid-template-columns: 7mm repeat(16, 1fr); gap: .9mm; }
  .grid .lab { font: 6.3pt "SF Mono", Menlo, monospace; color: #6b7280; display: grid; place-items: center; }
  .cell { aspect-ratio: 1.9; border-radius: .8mm; display: grid; place-items: center; font: 6.3pt "SF Mono", Menlo, monospace; color: #6b7280; background: #eef1f4; border: .25mm solid transparent; }
  .cell.pool { background: #dfeaf5; }
  .cell.dyn { background: #0a6aa8; color: #fff; }
  .cell.off { background: #fff; border: .45mm solid #0a6aa8; color: #0a6aa8; }
  .cell.fix { background: #7a4bc2 repeating-linear-gradient(135deg, rgba(255,255,255,.38) 0 .7mm, transparent .7mm 1.5mm); color: #fff; }
  .cell.offfix { background: #fff repeating-linear-gradient(135deg, rgba(122,75,194,.28) 0 .5mm, transparent .5mm 1.3mm); border: .45mm solid #7a4bc2; color: #5b34a0; }
  .cell.box { background: #1e6b34; color: #fff; }
  .cell.res { background: #fff1de; border: .4mm dotted #b36a00; color: #8a4b00; }
  .cell.plan { background: #fff; border: .4mm dashed #1e6b34; color: #1e6b34; }
  .cell.na { background: repeating-linear-gradient(45deg, #e5e9ee 0 .6mm, #fff .6mm 1.2mm); }
  .cell.blk { border-bottom: 1.1mm solid var(--bc); }
  .legend { display: flex; flex-wrap: wrap; gap: 1.5mm 5mm; margin-top: 3mm; font-size: 7.3pt; color: #4b5563; }
  .legend span { display: inline-flex; align-items: center; gap: 1.6mm; }
  .legend .cell { width: 5mm; aspect-ratio: 1.9; display: inline-block; flex: none; }
`;

function stat(label, value, sub) {
  return `<div class="stat"><div class="k">${escapeHtml(label)}</div><b>${escapeHtml(value)}</b><small>${escapeHtml(sub)}</small></div>`;
}

function mapHtml(m, own, t) {
  const a = t.addr;
  let cells = `<span></span>${[...Array(16).keys()].map((c) => `<span class="lab">${c.toString(16).toUpperCase()}</span>`).join("")}`;
  for (let r = 0; r < 16; r++) {
    cells += `<span class="lab">.${r * 16}</span>`;
    for (let c = 0; c < 16; c++) {
      const cell = m.cells[r * 16 + c];
      const blk = blockOf(own, cell.n);
      const cls = ["cell", cell.state, cell.pool ? "pool" : "", blk ? "blk" : ""].filter(Boolean).join(" ");
      cells += `<span class="${cls}" ${blk ? `style="--bc:${BLOCK_HEX[blk.color] ?? "#6b7280"}"` : ""}>${cell.n}</span>`;
    }
  }
  const lg = a.legend;
  const item = (cls, text) => `<span><i class="cell ${cls}"></i>${escapeHtml(text)}</span>`;
  return `<section class="map"><h2>${escapeHtml(a.print.map)}</h2><div class="grid">${cells}</div>
    <div class="legend">${item("dyn", lg.dyn)}${item("off", lg.off)}${item("fix", lg.fix)}${item("offfix", lg.offfix)}${item("box", lg.box)}${item("pool", lg.freePool)}${item("", lg.free)}${item("plan", lg.plan)}${item("res", lg.res)}${item("na", a.states.na)}</div></section>`;
}

function zonesHtml(m, t) {
  const a = t.addr;
  const bar = m.zones.map((z) => `<div class="${z.id}" style="flex:${Math.max(1, z.size)}">${escapeHtml(a.zones[z.id])}</div>`).join("");
  const rows = m.zones
    .map((z) => {
      const used = z.fixed + z.dynamic;
      const percent = z.size ? Math.round((used / z.size) * 100) : 0;
      return `<tr><td><b>${escapeHtml(a.zones[z.id])}</b><small>${escapeHtml(a.zoneNotes[z.id])}</small></td><td class="mono">.${z.from} – .${z.to}</td>
        <td><span class="meter"><i style="width:${(z.fixed / (z.size || 1)) * 100}%;background:#7a4bc2"></i><i style="width:${(z.dynamic / (z.size || 1)) * 100}%;background:#0a6aa8"></i></span>${used} / ${z.size} · ${percent} %</td>
        <td class="r">${escapeHtml(fill(a.zoneSplit, { fixed: z.fixed, dynamic: z.dynamic }))}</td></tr>`;
    })
    .join("");
  return `<section><h2>${escapeHtml(a.print.zones)}</h2><div class="bar">${bar}</div>
    <table><thead><tr><th>${escapeHtml(a.print.area)}</th><th>${escapeHtml(a.print.addresses)}</th><th>${escapeHtml(a.print.used)}</th><th class="r">${escapeHtml(a.print.split)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function blocksHtml(m, own, t) {
  if (!own.blocks.length) return "";
  const a = t.addr;
  const rows = [...own.blocks]
    .sort((x, y) => x.from - y.from)
    .map((b) => {
      const size = b.to - b.from + 1;
      const inside = m.cells.filter((c) => c.n >= b.from && c.n <= b.to);
      const usedN = inside.filter((c) => c.device).length;
      const planned = inside.filter((c) => c.state === "plan").length;
      return `<tr><td><span class="meter" style="width:3mm;height:3mm;border-radius:.8mm;background:${BLOCK_HEX[b.color] ?? "#6b7280"}"></span><b>${escapeHtml(b.name)}</b></td>
        <td class="mono">.${b.from} – .${b.to}</td><td>${usedN} / ${size}</td><td class="r">${planned ? escapeHtml(fill(a.blocks.planned, { n: planned })) : "–"}</td></tr>`;
    })
    .join("");
  return `<section><h2>${escapeHtml(a.blocks.title)}</h2><table><thead><tr><th>${escapeHtml(a.blocks.name)}</th><th>${escapeHtml(a.print.addresses)}</th><th>${escapeHtml(a.print.used)}</th><th class="r">${escapeHtml(a.print.plannedHead)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function listHtml(rows, t, { mac }) {
  const a = t.addr;
  const body = rows
    .map((r) => {
      const detail = [r.boxName ? fill(a.boxName, { name: r.boxName }) : "", r.link, r.block ? fill(a.inBlock, { name: r.block }) : ""].filter(Boolean).join(" · ");
      const note = r.note ? `<small>📝 ${escapeHtml(r.note)}</small>` : "";
      const status = r.online === null ? "–" : r.online ? a.online : a.offline;
      return `<tr class="${r.online === false ? "off" : ""}"><td class="mono">${escapeHtml(r.ip)}</td>
        <td><b>${escapeHtml(r.name || "—")}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}${note}</td>
        <td><span class="tag ${r.kind}">${escapeHtml(r.kindText)}</span></td><td>${escapeHtml(status)}${r.lastOnline ? `<small>${escapeHtml(r.lastOnline)}</small>` : ""}</td>
        <td>${escapeHtml(r.vendor || "–")}</td>${mac ? `<td class="mono">${escapeHtml(r.mac || "–")}</td>` : ""}</tr>`;
    })
    .join("");
  const c = a.export.columns;
  return `<section><h2>${escapeHtml(a.print.list)} (${rows.length})</h2><table><thead><tr><th>${escapeHtml(c.ip)}</th><th>${escapeHtml(c.name)}</th><th>${escapeHtml(c.kind)}</th><th>${escapeHtml(c.status)}</th><th>${escapeHtml(c.vendor)}</th>${mac ? `<th>${escapeHtml(c.mac)}</th>` : ""}</tr></thead><tbody>${body}</tbody></table></section>`;
}

/**
 * The sheet as a complete HTML document for A4: on screen as a page with a bar to print, on
 * paper without the bar. opts: { map, mac }. `fixedKnown` says whether the box told which
 * addresses are fixed.
 */
export function printSheet({ m, own, t, language, opts, now = new Date(), fixedKnown = true }) {
  const a = t.addr;
  const rows = addressRows(m, own, t, { free: false }).filter((r) => r.kind !== "free");
  const hints = addressHints(m, { fixedKnown }).filter((h) => !own.muted.includes(h.id));
  const when = new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "short" }).format(now);
  const percent = m.poolSize ? Math.round((m.poolUsed / m.poolSize) * 100) : 0;
  const shownHints = hints.slice(0, MAX_HINTS);
  const hintList = hints.length
    ? `<ul class="hints">${shownHints
        .map((h) => `<li class="${h.level}">${fill(a.hints[h.key], Object.fromEntries(Object.entries(h.values).map(([k, v]) => [k, escapeHtml(String(v))])))}</li>`)
        .join("")}${hints.length > MAX_HINTS ? `<li class="more">${escapeHtml(fill(a.print.moreHints, { n: hints.length - MAX_HINTS }))}</li>` : ""}</ul>`
    : `<p class="none">${escapeHtml(a.hintNone)}</p>`;
  return `<!doctype html><html lang="${escapeHtml(language || "de")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(a.title)} ${escapeHtml(m.baseText)}0/${m.prefix}</title><style>${PRINT_CSS}</style></head><body>
<div class="toolbar"><span>${escapeHtml(a.print.toolbarHint)}</span><button id="print">${escapeHtml(a.print.toolbar)}</button></div>
<main class="sheet">
  <header class="top"><div><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(m.baseText)}0/${m.prefix} · ${escapeHtml(m.gatewayName)}</p></div>
    <div class="when"><b>${escapeHtml(fill(a.print.stand, { when }))}</b>${escapeHtml(a.print.source)}</div></header>
  <div class="stats">
    ${stat(a.tiles.net, `${m.baseText}0/${m.prefix}`, fill(a.tiles.mask, { mask: m.mask }))}
    ${stat(a.tiles.gateway, m.gateway ?? "–", fill(a.tiles.gatewaySub, { name: m.gatewayName, dhcp: m.dhcp ? a.on : a.off }))}
    ${stat(a.tiles.pool, m.hasPool ? `.${m.poolFrom} – .${m.poolTo}` : a.tiles.noPool, m.hasPool ? fill(a.tiles.poolSub, { n: m.poolSize, used: m.poolUsed, free: m.poolSize - m.poolUsed, percent }) : "")}
    ${stat(a.tiles.used, fill(a.tiles.usedValue, { used: m.used, total: m.usable }), fill(a.tiles.usedSub, { online: m.online, offline: m.used - m.online }))}
    ${stat(a.tiles.fixed, String(m.fixed), a.tiles.fixedSub)}
    ${stat(a.tiles.free, String(m.free), m.hasPool ? fill(a.tiles.freeSub, { n: m.poolSize - m.poolUsed }) : "")}
  </div>
  ${opts.map ? mapHtml(m, own, t) : ""}
  <section><h2>${escapeHtml(a.hintsTitle)}</h2>${hintList}</section>
  ${zonesHtml(m, t)}${blocksHtml(m, own, t)}
  ${listHtml(rows, t, { mac: opts.mac })}
</main></body></html>`;
}
