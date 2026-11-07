/* The page Box › Phone: it reads the entities of FRITZ!Box Telefon (fritzbox_phone) and calls its services, against a fake Home Assistant. */

import assert from "node:assert/strict";
import test, { mock } from "node:test";

function fakeEl() {
  const kids = {};
  return {
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    dataset: {},
    attrs: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    focus() {},
    select() {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    querySelector(sel) {
      return (kids[sel] ??= fakeEl());
    },
    querySelectorAll: () => [],
    contains: () => false,
    addEventListener() {},
  };
}

function fakeRoot() {
  const els = {};
  return { els, activeElement: null, innerHTML: "", querySelector: (sel) => (els[sel] ??= fakeEl()), querySelectorAll: () => [], addEventListener() {} };
}

globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = fakeRoot();
    return this.shadowRoot;
  }
};
globalThis.CSS = { escape: (s) => String(s) };
globalThis.document = { addEventListener() {}, removeEventListener() {} };

const base = "../../custom_components/fritzbox_network/frontend/";
const panel = await import(`${base}fritzbox-network-panel.js`);
const texts = await import(`${base}texts.js`);
const shared = await import(`${base}shared.js`);
const model = await import(`${base}phone-model.js`);
const page = await import(`${base}panel-phone.js`);

const t = texts.panelTexts("de");
const en = texts.panelTexts("en");
// "today" is Saturday 7 November 2026, 15:00 local time; the box writes local time too
const NOW = new Date(2026, 10, 7, 15, 0);

// ---------- a Home Assistant with FRITZ!Box Telefon ----------

const CALLS = [
  { id: 512, type: "incoming", name: "Mama", caller_number: "01712345678", called_number: "030 5550101", device: "Mobilteil Küche", date: "07.11.26 14:12", duration: "0:04", area_name: "Mobilfunk", is_spam: false },
  { id: 511, type: "missed", name: "", caller_number: "+4922198765432", called_number: "030 5550101", date: "07.11.26 13:40", duration: "0:00", area_name: "Köln", is_spam: true, spam_confidence: 87, spam_rating: "E_ADVERTISING" },
  { id: 510, type: "outgoing", name: "Dr. Weber", caller_number: "030 5550101", called_number: "0304567890", device: "FRITZ!Fon C6", date: "07.11.26 12:05", duration: "0:02", area_name: "Berlin" },
  { id: 509, type: "incoming", name: "", caller_number: "0401234567", called_number: "030 5550102", device: "Anrufbeantworter 1", date: "07.11.26 10:31", duration: "0:01", area_name: "Hamburg", is_answering_machine: true, has_recording: true, tam_index: 0, tam_message_index: 2, reverse_name: "Hermes Logistik", reverse_category: "Dienstleister" },
  { id: 507, type: "outgoing", name: "Mama", caller_number: "030 5550101", called_number: "0171 2345678", date: "06.11.26 19:48", duration: "1:12" },
  { id: 506, type: "rejected_incoming", name: "", caller_number: "+498999990000", called_number: "030 5550101", date: "06.11.26 18:02", duration: "0:00", is_spam: true, spam_confidence: 95, spam_rating: "G_FRAUD" },
  { id: 505, type: "incoming", name: "Mama", caller_number: "01712345678", called_number: "030 5550101", date: "06.11.26 16:20", duration: "0:31" },
  { id: 499, type: "missed", name: "", caller_number: "08001234567", called_number: "030 5550101", date: "04.11.26 10:02", duration: "0:00" },
  { id: 498, type: "incoming", name: "Ohne Datum", caller_number: "0221111", called_number: "030 5550101", date: "gestern irgendwann", duration: "?" },
];
const MESSAGES = [
  { index: 2, name: "", number: "0401234567", called: "030 5550102", date: "07.11.26 10:31", key: "07.11.26 10:31|0401234567", duration: "0:38", new: true, in_phonebook: false, has_recording: true, recording_path: "/api/fritzbox_phone/recording/p1/0/2?key=07.11.26+10%3A31%7C0401234567", area_name: "Hamburg", reverse_name: "Hermes Logistik" },
  { index: 0, name: "Dr. Weber", number: "0304567890", date: "04.11.26 17:45", key: "04.11.26 17:45|0304567890", duration: "0:25", new: false, in_phonebook: true, has_recording: false, recording_path: null },
];
const CONTACTS = [
  { name: "Mama", vip: true, uniqueid: "1", numbers: [{ number: "01712345678", type: "mobile" }] },
  { name: "Büro Schmidt", vip: false, uniqueid: "2", numbers: [{ number: "069445566", type: "work" }, { number: "069445567", type: "fax_work" }] },
  { name: "Dr. Weber", vip: false, uniqueid: "3", numbers: [{ number: "0304567890", type: "work" }] },
];

const st = (state, attributes = {}) => ({ state: String(state), attributes, last_updated: "2026-11-07T14:21:00" });

