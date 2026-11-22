/* The overview (tiles and the notes of all pages), the command palette and the links that open a page with something chosen. */

import assert from "node:assert/strict";
import test from "node:test";

const base = "../../custom_components/fritzbox_network/frontend/";
const shared = await import(`${base}shared.js`);
const texts = await import(`${base}texts.js`);
const overview = await import(`${base}panel-overview.js`);
const palette = await import(`${base}panel-palette.js`);
const capture = await import(`${base}panel-capture.js`);

const t = texts.panelTexts("de");
const en = texts.panelTexts("en");
const NOW = Date.parse("2026-11-07T14:00:00Z");
const ago = (days) => new Date(NOW - days * 86400000).toISOString();

const client = (over) => ({ id: "aabbccddee01", mac: "aa:bb:cc:dd:ee:01", name: "Gerät", online: true, link_type: "lan", created_at: ago(100), last_online: ago(0), ...over });

// ---------- links ----------

test("a link can name what its page should show chosen; old links keep working, the start is the overview", () => {
  assert.deepEqual(shared.routeFromHash(""), { tab: "overview", device: null });
  assert.deepEqual(shared.routeFromHash("#/"), { tab: "overview", device: null });
  assert.deepEqual(shared.routeFromHash("#/overview"), { tab: "overview", device: null });
  assert.deepEqual(shared.routeFromHash("#/net"), { tab: "net", device: null });
  assert.deepEqual(shared.routeFromHash("#/capture?mac=aa:bb:cc:dd:ee:01"), { tab: "capture", device: null });
  assert.deepEqual(shared.hashParams("#/capture?mac=aa:bb:cc:dd:ee:01"), { mac: "aa:bb:cc:dd:ee:01" });
  assert.deepEqual(shared.hashParams("#/net?filter=new&q=nas%201"), { filter: "new", q: "nas 1" });
  assert.deepEqual(shared.hashParams("#/net"), {});
  assert.equal(shared.pageHash("capture", { mac: "aa:bb:cc:dd:ee:01" }), "#/capture?mac=aa:bb:cc:dd:ee:01");
  assert.equal(shared.pageHash("net", { filter: "new", q: "" }), "#/net?filter=new");
  assert.equal(shared.pageHash("overview"), "#/overview");
  // a device by its MAC, also with colons or in capitals
  assert.equal(shared.deviceFromHash("#/device/aabbccddee01"), "aabbccddee01");
  assert.equal(shared.deviceFromHash("#/device/AA:BB:CC:DD:EE:01"), "aabbccddee01");
  assert.equal(shared.deviceFromHash("#/device/aa-bb-cc-dd-ee-01"), "aabbccddee01");
  assert.equal(shared.deviceFromHash("#/device/aabbcc"), null);
  assert.deepEqual(shared.routeFromHash("#/device/AA:BB:CC:DD:EE:01"), { tab: "net", device: "aabbccddee01" });
});

test("a device chosen for the capture moves the choice off an interface of the internet side", () => {
  const interfaces = [{ id: "2-0" }, { id: "1-lan" }];
  const form = { interface: "2-0", seconds: 60, mb: 50, mac: "" };
  assert.deepEqual(capture.captureForDevice(form, "AA:BB", interfaces), { interface: "1-lan", seconds: 60, mb: 50, mac: "aa:bb" });
  // not known yet which interfaces there are: the choice stays, the page fixes it once it has read them
  assert.equal(capture.captureForDevice(form, "aa:bb", null).interface, "2-0");
  assert.equal(capture.captureForDevice({ ...form, interface: "1-vap0" }, "aa:bb", interfaces).interface, "1-vap0");
});

// ---------- overview ----------

