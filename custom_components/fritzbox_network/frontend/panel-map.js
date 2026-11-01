/* The network map of the panel: the box and every repeater as an island, the devices as buttons on their lines. */

import {
  BUSY_UTILIZATION,
  browseOrder,
  escapeHtml,
  initials,
  isBlocked,
  isWeak,
  mapIslands,
  signalBars,
  uplinkStyle,
} from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { whenText } from "./panel-network.js";

// up to this width the islands stand below each other and the lines run as a trunk on the left
export const NARROW_MAP = 600;

/** What a screen reader says for a node: "iPad Ben, online, WLAN 5 GHz, -71 dBm, weak link". */
export function nodeLabel(client, t, now, threshold) {
  const m = t.map;
  const link =
    client.link_type === "lan"
      ? "LAN"
      : client.link_type === "wlan"
        ? [
            m.buses[client.band] ?? m.buses.wlan,
            client.online && typeof client.signal_dbm === "number" ? `${client.signal_dbm} dBm` : "",
          ]
            .filter(Boolean)
            .join(", ")
        : "";
  return [
    client.name,
    client.online ? m.online : fill(m.offline, { when: whenText(client.last_online, now, t) }),
    link,
    isWeak(client, threshold) ? m.weak : "",
    isBlocked(client) ? m.blocked : "",
    client.guest ? m.guest : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The devices in the order of the map: the order for paging when the device was opened there. */
export function mapOrder(data, shown) {
  return browseOrder(mapIslands(data, shown));
}

function nodeHtml(client, state, t, now) {
  const weak = isWeak(client, state.threshold);
  const blocked = isBlocked(client);
  const cls = [
    "nd",
    client.link_type === "lan" ? "lan" : "",
    client.online ? "" : "off",
    weak ? "weak" : "",
    blocked ? "blk" : "",
    state.hl === client.id ? "hl" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const badge = blocked ? '<span class="bd">⦸</span>' : weak ? '<span class="bd">!</span>' : "";
  const bars = signalBars(client.signal_dbm);
  const level = client.signal_dbm > -65 ? "" : client.signal_dbm > -75 ? "mid" : "low";
  const signal =
    client.link_type === "wlan" && client.online && bars
      ? `<span class="sg ${level}">${[1, 2, 3, 4].map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${2 + i * 2}px"></i>`).join("")}</span>`
      : "";
  return `<button class="${cls}" data-dev="${escapeHtml(client.id)}" aria-label="${escapeHtml(nodeLabel(client, t, now, state.threshold))}" title="${escapeHtml(client.name)}"><span class="c" aria-hidden="true">${escapeHtml(initials(client.name))}${badge}${signal}</span><span class="nm" aria-hidden="true">${escapeHtml(client.name)}</span></button>`;
}

function islandHtml(island, state, t, now) {
  const m = t.map;
  const node = island.node;
  const name = node?.name ?? t.unassigned;
  const style = node && node.role !== "master" ? uplinkStyle(node) : "";
  let up = "";
  if (style) {
    const band = t.bandGroups[node.uplink?.band] ?? "";
    const text =
      style === "lan"
        ? m.upLan
        : style === "wlan"
          ? [fill(m.upWlan, { band }).trim(), typeof node.uplink.signal_dbm === "number" ? `${node.uplink.signal_dbm} dBm` : ""].filter(Boolean).join(", ")
          : m.upUnknown;
    up = `<div class="isle-up"><i class="lg-line ${style}"></i><span>${escapeHtml(text)}</span></div>`;
  }
  const loads = node
    ? Object.entries(node.radios ?? {})
        .map(([band, radio]) => {
          const parts = [t.bandGroups[band] ?? band];
          if (typeof radio.channel === "number") parts.push(fill(t.channel, { n: radio.channel }));
          if (typeof radio.utilization === "number") parts.push(`${radio.utilization} %`);
          return `<span class="load ${(radio.utilization ?? 0) >= BUSY_UTILIZATION ? "busy" : ""}">${escapeHtml(parts.join(" · "))}</span>`;
        })
        .join("")
    : "";
  const buses = island.buses
    .map((bus) => {
      const title = m.buses[bus.key] ?? bus.key;
      return `<div class="bus ${bus.type}" role="group" aria-label="${escapeHtml(fill(m.bus, { name: title, n: bus.clients.length }))}">
        <div class="bus-h" aria-hidden="true">${escapeHtml(title)} · ${bus.clients.length}</div>
        <div class="nodes">${bus.clients.map((c) => nodeHtml(c, state, t, now)).join("")}</div></div>`;
    })
    .join("");
  const sub = node ? summary(node, state.data, t) : t.unassignedHint;
  const kind = !node ? "lost" : node.role === "master" ? "root" : "";
  return `<section class="isle ${kind}" data-node="${escapeHtml(island.key)}" data-up="${style}" aria-label="${escapeHtml(fill(m.island, { name, n: island.shown }))}">
    <div class="isle-h"><span class="ico">${ic(!node ? "help" : node.role === "master" ? "router" : "ap")}</span>
      <span class="who"><b>${escapeHtml(name)}</b><small>${escapeHtml(sub)}</small></span></div>
    ${up}${loads ? `<div class="loads">${loads}</div>` : ""}<div class="buses">${buses}</div>
    ${island.hidden ? `<p class="hidden-note">${escapeHtml(fill(m.hidden, { n: island.hidden }))}</p>` : ""}</section>`;
}

function summary(node, data, t) {
  const online = (data?.clients ?? []).filter((c) => c.online && c.ap_mac === node.mac);
  return [
    fill(t.summaryWlan, { n: online.filter((c) => c.link_type === "wlan").length }),
    fill(t.summaryLan, { n: online.filter((c) => c.link_type === "lan").length }),
  ].join(" · ");
}

/** The whole map: the head with its buttons, the islands and the legend. The lines come from drawLinks. */
export function renderMap(state, t, now, shown) {
  const m = t.map;
  const islands = mapIslands(state.data, shown);
  const legend = `<div class="legend" role="group" aria-label="${escapeHtml(m.legend)}">
    <span><i class="lg-line lan"></i>${escapeHtml(m.legendLan)}</span><span><i class="lg-line wlan"></i>${escapeHtml(m.legendWlan)}</span>
    <span><i class="lg-line unknown"></i>${escapeHtml(m.legendUnknown)}</span>
    <span><i class="lg-dot"></i>${escapeHtml(m.legendOnline)}</span><span><i class="lg-dot off"></i>${escapeHtml(m.legendOffline)}</span>
    <span><i class="lg-dot weak"></i>${escapeHtml(m.legendWeak)}</span><span><i class="lg-dot blk"></i>${escapeHtml(m.legendBlocked)}</span>
    <span><i class="lg-dot sq"></i>${escapeHtml(m.legendSquare)}</span></div>`;
  return `<div class="card mapcard" role="region" aria-label="${escapeHtml(m.title)}">
    <div class="maphead"><h2>${escapeHtml(m.title)}</h2>
      <button class="btn sm" data-act="names" data-k="names" aria-pressed="${!state.names}">${escapeHtml(state.names ? m.hideNames : m.showNames)}</button>
      <button class="btn sm aslist" data-view="list" data-k="aslist">${escapeHtml(m.asList)}</button></div>
    <div class="isl ${state.names ? "" : "compact"}" id="isl"><svg class="links" id="links" aria-hidden="true"></svg>
      <div class="inet"><span>${ic("globe")}${escapeHtml(t.internetNode)}</span></div>
      <div class="isles">${islands.map((island) => islandHtml(island, state, t, now)).join("")}</div></div>
    ${legend}</div>`;
}

/**
 * The lines between the internet, the box and the repeaters, measured from the laid-out islands,
 * so they fit whatever number of columns the width gives.
 */
export function drawLinks(root) {
  const wrap = root.querySelector("#isl");
  const svg = root.querySelector("#links");
  const box = wrap?.querySelector(".isle.root");
  const inet = wrap?.querySelector(".inet span");
  if (!wrap || !svg || !box || !inet) return;
  const w = wrap.getBoundingClientRect();
  const r = box.getBoundingClientRect();
  const i = inet.getBoundingClientRect();
  const narrow = w.width <= NARROW_MAP;
  const paths = [];
  const x0 = narrow ? i.left - w.left + 14 : i.left - w.left + i.width / 2;
  paths.push(`<path d="M${x0},${i.bottom - w.top} V${r.top - w.top}"/>`);
  wrap.querySelectorAll(".isle[data-up]:not(.root):not(.lost)").forEach((el, n) => {
    const style = el.dataset.up;
    if (!style) return;
    const e = el.getBoundingClientRect();
    const d = narrow
      ? `M${8 + n * 6},${r.bottom - w.top} V${e.top - w.top + 28} H${e.left - w.left}`
      : `M${e.left - w.left + e.width / 2},${r.bottom - w.top} V${e.top - w.top}`;
    paths.push(`<path class="${style}" d="${d}"/>`);
  });
  const html = paths.join("");
  if (svg.innerHTML !== html) svg.innerHTML = html;
}