function makeHass({ phone = true, privacy = false, extra = {}, states: over = {} } = {}) {
  const entities = {
    "sensor.fritz_network_cpu": { platform: "fritzbox_network", device_id: "dnet" },
  };
  const states = {};
  const add = (id, tk, state, device = "dph1") => {
    entities[id] = { entity_id: id, platform: "fritzbox_phone", translation_key: tk, device_id: device };
    if (state) states[id] = state;
  };
  if (phone) {
    add("sensor.fb_anrufliste", "call_list", st(CALLS.length, { calls: CALLS, privacy_mode: privacy, friendly_name: "FRITZ!Box 7590 AX Anrufliste" }));
    add("sensor.fb_anrufe_heute", "calls_today", st(4, { incoming: 2, outgoing: 1, missed: 1 }));
    add("sensor.fb_gespraechszeit_heute", "talk_time_today", st(7));
    add("sensor.fb_spam_anrufe_heute", "spam_calls_today", st(1));
    add("sensor.fb_erkannte_spam_anrufe", "spam_calls_total", st(23));
    add("sensor.fb_anrufmonitor", "call_monitor", st("idle", {}));
    add("binary_sensor.fb_ungelesene_nachrichten", "unread_messages", st("on", { count: 1 }));
    add("sensor.fb_anrufbeantworter_1", "answering_machine", st(1, { tam_index: 0, enabled: true, running: true, capacity_minutes_remaining: 41, total_messages: 2, privacy_mode: privacy, messages: MESSAGES, friendly_name: "FRITZ!Box 7590 AX Anrufbeantworter 1" }));
    add("switch.fb_anrufbeantworter_1_aktiv", "tam_enabled", st("on", { friendly_name: "FRITZ!Box 7590 AX Anrufbeantworter 1 aktiv" }));
    add("sensor.fb_telefonbuch", "phonebook", st(3, { contacts: CONTACTS, privacy_mode: privacy, friendly_name: "FRITZ!Box 7590 AX Telefonbuch" }));
  }
  Object.assign(states, { "media_player.kueche": st("idle", { friendly_name: "Küche" }) }, over);
  return {
    language: "de",
    config: { components: phone ? ["fritzbox_network", "fritzbox_phone"] : ["fritzbox_network"] },
    entities,
    devices: {
      dnet: { id: "dnet", config_entries: ["e1"], identifiers: [["fritzbox_network", "SER123"]], serial_number: "SER123", name: "FRITZ!Box 7590 AX" },
      dph1: { id: "dph1", config_entries: ["p1"], identifiers: [["fritzbox_phone", "p1"]], serial_number: "SER123", name: "FRITZ!Box 7590 AX" },
    },
    states,
    ...extra,
  };
}

const panels = [];
test.afterEach(() => {
  for (const p of panels.splice(0)) {
    p._phoneClearTimers();
    clearTimeout(p._restartTimer);
  }
});

/** A panel on the phone page; services[name] answers a service (an Error is thrown), ws[type] a websocket command. */
function makePanel(hassOpts = {}, { services = {}, ws = {} } = {}) {
  const p = new panel.FritzboxNetworkPanel();
  panels.push(p);
  const calls = [];
  const wsCalls = [];
  p._entryId = "e1";
  p._hass = {
    ...makeHass(hassOpts),
    callService: async (domain, service, data, target, notify, response) => {
      calls.push({ domain, service, data, target, notify, response });
      const answer = services[service];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(data) : answer;
    },
    callWS: async (msg) => {
      wsCalls.push(msg);
      const answer = ws[msg.type];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(msg) : answer;
    },
  };
  p._state.tab = "phone";
  p._state.data = { can_write: true, nodes: [], clients: [] };
  p._readPhone();
  return { p, calls, wsCalls, root: p.shadowRoot, html: () => (p._renderPhone(), p._html["phone-view"]) };
}

const ctx = (ui = {}, extra = {}) => ({ t, language: "de", now: NOW, width: 640, ui: { view: "list", filter: "all", query: "", period: "7", tables: {}, bookQuery: "", expanded: new Set(), revealed: new Set(), blocked: new Set(), busy: new Set(), ...ui }, ...extra });
const read = (opts) => model.readPhone(makeHass(opts), "e1", { cache: new Map() });

// ---------- detection and navigation ----------

test("without fritzbox_phone the box has no sub-tabs, with it Overview and Phone, and #/box/phone is a route", () => {
  assert.equal(model.phoneLoaded(makeHass({ phone: false })), false);
  // listed as a component, but no entity: not there either
  assert.equal(model.phoneLoaded({ ...makeHass({ phone: false }), config: { components: ["fritzbox_phone"] } }), false);
  assert.equal(model.phoneLoaded(makeHass()), true);
  assert.deepEqual(panel.pagesOf("box", { phoneFound: false }), ["box"]);
  assert.equal(panel.renderSubTabs("box", t, { phoneFound: false }), "");
  assert.deepEqual(panel.pagesOf("box", { phoneFound: true }), ["box", "phone"]);
  const sub = panel.renderSubTabs("phone", t, { phoneFound: true, phoneUnread: 2 });
  assert.match(sub, /role="tablist" aria-label="Box"/);
  assert.match(sub, /data-tab="box" aria-selected="false" aria-pressed="false">Übersicht<\/button>/);
  assert.match(sub, /data-tab="phone" aria-selected="true" aria-pressed="true">Telefon <span class="chip info sub-badge">2<span class="sr"> neue Nachrichten/);
  assert.deepEqual(shared.routeFromHash("#/box/phone"), { tab: "phone", device: null });
  assert.deepEqual(shared.routeFromHash("#/box/nonsense"), { tab: "net", device: null });
  assert.equal(shared.pageHash("phone"), "#/box/phone");
  assert.equal(shared.pageHash("box"), "#/box");
  assert.equal(shared.pageHash("net"), "#/");
  assert.equal(panel.groupOf("phone"), "box");
});

test("the box tab carries a dot while the phone rings", () => {
  const nav = panel.renderNav({ tab: "net", data: {}, phoneRinging: true }, t, 0);
  assert.match(nav, /data-tab="box" aria-selected="false" aria-label="Box, es klingelt">Box<i class="dot warn"/);
  assert.doesNotMatch(panel.renderNav({ tab: "net", data: {} }, t, 0), /dot warn/);
});

test("the panel finds the phone from the registries; without it #/box/phone leads to the box", () => {
  const { p } = makePanel();
  assert.equal(p._state.phoneFound, true);
  assert.equal(p._state.phoneUnread, 1);
  const none = makePanel({ phone: false });
  globalThis.location = { hash: "#/box/phone", replace(h) { this.hash = h; } };
  none.p._state.box = "failed";
  none.p._update();
  assert.equal(none.p._state.tab, "box");
  assert.equal(globalThis.location.hash, "#/box");
  assert.equal(none.p._state.phoneFound, false);
});

