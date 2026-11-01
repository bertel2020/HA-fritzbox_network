/* The confirmation dialog and the toast of the panel. */

import { escapeHtml } from "./shared.js";

/**
 * Asks before something that cannot be taken back, or for a short text. Resolves true or
 * false, with a text field it resolves the text or null. Escape cancels, Tab stays inside.
 */
export function openDialog(root, t, { title, body = "", list = null, field = null, ok, danger = false }) {
  return new Promise((resolve) => {
    const backdrop = root.querySelector("#backdrop");
    const dialog = root.querySelector("#dialog");
    const before = root.activeElement;
    dialog.innerHTML = `
      <h2 id="dlg-title">${escapeHtml(title)}</h2>
      <div>${escapeHtml(body)}</div>
      ${list ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${field ? `<label class="field"><span class="label">${escapeHtml(field.label)}</span><input type="text" id="dlg-field" value="${escapeHtml(field.value ?? "")}" /></label>` : ""}
      <div class="btn-row">
        <button class="btn" id="dlg-no">${escapeHtml(t.cancel)}</button>
        <button class="btn ${danger ? "dp" : "p"}" id="dlg-yes">${escapeHtml(ok)}</button>
      </div>`;
    backdrop.classList.add("open");
    const input = dialog.querySelector("#dlg-field");
    const no = dialog.querySelector("#dlg-no");
    const yes = dialog.querySelector("#dlg-yes");
    (input ?? no).focus();
    input?.select();

    const done = (value) => {
      backdrop.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
      resolve(value);
    };
    const answer = () => {
      if (!field) return true;
      const text = input.value.trim();
      return text || null;
    };
    const onKey = (event) => {
      if (event.key === "Escape") return done(field ? null : false);
      if (event.key === "Enter" && input && root.activeElement === input) {
        event.preventDefault();
        const value = answer();
        return value === null ? undefined : done(value);
      }
      if (event.key === "Tab") {
        const stops = [input, no, yes].filter(Boolean);
        const at = stops.indexOf(root.activeElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    no.onclick = () => done(field ? null : false);
    yes.onclick = () => {
      const value = answer();
      if (value !== null) done(value);
    };
  });
}

let toastTimer = null;

export function showToast(root, message) {
  const toast = root.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}
