/* The address page of the panel: the whole /24 around the box, who has which address, what is free. */

import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";
import { whenText } from "./panel-network.js";

export const BLOCK_COLORS = ["--b1", "--b2", "--b3", "--b4", "--b5"];
export const FILTERS = ["all", "dyn", "fix", "plan", "online", "offline", "free"];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** "192.168.79.5" as a number; null for anything else. */
export function ipToInt(ip) {
  const m = IPV4.exec(String(ip ?? ""));
  if (!m || m.slice(1).some((p) => Number(p) > 255)) return null;
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
}

export function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** The length of a mask like 255.255.255.0; null where it is not a mask. */
export function prefixOf(mask) {
  const n = ipToInt(mask);
  if (n === null) return null;
  const bits = n.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) return null;
  return bits.includes("0") ? bits.indexOf("0") : 32;
}

const emptyOwn = () => ({ notes: {}, names: {}, marks: [], muted: [], blocks: [] });
export { emptyOwn };

/**
 * Everything the page shows, worked out from what the box says: the 256 addresses of the /24 around
 * the gateway with their state, the numbers for the tiles, the zones and the hints.
 * `fixed` is {mac: {fixed, editable} | null}, filled while the page reads the edit forms.
 * Returns null where the box does not tell its network.
 */
export function addressModel({ network, clients, nodes, fixed, own }) {
  const mask = ipToInt(network?.mask);
  const prefix = prefixOf(network?.mask);
  const gateway = ipToInt(network?.gateway);
  const firstClient = (clients ?? []).map((c) => ipToInt(c.ip)).find((n) => n !== null);
  const anchor = gateway ?? ipToInt(network?.pool_from) ?? firstClient;
  if (mask === null || prefix === null || anchor === null || anchor === undefined) return null;
  const base = (anchor & 0xffffff00) >>> 0;
  const netStart = (anchor & mask) >>> 0;
  const netEnd = (netStart | ~mask) >>> 0;
  const octet = (ip) => {
    const n = ipToInt(ip);
    return n !== null && (n & 0xffffff00) >>> 0 === base ? n & 255 : null;
  };
  const gatewayOctet = octet(network.gateway);
  const master = (nodes ?? []).find((n) => n.role === "master");
  const reserved = new Set((network.reserved ?? []).map(octet).filter((n) => n !== null));
  const marks = new Set((own.marks ?? []).map(octet).filter((n) => n !== null));
  const poolFrom = octet(network.pool_from);
  const poolTo = octet(network.pool_to);
  const hasPool = poolFrom !== null && poolTo !== null && poolFrom <= poolTo;

  const devices = new Map();
  const duplicates = new Map();
  for (const c of clients ?? []) {
    const n = octet(c.ip);
    if (n === null) continue;
    const reservation = fixed?.[c.mac] ?? null;
    const device = {
      n,
      ip: c.ip,
      mac: c.mac,
      id: c.id,
      name: n === gatewayOctet ? (master?.name ?? c.name) : c.name,
      vendor: c.vendor ?? null,
      online: Boolean(c.online),
      lastOnline: c.last_online ?? null,
      linkType: c.link_type ?? null,
      band: c.band ?? null,
      port: c.port ?? null,
      kind: n === gatewayOctet ? "box" : reservation?.fixed ? "fix" : "dyn",
      fixedKnown: reservation !== null && reservation !== undefined,
    };
    if (devices.has(n)) duplicates.set(n, [devices.get(n), device]);
    else devices.set(n, device);
  }
  if (gatewayOctet !== null && !devices.has(gatewayOctet)) {
    devices.set(gatewayOctet, {
      n: gatewayOctet, ip: network.gateway, mac: master?.mac ?? null, id: null, name: master?.name ?? "FRITZ!Box",
      vendor: "AVM", online: true, lastOnline: null, linkType: null, band: null, port: null, kind: "box", fixedKnown: true,
    });
  }

  const cells = [];
  for (let n = 0; n < 256; n++) {
    const ip = (base + n) >>> 0;
    const inNet = ip >= netStart && ip <= netEnd && ip !== netStart && ip !== netEnd;
    const d = devices.get(n);
    let state = "free";
    if (!inNet) state = "na";
    else if (d) state = d.kind === "box" ? "box" : d.kind === "fix" ? (d.online ? "fix" : "offfix") : d.online ? "dyn" : "off";
    else if (reserved.has(n)) state = "res";
    else if (marks.has(n)) state = "plan";
    cells.push({ n, state, device: d ?? null, pool: hasPool && n >= poolFrom && n <= poolTo });
  }
  const usable = cells.filter((c) => c.state !== "na");
  const used = usable.filter((c) => c.device);
  const poolCells = cells.filter((c) => c.pool && c.state !== "na");
  const poolUsed = poolCells.filter((c) => c.device).length;
  const first = usable[0]?.n ?? 1;
  const last = usable[usable.length - 1]?.n ?? 254;

  const model = {
    base,
    baseText: intToIp(base).replace(/\d+$/, ""),
    prefix,
    mask: network.mask,
    gateway: network.gateway,
    gatewayOctet,
    gatewayName: master?.name ?? "FRITZ!Box",
    dhcp: Boolean(network.dhcp),
    hasPool,
    poolFrom,
    poolTo,
    reserved,
    cells,
    devices,
    duplicates,
    usable: usable.length,
    used: used.length,
    online: used.filter((c) => c.device.online).length,
    fixed: used.filter((c) => c.device.kind === "fix" || c.device.kind === "box").length,
    reservedFree: cells.filter((c) => c.state === "res").length,
    poolSize: poolCells.length,
    poolUsed,
    wider: prefix < 24,
    first,
    last,
  };
  model.free = model.usable - model.used - model.reservedFree;
  model.zones = zonesOf(model);
  return model;
}

