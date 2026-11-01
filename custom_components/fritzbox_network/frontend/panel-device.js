/* The device page of the panel: the link, the master data and the actions, as HTML. */

import { BANDS, escapeHtml, isBlocked, isWeak } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { weakPercent, whenText } from "./panel-network.js";

/** The state of an entity of the integration, or null where it does not exist or is gone. */
export function entityState(hass, entityId) {
  const state = entityId ? hass?.states?.[entityId] : null;
  return state && state.state !== "unavailable" ? state : null;
}

/**
 * What an action offers: its entity, or the reason it cannot be used. The box user needs the
 * right to change things, and most actions go by the IPv4 address of the device.
 */
export function actionStatus(client, name, hass, canWrite, { needsIp = true } = {}) {
  const entity = client.actions?.[name];
  if (!canWrite) return { entity, state: null, reason: "noRights" };
  if (needsIp && !client.ip) return { entity, state: null, reason: "noIp" };
  const state = entityState(hass, entity);
  return state ? { entity, state, reason: null } : { entity, state: null, reason: "noEntity" };
}

function switchRow(id, label, hint, status, t) {
  const on = status.state?.state === "on";
  return `<div class="action"><div>${escapeHtml(label)}<small>${escapeHtml(status.reason ? t[status.reason] : hint)}</small></div>
    <button class="switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" data-sw="${id}" data-entity="${escapeHtml(status.entity ?? "")}" ${status.state ? "" : "disabled"}></button></div>`;
}

/** The access profile as a choice among the options the select entity offers. */
function profileRow(client, hass, canWrite, t) {
  const status = actionStatus(client, "access_profile", hass, canWrite);
  if (!client.actions?.access_profile) return "";
  const options = status.state?.attributes?.options ?? [];
  const current = status.state?.state;
  return `<div class="action"><div>${escapeHtml(t.profile)}<small>${escapeHtml(status.reason ? t[status.reason] : t.profileHint)}</small></div>
    <select data-profile data-entity="${escapeHtml(status.entity)}" aria-label="${escapeHtml(t.profile)}" ${status.state ? "" : "disabled"}>${options
      .map((o) => `<option ${o === current ? "selected" : ""}>${escapeHtml(o)}</option>`)
      .join("")}</select></div>`;
}

