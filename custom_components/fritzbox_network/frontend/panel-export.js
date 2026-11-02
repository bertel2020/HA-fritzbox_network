/* The address space as a file or on paper: CSV, JSON and an A4 sheet to print or save as PDF. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";
import { blockOf, displayName, linkText } from "./panel-addresses.js";

// the colours of the own blocks, as hex, for the sheet (a printer has no theme)
const BLOCK_HEX = { "--b1": "#0f8b8d", "--b2": "#d9730d", "--b3": "#c2417c", "--b4": "#4f8a10", "--b5": "#6b5b95" };

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
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-top: 6mm; }
  .stat { border: .3mm solid #d7dce3; border-radius: 2mm; padding: 2.4mm 3.2mm; background: #f7f9fb; break-inside: avoid; }
  .stat .k { font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
  .stat b { display: block; font-size: 13pt; font-weight: 600; line-height: 1.25; }
  .stat small { color: #6b7280; font-size: 7.5pt; }
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
  .cell.fix { background: #7a4bc2; color: #fff; }
  .cell.box { background: #1e6b34; color: #fff; }
  .cell.res { background: #fff1de; border: .4mm dotted #b36a00; color: #8a4b00; }
  .cell.plan { background: #fff; border: .4mm dashed #1e6b34; color: #1e6b34; }
  .cell.na { background: repeating-linear-gradient(45deg, #e5e9ee 0 .6mm, #fff .6mm 1.2mm); }
  .cell.blk { border-bottom: 1.1mm solid var(--bc); }
  .legend { display: flex; flex-wrap: wrap; gap: 1.5mm 5mm; margin-top: 3mm; font-size: 7.3pt; color: #4b5563; }
  .legend span { display: inline-flex; align-items: center; gap: 1.6mm; }
  .legend .cell { width: 5mm; aspect-ratio: 1.9; display: inline-block; flex: none; }
  .cell.free { background: #fff; border-color: #d7dce3; }
  .list { break-before: page; }
  .list td { padding-top: .5mm; padding-bottom: .5mm; white-space: nowrap; }
  .list td.wrap { white-space: normal; }
  tr.band td { background: #eaf3fa; color: #0a4f7e; font-weight: 600; font-size: 7.5pt; letter-spacing: .03em; border-bottom-color: #c9dcec; }
  tr.free td, tr.na td { color: #9aa4b1; }
  tr.na td i { font-style: italic; }
  tr.grey td.nm { color: #6b7280; }
  .tag.pool { background: #e1eef8; color: #0a4f7e; }
  .sw { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: .6mm; vertical-align: middle; margin-right: 1.5mm; }
  .scribble { height: 16mm; border: .3mm dashed #c9d0d9; border-radius: 2mm; color: #9aa4b1; font-size: 8pt; padding: 2mm 3mm; }
`;

function stat(label, value, sub) {
  return `<div class="stat"><div class="k">${escapeHtml(label)}</div><b>${escapeHtml(value)}</b><small>${escapeHtml(sub)}</small></div>`;
}

/** What an address is for, not whether something is connected: the sheet is documentation. */
function roleOf(cell) {
  const d = cell.device;
  if (cell.state === "na") return "na";
  if (d) return d.kind === "box" ? "box" : d.kind === "fix" ? "fix" : "dyn";
  if (cell.state === "res" || cell.state === "plan") return cell.state;
  return cell.pool ? "poolfree" : "free";
}

const MAP_CLASS = { na: "na", box: "box", fix: "fix", dyn: "pool", res: "res", plan: "plan", poolfree: "pool", free: "free" };