test("nothing stands out: no notes, and the tiles say what is there", () => {
  const state = {
    data: { clients: [client(), client({ id: "x2", mac: "x2", online: false })], nodes: [{ mac: "m", name: "Box", role: "master", model: "FRITZ!Box 7590", radios: {} }], internet: { connected: true, uptime: 3700, throughput: { down: 34100, up: 1300 } } },
  };
  assert.deepEqual(overview.collectIssues(state, t, NOW), []);
  const tiles = overview.overviewTiles(state, t, { now: NOW, language: "de" });
  assert.deepEqual(tiles.map((x) => x.id), ["internet", "net", "wlan", "box"]);
  assert.deepEqual(tiles[0], { id: "internet", href: "#/internet", label: "Internet", value: "34,1", unit: "Mbit/s", sub: "Verbunden · 1 Std. 1 Min.", tone: "ok" });
  assert.equal(tiles[1].value, "1");
  assert.equal(tiles[1].unit, "/ 2");
  assert.equal(tiles[1].sub, "online");
  // the box before box/info answered: its model
  assert.equal(tiles[3].value, "–");
  assert.equal(tiles[3].sub, "FRITZ!Box 7590");
  const html = overview.renderOverview(state, { t, now: NOW, language: "de", canWrite: true });
  assert.match(html, /<h1 id="dtitle" tabindex="-1" class="sr">Übersicht<\/h1>/);
  assert.match(html, /class="chip ok"><i class="dot on" aria-hidden="true"><\/i>Alles in Ordnung/);
  assert.match(html, /data-act="reconnect"/);
  assert.doesNotMatch(html, /href="#\/capture"|data-key="guest"/);
  const withGuest = { ...state, wlan: { networks: [], guest: { enabled: true, ssid: "Gäste" } } };
  const guestHtml = overview.renderOverview(withGuest, { t, now: NOW, canWrite: true });
  assert.match(guestHtml, /role="switch" aria-checked="true"[^>]*data-act="wlan-switch" data-key="guest" data-on="0"/);
  assert.match(guestHtml, /an · Gäste/);
  assert.match(overview.renderOverview(withGuest, { t, now: NOW, canWrite: false }), /data-key="guest"[^>]*disabled/);
  assert.doesNotMatch(overview.renderOverview(state, { t, now: NOW, canWrite: false }), /data-act="reconnect"/);
});

