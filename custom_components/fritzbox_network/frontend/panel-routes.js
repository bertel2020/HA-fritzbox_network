/** The routes page: the static IPv4 routes of the box, a switch and a delete button for each, and a form for a new one. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

/** "off" for a route switched off, "down" for one whose gateway is offline, "on" for any other. */
export function routeState(route) {
  if (!route.enabled) return "off";
  return route.gateway_online === false ? "down" : "on";
}

/** The routes with their state, what the page counts and the hints for routes that lead nowhere. */
export function routesModel(entries) {
  const routes = (entries ?? []).map((r) => ({ ...r, state: routeState(r) }));
  return {
    routes,
    on: routes.filter((r) => r.enabled).length,
    down: routes.filter((r) => r.state === "down"),
  };
}

const ip = (text) => {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text) || text.split(".").some((o) => Number(o) > 255)) return null;
  return text.split(".").reduce((a, o) => a * 256 + Number(o), 0);
};

/** "a.b.c.d/len" (a bare address is a /32) as its first and last address; null where it is no network address. */
export function parseNetwork(text) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const start = ip(m[1]);
  const len = m[2] === undefined ? 32 : Number(m[2]);
  if (start === null || len > 32) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  if (((start & mask) >>> 0) !== start) return null; // host bits set
  return { start, end: (start | (~mask >>> 0)) >>> 0, len, text: `${m[1]}/${len}` };
}

const inside = (address, net) => address >= net.start && address <= net.end;

/**
 * The same rules as the server (routes.py), shown while the user types: { tone, code, ... } or
 * null while the form is not filled. "bad" blocks the button, "warn" and "ok" do not.
 */
export function checkRoute(draft, routes, home, clients = []) {
  const text = String(draft.network ?? "").trim();
  const gateway = String(draft.gateway ?? "").trim();
  if (!text || !gateway) return null;
  const target = parseNetwork(text);
  const bad = (code) => ({ tone: "bad", code });
  if (!target) return bad("invalid_network");
  const first = target.start >>> 24;
  if (first === 127) return bad("invalid_network");
  if (first >= 224 && first <= 239) return bad("invalid_network");
  if (first === 169 && ((target.start >>> 16) & 255) === 254) return bad("invalid_network");
  if (target.len === 0) return bad("all_traffic");
  const lan = home ? parseNetwork(home.network) : null;
  const box = home ? ip(home.box) : null;
  if (!lan || box === null) return bad("home_unknown");
  if (target.start <= lan.end && lan.start <= target.end) return bad("overlaps_home");
  if (inside(box, target)) return bad("overlaps_home");
  const via = ip(gateway);
  if (via === null) return bad("invalid_gateway");
  if (!inside(via, lan)) return bad("gateway_outside");
  if (via === box) return bad("gateway_is_box");
  if (inside(via, target)) return bad("gateway_in_target");
  const metric = Number(draft.metric);
  if (!Number.isInteger(metric) || metric < 0 || metric > 65535 || String(draft.metric).trim() === "") return bad("invalid_metric");
  if ((routes ?? []).some((r) => r.network === target.text)) return bad("duplicate");
  const device = clients.find((c) => c.ip === gateway);
  if (device && device.online === false) return { tone: "warn", code: "offline", name: device.name, net: target.text, gateway };
  return { tone: "ok", code: "ok", net: target.text, gateway };
}

function form(ctx) {
  const { t, draft } = ctx;
  const v = t.routesPage;
  const f = v.form;
  const result = checkRoute(draft, ctx.routes, ctx.home, ctx.clients);
  const message = result ? fill(result.code === "ok" ? f.ok : result.code === "offline" ? f.offline : f.codes[result.code], result) : "";
  const options = ctx.clients
    .filter((c) => c.ip)
    .map((c) => `<option value="${escapeHtml(c.ip)}">${escapeHtml(c.name ?? "")}${c.online === false ? ` (${escapeHtml(f.offlineTag)})` : ""}</option>`)
    .join("");
  return `<section class="card sec routeform" aria-label="${escapeHtml(f.title)}"><span class="label">${escapeHtml(f.title)}</span>
    <div class="afield"><label for="r-net">${escapeHtml(f.network)}</label>
      <input type="text" id="r-net" data-k="r-net" class="mono" autocomplete="off" placeholder="10.9.0.0/24" value="${escapeHtml(draft.network)}"><small class="muted">${escapeHtml(f.networkHint)}</small></div>
    <div class="afield"><label for="r-gw">${escapeHtml(f.gateway)}</label>
      <input type="text" id="r-gw" data-k="r-gw" class="mono" list="r-gw-list" autocomplete="off" placeholder="192.168.178.5" value="${escapeHtml(draft.gateway)}"><datalist id="r-gw-list">${options}</datalist><small class="muted">${escapeHtml(f.gatewayHint)}</small></div>
    <div class="afield"><label for="r-metric">${escapeHtml(f.metric)}</label>
      <input type="text" inputmode="numeric" id="r-metric" data-k="r-metric" class="mono" autocomplete="off" value="${escapeHtml(draft.metric)}"><small class="muted">${escapeHtml(f.metricHint)}</small></div>
    <p class="routemsg ${result?.tone ?? ""}" role="status">${escapeHtml(message)}</p>
    <div class="btn-row"><button class="btn p" data-act="route-add"${result && result.tone !== "bad" && !ctx.adding ? "" : " disabled"}>${escapeHtml(f.save)}</button><button class="btn" data-act="route-cancel">${escapeHtml(t.cancel)}</button></div></section>`;
}

