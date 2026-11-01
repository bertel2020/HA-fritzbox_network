/* The filter page of the panel: the device filter with its preview, as HTML. */

import { escapeHtml, filterChanged } from "./shared.js";
import { fill } from "./texts.js";

const MODES = ["all", "include", "exclude"];

function toggle(key, label, hint, on) {
  return `<div class="action"><div>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></div>
    <button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" data-ft="${key}"></button></div>`;
}

/** The mode and the two switches: they are drawn again after each choice. */
export function renderFilterControls(page, t) {
  const f = t.filter;
  if (!page) return "";
  const draft = page.draft;
  return `<span class="label">${escapeHtml(f.mode)}</span>
    <div class="seg-wrap"><div class="seg" role="group">${MODES.map(
      (m) => `<button data-mode="${m}" aria-pressed="${draft.filter_mode === m}">${escapeHtml(f.modes[m])}</button>`
    ).join("")}</div></div>
    <div class="opts">${toggle("ignore_guests", f.ignoreGuests, f.ignoreGuestsHint, draft.ignore_guests)}${toggle(
      "ignore_private_macs",
      f.ignorePrivate,
      f.ignorePrivateHint,
      draft.ignore_private_macs
    )}</div>`;
}

/** The devices to pick from; only for "only selected" and "all except selected". */
export function renderPicker(page, t) {
  if (!page || page.draft.filter_mode === "all") return "";
  const f = t.filter;
  const query = (page.search ?? "").toLowerCase();
  const chosen = new Set(page.draft.filter_devices);
  const devices = (page.preview?.devices ?? []).filter(
    (d) => !query || `${d.name} ${d.mac}`.toLowerCase().includes(query)
  );
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

export function renderPreview(page, t) {
  const f = t.filter;
  if (!page?.preview) return `<div class="empty"><span>${escapeHtml(t.loading)}</span></div>`;
  const { keep, add, remove } = page.preview;
  const changed = filterChanged(page.current, page.draft);
  const stat = (key, list, cls = "") =>
    `<div class="stat ${cls}"><span class="label">${escapeHtml(f[key])}</span><b>${list.length}</b></div>`;
  return `<div class="stats">${stat("keep", keep)}${stat("add", add, add.length ? "ok" : "")}${stat("remove", remove, remove.length ? "bad" : "")}</div>
    ${remove.length ? `<div class="note bad">${escapeHtml(fill(f.removeNote, { names: names(remove) }))}</div>` : ""}
    ${add.length ? `<p class="muted spaced">${escapeHtml(fill(f.addNote, { names: names(add) }))}</p>` : ""}
    ${!changed ? `<p class="muted spaced">${escapeHtml(f.unchanged)}</p>` : ""}
    <div class="btn-row"><button class="btn p" data-act="apply" ${changed ? "" : "disabled"}>${escapeHtml(f.apply)}</button></div>`;
}