test("with several boxes the entry with the serial number of this box is used, else the only one, else a choice", () => {
  const two = makeHass();
  two.devices.dph0 = { id: "dph0", config_entries: ["p0"], identifiers: [["fritzbox_phone", "p0"]], serial_number: "SER999", name: "A Ferienwohnung" };
  two.entities["sensor.fw_anrufliste"] = { platform: "fritzbox_phone", translation_key: "call_list", device_id: "dph0" };
  const entries = model.phoneEntries(two);
  assert.deepEqual(entries.map((e) => e.entryId), ["p0", "p1"]);
  assert.equal(entries[1].entities.call_list, "sensor.fb_anrufliste");
  assert.deepEqual(entries[1].entities.answering_machine, ["sensor.fb_anrufbeantworter_1"]);
  const serials = model.ownSerials(two, "e1");
  assert.ok(serials.has("SER123"));
  const pick = model.pickEntry(entries, serials);
  assert.equal(pick.how, "match");
  assert.equal(pick.entry.deviceId, "dph1");
  // no serial matches: the only entry, marked; two of them: a choice, the chosen one wins
  assert.equal(model.pickEntry([entries[0]], new Set(["X"])).how, "only");
  const choose = model.pickEntry(entries, new Set(["X"]), "dph1");
  assert.equal(choose.how, "choose");
  assert.equal(choose.entry.deviceId, "dph1");
  const html = page.renderPhone(model.readPhone(two, "zz", { cache: new Map(), chosen: "dph1" }), ctx());
  assert.match(html, /<option value="dph1" selected>/);
  assert.match(html, /<select id="ph-entry"/);
  assert.match(html, /Mehrere Einträge von FRITZ!Box Telefon/);
  // the services go to the device of the entry shown
  const { p } = makePanel();
  assert.deepEqual(p._phoneTarget(), { device_id: "dph1" });
});

// ---------- parsing ----------

test("dates and durations of the box: DD.MM.YY HH:MM local, h:mm in minutes", () => {
  assert.deepEqual(model.parseAvmDate("07.11.26 14:12"), new Date(2026, 10, 7, 14, 12));
  assert.equal(model.parseAvmDate("31.02.26 10:00"), null);
  assert.equal(model.parseAvmDate(""), null);
  assert.equal(model.parseAvmDate(undefined), null);
  assert.equal(model.parseAvmDate(1234), null);
  assert.equal(model.callMinutes("0:31"), 31);
  assert.equal(model.callMinutes("1:12"), 72);
  assert.equal(model.callMinutes("?"), 0);
  assert.equal(model.callMinutes(null), 0);
});

test("a call with missing or odd fields never throws; numbers, names and types are read as the card reads them", () => {
  const empty = model.parseCall(undefined, 3);
  assert.equal(empty.id, "i3");
  assert.equal(empty.type, "other");
  assert.equal(empty.number, "");
  assert.equal(empty.date, null);
  assert.equal(empty.spamConfidence, null);
  const out = model.parseCall({ type: "active_outgoing", caller_number: "030 1", called: "0172 9", duration: "0:05", spam_confidence: "40" });
  assert.equal(out.number, "0172 9");
  assert.equal(out.own, "030 1");
  assert.equal(out.minutes, 5);
  assert.equal(out.spamConfidence, 40);
  assert.equal(model.parseCall({ type: "fax_something", caller: "0301" }).type, "other");
  assert.equal(model.displayName(model.parseCall({ type: "incoming", reverse_name: "Hermes", caller_number: "040" })), "Hermes");
  const list = model.parseCallList({ attributes: { calls: CALLS } }, CONTACTS);
  assert.equal(list.ok, true);
  assert.equal(list.calls.at(-1).name, "Ohne Datum");
  assert.equal(list.calls[0].vip, true);
  assert.equal(model.parseCallList({ attributes: {} }).ok, false);
  assert.equal(model.parseCallList(null).ok, false);
  assert.deepEqual(model.filterCounts(list.calls), { all: 9, missed: 3, incoming: 4, outgoing: 2, spam: 2 });
  assert.deepEqual(model.filterCalls(list.calls, "all", "hermes").map((c) => c.id), [509]);
  assert.deepEqual(model.filterCalls(list.calls, "all", "0171 234").map((c) => c.id), [512, 507, 505]);
});

test("answering machines and phone books are read defensively, names without the device", () => {
  const tam = model.parseTam("sensor.x", st(1, { messages: [{ index: "2", new: true, has_recording: true }, null], friendly_name: "Box AB 1" }), "Box");
  assert.equal(tam.ok, true);
  assert.equal(tam.name, "AB 1");
  assert.equal(tam.messages[0].index, 2);
  // a recording needs its path; an old version without one cannot be played
  assert.equal(tam.messages[0].hasRecording, false);
  assert.equal(tam.messages[1].index, null);
  assert.equal(tam.enabled, null);
  assert.equal(model.parseTam("sensor.y", st(0, {})).ok, false);
  const book = model.parseBook("sensor.b", st(2, { contacts: [{ name: "Zora", numbers: [{ number: "1" }, {}] }, { name: "Anna", vip: true }] }));
  assert.deepEqual(book.contacts.map((c) => c.name), ["Anna", "Zora"]);
  assert.deepEqual(book.contacts[1].numbers, [{ number: "1", type: "" }]);
  assert.equal(model.parseBook("sensor.b", undefined).ok, false);
  assert.deepEqual(model.searchBook(book.contacts, "zo").map((c) => c.name), ["Zora"]);
});

// ---------- the page and its states ----------

