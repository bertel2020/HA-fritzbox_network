/* The clean-up page of the panel: devices offline for long, and the removed ones, as HTML. */

import { escapeHtml, staleSince } from "./shared.js";
import { fill } from "./texts.js";
import { ic } from "./icons.js";

/** The devices the chosen days offer, the ones gone for longest first. */
export function staleList(state) {
  return staleSince(state.cleanup?.devices, state.cleanupDays).sort((a, b) => b.days - a.days);
}

/** The offered devices that match the search. */
export function visibleStale(state) {
  const query = (state.cleanupQuery ?? "").trim().toLowerCase();
  return staleList(state).filter(
    (d) => !query || `${d.name} ${d.vendor ?? ""} ${d.mac}`.toLowerCase().includes(query)
  );
}

/** The chosen devices that are still on offer: a device that came back is no longer picked. */
export function pickedMacs(state) {
  const offered = new Set(staleList(state).map((d) => d.mac));
  return [...state.picked].filter((mac) => offered.has(mac));
}

function emptyState(icon, title, hint) {
  return `<div class="empty">${ic(icon)}<b>${escapeHtml(title)}</b><span>${escapeHtml(hint)}</span></div>`;
}

export function renderStale(state, t) {
  const c = t.cleanup;
  if (!state.cleanup) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const all = staleList(state);
  if (!all.length) return emptyState("check", c.nothing, c.nothingHint);
  const list = visibleStale(state);
  const picked = pickedMacs(state);
  const summary = fill(all.length === 1 ? c.summaryOne : c.summary, { n: all.length, days: state.cleanupDays });
  const rows = list
    .map(
      (d) => `<label class="row crow"><input type="checkbox" data-pick="${escapeHtml(d.mac)}" ${state.picked.has(d.mac) ? "checked" : ""}>
        <span class="who"><b>${escapeHtml(d.name)}</b><small>${escapeHtml([d.vendor, d.mac].filter(Boolean).join(" · "))}</small></span>
        <span class="since">${escapeHtml(fill(c.days, { n: d.days }))}</span></label>`
    )
    .join("");
  return `<p class="count" aria-live="polite">${escapeHtml(summary)}</p>
    ${rows ? `<div class="crows">${rows}</div>` : `<div class="empty"><span>${escapeHtml(c.noMatch)}</span></div>`}
    <div class="selbar sticky"><span>${escapeHtml(fill(c.selected, { n: picked.length }))}</span>
      <span class="btn-row tight"><button class="btn" data-act="pick-all" ${list.length ? "" : "disabled"}>${escapeHtml(c.pickAll)}</button>
      <button class="btn" data-act="pick-none" ${picked.length ? "" : "disabled"}>${escapeHtml(c.pickNone)}</button>
      <button class="btn p danger" data-act="hide" ${picked.length ? "" : "disabled"}>${escapeHtml(fill(c.hide, { n: picked.length }))}</button></span></div>`;
}

/** The removed devices: a head with their number, and, opened, the list with the way back. */
export function renderHidden(state, t) {
  const c = t.cleanup;
  if (!state.cleanup) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const hidden = state.cleanup.hidden ?? [];
  if (!hidden.length) {
    return `<div class="foldhead static"><span>${escapeHtml(c.hiddenTitle)}</span><em>0</em></div><p class="hint">${escapeHtml(c.hiddenNone)}</p>`;
  }
  const open = Boolean(state.hiddenOpen);
  const rows = hidden
    .map(
      (d) => `<div class="row"><span class="who"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.mac)}</small></span>
        <button class="btn" data-unhide="${escapeHtml(d.mac)}">${escapeHtml(c.unhide)}</button></div>`
    )
    .join("");
  return `<button class="foldhead" data-act="toggle-hidden" data-k="toggle-hidden" aria-expanded="${open}"><span>${escapeHtml(c.hiddenTitle)}</span><em>${hidden.length}</em><span class="chev" aria-hidden="true">${open ? "▾" : "▸"}</span></button>
    ${open ? `<p class="lead">${escapeHtml(c.hiddenLead)}</p>${rows}` : ""}`;
}
