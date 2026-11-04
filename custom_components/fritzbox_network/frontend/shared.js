/* The parts of the FRITZ!Box Network frontend that need no DOM: used by the cards and the panel. */

// A device is on a weak link when its current rate is below this part of the
// highest rate the link can do, in one direction or the other.
export const WEAK_LINK_RATIO = 1 / 3;

export const BANDS = { "2_4ghz": "2.4 GHz", "5ghz": "5 GHz", "6ghz": "6 GHz" };
// from this channel load on, the radio is shown as busy
export const BUSY_UTILIZATION = 70;


/** An explanation that stays closed until it is wanted: a summary line and the paragraphs. */
export function noteHtml(label, ...texts) {
  return `<details class="explain"><summary>${escapeHtml(label)}</summary>${texts.map((text) => `<p class="hint">${escapeHtml(text)}</p>`).join("")}</details>`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export function matches(client, filter, query, threshold = WEAK_LINK_RATIO) {
  if (query) {
    const haystack = `${client.name} ${client.ip ?? ""} ${client.mac} ${client.vendor ?? ""}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
  }
  if (filter === "wifi") return client.link_type === "wlan";
  if (filter === "lan") return client.link_type === "lan";
  if (filter === "offline") return !client.online;
  if (filter === "weak") return isWeak(client, threshold);
  return true;
}

/** The lower of the current/highest rate ratios of both directions; null if unknown. */
export function linkRatio(client) {
  const ratios = [
    [client.rate_download, client.rate_max_download],
    [client.rate_upload, client.rate_max_upload],
  ]
    .filter(([current, max]) => typeof current === "number" && typeof max === "number" && max > 0)
    .map(([current, max]) => current / max);
  return ratios.length ? Math.min(...ratios) : null;
}

/** Only for online devices: the rate of a device that is gone says nothing. */
export function isWeak(client, threshold = WEAK_LINK_RATIO) {
  const ratio = linkRatio(client);
  return Boolean(client.online) && ratio !== null && ratio < threshold;
}

/** How many devices the filters with a number in front of them would show. */
export function countFilters(data, threshold = WEAK_LINK_RATIO) {
  const clients = data?.clients ?? [];
  return {
    offline: clients.filter((c) => !c.online).length,
    weak: clients.filter((c) => isWeak(c, threshold)).length,
  };
}

/** Groups the clients by access point: the box first, the unassigned ones last. */
export function groupTopology(data, filter = "all", query = "", threshold = WEAK_LINK_RATIO) {
  const groups = (data.nodes ?? []).map((node) => ({ node, clients: [], total: 0 }));
  const byMac = new Map(groups.map((g) => [g.node.mac, g]));
  const unassigned = { node: null, clients: [], total: 0 };
  for (const client of data.clients ?? []) {
    const group = byMac.get(client.ap_mac) ?? unassigned;
    group.total += 1;
    if (matches(client, filter, query, threshold)) group.clients.push(client);
  }
  for (const group of [...groups, unassigned]) {
    group.clients.sort(
      (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
    );
  }
  return unassigned.total ? [...groups, unassigned] : groups;
}

/** 0 (unknown) to 4 bars from the signal in dBm. */
export function signalBars(dbm) {
  if (typeof dbm !== "number") return 0;
  if (dbm > -55) return 4;
  if (dbm > -65) return 3;
  if (dbm > -75) return 2;
  return 1;
}

export function rateText(client) {
  const down = client.rate_download;
  const up = client.rate_upload;
  if (!down && !up) return "";
  return `${Math.round(down ?? 0)} / ${Math.round(up ?? 0)} Mbit/s`;
}

/** One entry per radio of an access point: band, channel and load, as far as the box says. */
export function radioInfo(node, t) {
  return Object.entries(node?.radios ?? {}).map(([band, radio]) => {
    const parts = [BANDS[band] ?? band];
    if (typeof radio.channel === "number") parts.push(t.channel.replace("{n}", radio.channel));
    if (typeof radio.utilization === "number") parts.push(`${radio.utilization} %`);
    return { text: parts.join(" · "), busy: (radio.utilization ?? 0) >= BUSY_UTILIZATION };
  });
}

/** What the expanded row says about the device: IP, MAC, band, signal. */
export function detailText(client) {
  const parts = [client.ip, client.mac];
  if (client.band) parts.push(BANDS[client.band] ?? client.band);
  if (typeof client.signal_dbm === "number") parts.push(`${client.signal_dbm} dBm`);
  return parts.filter(Boolean).join(" · ");
}

/** The radios of every access point with the number of devices on each band. */
export function radioRows(data) {
  return (data?.nodes ?? [])
    .map((node) => ({
      node,
      bands: Object.entries(node.radios ?? {}).map(([band, radio]) => ({
        band,
        label: BANDS[band] ?? band,
        channel: radio.channel ?? null,
        utilization: radio.utilization ?? null,
        noise_dbm: radio.noise_dbm ?? null,
        clients: (data.clients ?? []).filter(
          (c) => c.online && c.ap_mac === node.mac && c.band === band
        ).length,
      })),
    }))
    .filter((row) => row.bands.length);
}

/**
 * The chosen devices in the order of the config, null where the integration has no such device,
 * then the devices of a group (a label) that were not named, by name.
 */
export function devicesFor(data, entities, label = "") {
  const clients = data?.clients ?? [];
  const byEntity = new Map(clients.map((c) => [c.entity_id, c]));
  const named = entities.map((entity) => ({ entity, client: byEntity.get(entity) ?? null }));
  if (!label) return named;
  const members = clients
    .filter((c) => c.entity_id && c.labels?.includes(label) && !entities.includes(c.entity_id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => ({ entity: client.entity_id, client }));
  return [...named, ...members];
}

/**
 * What the button for all devices does: block them all when every one may go online,
 * else allow the ones that are blocked.
 */
export function bulkPlan(switches, states) {
  const usable = switches.filter((id) => states[id] && states[id].state !== "unavailable");
  const allAllowed = usable.length > 0 && usable.every((id) => states[id].state === "on");
  return {
    block: allAllowed,
    entities: allAllowed ? usable : usable.filter((id) => states[id].state !== "on"),
  };
}

export function signalHtml(client) {
  const bars = signalBars(client.signal_dbm);
  return `<span class="bars" title="${client.signal_dbm ?? ""} dBm">${[1, 2, 3, 4]
    .map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${3 + i * 2}px"></i>`)
    .join("")}</span>`;
}

export function linkIcon(client) {
  return client.link_type === "lan" ? "mdi:ethernet-cable" : client.link_type === "wlan" ? "mdi:wifi" : "mdi:help";
}

/* What the panel needs on top of the cards: filters with a number, sorting, grouping. */

export const NEW_DAYS = 7;
export const STALE_DAYS = 30;
export const PANEL_FILTERS = [
  "all",
  "online",
  "offline",
  "wlan",
  "lan",
  "guest",
  "blocked",
  "weak",
  "new",
  "stale",
  "unassigned",
];

const DAY = 86400000;

/** Whole days between a time and now; null where the time is not known. */
export function daysSince(iso, now = Date.now()) {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / DAY));
}

/** Only a device the box says is blocked; one it says nothing about is not. */
export function isBlocked(client) {
  return client.wan_access === false;
}

export function panelMatches(client, filter, now = Date.now(), threshold = WEAK_LINK_RATIO) {
  if (filter.startsWith("label:")) return Boolean(client.labels?.includes(filter.slice(6)));
  switch (filter) {
    case "online":
      return Boolean(client.online);
    case "offline":
      return !client.online;
    case "wlan":
      return client.link_type === "wlan";
    case "lan":
      return client.link_type === "lan";
    case "guest":
      return Boolean(client.guest);
    case "blocked":
      return isBlocked(client);
    case "weak":
      return isWeak(client, threshold);
    case "new":
      return (daysSince(client.created_at, now) ?? Infinity) < NEW_DAYS;
    case "stale":
      return !client.online && (daysSince(client.last_online, now) ?? -1) >= STALE_DAYS;
    case "unassigned":
      return !client.ap_mac;
    default:
      return true;
  }
}

export function panelCounts(data, now = Date.now(), threshold = WEAK_LINK_RATIO) {
  const clients = data?.clients ?? [];
  return Object.fromEntries(
    PANEL_FILTERS.map((f) => [f, clients.filter((c) => panelMatches(c, f, now, threshold)).length])
  );
}

/** The groups (labels) that have at least one device, with how many. */
export function labelCounts(data) {
  const clients = data?.clients ?? [];
  return (data?.labels ?? [])
    .map((label) => ({
      id: label.id,
      name: label.name,
      count: clients.filter((c) => c.labels?.includes(label.id)).length,
    }))
    .filter((label) => label.count);
}

/** An address padded so that a text comparison sorts it numerically; devices without one come last. */
const ipKey = (ip) => (ip ? ip.split(".").map((n) => n.padStart(3, "0")).join(".") : "~");

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  signal: (a, b) => (b.signal_dbm ?? -999) - (a.signal_dbm ?? -999),
  rate: (a, b) => (b.rate_download ?? -1) - (a.rate_download ?? -1),
  last: (a, b) => Date.parse(b.last_online ?? 0) - Date.parse(a.last_online ?? 0),
  traffic: (a, b, volumes) => (volumes?.[b.mac] ?? -1) - (volumes?.[a.mac] ?? -1),
  ip: (a, b) => ipKey(a.ip).localeCompare(ipKey(b.ip)),
  link: (a, b) => `${a.link_type ?? "~"}${a.band ?? ""}`.localeCompare(`${b.link_type ?? "~"}${b.band ?? ""}`),
};

/** Online devices first, then by the chosen key, the other way round when `desc` is set. */
export function sortClients(clients, sort = "name", desc = false, volumes = null) {
  const key = SORTS[sort] ?? SORTS.name;
  const sign = desc ? -1 : 1;
  return [...clients].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || sign * key(a, b, volumes));
}

/** The clients the panel shows: the filter, the search, the sorting. */
export function panelClients(data, { filter = "all", query = "", sort = "name", desc = false, now = Date.now(), threshold, volumes = null } = {}) {
  return sortClients(
    (data?.clients ?? []).filter(
      (c) => panelMatches(c, filter, now, threshold) && matches(c, "all", query)
    ),
    sort,
    desc,
    volumes
  );
}

/**
 * The groups of the list: by access point (the box first, those without one last),
 * by band or cable, or one flat list. A group without devices only stays for an access point
 * when nothing narrows the list.
 */
export function panelGroups(data, clients, mode = "ap", narrowed = false) {
  if (mode === "flat") return [{ key: "flat", node: null, clients }];
  if (mode === "band") {
    const by = (key, pred) => ({ key, node: null, clients: clients.filter(pred) });
    return [
      by("lan", (c) => c.link_type === "lan"),
      by("2_4ghz", (c) => c.band === "2_4ghz"),
      by("5ghz", (c) => c.band === "5ghz"),
      by("6ghz", (c) => c.band === "6ghz"),
      by("none", (c) => !c.link_type),
    ].filter((g) => g.clients.length);
  }
  if (mode === "label") {
    const byLabel = (data?.labels ?? [])
      .map((label) => ({
        key: `label:${label.id}`,
        node: null,
        label,
        clients: clients.filter((c) => c.labels?.includes(label.id)),
      }))
      .filter((g) => g.clients.length);
    const without = clients.filter((c) => !(c.labels ?? []).length);
    return [...byLabel, { key: "none", node: null, clients: without }].filter((g) => g.clients.length);
  }
  const groups = (data?.nodes ?? []).map((node) => ({
    key: node.mac,
    node,
    clients: clients.filter((c) => c.ap_mac === node.mac),
  }));
  const known = new Set(groups.map((g) => g.key));
  groups.push({ key: "none", node: null, clients: clients.filter((c) => !known.has(c.ap_mac)) });
  return groups.filter((g) => g.clients.length || (g.node && !narrowed));
}

/** Numbers for the head of an access point: devices online by link, the lowest rate among them. */
export function apSummary(data, node) {
  const online = (data?.clients ?? []).filter((c) => c.online && c.ap_mac === node.mac);
  const rates = online.map((c) => c.rate_download).filter((r) => typeof r === "number" && r > 0);
  return {
    wlan: online.filter((c) => c.link_type === "wlan").length,
    lan: online.filter((c) => c.link_type === "lan").length,
    minRate: rates.length ? Math.round(Math.min(...rates)) : null,
  };
}

/** The part of a #/device/<id> route that names the device; null for any other route. */
export function deviceFromHash(hash) {
  const match = /^#\/device\/([0-9a-f]{12})$/.exec(hash ?? "");
  return match ? match[1] : null;
}

/** Which page a #/… route shows: the network (also for a device), the internet, the diagnosis, the clean-up or the filter. */
export function routeFromHash(hash) {
  const device = deviceFromHash(hash);
  if (device) return { tab: "net", device };
  if (hash === "#/internet") return { tab: "internet", device: null };
  if (hash === "#/addresses") return { tab: "addresses", device: null };
  if (hash === "#/vpn") return { tab: "vpn", device: null };
  if (hash === "#/diagnose") return { tab: "diagnose", device: null };
  if (hash === "#/cleanup") return { tab: "cleanup", device: null };
  if (hash === "#/filter") return { tab: "filter", device: null };
  return { tab: "net", device: null };
}

/** The offline devices that have been gone for at least this many days. */
/** The steps the clean-up page offers, in days. */
export const STALE_STEPS = [3, 7, 14, 30, 90, 365];

/** The step nearest to a number of days. */
export function nearestStep(days) {
  return STALE_STEPS.reduce((best, s) => (Math.abs(s - days) < Math.abs(best - days) ? s : best));
}

export function staleSince(devices, days) {
  return (devices ?? []).filter((d) => d.days >= days);
}

/** Adds a MAC to a list or takes it out, whichever applies. */
export function toggleMac(list, mac) {
  return list.includes(mac) ? list.filter((m) => m !== mac) : [...list, mac];
}

/** Whether the draft of the filter differs from the filter in force; the order of devices does not count. */
export function filterChanged(current, draft) {
  if (!current || !draft) return false;
  const sorted = (list) => [...(list ?? [])].sort().join(",");
  return (
    current.filter_mode !== draft.filter_mode ||
    Boolean(current.ignore_guests) !== Boolean(draft.ignore_guests) ||
    Boolean(current.ignore_private_macs) !== Boolean(draft.ignore_private_macs) ||
    (draft.filter_mode !== "all" && sorted(current.filter_devices) !== sorted(draft.filter_devices))
  );
}

/* The filter menu, the map and the paging of the device page of the panel. */

// always shown as chips; every other filter and the groups are in the "More" menu
export const PRIMARY_FILTERS = ["all", "online", "offline"];

/**
 * What the filter row offers: the fixed chips, the other filters and the groups with something
 * to show (or chosen), and the chosen one when it is not a fixed chip.
 */
export function filterMenu(data, filter, now = Date.now(), threshold = WEAK_LINK_RATIO) {
  const counts = panelCounts(data, now, threshold);
  const others = PANEL_FILTERS.filter((f) => !PRIMARY_FILTERS.includes(f))
    .filter((f) => counts[f] || f === filter)
    .map((id) => ({ id, count: counts[id] }));
  const labels = labelCounts(data);
  const chosenLabel = filter.startsWith("label:") ? filter.slice(6) : null;
  if (chosenLabel && !labels.some((l) => l.id === chosenLabel)) {
    const label = (data?.labels ?? []).find((l) => l.id === chosenLabel);
    if (label) labels.push({ id: label.id, name: label.name, count: 0 });
  }
  return {
    primary: PRIMARY_FILTERS.map((id) => ({ id, count: counts[id] })),
    others,
    labels,
    // how many choices the menu has besides the fixed chips
    available: others.filter((o) => o.count).length + labels.filter((l) => l.count).length,
    active: PRIMARY_FILTERS.includes(filter) ? null : filter,
  };
}

// the lines of an access point in the map, in this order
export const MAP_BUSES = ["lan", "5ghz", "6ghz", "2_4ghz", "wlan", "none"];

/** Which line of the map a device hangs on: the cable, a Wi-Fi band, Wi-Fi without band, or none. */
export function busOf(client) {
  if (client.link_type === "lan") return "lan";
  if (client.link_type === "wlan") return ["2_4ghz", "5ghz", "6ghz"].includes(client.band) ? client.band : "wlan";
  return "none";
}

/** The lines of one access point with their devices, online first and then by name; empty lines stay away. */
export function mapBuses(clients) {
  return MAP_BUSES.map((key) => ({
    key,
    type: key === "lan" ? "lan" : key === "none" ? "none" : "wlan",
    clients: clients
      .filter((c) => busOf(c) === key)
      .sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || a.name.localeCompare(b.name)),
  })).filter((bus) => bus.clients.length);
}

/**
 * The islands of the map: the box and every repeater with the shown devices on their lines and
 * how many the filter hides there, then the devices without a known access point, if there are any.
 */
export function mapIslands(data, shown) {
  const all = data?.clients ?? [];
  const visible = new Set(shown.map((c) => c.id));
  const nodes = data?.nodes ?? [];
  const known = new Set(nodes.map((n) => n.mac));
  const island = (node, at) => {
    const here = all.filter(at);
    const kept = here.filter((c) => visible.has(c.id));
    return { key: node?.mac ?? "none", node, buses: mapBuses(kept), shown: kept.length, hidden: here.length - kept.length };
  };
  const islands = nodes.map((node) => island(node, (c) => c.ap_mac === node.mac));
  const lost = island(null, (c) => !known.has(c.ap_mac));
  if (lost.shown || lost.hidden) islands.push(lost);
  return islands;
}

/** How the line between the box and a repeater looks: cable, Wi-Fi, or unknown where the mesh says nothing. */
export function uplinkStyle(node) {
  const type = node?.uplink?.type;
  return type === "lan" || type === "wlan" ? type : "unknown";
}

/** The devices in the order the page shows them, each once: this is the order for paging. */
export function browseOrder(groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const client of group.clients ?? group.buses?.flatMap((b) => b.clients) ?? []) {
      if (seen.has(client.id)) continue;
      seen.add(client.id);
      out.push(client);
    }
  }
  return out;
}

/** Where a device is in that order, and its neighbours; index -1 when the filter hides it. */
export function pagerFor(list, id) {
  const index = list.findIndex((c) => c.id === id);
  return {
    index,
    total: list.length,
    prev: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
  };
}

/** Up to two letters for the node of a device in the map: the first of the first two words. */
export function initials(name) {
  return String(name ?? "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join("")
    .toUpperCase();
}

/** A rate in kbit/s as "56.3 Mbit/s" (decimal comma by language); a dash for an unknown one. */
export function formatRate(kbit, language) {
  if (typeof kbit !== "number" || !Number.isFinite(kbit)) return "–";
  const format = (value, digits) =>
    value.toLocaleString(language || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (kbit >= 100000) return `${format(kbit / 1000, 0)} Mbit/s`;
  if (kbit >= 1000) return `${format(kbit / 1000, 1)} Mbit/s`;
  return `${format(kbit, 0)} kbit/s`;
}

/** A data volume in bytes: "812 KB", "3.4 MB", "1.27 GB" (decimal units, as the box and providers count). */
export function formatBytes(bytes, language) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString(language || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`;
}

/** The traffic of the last n days up to today ({date: [received, sent]}, local dates), as [received, sent]. */
export function trafficSum(days, n, now = new Date()) {
  let received = 0;
  let sent = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    received += days?.[key]?.[0] ?? 0;
    sent += days?.[key]?.[1] ?? 0;
  }
  return [received, sent];
}

/** The traffic of every device over the last n days: {mac: [received, sent]}; devices without any are left out. */
export function trafficByDevice(traffic, n, now = new Date()) {
  const result = {};
  for (const [mac, days] of Object.entries(traffic ?? {})) {
    const sum = trafficSum(days, n, now);
    if (sum[0] || sum[1]) result[mac] = sum;
  }
  return result;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What the whole line moved per day over the last n days, oldest first, from the traffic of all
 * devices: [{ ts (local midnight, epoch seconds), down, up }]. A day without data counts 0.
 */
export function dailyTotals(traffic, n, now = new Date()) {
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    let down = 0;
    let up = 0;
    for (const days of Object.values(traffic ?? {})) {
      down += days?.[key]?.[0] ?? 0;
      up += days?.[key]?.[1] ?? 0;
    }
    rows.push({ ts: d.getTime() / 1000, down, up });
  }
  return rows;
}

/**
 * What the line moved over the last n days, told honestly: the history may be younger than n days.
 * { rows, since (epoch seconds of the first day with data, or null), available (days with a
 * history, at most n), down, up, average (bytes per day over the available ones), peak (the busiest
 * row or null), change (relative to the n days before, or the average of the days before for n = 1;
 * null when there is nothing to compare with) }.
 */
export function trafficSummary(traffic, n, now = new Date()) {
  const first = Object.values(traffic ?? {})
    .flatMap((days) => Object.keys(days ?? {}))
    .sort()[0];
  const rows = dailyTotals(traffic, n, now);
  const empty = { rows, since: null, available: 0, down: 0, up: 0, average: 0, peak: null, change: null };
  if (!first) return empty;
  const [y, m, d] = first.split("-").map(Number);
  const since = new Date(y, m - 1, d).getTime() / 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const age = Math.round((today - since) / 86400) + 1;
  if (age < 1) return empty;
  const own = rows.filter((r) => r.ts >= since);
  const sum = (list, key) => list.reduce((a, r) => a + r[key], 0);
  const down = sum(own, "down");
  const up = sum(own, "up");
  const peak = own.reduce((best, r) => (r.down + r.up > (best ? best.down + best.up : 0) ? r : best), null);
  let change = null;
  if (n === 1) {
    const before = dailyTotals(traffic, 8, now).slice(0, 7).filter((r) => r.ts >= since);
    const average = before.length ? (sum(before, "down") + sum(before, "up")) / before.length : 0;
    if (average > 0) change = { ratio: (down + up) / average - 1, base: average };
  } else if (age >= 2 * n) {
    const before = dailyTotals(traffic, 2 * n, now).slice(0, n);
    const base = sum(before, "down") + sum(before, "up");
    if (base > 0) change = { ratio: (down + up) / base - 1, base };
  }
  const available = Math.min(n, age);
  return { rows, since, available, down, up, average: (down + up) / available, peak, change };
}

/** What the line moved since the first of this month: { down, up, days } (days with a history). */
export function trafficMonth(traffic, now = new Date()) {
  const rows = dailyTotals(traffic, now.getDate(), now);
  return { down: rows.reduce((a, r) => a + r.down, 0), up: rows.reduce((a, r) => a + r.up, 0), days: rows.length };
}

/**
 * The text of the tooltip of a chart for one point [epoch seconds, value …]: the time and the
 * values as the chart's unit ("bytes", "rate" or a plain unit); two values are down and up.
 */
export function plotText(point, { unit = "", fmt = "", range = "day", unused = "" } = {}, language) {
  if (fmt === "spec") {
    // [MHz or null, dB or null, band]: a tone group the line does not use has no value
    const [mhz, dB, band] = point;
    const one = (n) => n.toLocaleString(language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const where = mhz === null ? "" : `${one(mhz)} MHz · `;
    return dB === null ? `${where}${unused}` : `${where}${one(dB)} dB${band ? ` · ${band}` : ""}`;
  }
  const [ts, ...values] = point;
  const options = {
    day: { hour: "2-digit", minute: "2-digit" },
    week: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
    date: { weekday: "short", day: "numeric", month: "short" },
  }[range] ?? { hour: "2-digit", minute: "2-digit" };
  const when = new Date(ts * 1000).toLocaleString(language, options);
  const show = (v) =>
    typeof v !== "number" ? "–" : fmt === "bytes" ? formatBytes(v, language) : fmt === "rate" ? formatRate(v, language) : `${v.toLocaleString(language)} ${unit}`;
  const arrows = values.length > 1 ? ["↓ ", "↑ "] : [""];
  return `${when} · ${values.map((v, k) => `${arrows[k] ?? ""}${show(v)}`).join(" · ")}`;
}

/** The days the table column of the data volume adds up. */
export const TABLE_DAYS = 7;

/** The bytes per device over the last n days, received and sent together: {mac: bytes}. */
export function sumVolumes(traffic, n, now = new Date()) {
  return Object.fromEntries(
    Object.entries(trafficByDevice(traffic, n, now)).map(([mac, [down, up]]) => [mac, down + up])
  );
}

/** A duration in seconds as its two largest units: "12 d 3 h", "18 h 11 min", "5 min". */
export function formatDuration(seconds, units) {
  if (typeof seconds !== "number" || seconds < 0) return "–";
  const minutes = Math.floor(seconds / 60);
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  const part = (n, unit) => `${n} ${unit}`;
  if (days) return `${part(days, units.d)} ${part(hours, units.h)}`;
  if (hours) return `${part(hours, units.h)} ${part(mins, units.m)}`;
  return part(mins, units.m);
}

/**
 * The lines of the throughput chart: samples [seconds, down, up] as path data in a box of
 * width × height, the larger of both rates at the top. Needs two samples.
 */
export function sparkPaths(samples, width, height) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const first = samples[0][0];
  const span = Math.max(samples[samples.length - 1][0] - first, 1);
  const top = Math.max(1, ...samples.map(([, down, up]) => Math.max(down, up)));
  const line = (index) =>
    samples
      .map((sample, i) => {
        const x = ((sample[0] - first) / span) * width;
        const y = height - (sample[index] / top) * (height - 2) - 1;
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  const down = line(1);
  return { down, up: line(2), area: `${down} L${width} ${height} L0 ${height}Z`, top, seconds: span };
}

/** How far a rate is from the rate of the line, in percent, at most 100; null when either is unknown. */
export function usedPercent(rate, max) {
  if (typeof rate !== "number" || typeof max !== "number" || max <= 0) return null;
  return Math.min(100, Math.round((rate / max) * 100));
}

/** The rows per page the table offers; 0 is all of them. */
export const PAGE_SIZES = [25, 50, 100, 0];
export const DEFAULT_PAGE_SIZE = 50;

/** One page of a list; the page number is kept inside the list, a size of 0 shows everything. */
export function pageSlice(list, page, size) {
  const total = list.length;
  const pages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  const current = Math.min(Math.max(0, page), pages - 1);
  const from = size > 0 ? current * size : 0;
  const to = size > 0 ? Math.min(total, from + size) : total;
  return { items: list.slice(from, to), page: current, pages, from: total ? from + 1 : 0, to, total };
}

/**
 * What the sparkline of a device shows: its signal for a Wi-Fi device, else its rate, and when
 * there is nothing of that (or the device is offline) the hours it was online.
 */
export function historySeries(client, history) {
  const own = history?.[client.mac];
  if (!own) return null;
  const has = (values) => values.some((v) => typeof v === "number");
  if (client.online) {
    const values = client.link_type === "wlan" ? own.signal : own.rate;
    if (has(values)) return { kind: client.link_type === "wlan" ? "signal" : "rate", values };
  }
  return has(own.online) ? { kind: "online", values: own.online.map((v) => v ?? 0) } : null;
}

/** A line through values (null leaves a gap) in a box of width × height; null with fewer than two. */
export function sparkLine(values, width, height, { min, max } = {}) {
  const known = values.filter((v) => typeof v === "number");
  if (known.length < 2) return null;
  const low = min ?? Math.min(...known);
  const span = (max ?? Math.max(...known)) - low || 1;
  const step = width / Math.max(1, values.length - 1);
  let pen = "M";
  let line = "";
  let first = null;
  let last = 0;
  values.forEach((v, i) => {
    if (typeof v !== "number") {
      pen = "M";
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (height - 2 - ((v - low) / span) * (height - 4)).toFixed(1);
    line += `${pen}${x} ${y} `;
    pen = "L";
    first ??= x;
    last = x;
  });
  return { line: line.trim(), area: `${line.trim()} L${last} ${height} L${first} ${height}Z` };
}

/** Min, mean and max of the numbers in a list; null without any. */
export function seriesStats(values) {
  const known = values.filter((v) => typeof v === "number");
  if (!known.length) return null;
  return {
    min: Math.min(...known),
    max: Math.max(...known),
    mean: known.reduce((a, b) => a + b, 0) / known.length,
  };
}

/** One column of the points of a device ([time, online, signal, rate]) as a list of numbers. */
export function pointColumn(points, index) {
  return (points ?? []).map((p) => (typeof p[index] === "number" ? p[index] : null));
}
