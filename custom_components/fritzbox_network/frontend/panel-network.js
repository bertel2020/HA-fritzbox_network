/* The network tab of the panel: the filters, the access points and the devices as HTML. */

import {
  BANDS,
  BUSY_UTILIZATION,
  bulkPlan,
  apSummary,
  browseOrder,
  daysSince,
  escapeHtml,
  filterMenu,
  isBlocked,
  isWeak,
  panelClients,
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

/** The name of a filter or of a group in the filter row. */
export function filterName(filter, data, t) {
  if (!filter.startsWith("label:")) return t.filters[filter] ?? filter;
  const id = filter.slice(6);
  return (data?.labels ?? []).find((l) => l.id === id)?.name ?? id;
}

/**
 * The filter row: three fixed chips, the chosen other filter as a chip with ×, and the button
 * for the menu with the rest. It wraps when it must and never scrolls sideways.
 */
export function renderChips(state, t, now) {
  const menu = filterMenu(state.data, state.filter, now, state.threshold);
  const fixed = menu.primary.map(
    (f) =>
      `<button class="fchip" data-filter="${f.id}" data-k="f-${f.id}" aria-pressed="${f.id === state.filter}">${escapeHtml(t.filters[f.id])}<b>${f.count}</b></button>`
  );
  let active = "";
  if (menu.active) {
    const name = filterName(menu.active, state.data, t);
    const count = menu.active.startsWith("label:")
      ? (menu.labels.find((l) => `label:${l.id}` === menu.active)?.count ?? 0)
      : (menu.others.find((o) => o.id === menu.active)?.count ?? 0);
    active = `<button class="fchip" data-filter="all" data-k="f-active" aria-pressed="true" aria-label="${escapeHtml(fill(t.removeFilter, { name }))}">${menu.active.startsWith("label:") ? ic("tag") : ""}${escapeHtml(name)}<b>${count}</b><span class="x">${ic("close")}</span></button>`;
  }
  const more = `<button class="fchip more" id="morebtn" data-act="menu" data-k="more" aria-haspopup="menu" aria-expanded="${Boolean(state.menu)}" aria-controls="fmenu" aria-label="${escapeHtml(fill(t.moreLabel, { n: menu.available }))}">${ic("filter")}${escapeHtml(t.more)}<b>${menu.available}</b>${ic("chev")}</button>`;
  return [...fixed, active, more].join("");
}

/** The menu behind "More": the other filters and the groups, each with its count. */
export function renderFilterMenu(state, t, now) {
  if (!state.menu) return "";
  const menu = filterMenu(state.data, state.filter, now, state.threshold);
  const item = (filter, name, count, icon = "") =>
    `<button role="menuitemradio" aria-checked="${state.filter === filter}" data-filter="${escapeHtml(filter)}" tabindex="-1"><span class="ck">${state.filter === filter ? ic("check") : ""}</span>${icon}<span class="t">${escapeHtml(name)}</span><b>${count}</b></button>`;
  const others = menu.others.map((o) => item(o.id, t.filters[o.id], o.count)).join("");
  const labels = menu.labels.map((l) => item(`label:${l.id}`, l.name, l.count, ic("tag"))).join("");
  return `<div class="sheet-scrim" data-act="menu-close"></div>
    <div class="fmenu" id="fmenu" role="menu" aria-label="${escapeHtml(fill(t.moreLabel, { n: menu.available }))}">
      ${others ? `<span class="label" aria-hidden="true">${escapeHtml(t.menuStatus)}</span>${others}` : ""}
      ${labels ? `<span class="label" aria-hidden="true">${escapeHtml(t.menuGroups)}</span>${labels}` : ""}
    </div>`;
}

/** The switches of the "Internet access" entities of the devices in a group. */
export function groupMembers(data, labelId) {
  return (data?.clients ?? []).filter((c) => c.labels?.includes(labelId) && c.actions?.internet_access);
}

/** What the button of a group does now: block all of them if every one may go online, else allow. */
export function groupPlan(data, labelId, hass) {
  const members = groupMembers(data, labelId);
  const plan = bulkPlan(members.map((c) => c.actions.internet_access), hass?.states ?? {});
  const names = new Map(members.map((c) => [c.actions.internet_access, c.name]));
  return { ...plan, names: plan.entities.map((entity) => names.get(entity)) };
}

/** Above the list while a group is the filter: its name and the button for all its devices. */
export function renderGroupBar(state, t, hass) {
  if (!state.filter.startsWith("label:")) return "";
  const id = state.filter.slice(6);
  const label = (state.data?.labels ?? []).find((l) => l.id === id);
  if (!label) return "";
  const count = (state.data?.clients ?? []).filter((c) => c.labels?.includes(id)).length;
  const plan = groupPlan(state.data, id, hass);
  const button = plan.entities.length
    ? `<button class="btn ${plan.block ? "d" : "p"}" data-act="group-bulk">${escapeHtml(plan.block ? t.groupBlockAll : t.groupAllowAll)}</button>`
    : "";
  return `<div class="card groupbar"><span class="ico">${ic("tag")}</span>
    <span class="who"><b>${escapeHtml(label.name)}</b><small>${escapeHtml(fill(t.groupCount, { n: count }))}</small></span>${button}</div>`;
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
  if (state.group === "label") {
    return group.label
      ? { icon: "tag", title: group.label.name, sub: "" }
      : { icon: "help", title: t.groupNone, sub: "" };
  }
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

/** The groups of the list as the page shows them, for the list and for paging on the device page. */
export function listGroups(state, now) {
  const narrowed = state.filter !== "all" || Boolean(state.query);
  return panelGroups(state.data, visibleClients(state, now), state.group, narrowed);
}

/** The devices in the order of the list: the order for paging when the device was opened there. */
export function listOrder(state, now) {
  return browseOrder(listGroups(state, now));
}

export function renderGroups(state, t, now) {
  const groups = listGroups(state, now);
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
