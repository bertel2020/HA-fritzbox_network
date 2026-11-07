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

/** The switch of a route, with the state the box reported. */
function switchOf(route, ctx) {
  const v = ctx.t.routesPage;
  const busy = ctx.busy?.has(route.network);
  return ctx.canWrite
    ? `<button class="switch" role="switch" aria-checked="${route.enabled}" aria-label="${escapeHtml(fill(v.switchLabel, { net: route.network }))}" title="${escapeHtml(route.enabled ? v.turnOff : v.turnOn)}" data-act="route-switch" data-network="${escapeHtml(route.network)}" data-on="${route.enabled ? "0" : "1"}"${busy ? " disabled" : ""}></button>`
    : "";
}

/** The delete button of a route, with the right to write only. */
function deleteOf(route, ctx) {
  if (!ctx.canWrite) return "";
  const busy = ctx.busy?.has(route.network);
  const label = ctx.t.routesPage.delete.ok;
  return `<button class="iconbtn del" data-act="route-delete" data-network="${escapeHtml(route.network)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${busy ? " disabled" : ""}>${ic("trash")}</button>`;
}

/** A route: the target network first, then the way it takes ("via gateway") with its reachability. */
function row(route, ctx) {
  const { t } = ctx;
  const v = t.routesPage;
  const reach = route.gateway_online === true ? "on" : route.gateway_online === false ? "down" : "unknown";
  // the address only where the name is not already the address; the metric only where it is not the usual 0
  const facts = [route.device_name ? route.gateway : null, route.metric ? fill(v.metric, { n: route.metric }) : null].filter(Boolean).map(escapeHtml);
  const via = `<span class="rvia"><i class="gdot ${reach}" title="${escapeHtml(v.reach[reach])}" aria-hidden="true"></i>${escapeHtml(fill(v.via, { name: gatewayName(route, t) }))}${facts.length ? ` <em>${facts.join(" · ")}</em>` : ""}${route.state === "down" ? ` <span class="chip bad">${escapeHtml(v.state.down)}</span>` : ""}</span>`;
  return `<li class="routerow ${route.state}" aria-current="${route.network === ctx.sel}">
    <span class="rico" aria-hidden="true">${ic("network")}</span>
    <button class="routepick routenet" data-act="route-pick" data-network="${escapeHtml(route.network)}"><b class="mono">${escapeHtml(route.network)}</b><small>${via}</small></button>
    ${switchOf(route, ctx)}${deleteOf(route, ctx)}</li>`;
}

/** What the box says of the gateway's address: the reservation as read from it, or null while unknown. */
function fixedOf(route, ctx) {
  const entry = route.device_mac ? ctx.fixed?.[route.device_mac] : null;
  return entry?.value ?? null;
}

/** The interface the box gives every route it makes itself: only another one is worth a line. */
const USUAL_INTERFACE = "LanHostConfigManagement1";

/** The way the traffic takes, as four small boxes, and what is known of the selected route. */
function detail(route, ctx) {
  const { t } = ctx;
  const d = t.routesPage.detail;
  const on = route.enabled;
  const down = route.state === "down";
  const known = Boolean(route.device_id);
  const reservation = fixedOf(route, ctx);
  const link = (text = "") => `<div class="rlink ${on ? "" : "off"}">${text ? `<span>${escapeHtml(text)}</span>` : ""}</div>`;
  // a gateway that is no device of the list is shown by its address, once
  const title = route.device_name ?? route.gateway ?? t.routesPage.noGateway;
  const sub = known ? route.gateway : route.gateway ? d.unknownDevice : "";
  const gatewayRow = known
    ? `<dt>${escapeHtml(d.gateway)}</dt><dd><a href="#/device/${escapeHtml(route.device_id)}">${escapeHtml(title)}</a><br><span class="muted mono">${escapeHtml(route.gateway ?? "")}</span></dd>`
    : `<dt>${escapeHtml(d.gateway)}</dt><dd><span class="mono">${escapeHtml(route.gateway ?? t.routesPage.noGateway)}</span>${route.gateway ? `<br><span class="muted">${escapeHtml(d.unknownDevice)}</span>` : ""}</dd>`;
  const fixedRow = known
    ? `<dt>${escapeHtml(d.fixed)}</dt><dd>${reservation ? `<span class="chip ${reservation.fixed ? "ok" : "warn"}">${escapeHtml(reservation.fixed ? d.yes : d.no)}</span>` : `<span class="muted">${escapeHtml(d.fixedUnknown)}</span>`}</dd>`
    : "";
  const hint =
    known && reservation && !reservation.fixed
      ? `<p class="ahint info"><span class="hbody">${escapeHtml(fill(d.notFixed, { name: title }))} <a href="#/addresses">${escapeHtml(d.fixLink)}</a></span></p>`
      : "";
  const iface = route.interface && route.interface !== USUAL_INTERFACE ? `<dt>${escapeHtml(d.iface)}</dt><dd class="mono">${escapeHtml(route.interface)}</dd>` : "";
  const source = route.source && route.source !== "0.0.0.0" ? `<dt>${escapeHtml(d.source)}</dt><dd class="mono">${escapeHtml(route.source)}/${escapeHtml(route.source_mask)}</dd>` : "";
  const home = ctx.home;
  return `<span class="label">${escapeHtml(d.title)}</span>
    <div class="rschema">
      <div class="rnode"><b>${escapeHtml(d.home)}</b><small class="mono">${escapeHtml(home?.network ?? "")}</small></div>
      ${link()}
      <div class="rnode"><b>${escapeHtml(d.box)}</b><small class="mono">${escapeHtml(home?.box ?? "")}</small></div>
      ${link(on ? d.route : d.off)}
      <div class="rnode gw ${!on ? "off" : down ? "down" : ""}"><b>${escapeHtml(title)}</b><small${known ? ' class="mono"' : ""}>${escapeHtml(sub)}</small></div>
      ${link()}
      <div class="rnode dst"><b class="mono">${escapeHtml(route.network)}</b><small>${escapeHtml(d.target)}</small></div>
    </div>${hint}
    <dl>${gatewayRow}${fixedRow}<dt>${escapeHtml(d.metric)}</dt><dd>${route.metric}</dd>${iface}${source}</dl>`;
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
    [String(m.down.length), v.tileDown, m.down.length ? "bad" : "ok"],
  ]
    .map(([value, label, tone]) => `<div class="tile ${tone ?? ""}"><span class="label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`)
    .join("");
  const hints = m.down.length
    ? `<div class="ahints">${m.down
        .map((r) => `<div class="ahint warn"><span class="hbody">${escapeHtml(fill(v.downHint, { name: gatewayName(r, t), net: r.network }))}</span></div>`)
        .join("")}</div>`
    : "";
  const selected = m.routes.find((r) => r.network === ctx.sel) ?? m.routes[0];
  const c = { ...ctx, sel: selected.network, home: routes.home };
  return `${head}${newForm}${noHome}<div class="tiles routetiles">${tiles}</div>${hints}
    <div class="routelayout">
      <section class="card sec"><span class="label">${escapeHtml(v.listTitle)}</span><ul class="vpnlist">${m.routes.map((r) => row(r, c)).join("")}</ul></section>
      <aside class="card sec routedetail" aria-live="polite">${detail(selected, c)}</aside>
    </div>
    <p class="hint">${escapeHtml(v.hint)}</p>`;
}