function gatewayName(route, t) {
  if (route.device_name) return route.device_name;
  return route.gateway ?? t.routesPage.noGateway;
}

function row(route, ctx) {
  const { t } = ctx;
  const v = t.routesPage;
  const tone = { on: "ok", off: "", down: "bad" }[route.state];
  const name = escapeHtml(gatewayName(route, t));
  const gateway = route.device_id ? `<a href="#/device/${escapeHtml(route.device_id)}">${name}</a>` : name;
  // the address only where the name is not already the address
  const facts = [route.device_name ? route.gateway : null, route.interface, fill(v.metric, { n: route.metric })]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const busy = ctx.busy?.has(route.network);
  const control = ctx.canWrite
    ? `<button class="btn vpnswitch" data-act="route-switch" data-network="${escapeHtml(route.network)}" data-on="${route.enabled ? "0" : "1"}"${busy ? " disabled" : ""}>${escapeHtml(route.enabled ? v.turnOff : v.turnOn)}</button>`
    : "";
  const remove = ctx.canWrite
    ? `<button class="btn del vpnswitch" data-act="route-delete" data-network="${escapeHtml(route.network)}"${busy ? " disabled" : ""}>${escapeHtml(v.delete.ok)}</button>`
    : "";
  return `<li class="routerow ${route.state}">
    <span class="i" aria-hidden="true">${ic("network")}</span>
    <div class="routenet"><b class="mono">${escapeHtml(route.network)}</b><small>${gateway} · ${facts}</small></div>
    <span class="chip ${tone}">${escapeHtml(v.state[route.state])}</span>${control}${remove}</li>`;
}

/** The page; a message where the box tells no routes. */
export function renderRoutes(routes, ctx) {
  const { t } = ctx;
  const v = t.routesPage;
  const canAdd = Boolean(ctx.canWrite && routes?.home);
  const add = canAdd && !ctx.draft ? `<div class="btn-row tight"><button class="btn" data-act="route-new" data-k="route-new" aria-haspopup="dialog"><span aria-hidden="true">+</span> ${escapeHtml(v.form.open)}</button></div>` : "";
  const head = `${ctx.subTabs ?? ""}<div class="phead"><div class="pheadrow"><h1 id="dtitle" tabindex="-1">${escapeHtml(v.title)}</h1>${add}</div><p class="lead">${escapeHtml(v.lead)}</p></div>`;
  if (routes === null) return `${head}<div class="card"><div class="empty"><span>${escapeHtml(t.loading)}</span></div></div>`;
  if (routes === "failed" || !Array.isArray(routes?.entries)) {
    return `${head}<div class="card"><div class="empty"><b>${escapeHtml(v.failed)}</b></div></div>`;
  }
  const newForm = ctx.draft && canAdd ? form({ ...ctx, routes: routes.entries, home: routes.home }) : "";
  const noHome = ctx.canWrite && !routes.home ? `<p class="hint">${escapeHtml(v.form.noHome)}</p>` : "";
  const m = routesModel(routes.entries);
  if (!m.routes.length) {
    return `${head}${newForm}${noHome}<div class="card"><div class="empty"><b>${escapeHtml(v.none)}</b><p>${escapeHtml(v.noneHint)}</p></div></div>`;
  }
  const tiles = [
    [String(m.routes.length), v.tileRoutes],
    [String(m.on), v.tileOn],
    [String(m.down.length), v.tileDown],
  ]
    .map(([value, label]) => `<div class="tile"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></div>`)
    .join("");
  const hints = m.down.length
    ? `<div class="ahints">${m.down
        .map((r) => `<div class="ahint warn"><span class="hbody">${escapeHtml(fill(v.downHint, { name: gatewayName(r, t), net: r.network }))}</span></div>`)
        .join("")}</div>`
    : "";
  return `${head}${newForm}${noHome}<div class="vpntiles">${tiles}</div>${hints}
    <section class="card sec"><span class="label">${escapeHtml(v.listTitle)}</span><ul class="vpnlist">${m.routes.map((r) => row(r, ctx)).join("")}</ul></section>
    <p class="hint">${escapeHtml(v.hint)}</p>`;
}
