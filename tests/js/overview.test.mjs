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
  assert.deepEqual(tiles.map((x) => x.id), ["internet", "net", "box", "wlan"]);
  assert.deepEqual(tiles[0], { id: "internet", href: "#/internet", label: "Internet", value: "34,1", unit: "Mbit/s", sub: "Verbunden · 1 Std. 1 Min.", tone: "ok" });
  assert.equal(tiles[1].value, "1");
  assert.equal(tiles[1].unit, "/ 2");
  assert.equal(tiles[1].sub, "online");
  // the box before box/info answered: its model
  assert.equal(tiles[2].value, "–");
  assert.equal(tiles[2].sub, "FRITZ!Box 7590");
  const html = overview.renderOverview(state, { t, now: NOW, language: "de", canWrite: true });
  assert.match(html, /<h1 id="dtitle" tabindex="-1">Übersicht<\/h1>/);
  assert.match(html, /class="chip ok"><i class="dot on" aria-hidden="true"><\/i>Alles in Ordnung/);
  assert.match(html, /data-act="reconnect"/);
  assert.match(html, /href="#\/capture"/);
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