function mapHtml(m, own, t) {
  const a = t.addr;
  let cells = `<span></span>${[...Array(16).keys()].map((c) => `<span class="lab">${c.toString(16).toUpperCase()}</span>`).join("")}`;
  for (let r = 0; r < 16; r++) {
    cells += `<span class="lab">.${r * 16}</span>`;
    for (let c = 0; c < 16; c++) {
      const cell = m.cells[r * 16 + c];
      const blk = blockOf(own, cell.n);
      const cls = ["cell", MAP_CLASS[roleOf(cell)], blk ? "blk" : ""].filter(Boolean).join(" ");
      cells += `<span class="${cls}" ${blk ? `style="--bc:${BLOCK_HEX[blk.color] ?? "#6b7280"}"` : ""}>${cell.n}</span>`;
    }
  }
  const lg = a.legend;
  const item = (cls, text) => `<span><i class="cell ${cls}"></i>${escapeHtml(text)}</span>`;
  return `<section class="map"><h2>${escapeHtml(a.print.map)}</h2><div class="grid">${cells}</div>
    <div class="legend">${item("box", lg.box)}${item("fix", a.print.legendFixed)}${item("pool", a.print.legendPool)}${item("free", lg.free)}${item("plan", lg.plan)}${item("res", lg.res)}${item("na", a.states.na)}<span>${escapeHtml(a.print.legendBlock)}</span></div></section>`;
}