function zonesOf(m) {
  const zone = (id, from, to) => {
    const list = m.cells.filter((c) => c.n >= from && c.n <= to && c.state !== "na");
    const devs = list.filter((c) => c.device);
    return {
      id,
      from,
      to,
      size: list.length,
      fixed: devs.filter((c) => c.device.kind !== "dyn").length,
      dynamic: devs.filter((c) => c.device.kind === "dyn").length,
    };
  };
  if (!m.hasPool) return [zone("whole", m.first, m.last)];
  return [
    m.poolFrom > m.first ? zone("low", m.first, m.poolFrom - 1) : null,
    zone("pool", m.poolFrom, m.poolTo),
    m.poolTo < m.last ? zone("high", m.poolTo + 1, m.last) : null,
  ].filter(Boolean);
}

/** What stands out, most serious first: [{ id, level, key, values, n }]; n is the address to jump to. */
export function addressHints(m, { fixedKnown }) {
  const hints = [];
  const at = (n) => `${m.baseText}${n}`;
  for (const [n, list] of m.duplicates) {
    hints.push({ id: `dup:${n}`, level: "bad", key: "dup", values: { ip: at(n), names: list.map((d) => d.name).join(", ") }, n });
  }
  if (!m.dhcp) hints.push({ id: "dhcp-off", level: "warn", key: "dhcpOff", values: {}, n: null });
  for (const n of [...m.reserved].sort((a, b) => a - b)) {
    if (!m.devices.has(n)) hints.push({ id: `res:${n}`, level: "warn", key: "reserved", values: { ip: at(n) }, n });
  }
  const fixedInPool = [...m.devices.values()].filter((d) => d.kind === "fix" && m.cells[d.n].pool);
  for (const d of fixedInPool) {
    hints.push({ id: `pool-fix:${d.n}`, level: "warn", key: "poolFixed", values: { name: d.name, ip: at(d.n) }, n: d.n });
  }
  const offlineFixed = [...m.devices.values()].filter((d) => d.kind === "fix" && !d.online);
  if (offlineFixed.length) {
    hints.push({
      id: "offline-fix",
      level: "info",
      key: offlineFixed.length === 1 ? "offlineFixedOne" : "offlineFixed",
      values: { n: offlineFixed.length, list: offlineFixed.map((d) => `.${d.n}`).join(", ") },
      n: offlineFixed[0].n,
    });
  }
  if (m.hasPool && m.poolSize) {
    const percent = Math.round((m.poolUsed / m.poolSize) * 100);
    hints.push({
      id: "pool-usage",
      level: percent >= 95 ? "bad" : percent >= 80 ? "warn" : "info",
      key: "poolUsage",
      values: { percent, free: m.poolSize - m.poolUsed },
      n: null,
    });
  }
  if (!fixedKnown) hints.push({ id: "fixed-unknown", level: "info", key: "fixedUnknown", values: {}, n: null });
  const order = { bad: 0, warn: 1, info: 2 };
  return hints.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * What a new DHCP range (last octets, as typed) would mean: null while nothing is typed, else
 * { error } with the key of the problem, or { size, used, outside, fixedInside, tooSmall, same }
 * with the devices it touches.
 */
export function poolChange(m, first, last) {
  const a = Number(first);
  const b = Number(last);
  if (String(first).trim() === "" || String(last).trim() === "") return null;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 254 || a > b) return { error: "range" };
  if (m.cells[a].state === "na" || m.cells[b].state === "na") return { error: "outside" };
  if (m.gatewayOctet !== null && a <= m.gatewayOctet && m.gatewayOctet <= b) return { error: "gateway" };
  const inside = (n) => n >= a && n <= b;
  const devices = [...m.devices.values()].filter((d) => d.kind !== "box");
  const dynamic = devices.filter((d) => d.kind === "dyn");
  const outside = dynamic.filter((d) => !inside(d.n));
  const size = m.cells.filter((c) => inside(c.n) && c.state !== "na").length;
  return {
    from: a,
    to: b,
    size,
    used: devices.filter((d) => inside(d.n)).length,
    outside,
    fixedInside: devices.filter((d) => d.kind === "fix" && inside(d.n)),
    tooSmall: size < dynamic.length,
    same: m.hasPool && a === m.poolFrom && b === m.poolTo,
  };
}

const namesOf = (list, t) => {
  const shown = list.slice(0, 6).map((d) => d.name).join(", ");
  return list.length > 6 ? `${shown} ${fill(t.addr.pool.more, { n: list.length - 6 })}` : shown;
};

