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

/** One message of an answering machine, as the sensor lists it and the command tams answers. */
export function parseMessage(raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  return {
    index: int(m.index),
    id: str(m.id),
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
}

/** One answering machine: { ok, entityId, name, tamIndex, enabled, running, capacity, total, privacy, messages }. */
export function parseTam(entityId, stateObj, deviceTitle = "") {
  const a = stateObj?.attributes ?? {};
  const list = Array.isArray(a.messages) ? a.messages : null;
  const messages = (list ?? []).map(parseMessage);
  return {
    ok: Boolean(list),
    entityId,
    target: true,
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

/** Contacts as the sensor lists them and the command contacts answers: VIP first, then by name. */
export function parseContacts(list) {
  return (Array.isArray(list) ? list : [])
    .map((raw) => {
      const c = raw && typeof raw === "object" ? raw : {};
      return {
        name: str(c.name),
        vip: c.vip === true,
        numbers: (Array.isArray(c.numbers) ? c.numbers : []).map((n) => ({ number: str(n?.number), type: str(n?.type) })).filter((n) => n.number),
      };
    })
    .sort((x, y) => Number(y.vip) - Number(x.vip) || x.name.localeCompare(y.name, "de"));
}

/**
 * One phone book: { ok, entityId, phonebookId, name, count, privacy, contacts }. phonebookId is the
 * id add_contact takes; newer versions of fritzbox_phone carry it as an attribute, older ones not (null).
 */
export function parseBook(entityId, stateObj, deviceTitle = "") {
  const a = stateObj?.attributes ?? {};
  const list = Array.isArray(a.contacts) ? a.contacts : null;
  const contacts = parseContacts(list);
  return {
    ok: Boolean(list),
    entityId,
    phonebookId: int(a.phonebook_id),
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

/**
 * The calls of the list filtered as the chips say and by a search over name, lookup, place and
 * number. isBlocked (number → boolean) serves the chip "blocked", only there with a block list.
 */
export function filterCalls(calls, filter = "all", query = "", isBlocked = null) {
  const q = str(query).trim().toLowerCase().replace(/\s/g, "");
  return calls.filter((c) => {
    if (filter === "missed" && !(c.type === "missed" || c.type === "rejected_incoming")) return false;
    if (filter === "incoming" && !(c.type === "incoming" || c.type === "active_incoming")) return false;
    if (filter === "outgoing" && !isOutgoing(c.type)) return false;
    if (filter === "spam" && !c.isSpam) return false;
    if (filter === "blocked" && !(isBlocked && c.number && isBlocked(c.number))) return false;
    if (!q) return true;
    return [c.name, c.reverseName, c.area, c.number].some((v) => v.toLowerCase().replace(/\s/g, "").includes(q));
  });
}

export const CALL_FILTERS = ["all", "missed", "incoming", "outgoing", "spam"];

/** How many calls each chip would show; with isBlocked also the chip "blocked". */
export function filterCounts(calls, isBlocked = null) {
  const counts = Object.fromEntries(CALL_FILTERS.map((f) => [f, filterCalls(calls, f).length]));
  if (isBlocked) counts.blocked = filterCalls(calls, "blocked", "", isBlocked).length;
  return counts;
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

/** The entity of a list (switches, sensors of answering machines) that carries this tam_index. */
function byTamIndex(hass, ids, index) {
  if (index === null || index === undefined) return null;
  return ids.find((id) => int(hass?.states?.[id]?.attributes?.tam_index) === index) ?? null;
}

/**
 * The switch of an answering machine: the one with the same tam_index (newer versions of
 * fritzbox_phone), else same name plus a word, or the only one where there is one of each.
 */
function tamSwitch(hass, tam, switches, count) {
  const same = byTamIndex(hass, switches, tam.tamIndex);
  if (same) return same;
  const name = str(hass?.states?.[tam.entityId]?.attributes?.friendly_name);
  const found = name && switches.find((id) => str(hass?.states?.[id]?.attributes?.friendly_name).startsWith(`${name} `));
  if (found) return found;
  return count === 1 && switches.length === 1 ? switches[0] : null;
}

function withSwitch(hass, tam, ids, count) {
  tam.switchId = tamSwitch(hass, tam, ids.tam_enabled, count);
  const sw = tam.switchId ? hass?.states?.[tam.switchId] : null;
  tam.switchOn = sw && usable(sw) ? sw.state === "on" : null;
  return tam;
}

/** Today's numbers, the call monitor and the badge: plain sensor states in both ways of reading. */
function sensorParts(hass, ids, tams) {
  const today = hass?.states?.[ids.calls_today];
  const unreadState = hass?.states?.[ids.unread_messages];
  const counted = tams.reduce((s, t) => s + (t.newCount ?? t.messages.filter((m) => m.isNew).length), 0);
  const unread = usable(unreadState) ? int(unreadState.attributes?.count) ?? counted : counted;
  const monitor = parseMonitor(ids.call_monitor ? hass?.states?.[ids.call_monitor] : null);
  return {
    today: {
      calls: usable(today) ? { n: num(today.state), in: int(today.attributes?.incoming), out: int(today.attributes?.outgoing), missed: int(today.attributes?.missed) } : null,
      talk: sensorNumber(hass, ids.talk_time_today),
      hasSpam: Boolean(ids.spam_calls_today || ids.spam_calls_total),
      spamToday: sensorNumber(hass, ids.spam_calls_today),
      spamTotal: sensorNumber(hass, ids.spam_calls_total),
    },
    monitor,
    unread,
    ringing: monitor.state === "ringing",
  };
}

/**
 * The whole page model from the entities (stage 1, and the fallback for versions of fritzbox_phone
 * without the websocket commands): which entry, its call list, today's numbers, the answering
 * machines, phone books and the call monitor. ownEntryId is the entry of this panel, chosen the
 * entry key the user picked, cache keeps the last good states (see lastGood).
 */
export function readPhone(hass, ownEntryId, { chosen = null, cache = null } = {}) {
  const found = phoneLoaded(hass);
  const entries = found ? phoneEntries(hass) : [];
  const pick = pickEntry(entries, ownSerials(hass, ownEntryId), chosen);
  const entry = pick.entry;
  if (!found || !entry) return { found: false, api: "entities", pick, entry: null };
  const ids = entry.entities;
  const title = entry.title;
  const books = ids.phonebook.map((id) => {
    const got = lastGood(hass, id, cache);
    return { ...parseBook(id, got.state, title), staleAt: got.staleAt, offline: got.offline, loading: !got.state };
  });
  const contacts = books.flatMap((b) => b.contacts);
  const tams = ids.answering_machine.map((id) => {
    const got = lastGood(hass, id, cache);
    return withSwitch(hass, { ...parseTam(id, got.state, title), staleAt: got.staleAt, offline: got.offline, loading: !got.state }, ids, ids.answering_machine.length);
  });
  const listId = ids.call_list ?? null;
  const got = listId ? lastGood(hass, listId, cache) : { state: null, staleAt: null, offline: false };
  const list = got.state ? parseCallList(got.state, contacts) : { ok: false, calls: [], privacy: false };
  return {
    found: true,
    api: "entities",
    pick,
    entry,
    listId,
    missing: !listId,
    loading: Boolean(listId) && !got.state,
    offline: got.offline,
    staleAt: got.staleAt,
    list,
    ...sensorParts(hass, ids, tams),
    tams,
    books,
    contacts,
    blocked: null,
    privacy: privacyOn(list, books, tams),
  };
}

// ---------- stage 2: the websocket commands of fritzbox_phone ----------

/** The days the command stats is asked for, per period of the page (0 = everything held). */
export const PERIOD_DAYS = { today: 1, 7: 7, 30: 30, 90: 90, 365: 365, all: 0 };
/** The periods with the call history of fritzbox_phone switched on; without it those of stage 1. */
export const HISTORY_PERIODS = ["today", "7", "30", "90", "365", "all"];
/** The parts of the page the commands answer; stats only for the statistics view. */
export const WS_PARTS = ["calls", "tams", "phonebooks", "blocklist"];

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const LIST_EMPTY = () => Object.fromEntries(LIST_KEYS.map((k) => [k, []]));

/** The code of a refused command (unknown_command, not_found, box_request_failed …); "" without one. */
export const wsCode = (err) => str(err?.code ?? err?.error?.code);

/** An ISO 8601 time as fritzbox_phone writes it; null when missing or unreadable. */
export function parseIso(text) {
  const s = str(text);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A day "2026-01-10" as local midnight; null when unreadable. */
export function parseDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(text));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getDate() === Number(m[3]) ? d : null;
}

/** The answer of fritzbox_phone/entries: one per config entry, keyed by its entry id. */
export function parseWsEntries(result) {
  return arr(obj(result).entries)
    .map(obj)
    .filter((e) => str(e.entry_id))
    .map((e) => ({
      key: str(e.entry_id),
      entryId: str(e.entry_id),
      title: str(e.title) || str(e.host),
      serial: str(e.serial),
      loaded: e.loaded !== false,
      privacy: e.privacy_mode === true,
      historyDays: int(e.history_days) ?? 0,
      callListDays: int(e.call_list_days),
      callListMax: int(e.call_list_max),
      version: str(e.version),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * One call of the command calls: the fields of the sensor plus a stable id, an ISO start time,
 * vip and in_list. A recording is only offered while the call is still in the box's list.
 */
export function parseWsCall(raw, i = 0) {
  const r = obj(raw);
  const c = parseCall(r, i);
  c.id = str(r.id) || c.id;
  c.boxId = str(r.box_id);
  c.date = parseIso(r.datetime) ?? c.date;
  c.vip = r.vip === true;
  c.inList = r.in_list !== false;
  if (!c.inList) {
    c.hasRecording = false;
    c.tamMessageIndex = null;
  }
  return c;
}

/** A part of the page as fetched: { ok, result } or { ok: false, code }; undefined while not asked yet. */
const partOk = (part) => Boolean(part?.ok);

/** The answer of the command calls: { ok, calls, privacy, window, total }; ok false with the error code. */
export function parseWsCalls(part) {
  if (!partOk(part)) return { ok: false, reason: part ? "na" : "loading", code: part?.code ?? "", calls: [], privacy: false };
  const r = obj(part.result);
  if (!Array.isArray(r.calls)) return { ok: false, reason: "na", code: "", calls: [], privacy: false };
  const calls = r.calls.map(parseWsCall);
  calls.sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity));
  const w = obj(r.window);
  return {
    ok: true,
    calls,
    privacy: r.privacy_mode === true,
    window: { days: int(w.days), max: int(w.max), oldest: parseIso(w.oldest), source: str(w.source) },
    total: int(r.total) ?? calls.length,
  };
}

/** The sensor of an answering machine for its tam_index (the services name it); the only one where there is one of each. */
function tamEntity(hass, sensors, index, count) {
  return byTamIndex(hass, sensors, index) ?? (count === 1 && sensors.length === 1 ? sensors[0] : null);
}

/**
 * The answer of the command tams. The services for messages still need the entity id of the
 * sensor: found over tam_index; target is false (actions locked) where none is found.
 */
export function parseWsTams(part, hass, ids) {
  if (!partOk(part)) return { ok: false, reason: part ? "na" : "loading", tams: [], privacy: false };
  const r = obj(part.result);
  const list = arr(r.tams).map(obj);
  const tams = list.map((raw, i) => {
    const index = int(raw.index);
    const entityId = tamEntity(hass, ids.answering_machine, index, list.length);
    const messages = arr(raw.messages).map(parseMessage);
    const tam = {
      ok: Array.isArray(raw.messages),
      entityId: entityId ?? `tam:${index ?? i}`,
      target: Boolean(entityId),
      name: str(raw.name) || `${index ?? i}`,
      tamIndex: index,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
      running: typeof raw.running === "boolean" ? raw.running : null,
      capacity: num(raw.capacity_minutes_remaining),
      total: int(raw.total) ?? messages.length,
      newCount: int(raw.new_count),
      privacy: r.privacy_mode === true,
      available: true,
      staleAt: null,
      offline: false,
      loading: false,
      messages,
    };
    return withSwitch(hass, tam, ids, list.length);
  });
  return { ok: true, tams, privacy: r.privacy_mode === true };
}

/** The answers of phonebooks and contacts: one book per phone book with its real id. */
export function parseWsBooks(part, contacts = {}) {
  if (!partOk(part)) return { ok: false, reason: part ? "na" : "loading", books: [], privacy: false };
  const r = obj(part.result);
  const books = arr(r.phonebooks)
    .map(obj)
    .filter((pb) => int(pb.id) !== null)
    .map((pb) => {
      const id = int(pb.id);
      const got = contacts?.[id];
      const answer = obj(got?.result);
      const list = partOk(got) && Array.isArray(answer.contacts) ? answer.contacts : null;
      const parsed = parseContacts(list);
      return {
        ok: Boolean(list),
        entityId: `pb:${id}`,
        phonebookId: id,
        name: str(pb.name) || String(id),
        count: int(pb.count) ?? parsed.length,
        privacy: r.privacy_mode === true || answer.privacy_mode === true,
        available: true,
        staleAt: null,
        offline: false,
        loading: !got,
        contacts: parsed,
      };
    });
  return { ok: true, books, privacy: r.privacy_mode === true };
}

/**
 * The answer of the command blocklist: { known, ok, supported, numbers (a Set of digits), entries,
 * privacy }. known is false while not asked yet; ok false where the box did not answer.
 */
export function parseBlocklist(part) {
  if (!part) return { known: false, ok: false, supported: false, numbers: new Set(), entries: [], privacy: false };
  if (!part.ok) return { known: true, ok: false, supported: true, code: part.code ?? "", numbers: new Set(), entries: [], privacy: false };
  const r = obj(part.result);
  const entries = arr(r.entries)
    .map(obj)
    .map((e) => ({ name: str(e.name), numbers: arr(e.numbers).map(str).filter(Boolean) }))
    .filter((e) => e.numbers.length);
  const all = arr(r.numbers).map(str).filter(Boolean);
  // numbers without an entry (an older answer) become entries of their own
  const listed = new Set(entries.flatMap((e) => e.numbers.map(digits)));
  for (const n of all) if (!listed.has(digits(n))) entries.push({ name: "", numbers: [n] });
  return {
    known: true,
    ok: true,
    supported: r.supported === true,
    numbers: new Set([...all, ...entries.flatMap((e) => e.numbers)].map(digits).filter(Boolean)),
    entries,
    privacy: r.privacy_mode === true,
  };
}

/** Whether a number is on the block list of the box (by its digits). */
export const onBlocklist = (blocked, number) => Boolean(blocked?.ok && blocked.supported && number && blocked.numbers.has(digits(number)));

/**
 * The model from the answers of the commands; the same shape as readPhone, plus api "ws", the
 * block list, the window of the call list and the statistics. ws: { entries, data } with data
 * { entryId, at, calls, tams, phonebooks, contacts, blocklist, stats } as fetchPhoneWs answers.
 * The live band, today's numbers, the badge and the targets of the services still come from the
 * entities of the same entry (plain states; there is no command for them).
 */
export function readPhoneWs(hass, ownEntryId, ws, { chosen = null } = {}) {
  const entries = (ws?.entries ?? []).map((e) => ({ ...e, deviceId: null, entities: LIST_EMPTY() }));
  const pick = pickEntry(entries, ownSerials(hass, ownEntryId), chosen);
  const entry = pick.entry;
  if (!phoneLoaded(hass) || !entry) return { found: false, api: "ws", pick, entry: null };
  const group = phoneEntries(hass).find((g) => g.entryId === entry.entryId);
  if (group) Object.assign(entry, { deviceId: group.deviceId, entities: group.entities, deviceTitle: group.title });
  const ids = entry.entities;
  const data = ws?.data?.entryId === entry.entryId ? ws.data : {};
  const list = parseWsCalls(data.calls);
  const tamPart = parseWsTams(data.tams, hass, ids);
  const bookPart = parseWsBooks(data.phonebooks, data.contacts);
  const books = bookPart.books;
  const blocked = parseBlocklist(data.blocklist);
  // the box is away: fritzbox_phone keeps its last data, its entities say unavailable
  const listState = ids.call_list ? hass?.states?.[ids.call_list] : null;
  const offline = Boolean(listState) && !usable(listState) && list.ok;
  const sensors = sensorParts(hass, ids, tamPart.tams);
  return {
    found: true,
    api: "ws",
    pick,
    entry,
    listId: ids.call_list ?? null,
    missing: false,
    notLoaded: !entry.loaded,
    loading: entry.loaded && list.reason === "loading",
    offline,
    staleAt: offline ? data.at ?? null : null,
    list,
    ...sensors,
    unread: tamPart.ok ? tamPart.tams.reduce((n, t) => n + (t.newCount ?? t.messages.filter((m) => m.isNew).length), 0) : sensors.unread,
    tams: tamPart.tams,
    tamsState: tamPart.ok ? "ok" : tamPart.reason,
    books,
    booksState: bookPart.ok ? "ok" : bookPart.reason,
    contacts: books.flatMap((b) => b.contacts),
    blocked,
    historyDays: entry.historyDays ?? 0,
    stats: data.stats ?? null,
    privacy: entry.privacy || privacyOn(list, books, tamPart.tams, blocked, bookPart, tamPart) || obj(data.stats?.result).privacy_mode === true,
  };
}

/**
 * The page model: from the commands where fritzbox_phone has them (api "ws"), else from the
 * entities (api "entities", legacy: an older version without the commands). api null: not known
 * yet, the page waits (loading) but the tabs already know from the entities whether it is there.
 */
export function readPhoneModel(hass, ownEntryId, { api = null, legacy = false, ws = null, chosen = null, cache = null } = {}) {
  if (api === "ws") return readPhoneWs(hass, ownEntryId, ws, { chosen });
  const model = readPhone(hass, ownEntryId, { chosen, cache });
  if (model.found && api === null) model.loading = true;
  model.legacy = legacy;
  return model;
}

/**
 * Fetches parts of the page with the commands of fritzbox_phone, each on its own: a refused
 * part ({ ok: false, code }) leaves the others standing. phonebooks also fetches the contacts of
 * each book; stats needs days. Nothing is logged, the answers hold names and numbers.
 */
export async function fetchPhoneWs(callWS, entryId, { parts = WS_PARTS, days = 7 } = {}) {
  const run = async (type, extra = {}) => {
    try {
      return { ok: true, result: await callWS({ type: `${PHONE_DOMAIN}/${type}`, entry_id: entryId, ...extra }) };
    } catch (err) {
      return { ok: false, code: wsCode(err) || "error" };
    }
  };
  const out = {};
  await Promise.all(
    [...parts].map(async (part) => {
      if (part === "stats") out.stats = { ...(await run("stats", { days })), days };
      else if (part === "phonebooks") {
        const books = await run("phonebooks");
        const contacts = {};
        if (books.ok) {
          await Promise.all(
            arr(obj(books.result).phonebooks).map(async (pb) => {
              const id = int(obj(pb).id);
              if (id !== null) contacts[id] = await run("contacts", { phonebook_id: id });
            })
          );
        }
        out.phonebooks = books;
        out.contacts = contacts;
      } else if (["calls", "tams", "blocklist"].includes(part)) out[part] = await run(part);
    })
  );
  return out;
}

/** The states whose change means fritzbox_phone has new data: call list, answering machines, phone books. */
export function phoneTrigger(hass, entry) {
  const ids = entry?.entities;
  if (!ids) return [];
  return [ids.call_list, ...ids.answering_machine, ...ids.phonebook].filter(Boolean).map((id) => hass?.states?.[id]);
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

/** Weekday (Monday first) × hour, a count in each cell (7 × 24, the shape the command stats answers). */
export function heatGrid(list) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of list) if (c.date) grid[(c.date.getDay() + 6) % 7][c.date.getHours()] += 1;
  return grid;
}

/** The heat map in blocks of three hours (7 × 8), for narrow screens. */
export function foldHeat(grid) {
  return grid.map((row) => Array.from({ length: 8 }, (_, j) => row.slice(j * 3, j * 3 + 3).reduce((a, b) => a + b, 0)));
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

/** The sums of the command stats (totals, previous) in the shape of summarize; null where unreadable. */
function wsTotals(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!r || int(r.calls) === null) return null;
  const n = int(r.calls);
  const missed = int(r.missed) ?? 0;
  // the command gives the rate, not the inbound count: every call that is not outgoing
  const inbound = Math.max(0, n - (int(r.outgoing) ?? 0));
  return {
    n,
    talk: num(r.talk_minutes) ?? 0,
    conn: int(r.connected) ?? 0,
    avg: num(r.avg_talk_minutes) ?? 0,
    inbound,
    missed,
    rate: num(r.missed_rate) ?? (inbound ? missed / inbound : 0),
    spam: int(r.spam) ?? 0,
    tam: null,
  };
}

/**
 * The statistics from the answer of the command stats, in the shape statsView draws (like
 * phoneStats) plus source, window and the reach of the comparison. The columns for "today" are
 * hours, counted from the calls of the list (the command answers per day); more than 31 days are
 * weeks. part: { ok, result, days } as fetchPhoneWs answers; calls: the parsed calls of the list.
 */
export function wsStats(part, { period = "7", now = new Date(), calls = [] } = {}) {
  if (!part) return { ok: false, reason: "loading" };
  if (!part.ok) return { ok: false, reason: "na", code: part.code ?? "" };
  const r = part.result && typeof part.result === "object" ? part.result : {};
  const w = r.window && typeof r.window === "object" ? r.window : {};
  const sum = wsTotals(r.totals);
  if (!sum) return { ok: false, reason: "na" };
  const days = int(w.days) ?? PERIOD_DAYS[period] ?? 7;
  const today = dayStart(now);
  const oldest = parseIso(w.oldest);
  const newest = parseIso(w.newest);
  const undated = int(w.undated) ?? 0;
  if (!oldest) return { ok: true, empty: true, total: undated, source: str(w.source) };
  const from = parseDay(w.from) ?? (days ? addDays(today, -(days - 1)) : dayStart(oldest));
  const last = parseDay(w.to) ?? today;
  const to = addDays(last, 1);
  const len = daysBetween(from, to);
  const reach = dayStart(oldest) > from ? dayStart(oldest) : from;
  const covered = Math.max(1, daysBetween(reach, to));
  const kind = str(r.compare?.kind);
  const compare =
    days === 0 ? { kind: "noneAll" }
      : kind === "full" ? { kind: "full", len: days }
        : kind === "partial" ? { kind: "partial", cover: int(r.compare?.cover_days) ?? 0, len: days, only: true }
          : { kind: "none" };
  const series = { incoming: "in", outgoing: "out", missed: "miss", spam: "spam" };
  const perDay = (Array.isArray(r.per_day) ? r.per_day : [])
    .map((d) => {
      const start = parseDay(d?.date);
      if (!start) return null;
      const b = { start, end: addDays(start, 1), total: 0 };
      for (const [k, s] of Object.entries(series)) {
        b[s] = int(d[k]) ?? 0;
        b.total += b[s];
      }
      return b;
    })
    .filter(Boolean);
  let bars;
  if (period === "today" || days === 1) bars = buckets(calls.filter((c) => c.date && c.date >= today && c.date < addDays(today, 1)), "today", today, addDays(today, 1));
  else if (perDay.length > 31) {
    const weeks = [];
    for (let i = 0; i < perDay.length; i += 7) {
      const part7 = perDay.slice(i, i + 7);
      const b = { start: part7[0].start, end: part7.at(-1).end, total: 0 };
      for (const s of SERIES) {
        b[s] = part7.reduce((n, x) => n + x[s], 0);
        b.total += b[s];
      }
      weeks.push(b);
    }
    bars = { unit: "week", list: weeks };
  } else bars = { unit: "day", list: perDay };
  const rank = (list) =>
    (Array.isArray(list) ? list : []).map((x) => ({
      key: digits(x?.number) || str(x?.number),
      number: str(x?.number),
      name: str(x?.name),
      vip: x?.vip === true,
      n: int(x?.count) ?? 0,
      talk: num(x?.talk_minutes) ?? 0,
      spam: x?.spam === true,
      area: "",
    }));
  const heat = Array.isArray(r.heat) && r.heat.length === 7 && r.heat.every((row) => Array.isArray(row) && row.length === 24) ? r.heat.map((row) => row.map((v) => int(v) ?? 0)) : null;
  return {
    ok: true,
    empty: false,
    source: str(w.source),
    days,
    total: (int(w.count) ?? sum.n) + undated,
    count: int(w.count) ?? sum.n,
    undated,
    first: oldest,
    oldest,
    newest,
    from,
    to,
    len,
    short: days !== 0 && dayStart(oldest) > from,
    perDay: len > 1 ? (int(w.count) ?? sum.n) / Math.min(len, covered) : null,
    sum,
    prev: wsTotals(r.previous),
    compare,
    bars,
    heat,
    lines: (Array.isArray(r.per_line) ? r.per_line : []).map((x) => ({ key: digits(x?.own_number) || str(x?.own_number), number: str(x?.own_number), n: int(x?.count) ?? 0 })),
    topIn: rank(r.top_callers),
    topOut: rank(r.top_called),
  };
}