test("the notes of all pages come together in one list, the most serious first, each with the page that deals with it", () => {
  const state = {
    threshold: -75,
    data: {
      clients: [
        client({ id: "n1", mac: "n1", name: "Pixel 9", created_at: ago(1) }),
        client({ id: "s1", mac: "s1", name: "Alt", online: false, last_online: ago(60) }),
        client({ id: "w1", mac: "w1", name: "Handy", link_type: "wlan", band: "5ghz", ap_mac: "m", signal_dbm: -85, wan_access: false }),
      ],
      nodes: [{ mac: "m", name: "Box", role: "master", radios: { "5ghz": { utilization: 88 } } }],
      internet: { connected: false },
      firmware: { installed: "8.0", latest: "8.1" },
    },
    boxRestart: { phase: "late" },
    routes: { entries: [{ network: "10.0.0.0/8", gateway: "192.168.178.60", enabled: true, gateway_online: false, device_name: "Keller" }] },
    ports: { entries: [{ description: "NAS", protocol: "TCP", external_port: 443, enabled: true, device_online: false }, { description: "x", protocol: "UDP", external_port: 1, enabled: false }] },
    phoneFound: true,
    phoneMissed: 2,
    phoneUnread: 1,
  };
  const issues = overview.collectIssues(state, t, NOW);
  assert.deepEqual(
    issues.map((i) => [i.level, i.key]),
    [
      ["bad", "inet-down"],
      ["bad", "box-late"],
      ["bad", "radio-busy"],
      ["warn", "route-down"],
      ["warn", "ports-open"],
      ["info", "radio-weak"],
      ["info", "net-firmware"],
      ["info", "devices-new"],
      ["info", "devices-stale"],
      ["info", "phone-missed"],
      ["info", "phone-messages"],
    ]
  );
  const by = Object.fromEntries(issues.map((i) => [i.key, i]));
  // the detail is the text the page itself shows
  assert.equal(by["inet-down"].detail, t.inet.hints.down);
  assert.equal(by["radio-busy"].title, "Funk 5 GHz: hohe Auslastung");
  assert.equal(by["radio-busy"].href, "#/wlan");
  assert.equal(by["route-down"].detail, "Keller ist offline. Der Verkehr an 10.0.0.0/8 geht ins Leere, bis es wieder da ist.");
  assert.equal(by["ports-open"].title, "1 Portfreigabe offen aus dem Internet");
  assert.equal(by["ports-open"].detail, "Davon führt eine zu einem Gerät, das offline ist.");
  assert.equal(by["devices-new"].title, "1 neues Gerät im Netz");
  assert.equal(by["devices-new"].detail, "Pixel 9");
  // the list opens with the filter of the new devices chosen
  assert.equal(by["devices-new"].href, "#/net?filter=new");
  assert.equal(by["devices-stale"].href, "#/cleanup");
  assert.equal(by["phone-missed"].title, "2 verpasste Anrufe heute");
  // without FRITZ!Box Telefon there is no phone note, and none for what was not read yet
  const quiet = overview.collectIssues({ ...state, phoneFound: false, routes: null, ports: "failed" }, en, NOW).map((i) => i.key);
  assert.equal(quiet.some((k) => k.startsWith("phone") || k === "route-down" || k === "ports-open"), false);
  const html = overview.renderOverview(state, { t, now: NOW, canWrite: true });
  assert.match(html, /<li class="issue"><span class="ic bad" aria-hidden="true">/);
  assert.match(html, /<a class="tlink" href="#\/routes">Routen ›<\/a>/);
  assert.doesNotMatch(html, /Alles in Ordnung/);
  // the tiles: blocked and new devices, the radio verdict, the phone
  const tiles = Object.fromEntries(overview.overviewTiles({ ...state, boxRestart: null, box: { uptime_seconds: 2000000, cpu_load: 22, cpu_temperature: 74.4 } }, t, { now: NOW, language: "de" }).map((x) => [x.id, x]));
  assert.equal(tiles.net.sub, "online · 1 neu · 1 gesperrt");
  assert.equal(tiles.wlan.value, "1");
  assert.equal(tiles.wlan.tone, "warn");
  assert.equal(tiles.box.value, "23");
  assert.equal(tiles.box.unit, "d");
  assert.equal(tiles.box.sub, "CPU 22 % · 74 °C");
  assert.deepEqual([tiles.phone.value, tiles.phone.sub], ["2", "1 neue Nachricht"]);
  assert.equal(tiles.internet.tone, "bad");
});