function poolCard(m, ctx) {
  const { t, addr } = ctx;
  const p = t.addr.pool;
  const draft = addr.poolDraft ?? { first: m.hasPool ? String(m.poolFrom) : "", last: m.hasPool ? String(m.poolTo) : "" };
  const change = poolChange(m, draft.first, draft.last);
  const line = (level, text) => `<div class="ahint ${level} flat"><span class="hbody"><span aria-hidden="true">${{ warn: "⚠", info: "ℹ", bad: "⛔" }[level]}</span><span>${text}</span></span></div>`;
  let preview = "";
  if (change?.error) preview = line("bad", escapeHtml(p.errors[change.error]));
  else if (change) {
    preview = `<p class="hint">${escapeHtml(fill(p.preview, { from: change.from, to: change.to, size: change.size, used: change.used }))}</p>`;
    if (change.outside.length) preview += line("warn", fill(p.outside, { n: change.outside.length, names: escapeHtml(namesOf(change.outside, t)) }));
    if (change.fixedInside.length) preview += line("info", fill(p.fixedInside, { n: change.fixedInside.length, names: escapeHtml(namesOf(change.fixedInside, t)) }));
    if (change.tooSmall) preview += line("bad", fill(p.tooSmall, { n: [...m.devices.values()].filter((d) => d.kind === "dyn").length }));
  }
  const ok = change && !change.error && !change.same && !change.tooSmall;
  return `<section class="card sec"><span class="label">${escapeHtml(p.title)}</span><p class="hint">${escapeHtml(p.lead)}</p>
    <form class="poolform" id="a-poolform" autocomplete="off">
      <span class="mono poolbase">${escapeHtml(m.baseText)}</span>
      <div class="afield"><label for="a-pf">${escapeHtml(p.from)}</label><input id="a-pf" data-k="a-pf" inputmode="numeric" value="${escapeHtml(draft.first)}"></div>
      <span class="poolbase">–</span>
      <div class="afield"><label for="a-pt">${escapeHtml(p.to)}</label><input id="a-pt" data-k="a-pt" inputmode="numeric" value="${escapeHtml(draft.last)}"></div>
      <button class="btn p" type="submit" ${ok ? "" : "disabled"}>${escapeHtml(p.apply)}</button>
      <button class="btn" type="button" data-apool="reset" ${addr.poolDraft ? "" : "disabled"}>${escapeHtml(p.reset)}</button></form>
    ${change?.same ? `<p class="hint">${escapeHtml(p.same)}</p>` : preview}</section>`;
}

/** Whether the box told for at least one device whether its address is fixed (or nothing was asked yet). */
export function fixedKnownOf(fixed) {
  const results = Object.values(fixed ?? {});
  return results.length === 0 || results.some((r) => r !== null && r !== undefined);
}

