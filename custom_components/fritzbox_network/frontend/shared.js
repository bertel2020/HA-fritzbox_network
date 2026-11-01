/* The parts of the FRITZ!Box Network frontend that need no DOM: used by the cards and the panel. */

// A device is on a weak link when its current rate is below this part of the
// highest rate the link can do, in one direction or the other.
export const WEAK_LINK_RATIO = 1 / 3;

export const BANDS = { "2_4ghz": "2.4 GHz", "5ghz": "5 GHz", "6ghz": "6 GHz" };
// from this channel load on, the radio is shown as busy
export const BUSY_UTILIZATION = 70;


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

/** The chosen devices in the order of the config; null where the integration has no such device. */
export function devicesFor(data, entities) {
  const byEntity = new Map((data?.clients ?? []).map((c) => [c.entity_id, c]));
  return entities.map((entity) => ({ entity, client: byEntity.get(entity) ?? null }));
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

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  signal: (a, b) => (b.signal_dbm ?? -999) - (a.signal_dbm ?? -999),
  rate: (a, b) => (b.rate_download ?? -1) - (a.rate_download ?? -1),
  last: (a, b) => Date.parse(b.last_online ?? 0) - Date.parse(a.last_online ?? 0),
};

/** Online devices first, then by the chosen key. */
export function sortClients(clients, sort = "name") {
  const key = SORTS[sort] ?? SORTS.name;
  return [...clients].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || key(a, b));
}

/** The clients the panel shows: the filter, the search, the sorting. */
export function panelClients(data, { filter = "all", query = "", sort = "name", now = Date.now(), threshold } = {}) {
  return sortClients(
    (data?.clients ?? []).filter(
      (c) => panelMatches(c, filter, now, threshold) && matches(c, "all", query)
    ),
    sort
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

/** Which page a #/… route shows: the network (also for a device), the clean-up or the filter. */
export function routeFromHash(hash) {
  const device = deviceFromHash(hash);
  if (device) return { tab: "net", device };
  if (hash === "#/cleanup") return { tab: "cleanup", device: null };
  if (hash === "#/filter") return { tab: "filter", device: null };
  return { tab: "net", device: null };
}

/** The offline devices that have been gone for at least this many days. */
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
