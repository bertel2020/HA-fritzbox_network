/* The command palette (Ctrl/⌘ K, or the magnifier in the header): devices, pages and actions in one search, all from what the panel already has. */

import { SUB_LABELS, escapeHtml, pageHash } from "./shared.js";
import { ic } from "./icons.js";
import { TEXTS, fill } from "./texts.js";

/** At most this many results per group. */
export const PALETTE_LIMIT = 6;
export const PALETTE_GROUPS = ["devices", "pages", "actions"];

/** A text to compare: lower case, without accents ("Übersicht" is found by "uber"). */
const norm = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Without separators, so "3ca62f" finds "3c:a6:2f" and "178.2" an address. */
const compact = (text) => text.replace(/[\s:.\-›/]/g, "");

/** Whether the letters of a token come in this order in a text from the start of one of its words: "wlan" in "Wireless LAN". */
function inOrder(token, text) {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== token[0] || (start > 0 && !/[\s›.:\-/(„"“]/.test(text[start - 1]))) continue;
    let at = 0;
    for (const char of text.slice(start)) if (char === token[at]) at += 1;
    if (at === token.length) return true;
  }
  return false;
}

/** How well one token fits one text: 0 for not at all, more the better (whole text, its start, a word start, inside it). */
function tokenScore(token, raw) {
  const text = norm(raw);
  if (!text) return 0;
  if (text === token) return 100;
  if (text.startsWith(token)) return 60;
  const at = text.indexOf(token);
  if (at > 0) return /[\s›.:\-/(„"“]/.test(text[at - 1]) ? 40 : 20;
  const bare = compact(token);
  if (bare.length >= 2 && compact(text).includes(bare)) return 15;
  return token.length >= 4 && inOrder(token, text) ? 4 : 0;
}

/**
 * How well an entry fits the search: null where one of the words of the search fits nowhere,
 * else the sum over the words of the best fit, its label counting three times its other words.
 */
export function scoreEntry(query, entry) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    const best = Math.max(3 * tokenScore(token, entry.label), ...(entry.keywords ?? []).map((k) => tokenScore(token, k)));
    if (!best) return null;
    total += best;
  }
  return total;
}

/**
 * The results for a search: [{ id, items }] for devices, pages and actions in this order, each
 * ranked by scoreEntry (the shorter label first on a tie, then the order given) and cut to `limit`;
 * groups without a result are left out. Without a search: the pages and actions that are not
 * searchOnly, no devices. The best device brings its "capture its traffic" to the top of the actions.
 */
export function searchPalette(query, entries, { limit = PALETTE_LIMIT } = {}) {
  const searching = norm(query).trim() !== "";
  const groups = PALETTE_GROUPS.map((id) => {
    const own = (entries ?? []).filter((e) => e.group === id);
    const items = searching
      ? own
          .map((entry, i) => ({ entry, i, score: scoreEntry(query, entry) }))
          .filter((x) => x.score !== null)
          .sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length || a.i - b.i)
          .map((x) => x.entry)
      : own.filter((e) => !e.searchOnly);
    return { id, items: items.slice(0, limit) };
  });
  const top = groups[0].items[0];
  if (top?.capture) groups[2].items = [top.capture, ...groups[2].items].slice(0, limit);
  return groups.filter((g) => g.items.length);
}

/** All labels of a text in both languages, for the search: "Neu verbinden" is found by "reconnect" too. */
function bothLanguages(pick) {
  return [...new Set(Object.values(TEXTS).map((texts) => pick(texts)).filter(Boolean))];
}

/** The name of a page in the palette: "Internet › Port forwarding", or the tab alone where it has one page. */
function pageName(texts, id, group, multi) {
  const own = texts.tabs[SUB_LABELS[id] ?? id] ?? id;
  return multi ? `${texts.tabs[group] ?? group} › ${own}` : own;
}

const LINK_ICONS = { wlan: "wifi", lan: "lan" };

/**
 * What the palette can find: the devices (name, address, MAC, hostname, vendor), the pages offered
 * ([{ id, group }] in order, with the number of pages of their tab) and the actions the panel has.
 * Each entry: { group, id, label, sub, keywords, icon, and hash (an address to open) or act (an
 * action of the panel) }; the actions that need the right to change settings only with canWrite.
 */
export function paletteEntries({ clients = [], pages = [], canWrite = false, internet = false } = {}, t) {
  const p = t.palette;
  const entries = [];
  for (const c of clients) {
    const link = c.link_type === "wlan" ? [t.tabs.wlan, t.bandGroups[c.band] ?? ""].filter(Boolean).join(" ") : c.link_type === "lan" ? t.bandGroups.lan : "";
    entries.push({
      group: "devices",
      id: `dev-${c.id}`,
      label: c.name ?? c.mac,
      sub: [c.ip, link].filter(Boolean).join(" · "),
      keywords: [c.ip, c.mac, c.hostname, c.vendor].filter(Boolean),
      icon: LINK_ICONS[c.link_type] ?? "network",
      hash: `#/device/${c.id}`,
      searchOnly: true,
      capture: c.mac ? { group: "actions", id: `cap-${c.id}`, label: fill(p.actions.captureDevice, { name: c.name ?? c.mac }), sub: `${t.tabs.box} › ${t.tabs.capture}`, icon: "download", hash: pageHash("capture", { mac: c.mac }) } : null,
    });
  }
  const tabsOf = (group) => pages.filter((x) => x.group === group).length;
  for (const { id, group } of pages) {
    const multi = tabsOf(group) > 1;
    entries.push({
      group: "pages",
      id: `page-${id}`,
      label: pageName(t, id, group, multi),
      sub: "",
      keywords: bothLanguages((texts) => pageName(texts, id, group, multi)),
      icon: "right",
      hash: pageHash(id),
    });
  }
  const action = (key, extra) => ({
    group: "actions",
    id: `act-${key}`,
    label: p.actions[key],
    keywords: bothLanguages((texts) => texts.palette.actions[key]),
    ...extra,
  });
  entries.push(action("check", { act: "check", sub: `${t.tabs.box} › ${t.tabs.check}`, icon: "check" }));
  if (canWrite && internet) entries.push(action("reconnect", { act: "reconnect", sub: t.tabs.internet, icon: "globe" }));
  entries.push(action("capture", { hash: pageHash("capture"), sub: `${t.tabs.box} › ${t.tabs.capture}`, icon: "download" }));
  if (canWrite) entries.push(action("reboot", { act: "reboot", sub: t.tabs.box, icon: "restart" }));
  entries.push(action("look", { act: "look", sub: t.lookTitle, icon: "palette" }));
  for (const mode of ["light", "dark", "ha"]) entries.push(action(mode, { act: `look-${mode}`, sub: t.lookTitle, icon: "palette", searchOnly: true }));
  return entries;
}

/** The results as the list of the palette: groups with their options; sel is the index of the chosen option over all groups. */
export function renderPaletteList(groups, { t, query, sel }) {
  if (!groups.length) return `<p class="palnone">${escapeHtml(fill(t.palette.none, { q: query.trim() }))}</p>`;
  let n = 0;
  return groups
    .map(
      (g) => `<div role="group" aria-labelledby="pal-g-${g.id}"><div class="label palgrp" id="pal-g-${g.id}" role="presentation">${escapeHtml(t.palette.groups[g.id])}</div>${g.items
        .map((item) => {
          const at = n++;
          return `<div class="palopt" role="option" id="pal-o-${at}" data-pal="${at}" aria-selected="${at === sel}"><span class="ic" aria-hidden="true">${ic(item.icon)}</span><b>${escapeHtml(item.label)}</b>${item.sub ? `<small>${escapeHtml(item.sub)}</small>` : ""}</div>`;
        })
        .join("")}</div>`
    )
    .join("");
}

/** The frame of the palette: the search field (a combobox for the list below it), the list, the keys at the foot. */
export function renderPalette(t) {
  const p = t.palette;
  const k = p.keys;
  return `<div class="pal" role="dialog" aria-modal="true" aria-label="${escapeHtml(p.title)}">
    <div class="palin">${ic("search")}<input id="pal-q" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-describedby="pal-count" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(p.placeholder)}" aria-label="${escapeHtml(p.title)}"><kbd aria-hidden="true">Esc</kbd><button class="iconbtn palclose" data-act="pal-close" aria-label="${escapeHtml(k.close)}">${ic("close")}</button></div>
    <div class="pallist" id="pal-list" role="listbox" aria-label="${escapeHtml(p.title)}"></div>
    <div class="sr" id="pal-count" aria-live="polite"></div>
    <div class="palfoot" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> ${escapeHtml(k.move)}</span><span><kbd>↵</kbd> ${escapeHtml(k.run)}</span><span><kbd>Tab</kbd> ${escapeHtml(k.group)}</span><span><kbd>Esc</kbd> ${escapeHtml(k.close)}</span></div>
  </div>`;
}

/** The option the chosen one moves to: by one up or down (round), or by Tab to the first of the next (Shift+Tab: previous) group. */
export function paletteMove(groups, sel, key, shift = false) {
  const sizes = groups.map((g) => g.items.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  if (key === "ArrowDown") return (sel + 1) % total;
  if (key === "ArrowUp") return (sel - 1 + total) % total;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  if (key === "Tab") {
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
    const here = starts.findLastIndex((s) => s <= sel);
    const to = (here + (shift ? -1 : 1) + starts.length) % starts.length;
    return starts[to];
  }
  return sel;
}

/** The option at an index over all groups. */
export function paletteItem(groups, sel) {
  return groups.flatMap((g) => g.items)[sel] ?? null;
}