/** The card for the files and the sheet: the options and the three buttons. */
function exportCard(m, ctx) {
  const { t, addr } = ctx;
  const e = t.addr.export;
  const opts = addr.exportOpts ?? { free: false, mac: true, map: true, poolNames: true };
  const check = (key, label) =>
    `<label class="acheck"><input type="checkbox" data-aopt="${key}" ${opts[key] ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
  const incomplete = addr.progress ? `<p class="hint">${escapeHtml(fill(e.incomplete, addr.progress))}</p>` : "";
  return `<section class="card sec" id="a-export"><span class="label">${escapeHtml(e.title)}</span><p class="hint">${escapeHtml(e.lead)}</p>
    <div class="aopts">${check("free", e.optFree)}${check("mac", e.optMac)}${check("map", e.optMap)}${check("poolNames", e.optPoolNames)}</div>${incomplete}
    <div class="btn-row"><button class="btn" data-aexport="csv" data-k="x-csv">${escapeHtml(e.csv)}</button>
      <button class="btn" data-aexport="json" data-k="x-json">${escapeHtml(e.json)}</button>
      <button class="btn p" data-aexport="print" data-k="x-print">${escapeHtml(e.print)}</button></div>
    <p class="hint">${escapeHtml(e.printHint)}</p></section>`;
}

/** The block of the user an address is in. */
export function blockOf(own, n) {
  return (own.blocks ?? []).find((b) => n >= b.from && n <= b.to) ?? null;
}

/** How a new block is checked: null when fine, else the key of the problem and its values. */
export function checkBlock(own, { name, from, to }) {
  if (!name || !(Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= 254 && from <= to)) return { key: "errRange" };
  const clash = (own.blocks ?? []).find((b) => from <= b.to && to >= b.from);
  return clash ? { key: "errOverlap", values: { name: clash.name, from: clash.from, to: clash.to } } : null;
}

/**
 * One address or a range as the user types it: ".42", "42", ".60-.69", "60 – 69" or with the network in front
 * ("192.168.178.60-69"). Gives { from, to } as last octets, null when it is not one.
 */
export function parseRange(text) {
  const m = /^\s*(?:\d{1,3}\.\d{1,3}\.\d{1,3})?\.?(\d{1,3})\s*(?:[-–—]\s*(?:\d{1,3}\.\d{1,3}\.\d{1,3})?\.?(\d{1,3}))?\s*$/.exec(text ?? "");
  if (!m) return null;
  const from = Number(m[1]);
  return { from, to: m[2] === undefined ? from : Number(m[2]) };
}

/** What the form says about what is typed so far: { ok, text } with text empty while nothing is typed. */
export function groupPreview(own, base, draft, a) {
  const text = String(draft?.range ?? "").trim();
  if (!text) return { ok: false, text: "" };
  const range = parseRange(text);
  const problem = range ? checkBlock(own, { name: String(draft?.name ?? "").trim() || "x", ...range }) : { key: "errRange" };
  if (problem) return { ok: false, text: fill(a.groups[problem.key === "errRange" ? "errRangeOnly" : problem.key], problem.values ?? {}) };
  const size = range.to - range.from + 1;
  return {
    ok: true,
    text: size === 1 ? fill(a.groups.previewOne, { ip: `${base}${range.from}` }) : fill(a.groups.previewRange, { n: size, from: `${base}${range.from}`, to: `.${range.to}` }),
  };
}

function matches(m, cell, ctx) {
  const { filter, query, own } = ctx;
  const d = cell.device;
  const ok = {
    all: true,
    dyn: cell.state === "dyn" || cell.state === "off",
    fix: ["fix", "offfix", "box"].includes(cell.state),
    plan: cell.state === "plan",
    online: Boolean(d?.online),
    offline: Boolean(d && !d.online),
    free: cell.state === "free" || cell.state === "plan",
  }[filter];
  if (!ok) return false;
  if (!query) return true;
  const hay = `${m.baseText}${cell.n} ${d ? (own.names[d.mac] ?? d.name) : ""} ${d?.name ?? ""} ${d?.vendor ?? ""} ${own.notes[`${m.baseText}${cell.n}`] ?? ""}`;
  return hay.toLowerCase().includes(query.toLowerCase());
}

function countFor(m, filter, ctx) {
  return m.cells.filter((c) => matches(m, c, { ...ctx, filter, query: "" })).length;
}

export const displayName = (d, own) => own.names[d.mac] || d.name;

/** Used, fixed and free in one tile: a bar of the four kinds of address, the numbers below. */
function usageTile(m, a) {
  const count = (...states) => m.cells.filter((c) => states.includes(c.state)).length;
  const parts = [
    ["fix", count("fix", "offfix", "box"), "var(--fixed)"],
    ["dyn", count("dyn"), "var(--accent)"],
    ["off", count("off"), "color-mix(in srgb, var(--accent) 35%, transparent)"],
  ];
  const total = m.usable || 1;
  const bar = `<div class="ameter" role="img" aria-label="${escapeHtml(fill(a.tiles.usedValue, { used: m.used, total: m.usable }))}">${parts
    .filter(([, n]) => n)
    .map(([, n, color]) => `<i style="width:${((n / total) * 100).toFixed(2)}%;background:${color}"></i>`)
    .join("")}</div>`;
  const sub = fill(a.tiles.usageSub, { dyn: parts[1][1], off: parts[2][1], fixed: parts[0][1], free: m.free });
  return `<div class="tile wide"><span class="label">${escapeHtml(a.tiles.usage)}</span><b>${escapeHtml(fill(a.tiles.usedValue, { used: m.used, total: m.usable }))}</b>${bar}<small>${escapeHtml(sub)}</small></div>`;
}

function tiles(m, t) {
  const a = t.addr;
  const percent = m.poolSize ? Math.round((m.poolUsed / m.poolSize) * 100) : 0;
  const tile = (label, value, sub, meter = "", cls = "") =>
    `<div class="tile${cls}"><span class="label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${meter}<small>${escapeHtml(sub)}</small></div>`;
  const meter = (share, color) => `<div class="ameter"><i style="width:${Math.min(100, share * 100).toFixed(1)}%;background:${color}"></i></div>`;
  return `<div class="tiles atiles">
    ${tile(a.tiles.net, `${m.baseText}0/${m.prefix}`, fill(a.tiles.mask, { mask: m.mask }))}
    ${tile(a.tiles.gateway, m.gateway ?? "–", fill(a.tiles.gatewaySub, { name: m.gatewayName, dhcp: m.dhcp ? a.on : a.off }))}
    ${tile(a.tiles.pool, m.hasPool ? `.${m.poolFrom} – .${m.poolTo}` : a.tiles.noPool, m.hasPool ? fill(a.tiles.poolSub, { n: m.poolSize, used: m.poolUsed, free: m.poolSize - m.poolUsed, percent }) : "", m.hasPool ? meter(m.poolUsed / (m.poolSize || 1), percent >= 80 ? "var(--warn)" : "var(--accent)") : "")}
    ${usageTile(m, a)}
  </div>`;
}

