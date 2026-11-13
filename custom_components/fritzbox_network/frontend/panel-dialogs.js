/* The confirmation dialog and the toast of the panel. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

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

/**
 * Asks for a new password with a repeat, the rules checked while typing and a generated one on
 * request. submit(password) sends it; while it runs the dialog waits, a refusal shows in the
 * dialog. Resolves true once it was set, false when cancelled. The fields are emptied on close;
 * the password is never written into an attribute.
 */
export function openPasswordDialog(root, t, { title, lead = "", warn = "", rules, generate, submit }) {
  const p = t.wlan.pw;
  return new Promise((resolve) => {
    const backdrop = root.querySelector("#backdrop");
    const dialog = root.querySelector("#dialog");
    const before = root.activeElement;
    const input = (id, label, extra = "") =>
      `<label class="field"><span class="label">${escapeHtml(label)}</span><span class="pw"><input id="${id}" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"${extra}>${id === "dlg-pw1" ? `<button type="button" class="iconbtn" id="dlg-show" aria-pressed="false" aria-controls="dlg-pw1 dlg-pw2" aria-label="${escapeHtml(p.show)}" title="${escapeHtml(p.show)}">${ic("eye")}</button>` : ""}</span></label>`;
    dialog.innerHTML = `
      <h2 id="dlg-title">${escapeHtml(title)}</h2>
      <div class="muted">${escapeHtml(lead)}</div>
      ${input("dlg-pw1", p.new, ' aria-describedby="dlg-rules"')}
      ${input("dlg-pw2", p.repeat)}
      <div class="btn-row"><button type="button" class="btn sm" id="dlg-gen">${ic("dice")}${escapeHtml(p.generate)}</button></div>
      <ul class="rules" id="dlg-rules" aria-live="polite"></ul>
      ${warn ? `<div class="note">${escapeHtml(warn)}</div>` : ""}
      <p class="msg bad" id="dlg-msg" role="alert"></p>
      <div class="btn-row">
        <button class="btn" id="dlg-no">${escapeHtml(t.cancel)}</button>
        <button class="btn p" id="dlg-yes" disabled>${escapeHtml(p.ok)}</button>
      </div>`;
    backdrop.classList.add("open");
    const pw1 = dialog.querySelector("#dlg-pw1");
    const pw2 = dialog.querySelector("#dlg-pw2");
    const show = dialog.querySelector("#dlg-show");
    const no = dialog.querySelector("#dlg-no");
    const yes = dialog.querySelector("#dlg-yes");
    const msg = dialog.querySelector("#dlg-msg");
    let busy = false;
    const update = () => {
      const list = rules(pw1.value, pw2.value);
      dialog.querySelector("#dlg-rules").innerHTML = list
        .map((r) => `<li class="${r.ok === true ? "ok" : r.ok === false ? "bad" : ""}">${escapeHtml(p[r.key])}</li>`)
        .join("");
      yes.disabled = busy || !list.every((r) => r.ok === true);
    };
    update();
    pw1.focus();

    const done = (value) => {
      pw1.value = "";
      pw2.value = "";
      dialog.innerHTML = "";
      backdrop.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) return done(false);
      if (event.key === "Tab") {
        const stops = [...dialog.querySelectorAll("input, button:not([disabled])")];
        const at = stops.indexOf(root.activeElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    pw1.oninput = pw2.oninput = () => {
      msg.textContent = "";
      update();
    };
    show.onclick = () => {
      const on = show.getAttribute("aria-pressed") !== "true";
      pw1.type = pw2.type = on ? "text" : "password";
      show.setAttribute("aria-pressed", String(on));
      show.setAttribute("aria-label", on ? p.hide : p.show);
      show.title = on ? p.hide : p.show;
      show.innerHTML = ic(on ? "eyeOff" : "eye");
    };
    dialog.querySelector("#dlg-gen").onclick = () => {
      pw1.value = pw2.value = generate();
      msg.textContent = "";
      update();
      pw1.focus();
    };
    no.onclick = () => {
      if (!busy) done(false);
    };
    yes.onclick = async () => {
      if (yes.disabled) return;
      busy = true;
      yes.textContent = p.busy;
      update();
      try {
        await submit(pw1.value);
        done(true);
      } catch (err) {
        busy = false;
        yes.textContent = p.ok;
        msg.textContent = fill(t.toastFailed, { error: err?.message ?? err });
        update();
      }
    };
  });
}

/**
 * A dialog with fields of its own: html is the body (escaped by the caller), focus the selector
 * that gets the focus, onOpen(dialog) wires the fields. On OK read(dialog) gives the answer; a
 * string from validate(dialog) is shown in the dialog instead and it stays open. Without ok the
 * dialog only has a close button. Resolves the answer, or null when cancelled. Escape cancels,
 * Tab stays inside, the focus goes back where it was.
 */
export function openFormDialog(root, t, { title, html = "", ok = null, danger = false, focus = null, onOpen = null, validate = null, read = () => true, close = null, controller = null }) {
  return new Promise((resolve) => {
    const backdrop = root.querySelector("#backdrop");
    const dialog = root.querySelector("#dialog");
    const before = root.activeElement;
    dialog.innerHTML = `
      <h2 id="dlg-title">${escapeHtml(title)}</h2>
      <div class="dlg-body">${html}</div>
      <p class="msg bad" id="dlg-msg" role="alert"></p>
      <div class="btn-row">
        <button class="btn" id="dlg-no">${escapeHtml(ok ? t.cancel : close ?? t.cancel)}</button>
        ${ok ? `<button class="btn ${danger ? "dp" : "p"}" id="dlg-yes">${escapeHtml(ok)}</button>` : ""}
      </div>`;
    backdrop.classList.add("open");
    const no = dialog.querySelector("#dlg-no");
    const yes = ok ? dialog.querySelector("#dlg-yes") : null;
    const msg = dialog.querySelector("#dlg-msg");
    (focus ? dialog.querySelector(focus) : no)?.focus();
    onOpen?.(dialog);

    const done = (value) => {
      backdrop.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
      resolve(value);
    };
    const accept = () => {
      const problem = validate?.(dialog);
      if (problem) {
        msg.textContent = problem;
        return;
      }
      done(read(dialog));
    };
    const onKey = (event) => {
      if (event.key === "Escape") return done(null);
      if (event.key === "Enter" && yes && root.activeElement?.tagName === "INPUT") {
        event.preventDefault();
        return accept();
      }
      if (event.key === "Tab") {
        const stops = [...dialog.querySelectorAll("input, select, button:not([disabled]), a[href]")];
        if (!stops.length) return;
        const at = stops.indexOf(root.activeElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    if (controller) controller.close = () => done(null);
    no.onclick = () => done(null);
    if (yes) yes.onclick = accept;
  });
}

let toastTimer = null;

/** A short message at the bottom; with action ({ label, run }) a button in it, for "Undo". */
export function showToast(root, message, action = null) {
  const toast = root.querySelector("#toast");
  if (!toast) return;
  if (action) {
    toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="toast-act" id="toast-act">${escapeHtml(action.label)}</button>`;
    toast.classList.add("act");
    const button = toast.querySelector("#toast-act");
    if (button) {
      button.onclick = () => {
        toast.classList.remove("show", "act");
        action.run();
      };
    }
  } else {
    toast.textContent = message;
    toast.classList.remove("act");
  }
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show", "act"), action ? 8000 : 4500);
}