test("the texts of the overview and the palette are there in both languages", () => {
  const keys = (o, prefix = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  assert.deepEqual(keys(t.overview).sort(), keys(en.overview).sort());
  assert.deepEqual(keys(t.palette).sort(), keys(en.palette).sort());
});

// ---------- command palette ----------

const devices = [
  client({ id: "d1", mac: "3c:28:6d:11:22:33", name: "Pixel 9 Anna", ip: "192.168.178.34", link_type: "wlan", band: "5ghz" }),
  client({ id: "d2", mac: "3c:28:6d:44:55:66", name: "Annas MacBook", ip: "192.168.178.51" }),
  client({ id: "d3", mac: "00:11:32:aa:bb:cc", name: "NAS", ip: "192.168.178.20", hostname: "diskstation" }),
];
const pages = [
  { id: "overview", group: "overview" },
  { id: "net", group: "net" },
  { id: "wlan", group: "net" },
  { id: "internet", group: "internet" },
  { id: "ports", group: "internet" },
  { id: "capture", group: "box" },
  { id: "filter", group: "devices" },
  { id: "cleanup", group: "devices" },
];

test("the palette finds devices by name, address and MAC, pages and actions in both languages", () => {
  const entries = palette.paletteEntries({ clients: devices, pages, canWrite: true, internet: true }, t);
  const labels = (query) => palette.searchPalette(query, entries).map((g) => [g.id, g.items.map((i) => i.label)]);
  // "ann": both devices of Anna, the one whose name starts with it first; the best brings its capture
  assert.deepEqual(labels("ann"), [
    ["devices", ["Annas MacBook", "Pixel 9 Anna"]],
    ["actions", ["Verkehr von „Annas MacBook“ mitschneiden"]],
  ]);
  assert.deepEqual(labels("178.20")[0], ["devices", ["NAS"]]);
  assert.deepEqual(labels("3c286d1122")[0], ["devices", ["Pixel 9 Anna"]]);
  assert.deepEqual(labels("diskst")[0], ["devices", ["NAS"]]);
  // pages under their German and English names, with the tab before the page
  assert.deepEqual(labels("port")[0], ["pages", ["Internet › Portfreigaben"]]);
  assert.deepEqual(labels("port forwarding")[0], ["pages", ["Internet › Portfreigaben"]]);
  assert.deepEqual(labels("aufr")[0], ["pages", ["Verwalten › Aufräumen"]]);
  assert.deepEqual(labels("uber"), [["pages", ["Übersicht"]]]);
  // actions, also the ones that only show on a search
  assert.deepEqual(labels("reconnect"), [["actions", ["Internet neu verbinden"]]]);
  assert.deepEqual(labels("dunkel"), [["actions", ["Darstellung: dunkel"]]]);
  assert.deepEqual(labels("zzzz"), []);
  const top = palette.searchPalette("pixel", entries);
  assert.equal(top[0].items[0].hash, "#/device/d1");
  assert.equal(top[1].items[0].hash, "#/capture?mac=3c:28:6d:11:22:33");
  assert.equal(top[0].items[0].sub, "192.168.178.34 · WLAN 5 GHz");
  // without a search: the pages and the actions, no device and no look of its own
  const start = palette.searchPalette("", entries);
  assert.deepEqual(start.map((g) => g.id), ["pages", "actions"]);
  assert.equal(start[1].items.some((i) => i.act === "look-dark"), false);
  // without the right to change settings: no reconnect, no restart
  const reader = palette.paletteEntries({ clients: devices, pages, canWrite: false, internet: true }, t);
  assert.equal(reader.some((e) => e.act === "reconnect" || e.act === "reboot"), false);
});

test("a search keeps to six per group; every word must fit somewhere", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ group: "devices", id: `x${i}`, label: `Lampe ${i}`, keywords: [] }));
  assert.equal(palette.searchPalette("lampe", many)[0].items.length, palette.PALETTE_LIMIT);
  assert.equal(palette.scoreEntry("lampe 3", many[3]) > 0, true);
  assert.equal(palette.scoreEntry("lampe 3", many[4]), null);
  assert.equal(palette.scoreEntry("", many[0]), 0);
  // the start of the label counts more than a word inside it, a word more than letters in order
  const a = { label: "WLAN", keywords: [] };
  const b = { label: "Gast-WLAN", keywords: [] };
  const c = { label: "Wireless LAN", keywords: [] };
  assert.ok(palette.scoreEntry("wlan", a) > palette.scoreEntry("wlan", b));
  assert.ok(palette.scoreEntry("wlan", b) > palette.scoreEntry("wlan", c));
  assert.ok(palette.scoreEntry("wlan", c) > 0);
});

test("the arrows go round the options, Tab to the first of the next group", () => {
  const groups = [{ items: [1, 2] }, { items: [3] }, { items: [4, 5, 6] }];
  assert.equal(palette.paletteMove(groups, 0, "ArrowDown"), 1);
  assert.equal(palette.paletteMove(groups, 5, "ArrowDown"), 0);
  assert.equal(palette.paletteMove(groups, 0, "ArrowUp"), 5);
  assert.equal(palette.paletteMove(groups, 1, "Tab"), 2);
  assert.equal(palette.paletteMove(groups, 2, "Tab"), 3);
  assert.equal(palette.paletteMove(groups, 4, "Tab"), 0);
  assert.equal(palette.paletteMove(groups, 0, "Tab", true), 3);
  assert.equal(palette.paletteMove([], 0, "ArrowDown"), 0);
  assert.equal(palette.paletteItem(groups, 3), 4);
  const html = palette.renderPaletteList([{ id: "pages", items: [{ label: "WLAN", icon: "right" }] }], { t, query: "w", sel: 0 });
  assert.match(html, /role="group" aria-labelledby="pal-g-pages"/);
  assert.match(html, /role="option" id="pal-o-0" data-pal="0" aria-selected="true"/);
  assert.match(palette.renderPaletteList([], { t, query: "xy ", sel: 0 }), /Nichts gefunden für „xy“/);
  assert.match(palette.renderPalette(t), /role="dialog" aria-modal="true"[\s\S]*role="combobox" aria-expanded="true" aria-controls="pal-list"[\s\S]*role="listbox"/);
});