test("the page shows today, the call list by day, the answering machine and the phone book", () => {
  const html = page.renderPhone(read(), ctx());
  assert.match(html, /<h1 id="dtitle" tabindex="-1">Telefon<\/h1>/);
  assert.match(html, /Eintrag „FRITZ!Box 7590 AX“/);
  assert.match(html, /Anrufmonitor <span class="chip ok">/);
  assert.match(html, /<span class="label">Anrufe<\/span><b>4<\/b><small>2 eingehend · 1 ausgehend/);
  assert.match(html, /<span class="label">Gesprächszeit<\/span><b>7 Min\.<\/b>/);
  assert.match(html, /23 erkannt insgesamt/);
  assert.match(html, /role="heading" aria-level="3">Heute<\/div>[\s\S]*role="heading" aria-level="3">Gestern<\/div>[\s\S]*Ohne Datum<\/div>/);
  assert.match(html, /aria-label="Zurückrufen: Mama"/);
  assert.match(html, /aria-label="Erneut anrufen: Dr\. Weber"/);
  assert.match(html, /Spam 87 %/);
  assert.match(html, /1 Std\. 12 Min\./);
  assert.match(html, /data-ph-val="missed" data-k="ph-f-missed" aria-pressed="false">Verpasst<span class="n">3/);
  assert.match(html, /role="switch" aria-checked="true" aria-label="Anrufbeantworter 1 eingeschaltet" data-act="ph-tamsw" data-ph-ent="switch.fb_anrufbeantworter_1_aktiv" data-ph-val="0"/);
  assert.match(html, /<span class="chip info">1 neu<\/span>/);
  assert.match(html, /noch 41 Min\. frei/);
  assert.match(html, /Keine Aufnahme/);
  assert.match(html, /Büro Schmidt[\s\S]*069445567<\/span><small>Fax<\/small><\/span>/);
  assert.doesNotMatch(html, /data-ph-num="069445567"/);
  assert.match(html, /aria-label="Mama anrufen, mobil"/);
});

test("loading, empty, an old version, a missing call list and a lost connection each say so", () => {
  const loading = page.renderPhone(read({ states: {} }).loading ? read({ states: {} }) : model.readPhone({ ...makeHass(), states: {} }, "e1"), ctx());
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /werden geladen/);
  const empty = makeHass();
  empty.states["sensor.fb_anrufliste"] = st(0, { calls: [] });
  assert.match(page.renderPhone(model.readPhone(empty, "e1"), ctx()), /Keine Anrufe in der Liste\./);
  assert.match(page.renderPhone(model.readPhone(empty, "e1"), ctx({ view: "stats" })), /Noch keine Daten für eine Statistik/);
  const old = makeHass();
  old.states["sensor.fb_anrufliste"] = st(3, {});
  assert.match(page.renderPhone(model.readPhone(old, "e1"), ctx()), /das Attribut „calls“ fehlt/);
  const missing = makeHass();
  delete missing.entities["sensor.fb_anrufliste"];
  assert.match(page.renderPhone(model.readPhone(missing, "e1"), ctx()), /liefert keine Anrufliste[\s\S]*Zur Integration/);
  // unavailable: the last good state with its time, actions locked; without one a note
  const cache = new Map();
  const hass = makeHass();
  model.readPhone(hass, "e1", { cache });
  hass.states["sensor.fb_anrufliste"] = { state: "unavailable", attributes: {} };
  const stale = page.renderPhone(model.readPhone(hass, "e1", { cache }), ctx());
  assert.match(stale, /Verbindung zur FRITZ!Box unterbrochen – Stand 14:21/);
  assert.match(stale, /data-act="ph-dial" data-k="ph-dialopen" aria-haspopup="dialog" disabled/);
  assert.match(stale, /aria-label="Zurückrufen: Mama" disabled/);
  assert.match(page.renderPhone(model.readPhone(hass, "e1", { cache: new Map() }), ctx()), /FRITZ!Box Telefon erreicht die Box nicht/);
  // the call monitor gone: shown as disconnected
  hass.states["sensor.fb_anrufmonitor"] = { state: "unavailable", attributes: {} };
  assert.match(page.renderPhone(model.readPhone(hass, "e1", { cache }), ctx()), /Anrufmonitor <span class="chip warn">/);
});

test("a part without its sensor says not available instead of failing", () => {
  const hass = makeHass();
  delete hass.states["sensor.fb_gespraechszeit_heute"];
  hass.states["sensor.fb_anrufe_heute"] = st(2, { incoming: "x" });
  const html = page.renderPhone(model.readPhone(hass, "e1"), ctx());
  assert.match(html, /<span class="label">Gesprächszeit<\/span><b class="na">nicht verfügbar/);
  assert.match(html, /<span class="label">Verpasst<\/span><b class="na">nicht verfügbar/);
  delete hass.entities["sensor.fb_spam_anrufe_heute"];
  delete hass.entities["sensor.fb_erkannte_spam_anrufe"];
  assert.doesNotMatch(page.renderPhone(model.readPhone(hass, "e1"), ctx()), /erkannt insgesamt/);
  const noTam = makeHass();
  delete noTam.entities["sensor.fb_anrufbeantworter_1"];
  assert.match(page.renderPhone(model.readPhone(noTam, "e1"), ctx()), /Kein Anrufbeantworter eingerichtet/);
});

// ---------- privacy ----------