function zonesHtml(m, t) {
  const a = t.addr;
  const bar = m.zones.map((z) => `<div class="${z.id}" style="flex:${Math.max(1, z.size)}">${escapeHtml(a.zones[z.id])} .${z.from}–.${z.to}</div>`).join("");
  const rows = m.zones
    .map((z) => `<tr><td><b>${escapeHtml(a.zones[z.id])}</b><small>${escapeHtml(a.zoneNotes[z.id])}</small></td><td class="mono">.${z.from} – .${z.to}</td><td>${z.size}</td><td class="r">${z.fixed}</td></tr>`)
    .join("");
  return `<section><h2>${escapeHtml(a.print.zones)}</h2><div class="bar">${bar}</div>
    <table><thead><tr><th>${escapeHtml(a.print.area)}</th><th>${escapeHtml(a.print.addresses)}</th><th>${escapeHtml(a.print.size)}</th><th class="r">${escapeHtml(a.print.fixedHead)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function blocksHtml(m, own, t) {
  if (!own.blocks.length) return "";
  const a = t.addr;
  const rows = [...own.blocks]
    .sort((x, y) => x.from - y.from)
    .map((b) => {
      const inside = m.cells.filter((c) => c.n >= b.from && c.n <= b.to);
      const fixed = inside.filter((c) => c.device && c.device.kind !== "dyn").length;
      const planned = inside.filter((c) => c.state === "plan").length;
      return `<tr><td><i class="sw" style="background:${BLOCK_HEX[b.color] ?? "#6b7280"}"></i><b>${escapeHtml(b.name)}</b></td>
        <td class="mono">.${b.from} – .${b.to}</td><td>${b.to - b.from + 1}</td><td class="r">${fixed}${planned ? ` · ${escapeHtml(fill(a.blocks.planned, { n: planned }))}` : ""}</td></tr>`;
    })
    .join("");
  return `<section><h2>${escapeHtml(a.blocks.title)}</h2><table><thead><tr><th>${escapeHtml(a.blocks.name)}</th><th>${escapeHtml(a.print.addresses)}</th><th>${escapeHtml(a.print.size)}</th><th class="r">${escapeHtml(a.print.fixedHead)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

/** Every address from .0 to .255 in one row, in bands by the areas of the network. */
function listHtml(m, own, t, { mac, poolNames }) {
  const a = t.addr;
  const p = a.print;
  const bandAt = new Map(m.zones.map((z) => [z.from, z.id]));
  const cols = 6 + (mac ? 1 : 0);
  let body = "";
  for (const cell of m.cells) {
    const band = bandAt.get(cell.n);
    if (band) body += `<tr class="band"><td colspan="${cols}">${escapeHtml(a.zones[band])} · .${m.zones.find((z) => z.id === band).from} – .${m.zones.find((z) => z.id === band).to}</td></tr>`;
    const ip = `${m.baseText}${cell.n}`;
    const role = roleOf(cell);
    const d = cell.device;
    const blk = blockOf(own, cell.n);
    const shown = d && (d.kind !== "dyn" || poolNames);
    const name = role === "na" ? `<i>${escapeHtml(cell.n === 0 ? p.netAddress : cell.n === 255 ? p.broadcast : p.unusable)}</i>` : shown ? escapeHtml(displayName(d, own)) : "";
    const tagText = { box: a.export.kinds.box, fix: a.export.kinds.fixed, dyn: p.roleDhcp, res: a.export.kinds.reserved, plan: a.export.kinds.planned, poolfree: p.roleDhcpFree, free: a.export.kinds.free }[role];
    const tag = role === "na" ? "" : role === "free" || role === "poolfree" ? escapeHtml(tagText) : `<span class="tag ${role === "dyn" ? "pool" : role}">${escapeHtml(tagText)}</span>`;
    body += `<tr class="${role === "free" || role === "poolfree" ? "free" : role === "na" ? "na" : role === "dyn" ? "grey" : ""}"><td class="mono">${escapeHtml(ip)}</td><td class="nm">${name}</td><td>${tag}</td>
      <td>${shown ? escapeHtml(d.vendor ?? "") : ""}</td>${mac ? `<td class="mono">${shown ? escapeHtml(d.mac ?? "") : ""}</td>` : ""}
      <td>${blk ? `<i class="sw" style="background:${BLOCK_HEX[blk.color] ?? "#6b7280"}"></i>${escapeHtml(blk.name)}` : ""}</td><td class="wrap">${escapeHtml(own.notes[ip] ?? "")}</td></tr>`;
  }
  const c = a.export.columns;
  return `<section class="list"><h2>${escapeHtml(p.listAll)}${poolNames ? ` <small style="font-weight:400;color:#6b7280">· ${escapeHtml(p.poolNote)}</small>` : ""}</h2>
    <table><thead><tr><th>${escapeHtml(c.ip)}</th><th>${escapeHtml(c.name)}</th><th>${escapeHtml(p.role)}</th><th>${escapeHtml(c.vendor)}</th>${mac ? `<th>${escapeHtml(c.mac)}</th>` : ""}<th>${escapeHtml(c.block)}</th><th>${escapeHtml(c.note)}</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

/**
 * The sheet as a complete HTML document for A4: documentation of the address space, so no
 * state of the moment (online, last seen, connection). On screen as a page with a bar to print,
 * on paper without the bar. opts: { map, mac, poolNames }.
 */
export function printSheet({ m, own, t, language, opts, now = new Date() }) {
  const a = t.addr;
  const when = new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "short" }).format(now);
  return `<!doctype html><html lang="${escapeHtml(language || "de")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(a.title)} ${escapeHtml(m.baseText)}0/${m.prefix}</title><style>${PRINT_CSS}</style></head><body>
<div class="toolbar"><span>${escapeHtml(a.print.toolbarHint)}</span><button id="print">${escapeHtml(a.print.toolbar)}</button></div>
<main class="sheet">
  <header class="top"><div><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(m.baseText)}0/${m.prefix} · ${escapeHtml(m.gatewayName)}</p></div>
    <div class="when"><b>${escapeHtml(fill(a.print.stand, { when }))}</b>${escapeHtml(a.print.source)}</div></header>
  <div class="stats">
    ${stat(a.tiles.net, `${m.baseText}0/${m.prefix}`, fill(a.tiles.mask, { mask: m.mask }))}
    ${stat(a.tiles.gateway, m.gateway ?? "–", fill(a.tiles.gatewaySub, { name: m.gatewayName, dhcp: m.dhcp ? a.on : a.off }))}
    ${stat(a.tiles.pool, m.hasPool ? `.${m.poolFrom} – .${m.poolTo}` : a.tiles.noPool, m.hasPool ? fill(a.print.poolSize, { n: m.poolSize }) : "")}
    ${stat(a.print.usable, String(m.usable), `.${m.first} – .${m.last}`)}
  </div>
  ${zonesHtml(m, t)}
  ${opts.map ? mapHtml(m, own, t) : ""}
  ${blocksHtml(m, own, t)}
  <section><h2>${escapeHtml(a.print.notes)}</h2><div class="scribble">${escapeHtml(a.print.notesHint)}</div></section>
  ${listHtml(m, own, t, { mac: opts.mac, poolNames: opts.poolNames !== false })}
</main></body></html>`;
}