test("the tiles show a course where there is one, and the phone the calls of today by kind", () => {
  const samples = [[1, 10000, 500], [2, 20000, 500], [3, 15000, 500]];
  const history = { a: { online: [1, 1, null, 0] }, b: { online: [1, 0, null, 0] }, c: { online: [null, null, null, 1] } };
  assert.deepEqual(overview.onlineCounts(history, ["a", "b"]), [2, 1, null, 0]);
  assert.deepEqual(overview.onlineCounts(history, ["a", "b", "c"]), [2, 1, null, 1]);
  assert.equal(overview.onlineCounts(history, ["zz"]), null);
  assert.equal(overview.onlineCounts(null, ["a"]), null);
  assert.equal(overview.onlineCounts({ a: { online: [1, null, null] } }, ["a"]), null);
  const clients = [client({ mac: "a", link_type: "wlan" }), client({ id: "x2", mac: "b" })];
  const state = {
    data: { clients, nodes: [], internet: { connected: true, throughput: { down: 1, up: 1 }, samples } },
    history,
    boxSpark: [[1, 10], [2, 20], [3, null], [4, 30]],
    box: { uptime_seconds: 1000, cpu_load: 30 },
    phoneFound: true,
    phoneUnread: 1,
    phoneMissed: 1,
    phoneToday: { n: 4, in: 2, out: 1, missed: 1 },
  };
  const tiles = Object.fromEntries(overview.overviewTiles(state, t, { now: NOW, language: "de" }).map((x) => [x.id, x]));
  assert.deepEqual(tiles.internet.spark, { values: [10000, 20000, 15000], min: 0, pts: [[1, 10000], [2, 20000], [3, 15000]], fmt: "rate" });
  assert.deepEqual(tiles.net.spark.values, [2, 1, null, 0]);
  assert.equal("bar" in tiles.net, false);
  assert.deepEqual(tiles.wlan.spark.values, [1, 1, null, 0]);
  assert.deepEqual(tiles.box.spark, { values: [10, 20, null, 30], min: 0, max: 100, pts: [[1, 10], [2, 20], [3, null], [4, 30]], unit: "%" });
  assert.deepEqual(tiles.net.spark.pts.map((p) => p[1]), [2, 1, null, 0]);
  assert.equal(tiles.net.spark.pts[3][0], Math.round(NOW / 1000));
  assert.deepEqual([tiles.phone.value, tiles.phone.unit, tiles.phone.sub, tiles.phone.tone], ["4", "Anrufe heute", "1 verpasst · 1 neue Nachricht", "warn"]);
  assert.deepEqual(tiles.phone.seg.map((p) => p.n), [2, 1, 1]);
  const html = overview.renderOverview(state, { t, now: NOW, language: "de" });
  assert.equal((html.match(/class="tspark"/g) ?? []).length, 4);
  assert.match(html, /<span class="tseg"/);
  // without a course the tiles keep their bars
  const bare = Object.fromEntries(overview.overviewTiles({ ...state, history: null, boxSpark: null, data: { ...state.data, internet: { connected: true, throughput: { down: 1, up: 1 } } }, phoneToday: null }, t, { now: NOW, language: "de" }).map((x) => [x.id, x]));
  assert.equal(bare.internet.spark, undefined);
  assert.equal(typeof bare.net.bar, "number");
  assert.equal(typeof bare.box.bar, "number");
  assert.deepEqual([bare.phone.value, bare.phone.unit], ["1", "verpasst"]);
});

