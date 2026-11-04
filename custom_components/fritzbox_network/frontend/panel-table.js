/* The flat list of the network tab as a table: sortable, with sparklines and pages. */

import {
  BANDS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  escapeHtml,
  historySeries,
  isBlocked,
  isWeak,
  pageSlice,
  rateText,
  TABLE_DAYS,
  formatBytes,
  signalBars,
  sparkLine,
  trafficByDevice,
} from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";
import { whenText, weakPercent } from "./panel-network.js";

export { DEFAULT_PAGE_SIZE, PAGE_SIZES };

const COLUMNS = [
  { id: "name", sort: "name" },
  { id: "ip", sort: "ip", wide: true },
  { id: "link", sort: "link", wide: true },
  { id: "rate", sort: "rate" },
  { id: "history" },
  { id: "traffic", sort: "traffic", wide: true },
  { id: "last", sort: "last", wide: true },
];

/** A sparkline of the last day of a device; empty without a history. */
export function sparkHtml(client, history, t) {
  const series = historySeries(client, history);
  const path = series && sparkLine(series.values, 96, 26, series.kind === "online" ? { min: 0, max: 1 } : {});
  if (!path) return `<span class="muted">–</span>`;
  const label = escapeHtml(t.sparkLabels[series.kind]);
  return `<svg class="spark ${series.kind === "online" ? "off" : ""}" viewBox="0 0 96 26" role="img" aria-label="${label}"><title>${label}</title><path class="area" d="${path.area}"/><path d="${path.line}"/></svg>`;
}

function connectionText(client, nodes, t) {
  if (!client.link_type) return "–";
  const ap = nodes.find((n) => n.mac === client.ap_mac)?.name;
  const how =
    client.link_type === "lan"
      ? client.port ? `LAN ${client.port}` : "LAN"
      : `WLAN${client.band ? ` ${BANDS[client.band] ?? client.band}` : ""}`;
  return [ap, how].filter(Boolean).join(" · ");
}

function volumeText(client, volumes, language) {
  const volume = volumes[client.mac];
  return volume ? `↓ ${formatBytes(volume[0], language)} <small>↑ ${formatBytes(volume[1], language)}</small>` : "–";
}

function row(client, state, t, now, volumes) {
  const weak = isWeak(client, state.threshold);
  const level = client.signal_dbm > -65 ? "" : client.signal_dbm > -75 ? "mid" : "low";
  const bars = signalBars(client.signal_dbm);
  const signal =
    client.link_type === "wlan" && client.online
      ? `<span class="bars ${level}" title="${escapeHtml(client.signal_dbm ?? "")} dBm">${[1, 2, 3, 4]
          .map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${3 + i * 3}px"></i>`)
          .join("")}</span>`
      : "";
  const sub = client.online ? client.vendor ?? "" : fill(t.lastOnline, { when: whenText(client.last_online, now, t) });
  const link = client.link_type === "lan" ? "lan" : client.link_type === "wlan" ? "wifi" : "help";
  const chips = `${isBlocked(client) ? `<span class="chip bad">${escapeHtml(t.blockedChip)}</span>` : ""}${client.guest ? `<span class="chip info">${escapeHtml(t.guestChip)}</span>` : ""}${weak ? `<span class="chip warn" title="${escapeHtml(fill(t.weakTitle, { percent: weakPercent(client) }))}">${escapeHtml(t.weakShort)}</span>` : ""}`;
  return `<tr data-dev="${escapeHtml(client.id)}" class="${client.online ? "" : "off"}"${state.sel === client.id ? ' aria-current="true"' : ""}>
    <td><span class="who2"><span class="dot ${client.online ? "on" : ""}"></span><span class="link">${ic(link)}</span>
      <span class="who"><button class="tlink" data-dev="${escapeHtml(client.id)}">${escapeHtml(client.name)}</button><small>${escapeHtml(sub)}</small></span></span></td>
    <td class="wide">${escapeHtml(client.ip ?? "–")}</td>
    <td class="wide">${escapeHtml(connectionText(client, state.data?.nodes ?? [], t))}</td>
    <td class="num">${escapeHtml(client.online ? rateText(client) : "–")}${signal}<span class="chips2">${chips}</span></td>
    <td class="hist">${sparkHtml(client, state.history, t)}</td>
    <td class="wide num vol">${volumeText(client, volumes, state.language)}</td>
    <td class="wide num">${escapeHtml(client.online ? t.nowText : whenText(client.last_online, now, t))}</td></tr>`;
}

function head(column, state, t) {
  const label = escapeHtml(t.columns[column.id]);
  const cls = [column.wide ? "wide" : "", ["rate", "last", "traffic"].includes(column.id) ? "num" : ""].filter(Boolean).join(" ");
  if (!column.sort) return `<th class="${cls}" scope="col">${label}</th>`;
  const sorted = state.sort === column.sort;
  const order = sorted ? (state.sortDesc ? "descending" : "ascending") : "none";
  return `<th class="${cls}" scope="col" aria-sort="${order}"><button data-sort="${column.sort}">${label}<span class="arrow ${sorted ? (state.sortDesc ? "down" : "up") : ""}" aria-hidden="true"></span></button></th>`;
}

export function renderTable(state, t, now, clients) {
  const volumes = trafficByDevice(state.traffic, TABLE_DAYS);
  const page = pageSlice(clients, state.page ?? 0, state.pageSize ?? DEFAULT_PAGE_SIZE);
  state.page = page.page;
  const pager = `<div class="tpager"><label>${escapeHtml(t.rowsPerPage)}
      <select id="pagesize">${PAGE_SIZES.map((n) => `<option value="${n}" ${n === (state.pageSize ?? DEFAULT_PAGE_SIZE) ? "selected" : ""}>${n || escapeHtml(t.allRows)}</option>`).join("")}</select></label>
    <span aria-live="polite">${escapeHtml(fill(t.pageRange, { from: page.from, to: page.to, total: page.total }))}</span>
    <button class="btn" data-act="page-prev" aria-label="${escapeHtml(t.pagePrev)}" ${page.page > 0 ? "" : "disabled"}>${ic("left")}</button>
    <button class="btn" data-act="page-next" aria-label="${escapeHtml(t.pageNext)}" ${page.page < page.pages - 1 ? "" : "disabled"}>${ic("right")}</button></div>`;
  return `<section class="card tablecard"><div class="tablewrap"><table class="devtable">
    <thead><tr>${COLUMNS.map((c) => head(c, state, t)).join("")}</tr></thead>
    <tbody>${page.items.map((c) => row(c, state, t, now, volumes)).join("")}</tbody></table></div>${page.pages > 1 || state.pageSize !== 0 ? pager : ""}</section>`;
}
