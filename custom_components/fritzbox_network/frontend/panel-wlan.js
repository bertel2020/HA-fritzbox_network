/* The Wi-Fi page: the radio networks of the box with a switch each, and the guest access with QR code and password. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

/** Characters of a generated password: no 0/O, 1/l/I that are easy to mix up when read off a card. */
const CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random password of 16 characters in groups of four, "abcd-EFGH-2345-wxyz". */
export function randomPassword(random = globalThis.crypto) {
  const values = new Uint32Array(16);
  random.getRandomValues(values);
  return [...values].map((v) => CHARS[v % CHARS.length]).join("").match(/.{4}/g).join("-");
}

/**
 * The rules of a WPA password as the box applies them, checked while typing: [{ key, ok }] with
 * ok true, false, or null while there is nothing to check yet.
 */
export function passwordRules(password, repeat) {
  const p = String(password ?? "");
  const q = String(repeat ?? "");
  return [
    { key: "ruleLength", ok: p.length ? p.length >= 8 && p.length <= 63 : null },
    { key: "ruleAscii", ok: p.length ? /^[\x20-\x7e]+$/.test(p) : null },
    { key: "ruleSpace", ok: p.length ? p.trim() === p : null },
    { key: "ruleSame", ok: q.length ? p === q : null },
  ];
}

export const passwordOk = (password, repeat) => passwordRules(password, repeat).every((r) => r.ok === true);

/** The main networks that are switched on now. */
export const enabledNetworks = (wlan) => (wlan?.networks ?? []).filter((n) => n.enabled);

/** Whether switching this network off leaves the box without any of its own (the guest access aside). */
export function isLastNetwork(wlan, key) {
  const on = enabledNetworks(wlan);
  return on.length === 1 && on[0].key === key;
}

function networkRow(n, ctx) {
  const { t } = ctx;
  const w = t.wlan;
  const busy = ctx.busy?.has(n.key);
  const ssid = n.ssid || w.noName;
  const band = fill(w.band, { band: n.band });
  const facts = [n.enabled ? n.standard : w.off, n.bssid ? n.bssid : ""].filter(Boolean);
  const label = fill(w.switchLabel, { ssid, band: n.band });
  return `<div class="net ${n.enabled ? "" : "off"}">
    <span class="ico">${ic("wifi")}</span>
    <div class="n"><b>${escapeHtml(ssid)} <span class="muted">· ${escapeHtml(band)}</span></b>
      <small>${facts.map((f) => `<span${f === n.bssid ? ' class="mono"' : ""}>${escapeHtml(f)}</span>`).join("")}${busy ? `<span class="busyText">${escapeHtml(w.switching)}</span>` : ""}</small></div>
    <div class="end"><span class="chip ${n.enabled ? "ok" : ""}">${escapeHtml(n.enabled ? w.on : w.off)}</span>
      <button class="switch${busy ? " busy" : ""}" role="switch" aria-checked="${n.enabled}" aria-label="${escapeHtml(label)}" data-act="wlan-switch" data-key="${escapeHtml(n.key)}" data-on="${n.enabled ? "0" : "1"}" data-k="wl-${escapeHtml(n.key)}"${!ctx.canWrite || busy ? " disabled" : ""}></button></div></div>`;
}

function networksCard(wlan, ctx) {
  const w = ctx.t.wlan;
  const nets = wlan.networks;
  const names = new Set(nets.map((n) => n.ssid));
  const same = nets.length > 1 && names.size === 1;
  const allOff = !enabledNetworks(wlan).length;
  const notes = [same ? w.sameName : "", w.meshFollows].filter(Boolean).join(" ");
  return `<section class="card sec"><span class="label">${escapeHtml(w.radios)}</span>
    ${allOff ? `<p class="hintline warn"><span aria-hidden="true">${ic("alert")}</span><span>${escapeHtml(w.allOff)}</span></p>` : ""}
    ${nets.map((n) => networkRow(n, ctx)).join("")}
    <p class="hint">${escapeHtml(notes)}</p>
    ${ctx.canWrite ? "" : `<p class="hint"><b>${escapeHtml(w.noRights)}</b></p>`}</section>`;
}