test("the last 24 hours: connection events, new devices and a restart of the box, newest first", () => {
  const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
  const state = {
    data: {
      clients: [client({ name: "Alt", created_at: ago(30) }), client({ id: "n1", mac: "n1", name: "Pixel", created_at: hoursAgo(5) })],
      internet: { events: [{ time: hoursAgo(2), kind: "reconnected", detail: null }, { time: hoursAgo(30), kind: "disconnected", detail: null }] },
    },
    box: { uptime_seconds: 3600 * 8 },
  };
  const events = overview.todayEvents(state, t, NOW);
  assert.deepEqual(events.map((e) => [e.kind, e.text]), [["internet", "Verbindung neu aufgebaut"], ["device", "Neues Gerät: Pixel"], ["box", "Box neu gestartet"]]);
  assert.deepEqual(events.map((e) => e.href), ["#/internet", "#/net?filter=new", "#/box"]);
  // more than three new devices are summed up; nothing happened: the card says so
  const many = { data: { clients: ["a", "b", "c", "d", "e"].map((n, i) => client({ id: n, mac: n, name: n, created_at: hoursAgo(1 + i) })) } };
  assert.deepEqual(overview.todayEvents(many, t, NOW).map((e) => e.text), ["Neues Gerät: a", "Neues Gerät: b", "Neues Gerät: c", "2 weitere neue Geräte"]);
  const html = overview.renderOverview({ data: { clients: [], internet: null } }, { t, now: NOW, language: "de" });
  assert.match(html, /In den letzten 24 Stunden wurde nichts vermerkt/);
  assert.match(overview.renderOverview(state, { t, now: NOW, language: "de" }), /class="tev internet" href="#\/internet"/);
});

test("the card of the data volume lists the devices by what they moved, for a day or a week", () => {
  const now = new Date(2026, 10, 7, 14);
  const traffic = {
    a: { "2026-11-07": [100, 50], "2026-11-03": [900, 0] },
    b: { "2026-11-07": [10, 10] },
    gone: { "2026-11-06": [5000, 0] },
  };
  const clients = [client({ id: "a1", mac: "a", name: "NAS" }), client({ id: "b1", mac: "b", name: "TV" })];
  assert.deepEqual(overview.topConsumers(traffic, clients, 1, now).map((r) => [r.name, r.total]), [["NAS", 150], ["TV", 20]]);
  assert.deepEqual(overview.topConsumers(traffic, clients, 7, now).map((r) => [r.name, r.id]), [["gone", null], ["NAS", "a1"], ["TV", "b1"]]);
  assert.equal(overview.topConsumers(traffic, clients, 7, now, 1).length, 1);
  const state = { data: { clients }, traffic };
  const html = overview.renderOverview(state, { t, now: now.getTime(), language: "de" });
  assert.match(html, /Datenverbrauch/);
  assert.match(html, /data-act="ov-traffic" data-ovdays="1" aria-pressed="true"/);
  assert.match(html, /href="#\/device\/a1">NAS</);
  assert.match(overview.renderOverview({ ...state, ovTrafficDays: 7 }, { t, now: now.getTime(), language: "de" }), /data-ovdays="7" aria-pressed="true"/);
  assert.match(overview.renderOverview({ data: { clients } }, { t, now: now.getTime(), language: "de" }), /ov-consumers[\s\S]*Lädt/);
  assert.match(overview.renderOverview({ data: { clients }, traffic: {} }, { t, now: now.getTime(), language: "de" }), /Noch kein Datenverkehr vermerkt/);
});

test("the quick actions: reading again for everyone, the restart of the box only with the right to write and not while it restarts", () => {
  const state = { data: { clients: [], internet: { connected: true } } };
  const html = (over, ctx = {}) => overview.renderOverview({ ...state, ...over }, { t, now: NOW, language: "de", canWrite: true, ...ctx });
  assert.match(html({}), /data-act="ov-rescan"[^>]*><span class="ic"[^>]*>[\s\S]*?Geräte neu einlesen/);
  assert.match(html({}), /data-act="reboot" data-k="ov-reboot" aria-haspopup="dialog"[\s\S]*?Box neu starten/);
  assert.doesNotMatch(html({}, { canWrite: false }), /data-act="reboot"/);
  assert.doesNotMatch(html({ boxRestart: { phase: "down" } }), /data-act="reboot"/);
  assert.match(html({}, { canWrite: false }), /data-act="ov-rescan"/);
  assert.match(html({}, { rescanBusy: true }), /data-act="ov-rescan"[^>]* disabled/);
});
