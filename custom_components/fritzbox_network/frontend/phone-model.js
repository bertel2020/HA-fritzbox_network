/*
 * What the Telephony page reads from the integration FRITZ!Box Telefon (fritzbox_phone): which of
 * its entities belong to this box, and its attributes turned into a model of our own. Only reads;
 * a missing or differently shaped attribute never throws, the part that needs it says so instead.
 * Attribute names as in fritzbox_phone/sensor.py, binary_sensor.py and callmonitor.py.
 */

export const PHONE_DOMAIN = "fritzbox_phone";

/** The translation keys of fritzbox_phone this page uses; several per entry where a list. */
const SINGLE_KEYS = ["call_list", "missed_calls", "calls_today", "talk_time_today", "spam_calls_today", "spam_calls_total", "call_monitor", "ringing", "unread_messages"];
const LIST_KEYS = ["phonebook", "answering_machine", "tam_enabled", "deflection_enabled"];

/** The call types of the box (CALL_TYPE_NAMES); any other value is shown as a call, not dropped. */
export const CALL_TYPES = ["incoming", "missed", "outgoing", "active_incoming", "rejected_incoming", "active_outgoing"];
export const RATINGS = ["A_LEGITIMATE", "B_MISSED", "C_PING", "D_POLL", "E_ADVERTISING", "F_GAMBLE", "G_FRAUD"];
/** What fritzbox_phone lets through to the box as a number (services.py _DIAL_NUMBER). */
export const DIAL_RE = /^[0-9+*#()\-/ ]{1,32}$/;
/** How long a tapped row stays readable in privacy mode, like REVEAL_MS of the card. */
export const REVEAL_MS = 15000;
/** A signed recording address is asked for an hour and used for a bit less (like the card). */
export const SIGN_EXPIRES_S = 3600;
export const SIGN_REUSE_MS = 50 * 60000;
/** How many contacts of a phone book are drawn at most; the search narrows it down. */
export const BOOK_ROWS = 50;

const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const int = (v) => (Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const usable = (s) => Boolean(s) && s.state !== "unavailable" && s.state !== "unknown";

/** Whether fritzbox_phone is loaded: listed in the components and with at least one entity. */
export function phoneLoaded(hass) {
  const components = hass?.config?.components;
  if (!Array.isArray(components) || !components.includes(PHONE_DOMAIN)) return false;
  return Object.values(hass?.entities ?? {}).some((e) => e?.platform === PHONE_DOMAIN);
}

/**
 * The entries of fritzbox_phone, one per device: { key, entryId, deviceId, title, serial, entities }
 * with entities[key] an entity id (or a list for phone books, answering machines and switches).
 */
export function phoneEntries(hass) {
  const groups = new Map();
  for (const [id, e] of Object.entries(hass?.entities ?? {})) {
    if (e?.platform !== PHONE_DOMAIN) continue;
    const key = e.device_id ?? "";
    if (!groups.has(key)) {
      const device = (key && hass.devices?.[key]) || {};
      const ident = (Array.isArray(device.identifiers) ? device.identifiers : []).find((i) => Array.isArray(i) && i[0] === PHONE_DOMAIN);
      const entities = Object.fromEntries(LIST_KEYS.map((k) => [k, []]));
      groups.set(key, {
        key,
        deviceId: key || null,
        entryId: ident?.[1] ?? (Array.isArray(device.config_entries) ? device.config_entries[0] : null) ?? null,
        title: str(device.name_by_user) || str(device.name),
        serial: str(device.serial_number),
        entities,
      });
    }
    const g = groups.get(key);
    const tk = e.translation_key;
    if (SINGLE_KEYS.includes(tk)) g.entities[tk] ??= id;
    else if (LIST_KEYS.includes(tk)) g.entities[tk].push(id);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** The serial numbers of this box: the identifiers and serial of the devices of our own entry. */
export function ownSerials(hass, entryId) {
  const serials = new Set();
  for (const d of Object.values(hass?.devices ?? {})) {
    if (!Array.isArray(d?.config_entries) || !d.config_entries.includes(entryId)) continue;
    if (d.serial_number) serials.add(String(d.serial_number));
    for (const i of Array.isArray(d.identifiers) ? d.identifiers : []) if (Array.isArray(i) && i[0] === "fritzbox_network") serials.add(String(i[1]));
  }
  return serials;
}

/**
 * The entry of fritzbox_phone for this box: the one with the same serial number; the only one
 * when none matches ("other": maybe another box); with several and no match the chosen one or the
 * first, and the page offers the choice. how: "match" | "only" | "choose".
 */
export function pickEntry(entries, serials, chosen = null) {
  if (!entries?.length) return { entry: null, how: "none", entries: [] };
  const match = entries.filter((e) => e.serial && serials?.has(e.serial));
  if (match.length) return { entry: match.find((e) => e.key === chosen) ?? match[0], how: match.length > 1 ? "choose" : "match", entries: match.length > 1 ? match : entries };
  if (entries.length === 1) return { entry: entries[0], how: "only", entries };
  return { entry: entries.find((e) => e.key === chosen) ?? entries[0], how: "choose", entries };
}

// ---------- formats of the box ----------

/** The box writes dates as "07.11.26 14:12" (DD.MM.YY HH:MM, local time of the box); null when unreadable. */
export function parseAvmDate(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str(text).trim());
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** The duration of the call list is "h:mm" (minutes, rounded up by the box), not m:ss: "0:31" is 31 minutes. */
export function callMinutes(text) {
  const m = /^(\d+):(\d{1,2})$/.exec(str(text).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export const isOutgoing = (type) => type === "outgoing" || type === "active_outgoing";
/** Only digits and a leading plus: the same number written with or without spaces counts once. */
export const digits = (n) => str(n).replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
/** Whether a number may be dialled: digits in it and only what the service accepts. */
export const dialable = (n) => /\d/.test(str(n)) && DIAL_RE.test(str(n).trim());
/** A shortened number for privacy mode: "0171 ••• 78". */
export function shortNumber(n) {
  const d = digits(n);
  return d.length > 6 ? `${d.slice(0, 4)} ••• ${d.slice(-2)}` : "•••";
}

/** One call of the list in our own shape; fields that are missing become empty, never undefined. */
export function parseCall(raw, i = 0) {
  const c = raw && typeof raw === "object" ? raw : {};
  const type = str(c.type);
  const out = isOutgoing(type);
  const number = out ? str(c.called_number) || str(c.called) : str(c.caller_number) || str(c.caller);
  const own = out ? str(c.caller_number) || str(c.caller) : str(c.called_number) || str(c.called);
  const date = parseAvmDate(c.date);
  return {
    id: c.id ?? `i${i}`,
    type: CALL_TYPES.includes(type) ? type : "other",
    rawType: type,
    name: str(c.name),
    number,
    own,
    device: str(c.device),
    date,
    dateText: str(c.date),
    minutes: callMinutes(c.duration),
    durationText: str(c.duration),
    isFax: c.is_fax === true,
    isTam: c.is_answering_machine === true,
    hasRecording: c.has_recording === true,
    tamIndex: int(c.tam_index),
    tamMessageIndex: int(c.tam_message_index),
    area: str(c.area_name),
    isSpam: c.is_spam === true,
    spamConfidence: num(c.spam_confidence),
    spamRating: str(c.spam_rating),
    spamLocation: str(c.spam_location),
    reverseName: str(c.reverse_name),
    reverseCategory: str(c.reverse_category),
    vip: false,
  };
}

/** The name to show: the phone book, the reverse lookup, the number, or nothing (then "unknown"). */
export const displayName = (c) => c.name || c.reverseName || c.number || "";

/** The kind of a row for its icon: spam before the answering machine before missed. */
export function callKind(c) {
  if (c.isSpam) return "spam";
  if (c.isTam) return "tam";
  if (c.type === "missed" || c.type === "rejected_incoming") return "miss";
  if (isOutgoing(c.type)) return "out";
  return "in";
}

/** One series per call for the statistics: spam first; missed includes calls the answering machine took. */
export function callCategory(c) {
  if (c.isSpam) return "spam";
  if (isOutgoing(c.type)) return "out";
  if (c.type === "missed" || c.type === "rejected_incoming" || c.isTam) return "miss";
  return "in";
}

/** Connected calls: incoming or outgoing and not the answering machine. */
export const connected = (c) => (c.type === "incoming" || c.type === "outgoing") && !c.isTam;

/**
 * The call list from its state: { ok, calls, privacy } with the newest first, unreadable dates at
 * the end. ok is false where the attribute calls is missing (an old or different version).
 */
export function parseCallList(stateObj, contacts = []) {
  const list = stateObj?.attributes?.calls;
  if (!Array.isArray(list)) return { ok: false, calls: [], privacy: stateObj?.attributes?.privacy_mode === true };
  const vip = new Set(contacts.filter((c) => c.vip).flatMap((c) => c.numbers.map((n) => digits(n.number))));
  const calls = list.map((raw, i) => {
    const c = parseCall(raw, i);
    c.vip = Boolean(c.number) && vip.has(digits(c.number));
    return c;
  });
  calls.sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity));
  return { ok: true, calls, privacy: stateObj.attributes.privacy_mode === true };
}

/** The part of a friendly name after the name of the device: "FRITZ!Box 7590 Familie" → "Familie". */
export function ownName(stateObj, deviceTitle) {
  const name = str(stateObj?.attributes?.friendly_name);
  if (deviceTitle && name.startsWith(`${deviceTitle} `)) return name.slice(deviceTitle.length + 1);
  return name;
}

/** One answering machine: { ok, entityId, name, tamIndex, enabled, running, capacity, total, privacy, messages }. */
export function parseTam(entityId, stateObj, deviceTitle = "") {
  const a = stateObj?.attributes ?? {};
  const list = Array.isArray(a.messages) ? a.messages : null;
  const messages = (list ?? []).map((raw) => {
    const m = raw && typeof raw === "object" ? raw : {};
    return {
      index: int(m.index),
      key: str(m.key),
      name: str(m.name),
      number: str(m.number),
      called: str(m.called),
      date: parseAvmDate(m.date),
      dateText: str(m.date),
      duration: str(m.duration),
      isNew: m.new === true,
      inPhonebook: m.in_phonebook === true,
      hasRecording: m.has_recording === true && Boolean(str(m.recording_path)),
      recordingPath: str(m.recording_path),
      area: str(m.area_name),
      isSpam: m.is_spam === true,
      spamConfidence: num(m.spam_confidence),
      spamRating: str(m.spam_rating),
      reverseName: str(m.reverse_name),
      reverseCategory: str(m.reverse_category),
    };
  });
  return {
    ok: Boolean(list),
    entityId,
    name: ownName(stateObj, deviceTitle) || entityId,
    tamIndex: int(a.tam_index),
    enabled: typeof a.enabled === "boolean" ? a.enabled : null,
    running: typeof a.running === "boolean" ? a.running : null,
    capacity: num(a.capacity_minutes_remaining),
    total: int(a.total_messages) ?? messages.length,
    privacy: a.privacy_mode === true,
    available: usable(stateObj),
    messages,
  };
}

/** One phone book: { ok, entityId, name, count, privacy, contacts } with VIP first, then by name. */
export function parseBook(entityId, stateObj, deviceTitle = "") {
  const a = stateObj?.attributes ?? {};
  const list = Array.isArray(a.contacts) ? a.contacts : null;
  const contacts = (list ?? [])
    .map((raw) => {
      const c = raw && typeof raw === "object" ? raw : {};
      return {
        name: str(c.name),
        vip: c.vip === true,
        numbers: (Array.isArray(c.numbers) ? c.numbers : []).map((n) => ({ number: str(n?.number), type: str(n?.type) })).filter((n) => n.number),
      };
    })
    .sort((x, y) => Number(y.vip) - Number(x.vip) || x.name.localeCompare(y.name, "de"));
  return {
    ok: Boolean(list),
    entityId,
    name: ownName(stateObj, deviceTitle) || entityId,
    count: num(stateObj?.state) ?? contacts.length,
    privacy: a.privacy_mode === true,
    available: usable(stateObj),
    contacts,
  };
}

/** The contacts of a book that match a search over name and number. */
export function searchBook(contacts, query) {
  const q = str(query).trim().toLowerCase();
  if (!q) return contacts;
  const qd = q.replace(/\s/g, "");
  return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.numbers.some((n) => digits(n.number).includes(qd) || n.number.toLowerCase().replace(/\s/g, "").includes(qd)));
}

/** The call monitor: { present, connected, state, ... } from sensor.*_anrufmonitor; never masked. */
export function parseMonitor(stateObj) {
  if (!stateObj) return { present: false, connected: false, state: "idle" };
  const a = stateObj.attributes ?? {};
  const state = ["idle", "ringing", "dialing", "talking"].includes(stateObj.state) ? stateObj.state : "idle";
  return {
    present: true,
    connected: stateObj.state !== "unavailable",
    state,
    from: str(a.from),
    fromName: str(a.from_name) || str(a.reverse_name),
    to: str(a.to),
    toName: str(a.to_name),
    with: str(a.with),
    withName: str(a.with_name),
    vip: a.vip === true,
    area: str(a.area_name),
    device: str(a.device),
    initiated: str(a.initiated),
    accepted: str(a.accepted),
    isSpam: a.is_spam === true,
    spamConfidence: num(a.spam_confidence),
    spamRating: str(a.spam_rating),
  };
}

/** The calls of the list filtered as the chips say and by a search over name, lookup, place and number. */
export function filterCalls(calls, filter = "all", query = "") {
  const q = str(query).trim().toLowerCase().replace(/\s/g, "");
  return calls.filter((c) => {
    if (filter === "missed" && !(c.type === "missed" || c.type === "rejected_incoming")) return false;
    if (filter === "incoming" && !(c.type === "incoming" || c.type === "active_incoming")) return false;
    if (filter === "outgoing" && !isOutgoing(c.type)) return false;
    if (filter === "spam" && !c.isSpam) return false;
    if (!q) return true;
    return [c.name, c.reverseName, c.area, c.number].some((v) => v.toLowerCase().replace(/\s/g, "").includes(q));
  });
}

export const CALL_FILTERS = ["all", "missed", "incoming", "outgoing", "spam"];

/** How many calls each chip would show. */
export function filterCounts(calls) {
  return Object.fromEntries(CALL_FILTERS.map((f) => [f, filterCalls(calls, f).length]));
}

/** Whether privacy mode is on: any of the entities read carries privacy_mode true (like the card). */
export const privacyOn = (...parts) => parts.flat().some((p) => p?.privacy === true);

/** The number of a sensor, or null where it is missing, unavailable or not a number. */
function sensorNumber(hass, id) {
  const s = id ? hass?.states?.[id] : null;
  return usable(s) ? num(s.state) : null;
}

/**
 * A state as it can be shown: the current one, or where it is unavailable the last good one seen
 * (the attributes are gone while unavailable), with the time of it. cache: Map entity id → state.
 */
function lastGood(hass, id, cache) {
  const s = id ? hass?.states?.[id] : undefined;
  if (s && usable(s)) {
    cache?.set(id, s);
    return { state: s, staleAt: null, offline: false };
  }
  const old = cache?.get(id);
  if (s && old) return { state: old, staleAt: Date.parse(old.last_updated ?? old.last_changed ?? "") || null, offline: true };
  return { state: s ?? null, staleAt: null, offline: Boolean(s) };
}

/** The switch of an answering machine: same name plus a word, or the only one where there is one of each. */
function tamSwitch(hass, tam, switches, count) {
  const name = str(hass?.states?.[tam.entityId]?.attributes?.friendly_name);
  const found = name && switches.find((id) => str(hass?.states?.[id]?.attributes?.friendly_name).startsWith(`${name} `));
  if (found) return found;
  return count === 1 && switches.length === 1 ? switches[0] : null;
}

/**
 * The whole page model from Home Assistant: which entry, its call list, today's numbers, the
 * answering machines, phone books and the call monitor. ownEntryId is the entry of this panel,
 * chosen the entry key the user picked, cache keeps the last good states (see lastGood).
 */
export function readPhone(hass, ownEntryId, { chosen = null, cache = null } = {}) {
  const found = phoneLoaded(hass);
  const entries = found ? phoneEntries(hass) : [];
  const pick = pickEntry(entries, ownSerials(hass, ownEntryId), chosen);
  const entry = pick.entry;
  if (!found || !entry) return { found: false, pick, entry: null };
  const ids = entry.entities;
  const title = entry.title;
  const books = ids.phonebook.map((id) => {
    const got = lastGood(hass, id, cache);
    return { ...parseBook(id, got.state, title), staleAt: got.staleAt, offline: got.offline, loading: !got.state };
  });
  const contacts = books.flatMap((b) => b.contacts);
  const tams = ids.answering_machine.map((id) => {
    const got = lastGood(hass, id, cache);
    const tam = { ...parseTam(id, got.state, title), staleAt: got.staleAt, offline: got.offline, loading: !got.state };
    tam.switchId = tamSwitch(hass, tam, ids.tam_enabled, ids.answering_machine.length);
    const sw = tam.switchId ? hass.states?.[tam.switchId] : null;
    tam.switchOn = sw && usable(sw) ? sw.state === "on" : null;
    return tam;
  });
  const listId = ids.call_list ?? null;
  const got = listId ? lastGood(hass, listId, cache) : { state: null, staleAt: null, offline: false };
  const list = got.state ? parseCallList(got.state, contacts) : { ok: false, calls: [], privacy: false };
  const today = hass?.states?.[ids.calls_today];
  const unreadState = hass?.states?.[ids.unread_messages];
  const unread = usable(unreadState) ? int(unreadState.attributes?.count) ?? tams.reduce((s, t) => s + t.messages.filter((m) => m.isNew).length, 0) : tams.reduce((s, t) => s + t.messages.filter((m) => m.isNew).length, 0);
  const monitor = parseMonitor(ids.call_monitor ? hass?.states?.[ids.call_monitor] : null);
  return {
    found: true,
    pick,
    entry,
    listId,
    missing: !listId,
    loading: Boolean(listId) && !got.state,
    offline: got.offline,
    staleAt: got.staleAt,
    list,
    today: {
      calls: usable(today) ? { n: num(today.state), in: int(today.attributes?.incoming), out: int(today.attributes?.outgoing), missed: int(today.attributes?.missed) } : null,
      talk: sensorNumber(hass, ids.talk_time_today),
      hasSpam: Boolean(ids.spam_calls_today || ids.spam_calls_total),
      spamToday: sensorNumber(hass, ids.spam_calls_today),
      spamTotal: sensorNumber(hass, ids.spam_calls_total),
    },
    tams,
    books,
    contacts,
    monitor,
    unread,
    ringing: monitor.state === "ringing",
    privacy: privacyOn(list, books, tams),
  };
}

// ---------- statistics ----------

const DAY = 86400000;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

export const PERIODS = ["today", "7", "30", "all"];
export const SERIES = ["in", "out", "miss", "spam"];

/** The sums of a set of calls. */
export function summarize(list) {
  const conn = list.filter(connected);
  const talk = conn.reduce((s, c) => s + c.minutes, 0);
  const inbound = list.filter((c) => !isOutgoing(c.type));
  const missed = inbound.filter((c) => callCategory(c) === "miss").length;
  return {
    n: list.length,
    talk,
    conn: conn.length,
    avg: conn.length ? talk / conn.length : 0,
    inbound: inbound.length,
    missed,
    rate: inbound.length ? missed / inbound.length : 0,
    spam: list.filter((c) => c.isSpam).length,
    tam: list.filter((c) => c.isTam).length,
  };
}

/** The most frequent numbers, grouped by their digits: top 5 by calls, then by talk time. */
export function topNumbers(list, pick = "in", limit = 5) {
  const map = new Map();
  for (const c of list) {
    if (pick === "in" ? isOutgoing(c.type) : !isOutgoing(c.type)) continue;
    const key = digits(c.number);
    if (!key) continue;
    const e = map.get(key) ?? { key, number: c.number, name: "", vip: false, n: 0, talk: 0, spam: false, area: "" };
    e.n += 1;
    if (connected(c)) e.talk += c.minutes;
    if (c.name) e.name = c.name;
    e.vip ||= c.vip;
    e.spam ||= c.isSpam;
    e.area ||= c.area;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.n - a.n || b.talk - a.talk || a.key.localeCompare(b.key)).slice(0, limit);
}

/** Calls per own number: incoming by called_number, outgoing by caller_number. */
export function perLine(list) {
  const map = new Map();
  for (const c of list) {
    if (!c.own) continue;
    const key = digits(c.own) || c.own;
    const e = map.get(key) ?? { key, number: c.own, n: 0 };
    e.n += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.n - a.n);
}

/** Weekday (Monday first) × block of three hours, a count in each cell. */
export function heatGrid(list) {
  const grid = Array.from({ length: 7 }, () => Array(8).fill(0));
  for (const c of list) if (c.date) grid[(c.date.getDay() + 6) % 7][Math.floor(c.date.getHours() / 3)] += 1;
  return grid;
}

/** The columns of the bar chart: today per hour, up to 31 days per day, beyond per week. */
export function buckets(list, period, from, to) {
  const len = daysBetween(from, to);
  let out;
  let unit;
  if (period === "today") {
    unit = "hour";
    out = Array.from({ length: 24 }, (_, h) => ({ start: new Date(from.getFullYear(), from.getMonth(), from.getDate(), h), end: new Date(from.getFullYear(), from.getMonth(), from.getDate(), h + 1), hour: h }));
  } else if (len > 31) {
    unit = "week";
    const n = Math.ceil(len / 7);
    out = Array.from({ length: n }, (_, i) => ({ start: addDays(from, i * 7), end: i === n - 1 ? to : addDays(from, i * 7 + 7) }));
  } else {
    unit = "day";
    out = Array.from({ length: len }, (_, i) => ({ start: addDays(from, i), end: addDays(from, i + 1) }));
  }
  for (const b of out) {
    const inside = list.filter((c) => c.date >= b.start && c.date < b.end);
    for (const s of SERIES) b[s] = inside.filter((c) => callCategory(c) === s).length;
    b.total = inside.length;
  }
  return { unit, list: out };
}

/**
 * Everything the statistics view shows, counted only from what the call list holds now.
 * period: today | 7 | 30 | all; now: the current time. compare: { kind: "full" | "partial" |
 * "none" | "noneAll", cover, len } says how far the list reaches back for the period before.
 */
export function phoneStats(calls, { period = "7", now = new Date() } = {}) {
  const dated = calls.filter((c) => c.date);
  if (!dated.length) return { empty: true, total: calls.length };
  const today = dayStart(now);
  const first = dated.reduce((a, c) => (c.date < a ? c.date : a), dated[0].date);
  const spanDays = daysBetween(first, today) + 1;
  const to = addDays(today, 1);
  const from = period === "today" ? today : period === "7" ? addDays(today, -6) : period === "30" ? addDays(today, -29) : dayStart(first);
  const len = daysBetween(from, to);
  const inP = dated.filter((c) => c.date >= from && c.date < to);
  const prevFrom = addDays(from, -len);
  let prev = null;
  let compare;
  if (period === "all") compare = { kind: "noneAll" };
  else if (prevFrom < dayStart(first)) {
    const cover = Math.max(0, daysBetween(first, from));
    if (cover >= len / 2 && cover > 0) {
      prev = summarize(dated.filter((c) => c.date >= prevFrom && c.date < from));
      compare = { kind: "partial", cover, len };
    } else compare = { kind: "none" };
  } else {
    prev = summarize(dated.filter((c) => c.date >= prevFrom && c.date < from));
    compare = { kind: "full", len };
  }
  return {
    empty: false,
    total: calls.length,
    undated: calls.length - dated.length,
    first,
    spanDays,
    from,
    to,
    len,
    perDay: len > 1 ? inP.length / Math.min(len, spanDays) : null,
    short: spanDays <= 7,
    sum: summarize(inP),
    prev,
    compare,
    bars: buckets(inP, period, from, to),
    heat: heatGrid(inP),
    lines: perLine(inP),
    topIn: topNumbers(inP, "in"),
    topOut: topNumbers(inP, "out"),
  };
}
