/** The routes page: the static IPv4 routes of the box, with the device each one leads to and a switch for each. */

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
  return `<li class="routerow ${route.state}">
    <span class="i" aria-hidden="true">${ic("network")}</span>
    <div class="routenet"><b class="mono">${escapeHtml(route.network)}</b><small>${gateway} · ${facts}</small></div>
    <span class="chip ${tone}">${escapeHtml(v.state[route.state])}</span>${control}</li>`;
}

/** The page; a message where the box tells no routes. */
export function renderRoutes(routes, ctx) {
  const { t } = ctx;
  const v = t.routesPage;
  const head = `${ctx.subTabs ?? ""}<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(v.title)}</h1><p class="lead">${escapeHtml(v.lead)}</p></div>`;
  if (routes === null) return `${head}<div class="card"><div class="empty"><span>${escapeHtml(t.loading)}</span></div></div>`;
  if (routes === "failed" || !Array.isArray(routes?.entries)) {
    return `${head}<div class="card"><div class="empty"><b>${escapeHtml(v.failed)}</b></div></div>`;
  }
  const m = routesModel(routes.entries);
  if (!m.routes.length) {
    return `${head}<div class="card"><div class="empty"><b>${escapeHtml(v.none)}</b><p>${escapeHtml(v.noneHint)}</p></div></div>`;
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
  return `${head}<div class="vpntiles">${tiles}</div>${hints}
    <section class="card sec"><span class="label">${escapeHtml(v.listTitle)}</span><ul class="vpnlist">${m.routes.map((r) => row(r, ctx)).join("")}</ul></section>
    <p class="hint">${escapeHtml(v.hint)}</p>`;
}