test("privacy mode hides names, numbers and places until a row is tapped, for 15 seconds", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { p, html } = makePanel({ privacy: true });
    let out = html();
    assert.match(out, /Privatsphäre-Modus ist in FRITZ!Box Telefon eingeschaltet/);
    assert.doesNotMatch(out, /Mama|Hermes|Köln|Dr\. Weber|01712345678/);
    assert.match(out, /<span class="ph-masked" aria-hidden="true">••••••<\/span><span class="sr">Verdeckt – zum Anzeigen antippen<\/span>/);
    // today's numbers stay
    assert.match(out, /<span class="label">Anrufe<\/span><b>4<\/b>/);
    p._onPhoneClick({ act: "ph-row", phKey: "c:512" });
    out = p._html["phone-view"];
    assert.match(out, /aria-label="Zurückrufen: Mama"/);
    assert.match(out, /aria-expanded="true"/);
    assert.doesNotMatch(out, /Dr\. Weber/);
    mock.timers.tick(15000);
    assert.doesNotMatch(p._html["phone-view"], /Mama/);
    // statistics: numbers stay, names hidden, numbers shortened
    p._state.phone.view = "stats";
    out = html();
    assert.match(out, /<span class="label">Anrufe<\/span><b>8<\/b>/);
    assert.match(out, /0401 ••• 67/);
    assert.doesNotMatch(out, /Mama/);
    assert.match(out, /Verdeckten Eintrag 1 anzeigen/);
  } finally {
    mock.timers.reset();
  }
});

test("dial suggestions come from the phone books, without numbers in privacy mode and without fax", () => {
  const contacts = model.parseBook("b", st(3, { contacts: CONTACTS })).contacts;
  const html = page.dialSuggestions(contacts, "bü", false, t);
  assert.match(html, /role="listbox"/);
  assert.match(html, /data-pick="069445566"/);
  assert.doesNotMatch(html, /069445567/);
  assert.match(page.dialSuggestions(contacts, "ma", true, t), /•••/);
  assert.doesNotMatch(page.dialSuggestions(contacts, "ma", true, t), /<span class="mono muted">01712345678/);
  assert.equal(page.dialSuggestions(contacts, "0171", false, t), "");
});

// ---------- the live band ----------

test("the live band follows the call monitor: ringing with spam, talking, dialling after an own call", () => {
  const hass = makeHass();
  hass.states["sensor.fb_anrufmonitor"] = st("ringing", { from: "+4922198765432", from_name: "", to: "030 5550101", area_name: "Köln", is_spam: true, spam_confidence: 87, spam_rating: "E_ADVERTISING", initiated: "2026-11-07T14:59:00" });
  let m = model.readPhone(hass, "e1");
  assert.equal(m.ringing, true);
  let html = page.renderPhone(m, ctx());
  assert.match(html, /class="ph-live spam" role="status" aria-live="assertive"/);
  assert.match(html, /Es klingelt: \+4922198765432/);
  assert.match(html, /Spamverdacht 87 % \(Werbung\) · an 030 5550101 · seit 14:59/);
  assert.match(html, /data-act="ph-block" data-ph-num="\+4922198765432"/);
  hass.states["sensor.fb_anrufmonitor"] = st("talking", { with: "01712345678", with_name: "Mama", vip: true, device: "Mobilteil", accepted: "2026-11-07T14:12:00" });
  html = page.renderPhone(model.readPhone(hass, "e1"), ctx());
  assert.match(html, /class="ph-live talk" role="status" aria-live="polite"/);
  assert.match(html, /Gespräch mit Mama/);
  assert.doesNotMatch(html, /ph-hangup/);
  // the monitor is never masked
  hass.states["sensor.fb_anrufliste"].attributes.privacy_mode = true;
  assert.match(page.renderPhone(model.readPhone(hass, "e1"), ctx()), /Gespräch mit Mama/);
  hass.states["sensor.fb_anrufmonitor"] = st("idle", { with: "01712345678", with_name: "Mama" });
  m = model.readPhone(hass, "e1");
  assert.equal(page.liveBand(m, ctx()), "");
  // hangup is only offered after an own dial
  const band = page.liveBand(m, ctx({ dial: { number: "030 123", name: "", at: NOW.getTime() - 1000 } }));
  assert.match(band, /Wählhilfe: 030 123[\s\S]*data-act="ph-hangup"/);
  assert.equal(page.liveBand(m, ctx({ dial: { number: "030 123", name: "", at: NOW.getTime() - 100000 } })), "");
});

// ---------- statistics ----------

const calls = model.parseCallList({ attributes: { calls: CALLS } }).calls;

test("statistics over the last 7 days: sums, talk time from h:mm, missed rate, buckets per day, heat map, top callers", () => {
  const s = model.phoneStats(calls, { period: "7", now: NOW });
  assert.equal(s.total, 9);
  assert.equal(s.undated, 1);
  assert.deepEqual(s.first, new Date(2026, 10, 4, 10, 2));
  assert.equal(s.spanDays, 4);
  assert.equal(s.short, true);
  assert.equal(s.len, 7);
  assert.deepEqual(s.sum, { n: 8, talk: 109, conn: 4, avg: 27.25, inbound: 6, missed: 2, rate: 2 / 6, spam: 2, tam: 1 });
  assert.equal(s.perDay, 2);
  assert.deepEqual(s.compare, { kind: "none" });
  assert.equal(s.prev, null);
  assert.equal(s.bars.unit, "day");
  assert.equal(s.bars.list.length, 7);
  const day = (d) => s.bars.list.find((b) => b.start.getDate() === d);
  assert.deepEqual([day(7).in, day(7).out, day(7).miss, day(7).spam, day(7).total], [1, 1, 1, 1, 4]);
  assert.deepEqual([day(6).in, day(6).out, day(6).miss, day(6).spam, day(6).total], [1, 1, 0, 1, 3]);
  assert.equal(day(4).miss, 1);
  assert.equal(day(5).total, 0);
  // Saturday is row 5, 12–15 h is column 4
  assert.equal(s.heat[5][4], 3);
  assert.equal(s.heat[5][3], 1);
  assert.equal(s.heat[4][6], 2);
  assert.equal(s.heat[4][5], 1);
  assert.equal(s.heat[2][3], 1);
  assert.equal(s.heat.flat().reduce((a, b) => a + b, 0), 8);
  assert.deepEqual(s.topIn[0], { key: "01712345678", number: "01712345678", name: "Mama", vip: false, n: 2, talk: 35, spam: false, area: "Mobilfunk" });
  assert.deepEqual(s.topOut.map((x) => [x.name, x.n, x.talk]), [["Mama", 1, 72], ["Dr. Weber", 1, 2]]);
  assert.deepEqual(s.lines.map((l) => [l.number, l.n]), [["030 5550101", 7], ["030 5550102", 1]]);
});