function hintsCard(m, hints, own, t) {
  const a = t.addr;
  const shown = hints.filter((h) => !own.muted.includes(h.id));
  const muted = own.muted.filter((id) => hints.some((h) => h.id === id));
  const body = shown.length
    ? shown
        .map((h) => {
          const values = Object.fromEntries(Object.entries(h.values).map(([k, v]) => [k, escapeHtml(String(v))]));
          return `<div class="ahint ${h.level}"><button class="hbody" data-ahint="${escapeHtml(h.id)}" ${h.n === null ? "disabled" : `data-an="${h.n}"`}><span aria-hidden="true">${{ bad: "⛔", warn: "⚠", info: "ℹ" }[h.level]}</span><span>${fill(a.hints[h.key], values)}</span></button>
            <button class="hx" data-amute="${escapeHtml(h.id)}" title="${escapeHtml(a.hintHideTitle)}">${escapeHtml(a.hintHide)}</button></div>`;
        })
        .join("")
    : `<p class="hint">${escapeHtml(a.hintNone)}</p>`;
  const again = muted.length ? `<div class="muted-row">${escapeHtml(fill(a.hintMuted, { n: muted.length }))} · <button data-aunmute>${escapeHtml(a.hintShowAgain)}</button></div>` : "";
  return `<section class="card sec"><span class="label">${escapeHtml(a.hintsTitle)}</span><div class="ahints">${body}</div>${again}</section>`;
}

function cellHtml(m, c, ctx) {
  const { own, sel } = ctx;
  const ip = `${m.baseText}${c.n}`;
  const d = c.device;
  const blk = blockOf(own, c.n);
  const warn = ctx.hints.some((h) => h.n === c.n && h.level !== "info" && !own.muted.includes(h.id));
  const cls = ["cell", c.pool ? "pool" : "", warn ? "warn" : "", matches(m, c, ctx) ? "" : "dim", sel === c.n ? "sel" : "", blk ? "blk" : "", own.notes[ip] ? "note" : ""].filter(Boolean).join(" ");
  const label = ctx.t.addr.states[c.state];
  const title = [ip, d ? displayName(d, own) : label, blk ? fill(ctx.t.addr.inBlock, { name: blk.name }) : "", own.notes[ip] ?? ""].filter(Boolean).join(" · ");
  return `<button class="${cls}" ${blk ? `style="--bc:var(${blk.color})"` : ""} data-aip="${c.n}" data-s="${c.state}" data-k="a${c.n}" title="${escapeHtml(title)}" aria-label="${escapeHtml(`${ip}, ${d ? `${displayName(d, own)}, ` : ""}${label}`)}">${c.n}</button>`;
}

function mapView(m, ctx) {
  const { t } = ctx;
  let html = `<span></span>${[...Array(16).keys()].map((c) => `<span class="collab">${c.toString(16).toUpperCase()}</span>`).join("")}`;
  for (let r = 0; r < 16; r++) {
    html += `<span class="rowlab">.${r * 16}</span>`;
    for (let c = 0; c < 16; c++) html += cellHtml(m, m.cells[r * 16 + c], ctx);
  }
  const lg = t.addr.legend;
  const item = (style, text) => `<span class="alg"><i style="${style}"></i>${escapeHtml(text)}</span>`;
  const legend = [
    item("background:var(--accent)", lg.dyn),
    item("box-shadow:inset 0 0 0 2px var(--accent);background:transparent", lg.off),
    item("background:var(--fixed)", lg.fix),
    item("box-shadow:inset 0 0 0 2px var(--fixed);background:transparent", lg.offfix),
    item("background:var(--ok)", lg.box),
    item("background:var(--accent-soft)", lg.freePool),
    item("background:var(--free)", lg.free),
    item("border:2px dashed var(--ok);background:transparent", lg.plan),
    item("background:var(--warn-soft);box-shadow:inset 0 0 0 1px var(--warn)", lg.res),
    item("background:var(--bad);border-radius:50%", lg.alert),
    item("background:var(--warn);border-radius:50%;width:7px;height:7px", lg.note),
    item("background:var(--free);border-bottom:4px solid var(--b2)", lg.block),
  ].join("");
  return `<div class="agrid" aria-label="${escapeHtml(fill(t.addr.gridLabel, { from: `${m.baseText}0`, to: `${m.baseText}255` }))}">${html}</div><div class="alegend">${legend}</div>`;
}

