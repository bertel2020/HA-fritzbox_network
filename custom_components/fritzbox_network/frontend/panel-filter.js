/* The page that decides which devices Home Assistant gets: modes, extra rules, the picker and the preview. */

import { escapeHtml, filterChanged } from "./shared.js";
import { fill } from "./texts.js";

const MODES = ["all", "include", "exclude"];

function toggle(key, label, hint, on) {
  return `<div class="action"><div>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></div>
    <button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" data-ft="${key}"></button></div>`;
}

/** The three modes as cards, each saying what it does, and the two extra rules below. */
export function renderFilterControls(page, t) {
  const f = t.filter;
  if (!page) return "";
  const draft = page.draft;
  const cards = MODES.map(
    (m) => `<button class="modecard" data-mode="${m}" aria-pressed="${draft.filter_mode === m}">
      <b>${escapeHtml(f.modes[m])}</b><small>${escapeHtml(f.modeHints[m])}</small></button>`
  ).join("");
  return `<div class="modecards" role="group" aria-label="${escapeHtml(f.mode)}">${cards}</div>
    <section class="card pad"><h2>${escapeHtml(f.rulesTitle)}</h2>
      ${toggle("ignore_guests", f.ignoreGuests, f.ignoreGuestsHint, draft.ignore_guests)}${toggle(
        "ignore_private_macs",
        f.ignorePrivate,
        f.ignorePrivateHint,
        draft.ignore_private_macs
      )}</section>`;
}

/** The devices matching the search of the picker; only for "only selected" and "all except selected". */
export function pickable(page) {
  if (!page || page.draft.filter_mode === "all") return [];
  const query = (page.search ?? "").toLowerCase();
  return (page.preview?.devices ?? []).filter((d) => !query || `${d.name} ${d.mac}`.toLowerCase().includes(query));
}

/** How many are chosen and the buttons for all of the shown and none. */
export function renderPickerHead(page, t) {
  if (!page || page.draft.filter_mode === "all") return "";
  const f = t.filter;
  const chosen = page.draft.filter_devices.length;
  return `<span class="count">${escapeHtml(fill(f.chosen, { n: chosen }))}</span>
    <span class="btn-row tight"><button class="btn" data-act="fpick-all" ${pickable(page).length ? "" : "disabled"}>${escapeHtml(f.pickAll)}</button>
    <button class="btn" data-act="fpick-none" ${chosen ? "" : "disabled"}>${escapeHtml(f.pickNoneBtn)}</button></span>`;
}

/** The devices to pick from. */
export function renderPicker(page, t) {
  if (!page || page.draft.filter_mode === "all") return "";
  const f = t.filter;
  const chosen = new Set(page.draft.filter_devices);
  const devices = pickable(page);
  const rows = devices.length
    ? devices
        .map(
          (d) => `<label class="row"><input type="checkbox" data-fpick="${escapeHtml(d.mac)}" ${chosen.has(d.mac) ? "checked" : ""}>
            <span class="who"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.mac)}</small></span></label>`
        )
        .join("")
    : `<div class="empty"><span>${escapeHtml(f.pickNone)}</span></div>`;
  return `<div class="picker">${rows}</div>`;
}

function names(devices) {
  return devices.map((d) => d.name).join(", ");
}

/** What applying does, in a bar that stays at the bottom: the three numbers, the warning, the button. */
export function renderPreview(page, t) {
  const f = t.filter;
  if (!page?.preview) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const { keep, add, remove } = page.preview;
  const changed = filterChanged(page.current, page.draft);
  const pill = (key, list, cls = "") =>
    `<span class="pill2 ${cls}"><b>${list.length}</b> ${escapeHtml(f[key])}</span>`;
  return `<div class="applybar sticky">
    <div class="sum">${pill("keep", keep)}${pill("add", add, add.length ? "ok" : "")}${pill("remove", remove, remove.length ? "bad" : "")}</div>
    ${remove.length ? `<div class="note bad">${escapeHtml(fill(f.removeNote, { names: names(remove) }))}</div>` : ""}
    ${add.length ? `<p class="muted">${escapeHtml(fill(f.addNote, { names: names(add) }))}</p>` : ""}
    ${!changed ? `<p class="muted">${escapeHtml(f.unchanged)}</p>` : ""}
    <div class="btn-row"><button class="btn p ${remove.length ? "danger" : ""}" data-act="apply" ${changed ? "" : "disabled"}>${escapeHtml(f.apply)}</button></div></div>`;
}