test("statistics for today compare with yesterday; all has no comparison; a short reach back is partial or none", () => {
  const today = model.phoneStats(calls, { period: "today", now: NOW });
  assert.equal(today.bars.unit, "hour");
  assert.equal(today.bars.list.length, 24);
  assert.equal(today.bars.list[14].in, 1);
  assert.equal(today.sum.n, 4);
  assert.deepEqual(today.compare, { kind: "full", len: 1 });
  assert.equal(today.prev.n, 3);
  assert.equal(today.perDay, null);
  assert.deepEqual(model.phoneStats(calls, { period: "all", now: NOW }).compare, { kind: "noneAll" });
  assert.equal(model.phoneStats(calls, { period: "all", now: NOW }).bars.list.length, 4);
  // the list reaches 4 of the 7 days before: a partial comparison
  const longer = [...CALLS, { id: 1, type: "incoming", caller_number: "1", date: "28.10.26 09:00", duration: "0:10" }];
  const s = model.phoneStats(model.parseCallList({ attributes: { calls: longer } }).calls, { period: "7", now: NOW });
  assert.deepEqual(s.compare, { kind: "partial", cover: 4, len: 7 });
  assert.equal(s.prev.n, 1);
  // more than 31 days: per week
  const old = [...CALLS, { id: 2, type: "outgoing", called_number: "2", date: "01.09.26 09:00", duration: "0:01" }];
  const all = model.phoneStats(model.parseCallList({ attributes: { calls: old } }).calls, { period: "all", now: NOW });
  assert.equal(all.bars.unit, "week");
  assert.equal(all.bars.list.reduce((n, b) => n + b.total, 0), 9);
  assert.equal(model.phoneStats([], { now: NOW }).empty, true);
});

test("the statistics view says how far the list reaches, shows deltas as text and offers tables", () => {
  const m = read();
  let html = page.renderPhone(m, ctx({ view: "stats", period: "today" }));
  assert.match(html, /Zeitraum: die letzten 8 Anrufe, seit 04\.11\./);
  assert.match(html, /Die Liste reicht nur 4 Tage zurück: 7 Tage, 30 Tage und „Alles“ zeigen dasselbe/);
  assert.match(html, /1 Anrufe ohne lesbares Datum/);
  assert.match(html, /▲ \+1<span class="sr"> gegenüber dem Zeitraum davor/);
  assert.match(html, /Änderung gegenüber gestern/);
  assert.match(html, /<svg class="ph-chart"[^>]*aria-label="Anrufe je Stunde, gestapelt nach Art"/);
  assert.match(html, /<g class="bar" tabindex="0" role="img" aria-label="14–15 Uhr: 1 Anrufe – 1 Eingehend, 0 Ausgehend, 0 Verpasst, 0 Spam"/);
  assert.match(html, /aria-label="Sa 12–15 Uhr: 3 Anrufe"/);
  assert.match(html, /heute 1 · gesamt 23/);
  assert.match(html, /Anrufe mit Nachricht · 1 ungehört/);
  html = page.renderPhone(m, ctx({ view: "stats", period: "7", tables: { bars: true, heat: true } }));
  assert.match(html, /<table class="ph-table"><caption class="sr">Anrufe je Tag<\/caption>/);
  assert.match(html, /<th scope="col">Spam<\/th>/);
  assert.match(html, /<caption class="sr">Anrufe nach Wochentag und Uhrzeit<\/caption>/);
  assert.match(html, /Kein Vergleich: Die Liste reicht nicht so weit zurück/);
  assert.match(html, /33 %<\/b><small>2 von 6 eingehenden/);
  assert.match(html, /1 Std\. 49 Min\./);
  assert.match(html, /Wer am meisten anruft[\s\S]*Mama/);
});

test("the charts fit narrow screens: at 375 px the labels are thinned out", () => {
  const s = model.phoneStats(calls, { period: "30", now: NOW });
  const narrow = page.barChart(s.bars, 375 - 66, { t, language: "de" });
  const labels = [...narrow.matchAll(/<text class="ax"[^>]*text-anchor="middle">/g)].length;
  assert.ok(labels < 30 && labels >= 5, `labels: ${labels}`);
  assert.match(narrow, /width="309"/);
  assert.match(page.heatChart(s.heat, 260, { t }), /width="260"/);
});

// ---------- services ----------

test("dial checks the number like the service, calls fritzbox_phone.dial with the device and shows the dial helper", async () => {
  const { p, calls: sent, root } = makePanel({}, { services: { dial: {}, hangup: {} } });
  let asked = p._phoneDial("", "");
  const dialog = root.els["#dialog"];
  dialog.querySelector("#ph-dial-in").value = "abc";
  dialog.querySelector("#dlg-yes").onclick();
  assert.match(dialog.querySelector("#dlg-msg").textContent, /Nur Ziffern/);
  assert.equal(sent.length, 0);
  assert.match(dialog.innerHTML, /Der Dienst fritzbox_phone\.dial kennt keine Auswahl des Telefons/);
  dialog.querySelector("#ph-dial-in").value = " 030 123456 ";
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(sent[0], { domain: "fritzbox_phone", service: "dial", data: { number: "030 123456" }, target: { device_id: "dph1" }, notify: false, response: false });
  assert.match(root.els["#toast"].textContent, /Wählhilfe gestartet/);
  assert.match(p._html["phone-view"], /Wählhilfe: 030 123456[\s\S]*data-act="ph-hangup"/);
  await p._onPhoneClick({ act: "ph-hangup" });
  assert.deepEqual(sent[1], { domain: "fritzbox_phone", service: "hangup", data: {}, target: { device_id: "dph1" }, notify: false, response: false });
  assert.equal(p._state.phone.dial, null);
  // cancelled: nothing sent
  asked = p._phoneDial("0301", "");
  dialog.querySelector("#dlg-no").onclick();
  await asked;
  assert.equal(sent.length, 2);
});