function listView(m, ctx) {
  const { t, own, now } = ctx;
  const a = t.addr;
  const rows = m.cells
    .filter((c) => (c.device || c.state === "res") && matches(m, c, ctx))
    .map((c) => {
      const ip = `${m.baseText}${c.n}`;
      const note = own.notes[ip] ? `📝 ${escapeHtml(own.notes[ip])}` : "";
      const d = c.device;
      if (!d) {
        return `<tr class="arow" data-aip="${c.n}" data-k="a${c.n}"><td class="mono">${ip}</td><td class="muted">${escapeHtml(a.nobody)}<small>${note}</small></td><td><span class="badge warn">${escapeHtml(a.states.res)}</span></td><td>–</td><td>–</td><td>–</td></tr>`;
      }
      const fixed = d.kind !== "dyn";
      const seen = d.online ? t.nowText : whenText(d.lastOnline, now, t);
      return `<tr class="arow" data-aip="${c.n}" data-k="a${c.n}"><td class="mono">${ip}</td>
        <td><span class="dot ${d.online ? "on" : ""}"></span>${escapeHtml(displayName(d, own))}<small>${note || escapeHtml(linkText(d, t))}</small></td>
        <td><span class="badge ${fixed ? "fix" : "dyn"}">${escapeHtml(fixed ? a.kindFixedShort : a.kindDynamicShort)}</span></td>
        <td>${escapeHtml(d.online ? a.online : a.offline)}</td><td>${escapeHtml(d.vendor ?? "–")}</td><td>${escapeHtml(seen)}</td></tr>`;
    })
    .join("");
  return `<div class="tablewrap"><table class="atable"><thead><tr>${a.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${escapeHtml(a.nothingFound)}</td></tr>`}</tbody></table></div>`;
}

export function linkText(d, t) {
  if (d.linkType === "lan") return d.port ? `LAN ${d.port}` : "LAN";
  if (d.linkType === "wlan") return `WLAN${d.band ? ` ${t.addr.bands[d.band] ?? d.band}` : ""}`;
  return "";
}

function ownFields(m, n, d, own, t) {
  const a = t.addr;
  const ip = `${m.baseText}${n}`;
  const blk = blockOf(own, n);
  const alias = d
    ? `<div class="afield"><label for="a-alias">${escapeHtml(a.alias)}</label><input id="a-alias" data-aown="name" data-mac="${escapeHtml(d.mac)}" value="${escapeHtml(own.names[d.mac] ?? "")}" placeholder="${escapeHtml(d.name)}" maxlength="60"></div>`
    : "";
  return `${alias}<div class="afield"><label for="a-note">${escapeHtml(a.note)}</label><textarea id="a-note" data-aown="note" data-ip="${ip}" maxlength="300" placeholder="${escapeHtml(a.notePlaceholder)}">${escapeHtml(own.notes[ip] ?? "")}</textarea></div>
    ${blk ? `<div class="muted small">${fill(a.inYourBlock, { name: `<b style="color:var(${blk.color})">${escapeHtml(blk.name)}</b>`, from: blk.from, to: blk.to })}</div>` : ""}`;
}

function detail(m, ctx) {
  const { t, own, sel, now } = ctx;
  const a = t.addr;
  const badge = (cls, text) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
  if (sel === null || !m.cells[sel]) {
    const rows = ["dyn", "fix", "off", "offfix", "plan", "free"]
      .map((s) => `<dt>${escapeHtml(a.states[s])}</dt><dd>${m.cells.filter((c) => c.state === s).length}</dd>`)
      .join("");
    return `<h2>${escapeHtml(a.pick)}</h2><p class="muted">${escapeHtml(a.pickHint)}</p><span class="label spaced">${escapeHtml(a.sameState)}</span><dl>${rows}</dl>`;
  }
  const cell = m.cells[sel];
  const d = cell.device;
  const ip = `${m.baseText}${sel}`;
  const free = cell.state === "free" || cell.state === "plan";
  if (!d) {
    const head = cell.state === "na" ? badge("", a.badges.na) : cell.state === "res" ? badge("warn", a.badges.res) : cell.state === "plan" ? badge("ok", a.badges.plan) : badge("ok", a.badges.free);
    const text = cell.state === "na" ? a.na : cell.state === "res" ? a.reservedNone : cell.pool ? a.freeInPool : a.freeOutside;
    return `<h2><span class="mono">${ip}</span> ${head}</h2><p class="muted">${escapeHtml(text)}</p>
      ${cell.state === "na" ? "" : ownFields(m, sel, null, own, t)}
      ${free ? `<div class="actions"><button class="btn" data-amark="${sel}" data-k="mark">${escapeHtml(cell.state === "plan" ? a.unmark : a.mark)}</button></div><p class="soon">${escapeHtml(a.markHint)}</p>` : ""}`;
  }
  const fixed = d.kind !== "dyn";
  const where = cell.pool ? a.areaPool : m.hasPool && sel < m.poolFrom ? a.areaLow : m.hasPool ? a.areaHigh : a.areaWhole;
  const seen = d.online ? t.nowText : whenText(d.lastOnline, now, t);
  const kind = d.kind === "box" ? badge("fix", a.kindBox) : fixed ? badge("fix", a.kindFixed) : badge("dyn", d.fixedKnown ? a.kindDynamic : a.kindDynamicMaybe);
  const warnPool = d.kind === "fix" && cell.pool ? `<div class="ahint warn flat"><span class="hbody"><span aria-hidden="true">⚠</span><span>${escapeHtml(fill(a.poolFixedAdvice, { from: m.poolFrom }))}</span></span></div>` : "";
  const warnOff = d.kind === "fix" && !d.online ? `<div class="ahint info flat"><span class="hbody"><span aria-hidden="true">ℹ</span><span>${escapeHtml(fill(a.offlineFixedAdvice, { when: seen }))}</span></span></div>` : "";
  return `<h2><span class="mono">${ip}</span> ${d.online ? badge("ok", a.online) : badge("", a.offline)}</h2>
    <div class="big">${escapeHtml(displayName(d, own))}</div>
    <div class="muted">${[own.names[d.mac] ? fill(a.boxName, { name: d.name }) : "", d.vendor ?? a.noVendor].filter(Boolean).map(escapeHtml).join(" · ")}</div>
    <dl><dt>${escapeHtml(a.kind)}</dt><dd>${kind}</dd><dt>${escapeHtml(a.area)}</dt><dd>${escapeHtml(where)}</dd>
      <dt>${escapeHtml(a.link)}</dt><dd>${escapeHtml(linkText(d, t) || "–")}</dd><dt>${escapeHtml(a.seen)}</dt><dd>${escapeHtml(seen)}</dd>
      <dt>MAC</dt><dd class="mono">${escapeHtml(d.mac ?? "–")}</dd></dl>
    ${ownFields(m, sel, d, own, t)}${warnPool}${warnOff}
    <div class="actions">${d.id ? `<button class="btn p" data-dev="${escapeHtml(d.id)}" data-k="open-dev">${escapeHtml(a.openDevice)}</button>` : ""}</div>
    <p class="soon">${escapeHtml(a.ownHint)}</p>`;
}

/** The button in the head of the page: how many groups there are, and the way to the dialog. */
function groupsButton(own, t) {
  const n = own.blocks.length;
  return `<button class="btn" data-agroups="open" data-k="groups-open" aria-haspopup="dialog">${escapeHtml(t.addr.groups.open)}${n ? ` <span class="count">${n}</span>` : ""}</button>`;
}

/** The dialog of the address groups: the list, and a form with one field for an address or a range. */
function groupsDialog(m, ctx) {
  const { t, own, groupDraft } = ctx;
  const g = t.addr.groups;
  const draft = groupDraft ?? { name: "", range: "", color: BLOCK_COLORS[0] };
  const list = [...own.blocks].sort((x, y) => x.from - y.from);
  const rows = list.length
    ? list
        .map((b) => {
          const size = b.to - b.from + 1;
          const inside = m.cells.filter((c) => c.n >= b.from && c.n <= b.to);
          const usedN = inside.filter((c) => c.device).length;
          const planned = inside.filter((c) => c.state === "plan").length;
          const stats = [size === 1 ? g.sizeOne : fill(g.size, { n: size }), fill(g.used, { n: usedN }), planned ? fill(g.planned, { n: planned }) : ""].filter(Boolean).join(" · ");
          const range = size === 1 ? `.${b.from}` : `.${b.from} – .${b.to}`;
          return `<li class="agroup"><i style="background:var(${b.color})"></i><span class="gname"><b>${escapeHtml(b.name)}</b><small>${escapeHtml(stats)}</small></span>
            <span class="mono">${escapeHtml(range)}</span>
            <button class="x" data-adel="${b.id}" aria-label="${escapeHtml(fill(g.deleteLabel, { name: b.name }))}" title="${escapeHtml(g.delete)}">✕</button></li>`;
        })
        .join("")
    : "";
  const colors = BLOCK_COLORS.map(
    (c, i) =>
      `<label class="swatch" title="${escapeHtml(g.colors[i])}"><input type="radio" name="color" value="${c}" ${draft.color === c ? "checked" : ""} aria-label="${escapeHtml(g.colors[i])}"><i style="background:var(${c})"></i></label>`
  ).join("");
  const preview = groupPreview(own, m.baseText, draft, t.addr);
  return `<div class="backdrop open" id="a-groups" data-agroups="backdrop"><div class="dialog groups" role="dialog" aria-modal="true" aria-labelledby="a-gtitle">
    <div class="ghead"><div><h2 id="a-gtitle">${escapeHtml(g.title)}</h2><p class="hint">${escapeHtml(g.lead)}</p></div>
      <button class="x" data-agroups="close" aria-label="${escapeHtml(g.close)}">✕</button></div>
    ${rows ? `<ul class="agroups">${rows}</ul>` : `<p class="hint gnone">${escapeHtml(g.none)}</p>`}
    <form class="groupform" id="a-blockform" autocomplete="off">
      <h3>${escapeHtml(g.newTitle)}</h3>
      <div class="gfields">
        <div class="afield"><label for="a-bn">${escapeHtml(g.name)}</label><input id="a-bn" name="name" maxlength="30" placeholder="${escapeHtml(g.namePlaceholder)}" value="${escapeHtml(draft.name)}"></div>
        <div class="afield"><label for="a-br">${escapeHtml(g.range)}</label><input id="a-br" name="range" class="mono" placeholder="${escapeHtml(g.rangePlaceholder)}" value="${escapeHtml(draft.range)}" inputmode="text"></div>
      </div>
      <p class="gprev ${preview.ok ? "ok" : ""}" id="a-bprev" aria-live="polite">${escapeHtml(preview.text || g.rangeHint)}</p>
      <div class="afield"><span class="label">${escapeHtml(g.color)}</span><div class="swatches" role="radiogroup" aria-label="${escapeHtml(g.color)}">${colors}</div></div>
      <div class="formmsg" role="alert">${ctx.blockMessage ? escapeHtml(ctx.blockMessage) : ""}</div>
      <div class="btn-row"><button type="button" class="btn" data-agroups="close">${escapeHtml(g.close)}</button><button class="btn p" type="submit">${escapeHtml(g.create)}</button></div>
    </form></div></div>`;
}

function zonesCard(m, t, language) {
  const a = t.addr;
  const bar = m.zones.map((z) => `<div class="z-${z.id}" style="flex:${Math.max(1, z.size)}">${escapeHtml(a.zones[z.id])}</div>`).join("");
  const rows = m.zones
    .map((z) => {
      const used = z.fixed + z.dynamic;
      return `<div class="azone"><div class="name"><b>${escapeHtml(a.zones[z.id])}</b><small>.${z.from} – .${z.to} · ${escapeHtml(a.zoneNotes[z.id])}</small></div>
        <div class="ameter" title="${escapeHtml(fill(a.zoneSplit, { fixed: z.fixed, dynamic: z.dynamic }))}"><i style="width:${(z.fixed / (z.size || 1)) * 100}%;background:var(--fixed)"></i><i style="width:${(z.dynamic / (z.size || 1)) * 100}%;background:var(--accent)"></i></div>
        <div class="num"><b>${used}</b> / ${z.size} <span class="muted">· ${z.size ? Math.round((used / z.size) * 100) : 0} %</span></div></div>`;
    })
    .join("");
  return `<section class="card sec"><span class="label">${escapeHtml(a.zonesTitle)}</span>
    <div class="abar">${bar}</div><div class="azones">${rows}</div><p class="hint">${escapeHtml(a.zonesNote)}</p></section>`;
}

/**
 * The page. ctx: { t, language, now, addr, clients, nodes, canWrite } with addr the state of the page: { status, network,
 * own, fixed, filter, query, view, sel, blockMessage, progress }.
 */
export function renderAddresses(ctx) {
  const { t, addr, clients, nodes } = ctx;
  const a = t.addr;
  const back = `<div class="phead"><div class="pheadrow"><h1 id="dtitle" tabindex="-1">${escapeHtml(a.title)}</h1>
    ${addr.status === "ready" ? `<div class="btn-row tight">${groupsButton(addr.own ?? emptyOwn(), t)}<button class="btn" data-aexport="scroll" data-k="x-scroll">${escapeHtml(a.export.open)}</button></div>` : ""}</div><p class="lead">${escapeHtml(a.lead)}</p></div>`;
  if (addr.status === "loading") return `${back}<div class="card"><div class="empty"><span>${escapeHtml(t.loading)}</span></div></div>`;
  if (addr.status === "failed") return `${back}<div class="card"><div class="empty"><b>${escapeHtml(a.failed)}</b></div></div>`;
  const own = addr.own ?? emptyOwn();
  const model = addressModel({ network: addr.network, clients, nodes, fixed: addr.fixed, own });
  if (!model) return `${back}<div class="card"><div class="empty"><b>${escapeHtml(a.noNetwork)}</b></div></div>`;
  const hints = addressHints(model, { fixedKnown: fixedKnownOf(addr.fixed) });
  const c = { ...ctx, own, filter: addr.filter, query: addr.query, sel: addr.sel, hints, blockMessage: addr.blockMessage, groupDraft: addr.groupDraft };
  const chips = FILTERS.map(
    (f) => `<button class="achip" data-afilter="${f}" data-k="f-${f}" aria-pressed="${addr.filter === f}">${escapeHtml(a.filters[f])}<em>${countFor(model, f, c)}</em></button>`
  ).join("");
  const progress = addr.progress ? `<p class="hint">${escapeHtml(fill(a.reading, addr.progress))}</p>` : "";
  const wider = model.wider ? `<p class="hint">${escapeHtml(fill(a.wider, { base: `${model.baseText}0/24`, prefix: model.prefix }))}</p>` : "";
  return `${back}${progress}${wider}${tiles(model, t)}${hintsCard(model, hints, own, t)}
    <div class="alayout">
      <section class="card sec"><div class="amaphead"><div class="achips" role="group" aria-label="${escapeHtml(a.filterLabel)}">${chips}</div>
          <div class="seg" role="group" aria-label="${escapeHtml(a.viewLabel)}"><button data-aview="map" data-k="v-map" aria-pressed="${addr.view === "map"}">${escapeHtml(a.viewMap)}</button><button data-aview="list" data-k="v-list" aria-pressed="${addr.view === "list"}">${escapeHtml(a.viewList)}</button></div></div>
        <label class="search"><span class="sr">${escapeHtml(a.search)}</span><input type="search" id="a-q" data-k="a-q" placeholder="${escapeHtml(a.search)}" aria-label="${escapeHtml(a.search)}" value="${escapeHtml(addr.query)}"></label>
        ${addr.view === "map" ? mapView(model, c) : listView(model, c)}</section>
      <aside class="card sec adetail" aria-live="polite">${detail(model, c)}</aside>
    </div>
    ${zonesCard(model, t, ctx.language)}${ctx.canWrite && model.dhcp ? poolCard(model, c) : ""}${exportCard(model, c)}${addr.groupsOpen ? groupsDialog(model, c) : ""}`;
}