export function renderDevice(client, ctx) {
  const { t, now, data, hass } = ctx;
  if (!client) {
    return `<div class="card empty">${ic("wifi")}<b>${escapeHtml(t.noSelection)}</b><span>${escapeHtml(t.noSelectionHint)}</span></div>`;
  }
  const canWrite = Boolean(data?.can_write);
  const node = (data?.nodes ?? []).find((n) => n.mac === client.ap_mac);
  const when = whenText(client.last_online, now, t);
  const weak = isWeak(client, ctx.threshold);
  const chips = [
    `<span class="chip ${client.online ? "ok" : ""}"><span class="dot ${client.online ? "on" : ""}"></span>${escapeHtml(
      client.online ? t.onlineChip : fill(t.offlineChip, { when })
    )}</span>`,
    client.link_type ? `<span class="chip">${client.link_type === "wlan" ? "WLAN" : "LAN"}</span>` : "",
    client.guest ? `<span class="chip info">${escapeHtml(t.guestChip)}</span>` : "",
    isBlocked(client) ? `<span class="chip bad">${escapeHtml(t.blockedChip)}</span>` : "",
    weak ? `<span class="chip warn">${escapeHtml(fill(t.weakChip, { percent: weakPercent(client) }))}</span>` : "",
    client.private_mac ? `<span class="chip">${escapeHtml(t.privateMac)}</span>` : "",
    client.vpn ? `<span class="chip">${escapeHtml(t.vpn)}</span>` : "",
  ].join("");

  const rate = (down, up) => `${Math.round(down ?? 0)} / ${Math.round(up ?? 0)}`;
  const showRate = client.online && (client.rate_download || client.rate_upload);
  const tiles = showRate
    ? `<div class="tiles">
        <div class="tile"><span class="label">${escapeHtml(t.rate)}</span><b>${rate(client.rate_download, client.rate_upload)}</b></div>
        ${
          client.rate_max_download || client.rate_max_upload
            ? `<div class="tile"><span class="label">${escapeHtml(t.maxRate)}</span><b>${rate(client.rate_max_download, client.rate_max_upload)}</b></div>`
            : ""
        }
        ${
          client.link_type === "wlan"
            ? `<div class="tile"><span class="label">${escapeHtml(t.signal)}</span><b>${typeof client.signal_dbm === "number" ? `${client.signal_dbm} dBm` : "–"}</b></div>
               <div class="tile"><span class="label">${escapeHtml(t.band)}</span><b>${escapeHtml(BANDS[client.band] ?? "–")}</b></div>`
            : client.port
              ? `<div class="tile wide"><span class="label">${escapeHtml(t.port)}</span><b>${escapeHtml(client.port)}${client.speed ? `, ${client.speed} Mbit/s` : ""}</b></div>`
              : ""
        }</div>`
    : "";

  const master = [
    [t.mac, `<span class="mono">${escapeHtml(client.mac)}</span>`],
    [t.ip, `<span class="mono">${escapeHtml(client.ip ?? t.unknown)}</span>`],
    [t.vendor, escapeHtml(client.vendor ?? t.unknown)],
    [t.accessPoint, escapeHtml(node?.name ?? t.notAssigned)],
    client.ssid ? [t.network, escapeHtml(client.ssid)] : null,
    client.filter_profile ? [t.profile, escapeHtml(client.filter_profile)] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`)
    .join("");

  const internet = actionStatus(client, "internet_access", hass, canWrite);
  const priority = actionStatus(client, "priority", hass, canWrite);
  const wol = actionStatus(client, "wake_on_lan", hass, canWrite, { needsIp: false });
  const blocked = internet.state ? internet.state.state !== "on" : isBlocked(client);
  const wolUsable = Boolean(wol.state) && !client.online;
  return `<div class="card detail">
    <button class="back" data-act="back">${ic("back")}${escapeHtml(t.back)}</button>
    <h1>${escapeHtml(client.name)}</h1>
    <div class="chips-row">${chips}</div>
    ${tiles}
    <div class="section"><span class="label">${escapeHtml(t.master)}</span><dl>${master}</dl></div>
    <div class="section"><span class="label">${escapeHtml(t.actions)}</span>
      ${switchRow("internet_access", t.internet, blocked ? t.internetBlocked : t.internetAllowed, internet, t)}
      ${switchRow("priority", t.priority, t.priorityHint, priority, t)}
      ${profileRow(client, hass, canWrite, t)}
      <div class="btn-row">
        <button class="btn" data-act="wol" data-entity="${escapeHtml(wol.entity ?? "")}" ${wolUsable ? "" : "disabled"}>${escapeHtml(t.wol)}</button>
        <button class="btn" data-act="rename" ${client.entity_id ? "" : "disabled"}>${escapeHtml(t.rename)}</button>
        <button class="btn" data-act="ha" ${client.device_id ? "" : "disabled"}>${ic("external")}${escapeHtml(t.openInHa)}</button>
      </div>
      <p class="hint">${escapeHtml(t.wolHint)}</p></div>
    ${groupsSection(client, data, t)}
    ${historySection(client, t)}</div>`;
}

/** The groups of a device: the labels of Home Assistant, put on its "Internet access" entity. */
function groupsSection(client, data, t) {
  const labels = data?.labels ?? [];
  const body = client.actions?.internet_access
    ? `<div class="chips-row">${labels
        .map(
          (l) =>
            `<button class="fchip" data-label="${escapeHtml(l.id)}" aria-pressed="${(client.labels ?? []).includes(l.id)}">${escapeHtml(l.name)}</button>`
        )
        .join("")}<button class="fchip" data-act="new-group">+ ${escapeHtml(t.newGroup)}</button></div>
      <p class="hint">${escapeHtml(t.groupsHint)}</p>`
    : `<p class="hint">${escapeHtml(t.noGroupEntity)}</p>`;
  return `<div class="section"><span class="label">${escapeHtml(t.groupsTitle)}</span>${body}</div>`;
}

/** Links to what Home Assistant already records about the device. */
function historySection(client, t) {
  if (!client.entity_id) return "";
  return `<div class="section"><span class="label">${escapeHtml(t.historyTitle)}</span>
    <div class="btn-row"><button class="btn" data-act="logbook">${escapeHtml(t.logbook)}</button><button class="btn" data-act="history">${escapeHtml(t.history)}</button></div>
    <p class="hint">${escapeHtml(t.historyHint)}</p></div>`;
}