test("block asks first, sends the label, and the toast undoes it with unblock_number", async () => {
  const { p, calls: sent, root } = makePanel({}, { services: { block_number: {}, unblock_number: {} } });
  const asked = p._phoneBlock("+4922198765432", "");
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /Nummer sperren\?/);
  assert.match(dialog.innerHTML, /maxlength="64"/);
  dialog.querySelector("#ph-blk-name").value = "  Werbung  ";
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(sent[0], { domain: "fritzbox_phone", service: "block_number", data: { number: "+4922198765432", name: "Werbung" }, target: { device_id: "dph1" }, notify: false, response: false });
  assert.ok(p._state.phone.blocked.has("+4922198765432"));
  assert.match(root.els["#toast"].innerHTML, /ist gesperrt\.[\s\S]*Rückgängig/);
  await root.els["#toast"].querySelector("#toast-act").onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent[1].data, { number: "+4922198765432" });
  assert.equal(sent[1].service, "unblock_number");
  assert.equal(p._state.phone.blocked.size, 0);
  // without a label no name is sent
  const again = p._phoneBlock("0301", "");
  dialog.querySelector("#ph-blk-name").value = "";
  dialog.querySelector("#dlg-yes").onclick();
  await again;
  assert.deepEqual(sent[2].data, { number: "0301" });
});

test("add_contact goes into the first phone book (id 0) and says so; lookup_number asks for the answer", async () => {
  const lookup = { number: "+4940123", contact: null, area_name: "Hamburg", spam: { is_spam: true, confidence: 70, rating: "C_PING", location: "HH" }, reverse_lookup: { name: "Hermes", category: "Logistik", score: 3, is_spam: false } };
  const { p, calls: sent, root } = makePanel({}, { services: { add_contact: {}, lookup_number: { context: {}, response: lookup } } });
  let asked = p._phoneContact("0401234567", "Hermes Logistik");
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /in das erste Telefonbuch der Box \(„Telefonbuch“\)/);
  assert.match(dialog.innerHTML, /Vorschlag aus der Rückwärtssuche/);
  dialog.querySelector("#ph-ct-name").value = "";
  dialog.querySelector("#dlg-yes").onclick();
  assert.match(dialog.querySelector("#dlg-msg").textContent, /Ohne Namen/);
  dialog.querySelector("#ph-ct-name").value = "Hermes";
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(sent[0], { domain: "fritzbox_phone", service: "add_contact", data: { number: "0401234567", name: "Hermes", phonebook_id: 0 }, target: { device_id: "dph1" }, notify: false, response: false });
  asked = p._phoneLookup("0401234567");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent[1], { domain: "fritzbox_phone", service: "lookup_number", data: { number: "0401234567" }, target: { device_id: "dph1" }, notify: false, response: true });
  assert.match(dialog.innerHTML, /\+4940123[\s\S]*kein Eintrag[\s\S]*Hamburg[\s\S]*Ping-Anruf, 70 % Spamverdacht, HH[\s\S]*Hermes, Logistik, Score 3/);
  assert.doesNotMatch(dialog.innerHTML, /id="dlg-yes"/);
  dialog.querySelector("#dlg-no").onclick();
  await asked;
});

test("a refusal of the box shows in a toast and as a note with the rights; reading goes on", async () => {
  const err = Object.assign(new Error("Die FRITZ!Box hat die Anfrage nicht ausgeführt: 401"), { code: "home_assistant_error", translation_key: "box_request_failed" });
  const { p, root } = makePanel({}, { services: { dial: err } });
  const asked = p._phoneDial("030 1", "");
  root.els["#dialog"].querySelector("#ph-dial-in").value = "030 1";
  root.els["#dialog"].querySelector("#dlg-yes").onclick();
  await asked;
  assert.match(root.els["#toast"].textContent, /Nicht ausgeführt: Die FRITZ!Box hat die Anfrage nicht ausgeführt: 401/);
  assert.match(p._html["phone-view"], /hintline warn[\s\S]*abgelehnt: Die FRITZ!Box hat die Anfrage nicht ausgeführt: 401[\s\S]*FRITZ!Box-Benutzer/);
  assert.equal(p._state.phone.dial, null);
  assert.match(p._html["phone-view"], /Mama/);
});

