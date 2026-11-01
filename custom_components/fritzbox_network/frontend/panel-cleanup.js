/* The clean-up page of the panel: devices offline for long, and the hidden ones, as HTML. */

import { escapeHtml, staleSince } from "./shared.js";
import { fill } from "./texts.js";
import { ic } from "./icons.js";
import { whenText } from "./panel-network.js";

/** The devices the slider currently offers. */
export function staleList(state) {
  return staleSince(state.cleanup?.devices, state.cleanupDays);
}

/** The chosen devices that are still on offer: a device that came back is no longer picked. */
export function pickedMacs(state) {
  const offered = new Set(staleList(state).map((d) => d.mac));
  return [...state.picked].filter((mac) => offered.has(mac));
}

export function renderStale(state, t, now) {
  const c = t.cleanup;
  if (!state.cleanup) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const list = staleList(state);
  if (!list.length) {
    return `<div class="empty">${ic("search")}<b>${escapeHtml(c.nothing)}</b><span>${escapeHtml(c.nothingHint)}</span></div>`;
  }
  const picked = pickedMacs(state);
  const rows = list
    .map(
      (d) => `<label class="row"><input type="checkbox" data-pick="${escapeHtml(d.mac)}" ${state.picked.has(d.mac) ? "checked" : ""}>
        <span class="who"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(
          [d.vendor ?? d.mac, fill(t.lastOnline, { when: whenText(d.last_online, now, t) })].join(" · ")
        )}</small></span></label>`
    )
    .join("");
  return `<div>${rows}</div>
    <div class="selbar"><span>${escapeHtml(fill(c.selected, { n: picked.length }))}</span>
      <span class="btn-row tight"><button class="btn" data-act="pick-all">${escapeHtml(c.pickAll)}</button>
      <button class="btn p" data-act="hide" ${picked.length ? "" : "disabled"}>${escapeHtml(fill(c.hide, { n: picked.length }))}</button></span></div>`;
}

export function renderHidden(state, t) {
  const c = t.cleanup;
  if (!state.cleanup) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const hidden = state.cleanup.hidden ?? [];
  if (!hidden.length) {
    return `<div class="empty"><b>${escapeHtml(c.hiddenNone)}</b><span>${escapeHtml(c.hiddenNoneHint)}</span></div>`;
  }
  return hidden
    .map(
      (d) => `<div class="row"><span class="who"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.mac)}</small></span>
        <button class="btn" data-unhide="${escapeHtml(d.mac)}">${escapeHtml(c.unhide)}</button></div>`
    )
    .join("");
}
