/* Switching over from the core integration "AVM FRITZ!Box Tools": a read-only preview and the note above the pages. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

export const MIGRATE_STATUSES = ["migrate", "conflict", "none", "skip"];
const LATER_KEY = "fritzbox_network_migrate_later";
const LATER_MS = 30 * 86400000;

/** How many rows of the preview have each result, and all of them. */
export function migrateCounts(rows) {
  const counts = { all: 0, migrate: 0, conflict: 0, none: 0, skip: 0 };
  for (const row of rows ?? []) {
    counts.all += 1;
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

const storageOf = (storage) => {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Whether "Later" was chosen for this core entry in this browser less than 30 days ago. */
export function bannerHidden(coreEntryId, now = Date.now(), storage) {
  try {
    const store = storageOf(storage);
    const until = JSON.parse(store?.getItem(LATER_KEY) ?? "{}")?.[coreEntryId];
    return typeof until === "number" && until > now;
  } catch {
    return false;
  }
}

/** Hides the note for this core entry for 30 days in this browser; without storage only until the reload. */
export function hideBanner(coreEntryId, now = Date.now(), storage) {
  try {
    const store = storageOf(storage);
    if (!store) return false;
    const saved = JSON.parse(store.getItem(LATER_KEY) ?? "{}") ?? {};
    saved[coreEntryId] = now + LATER_MS;
    store.setItem(LATER_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

/** Whether the scan found a core entry for this box: then the page is offered and the note may show. */
export const hasCore = (scan) => Boolean(scan && typeof scan === "object" && scan.core);

/** The note above every page while FRITZ!Box Tools runs for the same box; empty otherwise. */
export function renderBanner(scan, ctx) {
  const { t, hidden, tab } = ctx;
  const core = scan?.core;
  if (!core || core.same_box === false || hidden || tab === "migrate") return "";
  const b = t.migrate.banner;
  const loud = core.state === "loaded";
  return `<div class="banner ${loud ? "" : "info"}" role="region" aria-label="${escapeHtml(b.label)}">${ic(loud ? "alert" : "swap")}
    <div><b>${escapeHtml(loud ? b.dup : b.quiet)}</b><span class="t">${escapeHtml(loud ? b.dupBody : b.quietBody)}</span></div>
    <div class="btn-row tight"><button class="btn ${loud ? "p " : ""}sm" data-act="mig-open" data-k="mig-open">${escapeHtml(loud ? b.start : b.look)}</button><button class="btn sm" data-act="mig-later" data-k="mig-later">${escapeHtml(b.later)}</button></div></div>`;
}

function statusChip(status, t) {
  const cls = { migrate: "ok", conflict: "bad", none: "", skip: "" }[status] ?? "";
  const sign = { migrate: "✓", conflict: "!", none: "–", skip: "–" }[status] ?? "";
  return `<span class="chip ${cls}"><span aria-hidden="true">${sign}</span> ${escapeHtml(t.migrate.status[status] ?? status)}</span>`;
}

function row(r, t) {
  const m = t.migrate;
  const takes = r.status === "migrate" || r.status === "conflict";
  const why = [
    r.reason ? m.reasons[r.reason] ?? r.reason : "",
    ...(r.notes ?? []).map((n) => m.notes[n] ?? n),
    r.used_by?.length ? fill(m.usedBy, { n: r.used_by.length, names: r.used_by.join(", ") }) : "",
  ].filter(Boolean);
  const tone = r.status === "conflict" ? "bad" : (r.notes ?? []).length ? "warn" : "";
  const target = r.target_entity_id
    ? `<b class="mono">${escapeHtml(r.target_entity_id)}</b><span class="mono">${escapeHtml(takes ? m.getsId : m.keeps)}</span>`
    : `<b class="muted">–</b>`;
  return `<li class="mrow ${takes ? "" : "dim"}">
    <div class="ent"><b>${escapeHtml(r.core_name || r.core_entity_id)}</b><span class="mono">${escapeHtml(r.core_entity_id)}</span></div>
    <span class="arrow" aria-hidden="true">→</span>
    <div class="ent to"><span class="sr">${escapeHtml(m.cols.ours)}: </span>${target}</div>
    <div class="st">${statusChip(r.status, t)}</div>
    ${why.length ? `<div class="why ${tone}">${why.map((w) => escapeHtml(w)).join("<br>")}</div>` : ""}</li>`;
}

/**
 * The page. scan is what migrate/scan answered: null while it is read, "failed" where it could not.
 * ctx: t, filter (all or one of the results). The preview only reads; taking over is not built yet.
 */
export function renderMigrate(scan, ctx) {
  const { t } = ctx;
  const m = t.migrate;
  const head = `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(m.title)}</h1><p class="lead">${escapeHtml(m.lead)}</p></div>`;
  const rescan = `<button class="btn" data-act="mig-rescan" data-k="mig-rescan">${escapeHtml(m.rescan)}</button>`;
  if (scan === null || scan === undefined) {
    return `${head}<section class="card sec" aria-busy="true"><p role="status">${escapeHtml(m.scanning)}</p></section>`;
  }
  if (scan === "failed" || typeof scan !== "object") {
    return `${head}<div class="card"><div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${escapeHtml(m.failed)}</b><div class="btn-row">${rescan}</div></div></div>`;
  }
  const core = scan.core;
  if (!core) return `${head}<div class="card"><div class="empty"><b>${escapeHtml(m.empty.none)}</b><span>${escapeHtml(m.empty.noneHint)}</span></div></div>`;
  if (core.same_box === false) {
    return `${head}<div class="card"><div class="empty"><b>${escapeHtml(m.empty.other)}</b><span>${escapeHtml(fill(m.empty.otherHint, { title: core.title ?? "" }))}</span></div></div>`;
  }
  const rows = scan.rows ?? [];
  const counts = migrateCounts(rows);
  const filter = ctx.filter && ctx.filter in counts ? ctx.filter : "all";
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const groups = [...new Set(shown.map((r) => r.group))];
  const body = groups
    .map((g) => {
      const list = shown.filter((r) => r.group === g);
      return `<div class="grp"><span>${escapeHtml(m.groups[g] ?? g)}</span><span>${list.length}</span></div>
        <div class="mrow mhead" aria-hidden="true"><span>${escapeHtml(m.cols.core)}</span><span></span><span>${escapeHtml(m.cols.ours)}</span><span>${escapeHtml(m.cols.result)}</span></div>
        <ul class="mlist">${list.map((r) => row(r, t)).join("")}</ul>`;
    })
    .join("");
  const tiles = MIGRATE_STATUSES.map((s) => {
    const cls = { migrate: "ok", conflict: counts.conflict ? "bad" : "" }[s] ?? "";
    return `<div class="tile ${cls}"><span class="label">${escapeHtml(m.tiles[s])}</span><b>${counts[s]}</b>${s === "none" ? `<small>${escapeHtml(m.noneSub)}</small>` : ""}</div>`;
  }).join("");
  const filters = ["all", ...MIGRATE_STATUSES]
    .map((k) => `<button class="fchip" data-act="mig-filter" data-f="${k}" data-k="mig-f-${k}" aria-pressed="${filter === k}">${escapeHtml(m.filters[k])}<b>${counts[k]}</b></button>`)
    .join("");
  const stateText = m.state[core.state] ?? core.state ?? "";
  return `${head}
    <div class="banner info" role="note">${ic("swap")}<div><b>${escapeHtml(m.notYet)}</b></div><div class="btn-row tight">${rescan}</div></div>
    <section class="card sec">
      <div class="ihead"><span class="ico">${ic("swap")}</span>
        <span class="who"><b>${escapeHtml(core.title ?? "FRITZ!Box Tools")}</b><small>${escapeHtml([m.sameBox, stateText, fill(m.entities, { n: counts.all })].filter(Boolean).join(" · "))}</small></span></div>
      <div class="tiles">${tiles}</div>
      <div class="filters" role="group" aria-label="${escapeHtml(m.filterLabel)}">${filters}</div>
      <div class="mtable">${body || `<div class="empty"><b>${escapeHtml(m.emptyFilter)}</b></div>`}</div>
      <p class="hint">${escapeHtml(m.hint)}</p>
    </section>`;
}
