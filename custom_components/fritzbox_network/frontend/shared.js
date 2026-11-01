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
