/* The box page: the FRITZ!Box itself, how long it runs, how warm it is, its line, restart and reconnect. */

import { escapeHtml, formatBytes, formatDuration } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { accessLabel } from "./panel-internet.js";

/** After this long without an answer the restart counts as failed and the panel stops asking. */
export const RESTART_GIVE_UP_MS = 600000;
/** How often the panel asks the box during a restart. */
export const RESTART_POLL_MS = 5000;

/** A span of milliseconds as "3:18". */
export function minSec(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Whether an answer of box/info shows that the box restarted after the request: it runs for less
 * time than has passed, its last restart lies after the request, or (where it tells neither) it
 * was away in between. Right after the request the box may still answer with its old uptime.
 */
export function restarted(info, restart, now) {
  const slack = 30000;
  if (typeof info?.uptime_seconds === "number") return info.uptime_seconds * 1000 <= now - restart.requestedAt + slack;
  const last = Date.parse(info?.last_restart ?? "");
  if (!Number.isNaN(last)) return last >= restart.requestedAt - slack;
  return Boolean(restart.unreachableAt);
}

/** The restart after one more question to the box: info is its answer, null where it did not answer. */
export function nextRestart(restart, info, now) {
  if (!restart || restart.phase !== "down") return restart;
  const late = now - restart.requestedAt > RESTART_GIVE_UP_MS;
  if (!info) {
    const away = { ...restart, unreachableAt: restart.unreachableAt ?? now };
    return late ? { ...away, phase: "late" } : away;
  }
  if (restarted(info, restart, now)) return { ...restart, phase: "back", backAt: now };
  return late ? { ...restart, phase: "late" } : restart;
}

const when = (ms, language) => new Date(ms).toLocaleString(language || "en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function tile(label, value, small = "", cls = "") {
  return `<div class="tile${cls ? ` ${cls}` : ""}"><span class="label">${escapeHtml(label)}</span>${value}${small ? `<small>${escapeHtml(small)}</small>` : ""}</div>`;
}

function hero(info, ctx) {
  const { t, language, now, restart } = ctx;
  const b = t.boxPage;
  const down = restart && restart.phase !== "back";
  const back = restart?.phase === "back";
  let uptime = typeof info.uptime_seconds === "number" ? info.uptime_seconds : null;
  const lastMs = Date.parse(info.last_restart ?? "");
  if (uptime === null && !Number.isNaN(lastMs)) uptime = Math.max(0, (now - lastMs) / 1000);
  const last = back
    ? fill(b.lastRestartHere, { time: when(restart.requestedAt, language) })
    : Number.isNaN(lastMs)
      ? b.unknown
      : when(lastMs, language);
  const temp =
    typeof info.cpu_temperature === "number"
      ? tile(b.cpuTemp, `<b>${escapeHtml(down ? "–" : `${info.cpu_temperature.toLocaleString(language || "en", { maximumFractionDigits: 1 })} °C`)}</b>`, down ? b.unreachable : "")
      : tile(b.cpuTemp, `<b class="na">${escapeHtml(b.notReported)}</b>`, b.notReportedHint);
  const stat = down
    ? `<span class="chip warn"><i class="dot warn" aria-hidden="true"></i>${escapeHtml(b.restarting)}</span>`
    : `<span class="chip ok"><i class="dot on" aria-hidden="true"></i>${escapeHtml(b.running)}</span>`;
  const sub = [info.firmware ? `FRITZ!OS ${info.firmware}` : ""].filter(Boolean).join(" · ");
  return `<section class="card sec">
    <div class="ihead"><span class="ico">${ic("router")}</span>
      <span class="who"><b>${escapeHtml(info.model ?? t.box)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</span>${stat}</div>
    <div class="tiles">
      ${tile(b.uptime, `<b>${escapeHtml(down ? "–" : formatDuration(uptime, t.inet.units))}</b>`, b.noRestart)}
      ${tile(b.lastRestart, `<b>${escapeHtml(last)}</b>`, back && restart.backAt ? fill(b.lastRestartTook, { time: minSec(restart.backAt - restart.requestedAt) }) : b.noReason)}
      ${temp}
      ${tile(b.firmware, `<b>${escapeHtml(info.firmware ?? "–")}</b>`)}
    </div></section>`;
}

function chip(on, yes, no, unknown) {
  if (on === true) return `<span class="chip ok"><i class="dot on" aria-hidden="true"></i>${escapeHtml(yes)}</span>`;
  if (on === false) return `<span class="chip"><i class="dot" aria-hidden="true"></i>${escapeHtml(no)}</span>`;
  return `<span class="chip">${escapeHtml(unknown)}</span>`;
}

function lineCard(info, ctx) {
  const { t, language, restart, internet } = ctx;
  const b = t.boxPage;
  const down = restart && restart.phase !== "back";
  const line = info.line ?? {};
  const rows = [
    [b.lineTitle, accessLabel(line.access_type, t), chip(down ? false : line.linked ?? null, b.linked, b.notLinked, b.linkUnknown)],
    ...(internet ? [[b.internet, internet.external_ipv4 ?? "", chip(down ? false : internet.connected !== false, b.connected, b.disconnected, b.linkUnknown)]] : []),
  ];
  const bytes = (n) => escapeHtml(down ? "–" : formatBytes(n, language));
  return `<section class="card sec"><span class="label">${escapeHtml(b.line)}</span>
    <dl class="kv">${rows.map(([k, sub, v]) => `<dt>${escapeHtml(k)}${sub ? `<br><small class="muted mono">${escapeHtml(sub)}</small>` : ""}</dt><dd>${v}</dd>`).join("")}</dl>
    <div class="tiles counter">
      ${tile(b.received, `<b>${bytes(info.bytes_received)}</b>`, b.sinceRestart)}
      ${tile(b.sent, `<b>${bytes(info.bytes_sent)}</b>`, b.sinceRestart)}
    </div>
    <p class="hint">${escapeHtml(b.lineNote)}</p></section>`;
}

function restartBlock(restart, ctx) {
  const { t, now } = ctx;
  const r = t.boxPage.restart;
  const { phase } = restart;
  const away = restart.unreachableAt ? (phase === "down" ? now : restart.backAt ?? now) - restart.unreachableAt : null;
  const steps = [
    [r.requested, new Date(restart.requestedAt).toLocaleTimeString(ctx.language || "en"), true],
    [r.unreachable, away === null ? "" : fill(r.unreachableFor, { time: minSec(away) }), Boolean(restart.unreachableAt) || phase === "back"],
    [r.answers, phase === "back" && restart.backAt ? new Date(restart.backAt).toLocaleTimeString(ctx.language || "en") : "", phase === "back"],
  ];
  const at = steps.findIndex(([, , done]) => !done);
  const tone = phase === "back" ? "ok" : phase === "late" ? "bad" : "";
  const title = phase === "back" ? fill(r.back, { time: minSec(restart.backAt - restart.requestedAt) }) : phase === "late" ? r.late : r.inProgress;
  const share = Math.min(100, ((now - restart.requestedAt) / 240000) * 100);
  const buttons = [
    phase === "late" ? `<button class="btn sm" data-act="box-check" data-k="box-check">${escapeHtml(r.check)}</button>` : "",
    phase !== "down" ? `<button class="btn sm" data-act="box-restart-clear" data-k="box-restart-clear">${escapeHtml(r.hide)}</button>` : "",
  ].join("");
  return `<div class="progress ${tone}" role="status" aria-live="polite"><b>${escapeHtml(title)}</b>
    ${phase === "back" ? "" : `<div class="bar" aria-hidden="true"><i style="width:${phase === "late" ? 100 : share.toFixed(0)}%"></i></div>`}
    <ol>${steps.map(([name, detail, done], i) => `<li class="${done ? "done" : i === at ? "now" : ""}"><i class="dot" aria-hidden="true"></i><span>${escapeHtml(name)}${detail ? ` <span class="muted">· ${escapeHtml(detail)}</span>` : ""}</span></li>`).join("")}</ol>
    ${phase === "down" ? `<small>${escapeHtml(r.leaveOk)}</small>` : ""}
    ${buttons ? `<div class="btn-row tight">${buttons}</div>` : ""}</div>`;
}

function reconnectBlock(reconnect, ctx) {
  const d = ctx.t.boxPage.reconnectDone;
  const after = ctx.internet?.external_ipv4 ?? null;
  const done = Boolean(after && reconnect.before && after !== reconnect.before);
  return `<div class="progress ${done ? "ok" : ""}" role="status" aria-live="polite"><b>${escapeHtml(done ? d.done : d.title)}</b>
    <dl class="kv"><dt>${escapeHtml(d.before)}</dt><dd class="mono">${escapeHtml(reconnect.before ?? "–")}</dd><dt>${escapeHtml(d.after)}</dt><dd class="mono">${escapeHtml(after ?? "–")}</dd></dl>
    <div class="btn-row tight"><button class="btn sm" data-act="box-reconnect-clear" data-k="box-reconnect-clear">${escapeHtml(ctx.t.boxPage.restart.hide)}</button></div></div>`;
}

function actionsCard(info, ctx) {
  const { t, restart, reconnect } = ctx;
  const a = t.boxPage.actions;
  const canWrite = Boolean(info.can_write);
  const down = restart && restart.phase === "down";
  const off = !canWrite || down ? " disabled" : "";
  const why = !canWrite ? a.noRights : down ? a.busy : a.hint;
  return `<section class="card sec"><span class="label">${escapeHtml(a.title)}</span>
    <div class="act"><span class="ico">${ic("globe")}</span><div><b>${escapeHtml(a.reconnectName)}</b><small>${escapeHtml(a.reconnectSub)}</small></div>
      <button class="btn" data-act="reconnect" data-k="reconnect"${off}>${escapeHtml(a.reconnect)}</button></div>
    <div class="act"><span class="ico">${ic("restart")}</span><div><b>${escapeHtml(a.rebootName)}</b><small>${escapeHtml(a.rebootSub)}</small></div>
      <button class="btn dp" data-act="reboot" data-k="reboot" aria-haspopup="dialog"${off}>${escapeHtml(a.reboot)}</button></div>
    ${restart ? restartBlock(restart, ctx) : ""}${reconnect ? reconnectBlock(reconnect, ctx) : ""}
    <p class="hint">${escapeHtml(why)}</p></section>`;
}

/**
 * The page. info is what box/info answered: null while it is read, "failed" where the box did not
 * answer. ctx: t, language, now, internet (of the subscription), restart and reconnect under way.
 */
export function renderBoxPage(info, ctx) {
  const { t } = ctx;
  const b = t.boxPage;
  const head = `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(b.title)}</h1><p class="lead">${escapeHtml(b.lead)}</p></div>`;
  if (info === null || info === undefined) return `${head}<div class="card" aria-busy="true"><div class="empty"><span>${escapeHtml(t.loading)}</span></div></div>`;
  if (info === "failed" || typeof info !== "object") {
    return `${head}<div class="card"><div class="empty"><span class="bad-ico">${ic("alert")}</span><b>${escapeHtml(b.failed)}</b>
      <div class="btn-row"><button class="btn p" data-act="box-retry" data-k="box-retry">${escapeHtml(b.retry)}</button></div></div></div>`;
  }
  const late = ctx.restart?.phase === "late"
    ? `<section class="card sec hints" aria-label="${escapeHtml(b.hintsLabel)}"><p class="hintline bad"><span aria-hidden="true">${ic("alert")}</span><span>${escapeHtml(b.restart.late)}</span></p></section>`
    : "";
  return `${head}${late}${hero(info, ctx)}<div class="two">${actionsCard(info, ctx)}${lineCard(info, ctx)}</div>`;
}