function qrBox(guest, ctx) {
  const g = ctx.t.wlan.guest;
  const secret = ctx.secret;
  if (!ctx.canWrite) return `<div class="qrveil">${ic("lock")}<span>${escapeHtml(g.qrLocked)}</span></div>`;
  if (!guest.enabled) return `<div class="qrveil"><span>${escapeHtml(g.qrOff)}</span></div>`;
  if (!secret || secret === "loading") {
    const loading = secret === "loading";
    return `<div class="qrveil"><span>${escapeHtml(g.qrHint)}</span></div>
      <button class="btn p sm" data-act="wlan-qr" data-k="wlan-qr"${loading ? " disabled" : ""}>${escapeHtml(loading ? g.loadingQr : g.showQr)}</button>`;
  }
  const ssid = secret.ssid ?? guest.ssid ?? "";
  // the password is in the page only while it is shown; masked, the page has dots and no password
  const shown = ctx.reveal && secret.password;
  const text = secret.password ? (shown ? secret.password : "•".repeat(12)) : g.noPassword;
  const pw = secret.password
    ? `<div class="secret"><span class="mono" id="w-pw"${shown ? "" : ` aria-label="${escapeHtml(g.password)}"`}>${escapeHtml(text)}</span>
        <button class="iconbtn" data-act="wlan-reveal" data-k="wlan-reveal" aria-pressed="${Boolean(shown)}" aria-controls="w-pw" title="${escapeHtml(shown ? g.conceal : g.reveal)}" aria-label="${escapeHtml(shown ? g.conceal : g.reveal)}">${ic(shown ? "eyeOff" : "eye")}</button>
        <button class="iconbtn" data-act="wlan-copy" data-k="wlan-copy" title="${escapeHtml(g.copy)}" aria-label="${escapeHtml(g.copy)}">${ic("copy")}</button></div>`
    : `<div class="secret"><span class="muted">${escapeHtml(text)}</span></div>`;
  return `<div class="qr"><img src="data:image/png;base64,${escapeHtml(secret.qr_png_base64 ?? "")}" alt="${escapeHtml(fill(g.qrAlt, { ssid }))}" width="180" height="180"></div>
    ${pw}
    <div class="btn-row tight"><button class="btn sm" data-act="wlan-hideqr" data-k="wlan-hideqr">${escapeHtml(g.hideQr)}</button></div>`;
}

function guestCard(guest, ctx) {
  const { t } = ctx;
  const g = t.wlan.guest;
  if (!guest) {
    return `<section class="card sec"><span class="label">${escapeHtml(g.title)}</span><div class="empty"><span>${ic("guest")}</span><b>${escapeHtml(g.none)}</b><span>${escapeHtml(g.noneHint)}</span></div></section>`;
  }
  const busy = ctx.busy?.has("guest");
  const ssid = guest.ssid || g.name;
  return `<section class="card sec"><span class="label">${escapeHtml(g.title)}</span>
    <div class="guest"><div>
      <div class="net first ${guest.enabled ? "" : "off"}">
        <span class="ico">${ic("guest")}</span>
        <div class="n"><b>${escapeHtml(ssid)}</b><small><span>${escapeHtml(guest.enabled ? t.wlan.on : t.wlan.off)}</span>${busy ? `<span class="busyText">${escapeHtml(t.wlan.switching)}</span>` : ""}</small></div>
        <div class="end"><button class="switch${busy ? " busy" : ""}" role="switch" aria-checked="${guest.enabled}" aria-label="${escapeHtml(fill(g.switchLabel, { ssid }))}" data-act="wlan-switch" data-key="guest" data-on="${guest.enabled ? "0" : "1"}" data-k="wl-guest"${!ctx.canWrite || busy ? " disabled" : ""}></button></div></div>
      ${ctx.canWrite ? `<div class="btn-row"><button class="btn" data-act="wlan-pw" data-k="wlan-pw" aria-haspopup="dialog">${escapeHtml(g.edit)}</button></div>` : ""}
      <p class="hint">${escapeHtml(g.hint)}</p>
    </div>
    <div class="qrbox">${qrBox(guest, ctx)}</div></div></section>`;
}

/**
 * The page. wlan is what wlan/list answered: null while it is read, "failed" where the box did not
 * answer. ctx: t, busy (the keys being switched), secret (null, "loading" or wlan/guest/secret), reveal.
 */
export function renderWlan(wlan, ctx) {
  const { t } = ctx;
  const w = t.wlan;
  const head = `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(w.title)}</h1><p class="lead">${escapeHtml(w.lead)}</p></div>`;
  if (wlan === null || wlan === undefined) return `${head}<div class="card" aria-busy="true"><div class="empty"><span>${escapeHtml(t.loading)}</span></div></div>`;
  if (wlan === "failed" || typeof wlan !== "object") {
    return `${head}<div class="card"><div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${escapeHtml(w.failed)}</b>${ctx.error ? `<span class="mono">${escapeHtml(ctx.error)}</span>` : ""}
      <div class="btn-row"><button class="btn p" data-act="wlan-retry" data-k="wlan-retry">${escapeHtml(w.retry)}</button></div></div></div>`;
  }
  const c = { ...ctx, canWrite: Boolean(wlan.can_write) };
  const nets = Array.isArray(wlan.networks) && wlan.networks.length
    ? networksCard(wlan, c)
    : `<section class="card"><div class="empty"><span>${ic("wifi")}</span><b>${escapeHtml(w.noWlan)}</b><span>${escapeHtml(w.noWlanHint)}</span></div></section>`;
  return `${head}${nets}${guestCard(wlan.guest ?? null, c)}`;
}