test("a message plays through auth/sign_path, is marked as read with its key, and the signature is reused", async () => {
  const played = [];
  globalThis.Audio = class {
    constructor() {
      this.src = "";
    }
    addEventListener() {}
    async play() {
      played.push(this.src);
    }
    pause() {
      played.push("pause");
    }
  };
  try {
    const { p, calls: sent, wsCalls } = makePanel({}, { services: { mark_message_read: {} }, ws: { "auth/sign_path": (msg) => ({ path: `${msg.path}&authSig=abc` }) } });
    await p._onPhoneClick({ act: "ph-play", phEnt: "sensor.fb_anrufbeantworter_1", phIdx: "2" });
    assert.deepEqual(wsCalls[0], { type: "auth/sign_path", path: MESSAGES[0].recording_path, expires: 3600 });
    assert.deepEqual(played.filter((x) => x !== "pause"), [`${MESSAGES[0].recording_path}&authSig=abc`]);
    assert.deepEqual(sent[0], { domain: "fritzbox_phone", service: "mark_message_read", data: { entity_id: "sensor.fb_anrufbeantworter_1", message_index: 2, message_key: "07.11.26 10:31|0401234567", read: true }, target: undefined, notify: false, response: undefined });
    assert.match(p._html["phone-view"], /<input type="range" id="ph-seek"[^>]*aria-label="Position in der Aufnahme" aria-valuetext="0:00 von 0:00"/);
    assert.match(p._html["phone-view"], /data-act="ph-play"[^>]*aria-pressed="true" aria-label="Pause"/);
    // the same message again pauses it
    await p._onPhoneClick({ act: "ph-play", phEnt: "sensor.fb_anrufbeantworter_1", phIdx: "2" });
    assert.equal(played.at(-1), "pause");
    assert.equal(p._state.phone.play.paused, true);
    // a new start within 50 minutes asks for no new signature
    p._phoneStop();
    await p._onPhoneClick({ act: "ph-play", phEnt: "sensor.fb_anrufbeantworter_1", phIdx: "2" });
    assert.equal(wsCalls.length, 1);
    // a message without a recording has no play button
    assert.match(p._html["phone-view"], /Keine Aufnahme/);
  } finally {
    delete globalThis.Audio;
  }
});

test("mark, delete and speaker name the message with index and key; the answering machine switch is switch.turn_off", async () => {
  const { p, calls: sent, root } = makePanel({}, { services: { mark_message_read: {}, delete_message: {}, play_message: {} } });
  p._hass.callService = ((orig) => async (...args) => {
    if (args[0] === "switch") {
      sent.push({ domain: args[0], service: args[1], data: args[2] });
      return {};
    }
    return orig(...args);
  })(p._hass.callService);
  const ent = "sensor.fb_anrufbeantworter_1";
  await p._onPhoneClick({ act: "ph-mark", phEnt: ent, phIdx: "0" });
  assert.deepEqual(sent[0].data, { entity_id: ent, message_index: 0, message_key: "04.11.26 17:45|0304567890", read: false });
  assert.equal(sent[0].target, undefined);
  assert.match(root.els["#toast"].textContent, /Als ungelesen markiert/);
  let asked = p._onPhoneClick({ act: "ph-delete", phEnt: ent, phIdx: "2" });
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /Die Nachricht von Hermes Logistik vom 07\.11\.26 10:31 wird auf der FRITZ!Box gelöscht/);
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(sent[1], { domain: "fritzbox_phone", service: "delete_message", data: { entity_id: ent, message_index: 2, message_key: "07.11.26 10:31|0401234567" }, target: undefined, notify: false, response: false });
  asked = p._onPhoneClick({ act: "ph-speaker", phEnt: ent, phIdx: "2" });
  assert.match(dialog.innerHTML, /<option value="media_player\.kueche">Küche<\/option>/);
  dialog.querySelector("#ph-mp").value = "media_player.kueche";
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(sent[2].data, { entity_id: ent, message_index: 2, message_key: "07.11.26 10:31|0401234567", media_player: "media_player.kueche" });
  assert.match(root.els["#toast"].textContent, /läuft auf Küche/);
  await p._onPhoneClick({ act: "ph-tamsw", phEnt: "switch.fb_anrufbeantworter_1_aktiv", phVal: "0", phName: "Anrufbeantworter 1" });
  assert.deepEqual(sent[3], { domain: "switch", service: "turn_off", data: { entity_id: "switch.fb_anrufbeantworter_1_aktiv" } });
  assert.match(root.els["#toast"].innerHTML, /Anrufbeantworter 1 ausgeschaltet\.[\s\S]*Rückgängig/);
});

test("in privacy mode the delete question names nobody", async () => {
  const { p, root } = makePanel({ privacy: true }, { services: { delete_message: {} } });
  const asked = p._onPhoneClick({ act: "ph-delete", phEnt: "sensor.fb_anrufbeantworter_1", phIdx: "2" });
  assert.match(root.els["#dialog"].innerHTML, /Die Nachricht vom 07\.11\.26 10:31/);
  assert.doesNotMatch(root.els["#dialog"].innerHTML, /Hermes/);
  root.els["#dialog"].querySelector("#dlg-no").onclick();
  await asked;
});

test("filters, search and the view switch only change what is drawn", () => {
  const { p, html } = makePanel();
  p._onPhoneClick({ act: "ph-filter", phVal: "spam" });
  let out = p._html["phone-view"];
  assert.match(out, /data-ph-val="spam" data-k="ph-f-spam" aria-pressed="true"/);
  assert.match(out, /2 von 9 Anrufen angezeigt/);
  p._onPhoneInput({ id: "ph-q", value: "köln" });
  assert.match(p._html["phone-view"], /1 von 9 Anrufen angezeigt/);
  p._state.phone.query = "zzz";
  out = html();
  assert.match(out, /Keine Anrufe für diese Auswahl[\s\S]*data-act="ph-reset"/);
  p._onPhoneClick({ act: "ph-reset" });
  assert.equal(p._state.phone.filter, "all");
  p._onPhoneClick({ act: "ph-view", phVal: "stats" });
  assert.match(p._html["phone-view"], /Wann es klingelt/);
  p._onPhoneClick({ act: "ph-jump", phTam: "0", phIdx: "2" });
  assert.equal(p._state.phone.view, "list");
  assert.ok(p._state.phone.expanded.has("m:sensor.fb_anrufbeantworter_1:2"));
});

test("the phone texts exist in both languages with the same shape", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(keys(t.phone).sort(), keys(en.phone).sort());
  assert.equal(en.tabs.phone, "Phone");
  assert.equal(t.tabs.boxOverview, "Übersicht");
  for (const r of model.RATINGS) assert.ok(t.phone.rating[r] && en.phone.rating[r]);
  for (const ty of model.CALL_TYPES) assert.ok(t.phone.calls.type[ty] && en.phone.calls.type[ty]);
});
