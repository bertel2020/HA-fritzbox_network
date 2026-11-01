/* The network tab of the panel: the filters, the access points and the devices as HTML. */

import {
  BANDS,
  BUSY_UTILIZATION,
  PANEL_FILTERS,
  apSummary,
  daysSince,
  escapeHtml,
  isBlocked,
  isWeak,
  panelClients,
  panelCounts,
  panelGroups,
  rateText,
  signalBars,
} from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

/** "today", "yesterday", "3 days ago": when a time was, in words; "unknown" without one. */
export function whenText(iso, now, t) {
  const days = daysSince(iso, now);
  if (days === null) return t.unknown;
  if (days === 0) return t.today;
  if (days === 1) return t.yesterday;
  return fill(t.daysAgo, { n: days });
}

/** The status filters; those with nothing to show stay away unless chosen. */
export function renderChips(state, t, now) {
  const counts = panelCounts(state.data, now, state.threshold);
  return PANEL_FILTERS.filter((f) => f === "all" || counts[f] || f === state.filter)
    .map(
      (f) =>
        `<button class="fchip" data-filter="${f}" aria-pressed="${f === state.filter}">${escapeHtml(t.filters[f])}<b>${counts[f]}</b></button>`
    )
    .join("");
}

export function visibleClients(state, now) {
  return panelClients(state.data, {
    filter: state.filter,
    query: state.query,
    sort: state.sort,
    now,
    threshold: state.threshold,
  });
}

export function renderMeta(state, t, shown) {
  const clients = state.data?.clients ?? [];
  return escapeHtml(
    fill(t.meta, {
      total: clients.length,
      online: clients.filter((c) => c.online).length,
      blocked: clients.filter(isBlocked).length,
      shown,
    })
  );
}

function radioCard(band, radio, t) {
  const busy = (radio.utilization ?? 0) >= BUSY_UTILIZATION;
  const channel =
    typeof radio.channel === "number" ? fill(t.channel, { n: radio.channel }) : "";
  const load =
    typeof radio.utilization === "number"
      ? `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${radio.utilization}"><i class="${busy ? "busy" : ""}" style="width:${Math.min(100, radio.utilization)}%"></i></div>
         <div class="top"><span class="${busy ? "busyText" : "muted"}">${escapeHtml(fill(t.load, { n: radio.utilization }))}</span><span class="muted">${typeof radio.noise_dbm === "number" ? escapeHtml(fill(t.noise, { n: radio.noise_dbm })) : ""}</span></div>`
      : "";
  return `<div class="radio"><div class="top"><b>${escapeHtml(BANDS[band] ?? band)}</b><span class="muted">${escapeHtml(channel)}</span></div>${load}</div>`;
}

function groupHead(group, state, t) {
  if (group.node) {
    const sum = apSummary(state.data, group.node);
    const parts = [
      fill(t.summaryWlan, { n: sum.wlan }),
      fill(t.summaryLan, { n: sum.lan }),
      sum.minRate === null ? "" : fill(t.summaryRate, { n: sum.minRate }),
    ].filter(Boolean);
    return {
      icon: group.node.role === "master" ? "router" : "ap",
      title: group.node.name,
      sub: parts.join(" · "),
    };
  }
  if (state.group === "flat") return { icon: "ap", title: t.flat, sub: "" };
  if (state.group === "ap") return { icon: "help", title: t.unassigned, sub: t.unassignedHint };
  return {
    icon: group.key === "lan" ? "lan" : group.key === "none" ? "help" : "wifi",
    title: t.bandGroups[group.key] ?? group.key,
    sub: "",
  };
}

function deviceRow(client, state, t, now) {
  const weak = isWeak(client, state.threshold);
  const line2 = client.online
    ? [client.ip, client.vendor].filter(Boolean).join(" · ")
    : fill(t.lastOnline, { when: whenText(client.last_online, now, t) });
  const bars = signalBars(client.signal_dbm);
  const level = client.signal_dbm > -65 ? "" : client.signal_dbm > -75 ? "mid" : "low";
  const signal =
    client.link_type === "wlan"
      ? `<span class="bars ${level}" title="${escapeHtml(client.signal_dbm ?? "")} dBm">${[1, 2, 3, 4]
          .map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${3 + i * 3}px"></i>`)
          .join("")}</span>`
      : "";
  const link = client.link_type === "lan" ? "lan" : client.link_type === "wlan" ? "wifi" : "help";
  return `<button class="dev ${client.online ? "" : "off"}" data-dev="${escapeHtml(client.id)}"${state.sel === client.id ? ' aria-current="true"' : ""}>
    <span class="dot ${client.online ? "on" : ""}"></span>
    <span class="link">${ic(link)}</span>
    <span class="who"><b>${escapeHtml(client.name)}</b><small>${escapeHtml(line2)}</small></span>
    <span class="end">${isBlocked(client) ? `<span class="chip bad">${escapeHtml(t.blockedChip)}</span>` : ""}${client.guest ? `<span class="chip info">${escapeHtml(t.guestChip)}</span>` : ""}<span class="rate">${escapeHtml(rateText(client))}</span>${weak ? `<span class="warnIcon" title="${escapeHtml(fill(t.weakTitle, { percent: weakPercent(client) }))}">${ic("alert")}</span>` : ""}${signal}</span></button>`;
}

function weakPercent(client) {
  const ratios = [
    [client.rate_download, client.rate_max_download],
    [client.rate_upload, client.rate_max_upload],
  ]
    .filter(([a, b]) => typeof a === "number" && typeof b === "number" && b > 0)
    .map(([a, b]) => a / b);
  return ratios.length ? Math.round(Math.min(...ratios) * 100) : 0;
}

export { weakPercent };

export function renderGroups(state, t, now) {
  const clients = visibleClients(state, now);
  const narrowed = state.filter !== "all" || Boolean(state.query);
  const groups = panelGroups(state.data, clients, state.group, narrowed);
  if (!groups.length) {
    return `<div class="card empty">${ic("search")}<b>${escapeHtml(t.emptyTitle)}</b><span>${escapeHtml(t.emptyHint)}</span></div>`;
  }
  return groups
    .map((group) => {
      const head = groupHead(group, state, t);
      const open = !state.closed.has(group.key);
      const radios =
        group.node && Object.keys(group.node.radios ?? {}).length
          ? `<div class="radios">${Object.entries(group.node.radios)
              .map(([band, radio]) => radioCard(band, radio, t))
              .join("")}</div>`
          : "";
      const rows = group.clients.length
        ? group.clients.map((c) => deviceRow(c, state, t, now)).join("")
        : `<div class="empty"><span>${escapeHtml(t.noDevicesAtAp)}</span></div>`;
      return `<section class="card ap ${open ? "" : "closed"}">
        <button class="ap-head" data-ap="${escapeHtml(group.key)}" aria-expanded="${open}">
          <span class="ico">${ic(head.icon)}</span>
          <span class="who"><b>${escapeHtml(head.title)}</b><small>${escapeHtml(head.sub)}</small></span>
          <span class="count">${group.clients.length}</span><span class="chev">${ic("chev")}</span>
        </button>
        <div class="ap-body">${radios}${rows}</div></section>`;
    })
    .join("");
}
