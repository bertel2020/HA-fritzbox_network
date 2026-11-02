import assert from "node:assert/strict";
import test from "node:test";

globalThis.HTMLElement = class {};

const base = "../../custom_components/fritzbox_network/frontend/";
const network = await import(`${base}panel-network.js`);
const device = await import(`${base}panel-device.js`);
const texts = await import(`${base}texts.js`);
const cleanup = await import(`${base}panel-cleanup.js`);
const filter = await import(`${base}panel-filter.js`);
const panel = await import(`${base}fritzbox-network-panel.js`);
const map = await import(`${base}panel-map.js`);
const shared = await import(`${base}shared.js`);

const t = texts.panelTexts("de");
const NOW = Date.parse("2026-11-01T12:00:00Z");
const day = (n) => new Date(NOW - n * 86400000).toISOString();

const data = {
  can_write: true,
  nodes: [
    { mac: "aa", name: "Box", role: "master", radios: { "5ghz": { channel: 100, utilization: 85, noise_dbm: -95 } } },
    { mac: "bb", name: "Repeater", role: "slave", radios: {} },
  ],
  clients: [
    {
      mac: "01", id: "000000000001", name: "tv <b>", ip: "192.0.2.1", vendor: "ACME", online: true, ap_mac: "aa",
      link_type: "lan", rate_download: 1000, rate_upload: 1000, wan_access: false, created_at: day(100),
      entity_id: "device_tracker.tv", device_id: "d1",
      actions: { internet_access: "switch.tv_i", priority: "switch.tv_p", wake_on_lan: "button.tv_w", access_profile: "select.tv_s" },
    },
    { mac: "02", id: "000000000002", name: "old", ip: null, online: false, ap_mac: null, link_type: null, last_online: day(3), actions: {} },
  ],
};
const state = { data, filter: "all", query: "", sort: "name", group: "ap", closed: new Set(), sel: null, threshold: 1 / 3 };
const hass = {
  states: {
    "switch.tv_i": { state: "off" },
    "switch.tv_p": { state: "on" },
    "button.tv_w": { state: "unknown" },
    "select.tv_s": { state: "Kinder", attributes: { options: ["Standard", "Kinder"] } },
  },
};

test("the when text says today, yesterday, days or unknown", () => {
  assert.equal(network.whenText(day(0), NOW, t), "heute");
  assert.equal(network.whenText(day(1), NOW, t), "gestern");
  assert.equal(network.whenText(day(5), NOW, t), "vor 5 Tagen");
  assert.equal(network.whenText(null, NOW, t), "unbekannt");
});

test("the filter row has three fixed chips with a number and the button for the menu", () => {
  const html = network.renderChips(state, t, NOW);
  assert.match(html, /data-filter="all"[^>]*>Alle<b>2<\/b>/);
  assert.match(html, /data-filter="online"[^>]*>Online<b>1<\/b>/);
  assert.match(html, /data-filter="offline"[^>]*>Offline<b>1<\/b>/);
  assert.doesNotMatch(html, /data-filter="blocked"/);
  // LAN, blocked, no access point; "new" needs a time on record, which "old" lacks
  assert.match(html, /id="morebtn"[^>]*aria-expanded="false"[^>]*aria-label="Weitere Filter, 3 verfügbar"/);
  assert.equal(network.renderFilterMenu(state, t, NOW), "");
});

test("the menu offers the other filters with something to show, and the chosen one", () => {
  const html = network.renderFilterMenu({ ...state, menu: true }, t, NOW);
  assert.match(html, /role="menu"/);
  assert.match(html, /role="menuitemradio" aria-checked="false" data-filter="blocked"[^>]*>.*Gesperrt<\/span><b>1<\/b>/);
  assert.doesNotMatch(html, /data-filter="guest"/);
  assert.doesNotMatch(html, /data-filter="online"/);
  const chosen = network.renderFilterMenu({ ...state, menu: true, filter: "guest" }, t, NOW);
  assert.match(chosen, /aria-checked="true" data-filter="guest"/);
});

test("a chosen other filter stands as a chip with ×, which goes back to all", () => {
  const html = network.renderChips({ ...state, filter: "blocked" }, t, NOW);
  assert.match(html, /data-filter="all" data-k="f-active" aria-pressed="true" aria-label="Filter Gesperrt entfernen">Gesperrt<b>1<\/b><span class="x">/);
  assert.match(html, /data-filter="all" data-k="f-all" aria-pressed="false"/);
});

test("the menu logic counts what is on offer and keeps a chosen group without devices", () => {
  const menu = shared.filterMenu(groupData, "label:gone", NOW);
  assert.deepEqual(menu.primary.map((f) => f.id), ["all", "online", "offline"]);
  assert.deepEqual(menu.others.map((f) => f.id), ["lan", "blocked", "unassigned"]);
  assert.equal(menu.active, "label:gone");
  assert.deepEqual(menu.labels.map((l) => [l.id, l.count]), [["kids", 1]]);
  assert.equal(menu.available, 4);
  const kept = shared.filterMenu({ ...groupData, labels: [...groupData.labels, { id: "gone", name: "Gone" }] }, "label:gone", NOW);
  assert.deepEqual(kept.labels.map((l) => [l.id, l.count]), [["kids", 1], ["gone", 0]]);
  assert.equal(kept.available, 4);
  assert.equal(shared.filterMenu(groupData, "online", NOW).active, null);
});

test("the groups show access points with radios, names are escaped", () => {
  const html = network.renderGroups(state, t, NOW);
  assert.match(html, /Box/);
  assert.match(html, /1 LAN/);
  assert.match(html, /Kanal 100/);
  assert.match(html, /85 % Auslastung/);
  assert.match(html, /tv &lt;b&gt;/);
  assert.doesNotMatch(html, /tv <b>/);
  assert.match(html, /Nicht zugeordnet/);
  assert.match(html, /zuletzt online vor 3 Tagen/);
});

test("nothing to show gives an empty state", () => {
  const html = network.renderGroups({ ...state, query: "zzz" }, t, NOW);
  assert.match(html, /Keine passenden Geräte/);
});

test("a closed access point shows no devices", () => {
  const html = network.renderGroups({ ...state, closed: new Set(["aa"]) }, t, NOW);
  assert.match(html, /ap closed/);
});

test("an action needs the right, an IP address and its entity", () => {
  const client = data.clients[0];
  assert.equal(device.actionStatus(client, "internet_access", hass, false).reason, "noRights");
  assert.equal(device.actionStatus({ ...client, ip: null }, "internet_access", hass, true).reason, "noIp");
  // the device has the entity, Home Assistant shows no state: it is switched off in the registry
  assert.equal(device.actionStatus(client, "priority", { states: {} }, true).reason, "disabled");
  assert.equal(device.actionStatus(client, "priority", { states: { "switch.tv_p": { state: "unavailable" } } }, true).reason, "noEntity");
  assert.equal(device.actionStatus({ ...client, actions: {} }, "priority", hass, true).reason, "noEntity");
  assert.equal(device.actionStatus(client, "priority", hass, true).reason, null);
  assert.equal(
    device.actionStatus({ ...client, ip: null }, "wake_on_lan", hass, true, { needsIp: false }).reason,
    null
  );
  assert.equal(device.entityState({ states: { x: { state: "unavailable" } } }, "x"), null);
});

test("the device page shows the data and the actions", () => {
  const html = device.renderDevice(data.clients[0], { t, now: NOW, data, hass, threshold: 1 / 3 });
  assert.match(html, /<h1 id="dtitle" tabindex="-1">tv &lt;b&gt;<\/h1>/);
  assert.match(html, /Gesperrt: das Gerät kommt nicht ins Internet/);
  assert.match(html, /data-sw="internet_access" data-entity="switch.tv_i"/);
  assert.match(html, /aria-checked="false"[^>]*data-sw="internet_access"/);
  assert.match(html, /aria-checked="true"[^>]*data-sw="priority"/);
  assert.match(html, /<option selected>Kinder<\/option>/);
});

test("without the right the actions are off and say why", () => {
  const html = device.renderDevice(data.clients[0], {
    t, now: NOW, data: { ...data, can_write: false }, hass, threshold: 1 / 3,
  });
  assert.match(html, /FRITZ!Box Einstellungen/);
  assert.match(html, /role="switch"[^>]*disabled/);
});

test("only an offline device can be woken", () => {
  const ctx = { t, now: NOW, data, hass, threshold: 1 / 3 };
  assert.match(device.renderDevice(data.clients[0], ctx), /data-act="wol"[^>]*disabled/);
  const offline = { ...data.clients[0], online: false, ip: null };
  assert.doesNotMatch(device.renderDevice(offline, ctx), /data-act="wol"[^>]*disabled/);
});

test("an unknown device shows a hint and the way back", () => {
  const html = device.renderDevice(null, { t, now: NOW, data, hass, view: "map" });
  assert.match(html, /Gerät nicht gefunden/);
  assert.match(html, /data-act="back"[^>]*>.*Netzkarte<\/button>/);
});

test("the device page is a page of its own: back to where it came from, paging, the connection path", () => {
  const pager = shared.pagerFor(data.clients, "000000000001");
  const html = device.renderDevice(data.clients[0], { t, now: NOW, data, hass, threshold: 1 / 3, pager, view: "list" });
  assert.match(html, /data-act="back"[^>]*>.*Liste<\/button>/);
  assert.match(html, /<span aria-hidden="true">1 \/ 2<\/span>/);
  assert.match(html, /data-go="" data-k="prev"[^>]*disabled/);
  assert.match(html, /data-go="000000000002" data-k="next" aria-label="Nächstes Gerät: old"/);
  assert.match(html, /class="path" role="img" aria-label="Verbindungsweg: Internet, Box, tv &lt;b&gt; über LAN"/);
  assert.match(html, /data-act="show-map"/);
});

test("the connection path goes through the repeater with the line of its uplink", () => {
  const nodes = [data.nodes[0], { ...data.nodes[1], uplink: { type: "wlan", band: "5ghz", signal_dbm: -58 } }];
  const client = { ...data.clients[0], ap_mac: "bb", link_type: "wlan", band: "2_4ghz", signal_dbm: -70 };
  const steps = device.connectionPath(client, { nodes }, t, 1 / 3);
  assert.deepEqual(steps.filter((s) => s.kind).map((s) => s.name), ["Internet", "Box", "Repeater", "tv <b>"]);
  assert.deepEqual(steps.filter((s) => !s.kind).map((s) => [s.style, s.text]), [
    ["plain", ""],
    ["wlan", "WLAN 5 GHz · -58 dBm"],
    ["wlan", "WLAN 2,4 GHz · -70 dBm"],
  ]);
  const unknown = device.connectionPath(client, data, t, 1 / 3);
  assert.deepEqual(unknown[3], { style: "unknown", text: "unbekannt" });
  const offline = device.connectionPath({ ...client, online: false }, data, t, 1 / 3);
  assert.equal(offline.at(-2).text, "offline");
});

test("an action off in Home Assistant shows the known value and offers to switch it on", () => {
  const off = { states: { "switch.tv_i": { state: "off" } } };
  const client = { ...data.clients[0], priority: true, filter_profile: "Kinder" };
  const html = device.renderDevice(client, { t, now: NOW, data, hass: off, threshold: 1 / 3 });
  assert.match(html, /Zugangsprofil<span class="val-line">Kinder<\/span><small>Ausgeschaltet in Home Assistant<\/small>/);
  assert.match(html, /Priorisierung<span class="val-line">An<\/span>/);
  assert.match(html, /data-enable="select.tv_s"[^>]*>Einschalten/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /3 Aktionen sind in Home Assistant ausgeschaltet/);
  assert.match(html, /data-enable="all"[^>]*>Alle einschalten/);
  const busy = device.renderDevice(client, {
    t, now: NOW, data, hass: off, threshold: 1 / 3, enabling: new Set(["select.tv_s", "switch.tv_p"]),
  });
  assert.match(busy, /Wird eingeschaltet/);
  assert.match(busy, /data-enable="select.tv_s"[^>]*disabled/);
  // one left to switch on: no button for all
  assert.doesNotMatch(busy, /data-enable="all"/);
});

test("the plan to switch on lists only what is off, can be written and is not under way", () => {
  const client = data.clients[0];
  const off = { states: { "switch.tv_i": { state: "off" } } };
  assert.deepEqual(device.enablePlan(client, off, true), ["switch.tv_p", "select.tv_s", "button.tv_w"]);
  assert.deepEqual(device.enablePlan(client, off, true, new Set(["switch.tv_p"])), ["select.tv_s", "button.tv_w"]);
  assert.deepEqual(device.enablePlan(client, hass, true), []);
  // without the right of the box user nothing would work after switching on
  assert.deepEqual(device.enablePlan(client, off, false), []);
  // without an IPv4 address only Wake on LAN is left
  assert.deepEqual(device.enablePlan({ ...client, ip: null }, off, true), ["button.tv_w"]);
  assert.deepEqual(device.enablePlan(null, off, true), []);
});

test("the texts are complete in both languages", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(keys(texts.TEXTS.de).sort(), keys(texts.TEXTS.en).sort());
  assert.equal(texts.panelTexts("de-AT"), texts.TEXTS.de);
  assert.equal(texts.panelTexts("fr"), texts.TEXTS.en);
  assert.equal(texts.fill("{n} Geräte", { n: 3 }), "3 Geräte");
});

test("the panel element is defined for Home Assistant", () => {
  assert.equal(typeof panel.FritzboxNetworkPanel, "function");
});

const cleanupState = {
  cleanup: {
    days: 30,
    devices: [
      { mac: "a", name: "old <i>", vendor: "ACME", last_online: day(200), days: 200 },
      { mac: "b", name: "mid", vendor: null, last_online: day(60), days: 60 },
      { mac: "c", name: "fresh", vendor: null, last_online: day(35), days: 35 },
    ],
    hidden: [{ mac: "z", name: "gone" }],
  },
  cleanupDays: 50,
  picked: new Set(["a", "c"]),
};

test("the clean-up page offers the devices gone for long enough, names are escaped", () => {
  const html = cleanup.renderStale(cleanupState, t, NOW);
  assert.match(html, /old &lt;i&gt;/);
  assert.match(html, /mid/);
  assert.doesNotMatch(html, /fresh/);
  assert.match(html, /1 ausgewählt/);
  assert.match(html, /1 Geräte entfernen/);
  assert.match(html, /2 Geräte sind seit mindestens 50 Tagen offline/);
  assert.ok(html.indexOf("old") < html.indexOf("mid"), "the device gone for longest comes first");
});

test("a device that fell out of the offer is no longer picked", () => {
  assert.deepEqual(cleanup.pickedMacs(cleanupState), ["a"]);
  assert.match(cleanup.renderStale({ ...cleanupState, picked: new Set() }, t, NOW), /data-act="hide"[^>]*disabled/);
});

test("the clean-up page says when all is tidy, and lists the hidden devices", () => {
  assert.match(cleanup.renderStale({ ...cleanupState, cleanupDays: 365 }, t, NOW), /Alles aufgeräumt/);
  assert.match(cleanup.renderStale({ cleanup: null, picked: new Set() }, t, NOW), /Lädt/);
  assert.doesNotMatch(cleanup.renderHidden(cleanupState, t), /data-unhide/);
  assert.match(cleanup.renderHidden(cleanupState, t), /aria-expanded="false"/);
  assert.match(cleanup.renderHidden({ ...cleanupState, hiddenOpen: true }, t), /data-unhide="z"/);
  assert.match(cleanup.renderHidden({ cleanup: { hidden: [] } }, t), /Noch nichts entfernt/);
});

const page = {
  current: { filter_mode: "all", filter_devices: [], ignore_guests: false, ignore_private_macs: false },
  draft: { filter_mode: "include", filter_devices: ["x"], ignore_guests: false, ignore_private_macs: false },
  preview: {
    keep: [{ mac: "x", name: "kept" }],
    add: [],
    remove: [{ mac: "y", name: "lost <b>" }],
    devices: [
      { mac: "x", name: "kept" },
      { mac: "y", name: "lost <b>" },
    ],
  },
  search: "",
};

test("the filter page shows the mode and the picker only when needed", () => {
  assert.match(filter.renderFilterControls(page, t), /data-mode="include" aria-pressed="true"/);
  assert.match(filter.renderPicker(page, t), /data-fpick="x" checked/);
  assert.match(filter.renderPicker(page, t), /lost &lt;b&gt;/);
  assert.equal(filter.renderPicker({ ...page, draft: { ...page.draft, filter_mode: "all" } }, t), "");
  assert.doesNotMatch(filter.renderPicker({ ...page, search: "zzz" }, t), /data-fpick/);
});

test("the preview says what is removed, and applying needs a change", () => {
  const html = filter.renderPreview(page, t);
  assert.match(html, /Wird samt Entitäten entfernt: lost &lt;b&gt;/);
  assert.match(html, /data-act="apply" >/);
  const same = filter.renderPreview({ ...page, draft: page.current }, t);
  assert.match(same, /Mit diesem Filter ändert sich nichts/);
  assert.match(same, /data-act="apply"[^>]*disabled/);
  assert.match(filter.renderPreview({ ...page, preview: null }, t), /Lädt/);
});

const groupData = {
  ...data,
  labels: [{ id: "kids", name: "Kinder <i>" }],
  clients: [
    { ...data.clients[0], labels: ["kids"] },
    { ...data.clients[1], labels: [] },
  ],
};
const groupState = { ...state, data: groupData, filter: "label:kids" };

test("a group shows in the menu with its count, and as a chip and a bar when it is the filter", () => {
  const menu = network.renderFilterMenu({ ...groupState, menu: true }, t, NOW);
  assert.match(menu, /aria-checked="true" data-filter="label:kids"/);
  assert.match(menu, /Kinder &lt;i&gt;<\/span><b>1<\/b>/);
  const chips = network.renderChips(groupState, t, NOW);
  assert.match(chips, /aria-label="Filter Kinder &lt;i&gt; entfernen">/);
  assert.match(chips, /Kinder &lt;i&gt;<b>1<\/b>/);
  const bar = network.renderGroupBar(groupState, t, hass);
  assert.match(bar, /Kinder &lt;i&gt;/);
  assert.match(bar, /1 Geräte/);
  assert.equal(network.renderGroupBar({ ...groupState, filter: "all" }, t, hass), "");
});

test("the group button blocks when every device may go online, else allows", () => {
  const allowed = { states: { "switch.tv_i": { state: "on" } } };
  assert.match(network.renderGroupBar(groupState, t, allowed), /class="btn d" data-act="group-bulk">Alle sperren/);
  assert.match(network.renderGroupBar(groupState, t, hass), /class="btn p" data-act="group-bulk">Alle freigeben/);
  const plan = network.groupPlan(groupData, "kids", hass);
  assert.equal(plan.block, false);
  assert.deepEqual(plan.entities, ["switch.tv_i"]);
  assert.deepEqual(plan.names, ["tv <b>"]);
  assert.deepEqual(network.groupPlan(groupData, "kids", { states: {} }).entities, []);
});

test("the device page offers the groups and the links to the history", () => {
  const html = device.renderDevice(groupData.clients[0], { t, now: NOW, data: groupData, hass, threshold: 1 / 3 });
  assert.match(html, /data-label="kids" aria-pressed="true"/);
  assert.match(html, /data-act="new-group"/);
  assert.match(html, /data-act="logbook"/);
  assert.match(html, /data-act="history"/);
  const bare = { ...groupData.clients[0], actions: {} };
  const without = device.renderDevice(bare, { t, now: NOW, data: groupData, hass, threshold: 1 / 3 });
  assert.match(without, /Gruppen brauchen die Entität/);
  assert.doesNotMatch(without, /data-label=/);
  const noTracker = { ...groupData.clients[0], entity_id: null };
  assert.doesNotMatch(device.renderDevice(noTracker, { t, now: NOW, data: groupData, hass, threshold: 1 / 3 }), /data-act="logbook"/);
});

test("the groups are a way to group the list", () => {
  const html = network.renderGroups({ ...groupState, filter: "all", group: "label" }, t, NOW);
  assert.match(html, /Kinder &lt;i&gt;/);
  assert.match(html, /Ohne Gruppe/);
});

const mapData = {
  can_write: true,
  nodes: [
    { mac: "aa", name: "Box", role: "master", radios: { "5ghz": { channel: 36, utilization: 80 } } },
    { mac: "bb", name: "Repeater", role: "slave", radios: {}, uplink: { type: "wlan", band: "5ghz", signal_dbm: -58 } },
    { mac: "cc", name: "Garden", role: "slave", radios: {}, uplink: null },
  ],
  labels: [],
  clients: [
    { id: "000000000011", mac: "11", name: "Zeta TV", online: true, ap_mac: "aa", link_type: "lan" },
    { id: "000000000012", mac: "12", name: "alpha phone", online: false, ap_mac: "aa", link_type: "wlan", band: "5ghz", last_online: day(2) },
    { id: "000000000013", mac: "13", name: "Beta phone", online: true, ap_mac: "aa", link_type: "wlan", band: "5ghz", signal_dbm: -71, rate_download: 10, rate_max_download: 400 },
    { id: "000000000014", mac: "14", name: "Plug", online: true, ap_mac: "bb", link_type: "wlan", band: "2_4ghz", signal_dbm: -60, wan_access: false },
    { id: "000000000015", mac: "15", name: "Mystery", online: false, ap_mac: null, link_type: null },
    { id: "000000000016", mac: "16", name: "Odd", online: true, ap_mac: "aa", link_type: "wlan", band: null },
  ],
};
const mapState = { data: mapData, filter: "all", query: "", sort: "name", group: "ap", closed: new Set(), threshold: 1 / 3, names: true, view: "map" };

test("an access point has a line for the cable and each band, online devices first", () => {
  const atBox = mapData.clients.filter((c) => c.ap_mac === "aa");
  const buses = shared.mapBuses(atBox);
  assert.deepEqual(buses.map((b) => [b.key, b.type]), [["lan", "lan"], ["5ghz", "wlan"], ["wlan", "wlan"]]);
  assert.deepEqual(buses[1].clients.map((c) => c.name), ["Beta phone", "alpha phone"]);
  assert.equal(shared.busOf({ link_type: "wlan", band: "6ghz" }), "6ghz");
  assert.equal(shared.busOf({ link_type: null }), "none");
});

test("the islands keep their access point and count what the filter hides", () => {
  const shown = mapData.clients.filter((c) => c.online);
  const islands = shared.mapIslands(mapData, shown);
  assert.deepEqual(islands.map((i) => [i.key, i.shown, i.hidden]), [["aa", 3, 1], ["bb", 1, 0], ["cc", 0, 0], ["none", 0, 1]]);
  // nobody without an access point at all: no island for them
  const placed = { ...mapData, clients: mapData.clients.filter((c) => c.ap_mac) };
  assert.deepEqual(shared.mapIslands(placed, placed.clients).map((i) => i.key), ["aa", "bb", "cc"]);
});

test("paging follows the order of the view and skips nothing, each device once", () => {
  const order = map.mapOrder(mapData, mapData.clients).map((c) => c.name);
  assert.deepEqual(order, ["Zeta TV", "Beta phone", "alpha phone", "Odd", "Plug", "Mystery"]);
  const list = network.listOrder({ ...mapState, group: "label", data: { ...mapData, labels: [{ id: "a", name: "A" }, { id: "b", name: "B" }], clients: mapData.clients.map((c, i) => ({ ...c, labels: i < 2 ? ["a", "b"] : [] })) } }, NOW);
  assert.equal(list.length, mapData.clients.length);
  const pager = shared.pagerFor(map.mapOrder(mapData, mapData.clients), "000000000012");
  assert.equal(pager.index, 2);
  assert.equal(pager.prev.name, "Beta phone");
  assert.equal(pager.next.name, "Odd");
  assert.deepEqual(shared.pagerFor([], "x"), { index: -1, total: 0, prev: null, next: null });
});

test("the line to a repeater is drawn by its uplink, and neutral without one", () => {
  assert.equal(shared.uplinkStyle(mapData.nodes[1]), "wlan");
  assert.equal(shared.uplinkStyle({ uplink: { type: "lan" } }), "lan");
  assert.equal(shared.uplinkStyle(mapData.nodes[2]), "unknown");
  assert.equal(shared.uplinkStyle({}), "unknown");
});

test("a node has initials and says everything for a screen reader", () => {
  assert.equal(shared.initials("iPad Ben"), "IB");
  assert.equal(shared.initials("Ökö-Gerät 2"), "ÖG");
  assert.equal(shared.initials("NAS"), "N");
  assert.equal(shared.initials(""), "");
  assert.equal(map.nodeLabel(mapData.clients[2], t, NOW, 1 / 3), "Beta phone, online, WLAN 5 GHz, -71 dBm, schwache Verbindung");
  assert.equal(map.nodeLabel(mapData.clients[1], t, NOW, 1 / 3), "alpha phone, offline, zuletzt online vor 2 Tagen, WLAN 5 GHz");
  assert.equal(map.nodeLabel(mapData.clients[3], t, NOW, 1 / 3), "Plug, online, WLAN 2,4 GHz, -60 dBm, Internet gesperrt");
});

test("the map draws islands with real buttons, the uplink, hidden devices and the legend", () => {
  const shown = mapData.clients.filter((c) => c.online);
  const html = map.renderMap({ ...mapState, hl: "000000000013" }, t, NOW, shown);
  assert.match(html, /class="isle root" data-node="aa" data-up=""/);
  assert.match(html, /class="isle " data-node="bb" data-up="wlan"/);
  assert.match(html, /class="isle " data-node="cc" data-up="unknown"/);
  assert.match(html, /Angebunden per WLAN 5 GHz, -58 dBm/);
  assert.match(html, /<button class="nd lan" data-dev="000000000011" aria-label="Zeta TV, online, LAN"/);
  assert.match(html, /class="nd weak hl" data-dev="000000000013"/);
  assert.match(html, /class="nd blk" data-dev="000000000014"[^>]*><span class="c" aria-hidden="true">P<span class="bd">⦸/);
  assert.match(html, /1 durch den Filter ausgeblendet/);
  assert.match(html, /5 GHz · Kanal 36 · 80 %/);
  assert.match(html, /class="load busy"/);
  assert.match(html, /Legende/);
  assert.match(html, /data-act="names"[^>]*>Namen ausblenden/);
  assert.match(map.renderMap({ ...mapState, names: false }, t, NOW, shown), /class="isl compact"/);
});

const internetPage = await import(`${base}panel-internet.js`);
const sharedHelpers = await import(`${base}shared.js`);

test("rates read as kbit/s, Mbit/s with one place and, from 100, without", () => {
  assert.equal(sharedHelpers.formatRate(56316, "en"), "56.3 Mbit/s");
  assert.equal(sharedHelpers.formatRate(56316, "de"), "56,3 Mbit/s");
  assert.equal(sharedHelpers.formatRate(250000, "en"), "250 Mbit/s");
  assert.equal(sharedHelpers.formatRate(640, "en"), "640 kbit/s");
  assert.equal(sharedHelpers.formatRate(null, "en"), "–");
});

test("a duration shows its two largest units", () => {
  const units = { d: "d", h: "h", m: "min" };
  assert.equal(sharedHelpers.formatDuration(65439, units), "18 h 10 min");
  assert.equal(sharedHelpers.formatDuration(3 * 86400 + 4 * 3600 + 59, units), "3 d 4 h");
  assert.equal(sharedHelpers.formatDuration(90, units), "1 min");
  assert.equal(sharedHelpers.formatDuration(null, units), "–");
});

test("the chart needs two samples and puts the larger rate at the top", () => {
  assert.equal(sharedHelpers.sparkPaths([[0, 1, 1]], 100, 50), null);
  assert.equal(sharedHelpers.sparkPaths(null, 100, 50), null);
  const paths = sharedHelpers.sparkPaths([[0, 0, 0], [60, 100, 50]], 100, 50);
  assert.equal(paths.top, 100);
  assert.equal(paths.seconds, 60);
  // download ends at the top of the box (y = 1), upload at half of it
  assert.match(paths.down, /^M0\.0 49\.0 L100\.0 1\.0$/);
  assert.match(paths.up, /L100\.0 25\.0$/);
});

test("the load is the share of the line rate, at most 100", () => {
  assert.equal(sharedHelpers.usedPercent(28000, 56000), 50);
  assert.equal(sharedHelpers.usedPercent(90000, 56000), 100);
  assert.equal(sharedHelpers.usedPercent(null, 56000), null);
  assert.equal(sharedHelpers.usedPercent(100, 0), null);
});

test("the internet page is a route of its own", () => {
  assert.deepEqual(sharedHelpers.routeFromHash("#/internet"), { tab: "internet", device: null });
});

const internet = {
  connected: true,
  uptime: 65439,
  last_error: "ERROR_NONE",
  access_type: "DSL",
  rate_down: 56316,
  rate_up: 11260,
  external_ipv4: "203.0.113.7",
  external_ipv6: "2001:db8::1",
  ipv6_prefix: "2001:db8:1::",
  ipv6_prefix_length: 56,
  dns: ["198.51.100.1", "198.51.100.2", "2001:db8::53"],
  dsl: {
    modulation: "VDSL",
    profile: "17a",
    rate_down: 56316,
    rate_up: 11260,
    max_rate_down: 96347,
    max_rate_up: 34957,
    noise_margin_down: 17,
    noise_margin_up: 22,
    attenuation_down: 7,
    attenuation_up: 7,
    fec_errors: 96,
    crc_errors: 0,
  },
  throughput: { down: 38200, up: 4100 },
  samples: [[1000, 10, 5], [1030, 20000, 100]],
  events: [{ time: "2026-11-01T01:00:00Z", kind: "ip_changed", detail: "203.0.113.9" }],
};

test("the internet page shows the connection, the load, the line and the events", () => {
  const t = texts.panelTexts("en");
  const html = internetPage.renderInternet(internet, { t, language: "en", now: Date.parse("2026-11-01T12:00:00Z") });
  assert.match(html, /203\.0\.113\.7/);
  assert.match(html, /2001:db8:1::\/56/);
  assert.match(html, /198\.51\.100\.1/);
  assert.match(html, /\+2 more/);
  assert.match(html, /38\.2 Mbit\/s/);
  assert.match(html, /of 56\.3 Mbit\/s line rate/);
  assert.match(html, /18 h 10 min/);
  assert.match(html, /VDSL, profile 17a/);
  assert.match(html, /FEC 96 · CRC 0/);
  assert.match(html, /External IPv4 changed to 203\.0\.113\.9/);
  assert.match(html, /aria-valuenow="68"/);
  assert.match(html, /<svg class="spark"/);
});

test("without a line, a rate or a history the page still draws and says what is missing", () => {
  const t = texts.panelTexts("de");
  const bare = { ...internet, dsl: null, throughput: null, samples: [], events: [], connected: false };
  const html = internetPage.renderInternet(bare, { t, language: "de", now: Date.now() });
  assert.doesNotMatch(html, /Leitungsqualität/);
  assert.match(html, /Getrennt/);
  assert.match(html, /nach der nächsten/);
  assert.match(html, /Der Verlauf erscheint/);
  assert.match(html, /Seit dem Start von Home Assistant nichts/);
  assert.match(internetPage.renderInternet(null, { t, language: "de", now: 0 }), /meldet ihre Internetverbindung nicht/);
});

test("a hostile value from the box is escaped", () => {
  const t = texts.panelTexts("en");
  const html = internetPage.renderInternet({ ...internet, external_ipv4: "<img src=x>" }, { t, language: "en", now: 0 });
  assert.doesNotMatch(html, /<img src=x>/);
});

test("the node of the map reads out the state and the rates", () => {
  const t = texts.panelTexts("en");
  assert.equal(internetPage.nodeLabel(internet, t, "en"), "Internet, connected, 38.2 Mbit/s Download, 4.1 Mbit/s Upload");
  assert.equal(internetPage.nodeLabel({ ...internet, connected: false, throughput: null }, t, "en"), "Internet, disconnected");
  assert.equal(internetPage.nodeRates({ throughput: null }, "en"), null);
});

test("the internet page points out what stands out, the most serious first", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const calm = internetPage.internetHints(internet, now);
  assert.deepEqual(calm, []);
  const keys = (changes) => internetPage.internetHints({ ...internet, ...changes }, now).map((h) => [h.level, h.key]);
  assert.deepEqual(keys({ connected: false }), [["bad", "down"]]);
  const margin = (db) => ({ dsl: { ...internet.dsl, noise_margin_down: db } });
  assert.deepEqual(keys(margin(5)), [["bad", "noiseVeryLow"]]);
  assert.deepEqual(keys(margin(9)), [["warn", "noiseLow"]]);
  assert.deepEqual(keys(margin(10)), []);
  assert.deepEqual(keys({ ...margin(9), connected: false }), [["bad", "down"], ["warn", "noiseLow"]]);
});

test("several new connections in a day are one hint, an old one does not count", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const at = (hours) => new Date(now - hours * 3600000).toISOString();
  const events = (kinds) => kinds.map(([kind, hours]) => ({ kind, time: at(hours), detail: null }));
  const hints = (list) => internetPage.internetHints({ ...internet, events: events(list) }, now).map((h) => h.key);
  assert.deepEqual(hints([["reconnected", 1], ["reconnected", 5], ["reconnected", 9]]), ["reconnects"]);
  assert.deepEqual(hints([["reconnected", 1], ["reconnected", 5], ["reconnected", 30]]), []);
  // a loss and its new connection are one interruption
  assert.deepEqual(hints([["disconnected", 2], ["reconnected", 1], ["disconnected", 4], ["reconnected", 3]]), []);
  assert.deepEqual(internetPage.internetHints(null, now), []);
});

test("a line that is full for the last samples is noted", () => {
  const now = Date.now();
  const full = [[1, 51000, 100], [2, 52000, 100], [3, 53000, 100]];
  assert.deepEqual(internetPage.internetHints({ ...internet, samples: full }, now).map((h) => h.key), ["saturatedDown"]);
  assert.deepEqual(internetPage.internetHints({ ...internet, samples: full.slice(1) }, now), []);
});

test("the hints show on the page and in both languages", () => {
  const html = internetPage.renderInternet({ ...internet, connected: false }, { t: texts.panelTexts("de"), language: "de", now: Date.now() });
  assert.match(html, /Die Box hat keine Internetverbindung/);
});

test("the line quality shows the spectrum only when the box gave one", () => {
  const t = texts.panelTexts("en");
  const ctx = { t, language: "en", now: Date.now() };
  const withSpectrum = { ...internet, dsl: { ...internet.dsl, spectrum_down: [0, 50, 100, 0], spectrum_up: [20, 40] } };
  const html = internetPage.renderInternet(withSpectrum, ctx);
  assert.match(html, /Signal over the frequency/);
  assert.equal((html.match(/<figure class="spec">/g) ?? []).length, 2);
  // a gap draws no bar: two of four bars of the download, both of the upload
  assert.equal((html.match(/<rect /g) ?? []).length, 4);
  assert.doesNotMatch(internetPage.renderInternet(internet, ctx), /Signal over the frequency/);
  assert.doesNotMatch(
    internetPage.renderInternet({ ...internet, dsl: { ...internet.dsl, spectrum_down: [0, 0], spectrum_up: [] } }, ctx),
    /Signal over the frequency/
  );
});

test("the access type is named in the language of the page, an unknown one as the box says it", () => {
  const de = texts.panelTexts("de");
  const en = texts.panelTexts("en");
  assert.equal(internetPage.accessLabel("DSL", de), "DSL");
  assert.equal(internetPage.accessLabel("X_AVM-DE_Fiber", de), "Glasfaser");
  assert.equal(internetPage.accessLabel("X_AVM-DE_Cable", en), "Cable");
  assert.equal(internetPage.accessLabel("Ethernet", en), "Ethernet");
  assert.equal(internetPage.accessLabel("X_AVM-DE_Satellite", en), "X_AVM-DE_Satellite");
  assert.equal(internetPage.accessLabel(null, en), "");
  const html = internetPage.renderInternet({ ...internet, access_type: "X_AVM-DE_Fiber", dsl: null }, { t: de, language: "de", now: Date.now() });
  assert.match(html, /Glasfaser/);
  assert.doesNotMatch(html, /Leitungsqualität/);
});

test("the internet page offers to reconnect and restart, and says why it cannot", () => {
  const t = texts.panelTexts("en");
  const page = (canWrite) => internetPage.renderInternet(internet, { t, language: "en", now: Date.now(), canWrite });
  const allowed = page(true);
  assert.match(allowed, /data-act="reconnect" data-k="reconnect">Reconnect/);
  assert.match(allowed, /data-act="reboot"[^>]*>Restart the box/);
  assert.doesNotMatch(allowed, /data-act="reboot"[^>]*disabled/);
  const refused = page(false);
  assert.match(refused, /data-act="reboot"[^>]*disabled/);
  assert.match(refused, /may not change settings/);
});

const hintsModule = await import(`${base}panel-hints.js`);

test("the network points out a busy radio and a weak repeater link", () => {
  const t = texts.panelTexts("en");
  const data = {
    nodes: [
      { name: "Box", role: "master", radios: { "5ghz": { utilization: 85 }, "2_4ghz": { utilization: 30 } }, uplink: null },
      { name: "Keller", role: "slave", radios: {}, uplink: { type: "wlan", band: "5ghz", signal_dbm: -80 } },
      { name: "Garten", role: "slave", radios: {}, uplink: { type: "wlan", band: "5ghz", signal_dbm: -60 } },
      { name: "Dach", role: "slave", radios: {}, uplink: { type: "lan", signal_dbm: null } },
    ],
  };
  const hints = hintsModule.networkHints(data, t);
  assert.deepEqual(hints.map((h) => [h.key, h.values.name]), [["radioBusy", "Box"], ["uplinkWeak", "Keller"]]);
  assert.equal(hints[0].values.percent, 85);
  assert.deepEqual(hintsModule.networkHints({ nodes: [] }, t), []);
  assert.deepEqual(hintsModule.networkHints(null, t), []);
  assert.equal(hintsModule.renderHints({ nodes: [] }, t), "");
  assert.match(hintsModule.renderHints(data, t), /5 GHz radio is 85 % busy/);
});

test("a new firmware is a hint only when it differs from the installed one", () => {
  const t = texts.panelTexts("de");
  const data = (installed, latest) => ({ nodes: [], firmware: { installed, latest } });
  assert.match(hintsModule.renderHints(data("8.25", "8.30"), t), /neue Firmware: 8\.30/);
  assert.equal(hintsModule.renderHints(data("8.25", "8.25"), t), "");
  assert.equal(hintsModule.renderHints(data("8.25", null), t), "");
});

test("the internet page lists the port forwardings, and says when there are none or they cannot be read", () => {
  const t = texts.panelTexts("en");
  const page = (ports) => internetPage.renderInternet(internet, { t, language: "en", now: Date.now(), canWrite: true, ports });
  const entries = [
    { description: "Web", protocol: "TCP", external_port: 443, internal_port: 8443, client: "192.0.2.10", device_id: "000000000001", device_name: "NAS", enabled: true, lease: 0 },
    { description: null, protocol: "UDP", external_port: 5000, internal_port: 5000, client: "192.0.2.250", device_id: null, device_name: null, enabled: false, lease: 3600 },
  ];
  const html = page({ entries });
  assert.match(html, /TCP 443 → <button class="linklike" data-dev="000000000001">NAS<\/button>:8443/);
  assert.match(html, /UDP 5000 → 192\.0\.2\.250:5000/);
  assert.match(html, /Without a name/);
  assert.match(html, /off · ends after 1 h 0 min/);
  assert.match(page({ entries: [] }), /No ports are open to the internet/);
  assert.match(page("failed"), /did not tell its port forwardings/);
  assert.match(page(null), /Loading/);
  // a hostile description is escaped
  assert.doesNotMatch(page({ entries: [{ ...entries[0], description: "<b>x</b>" }] }), /<b>x<\/b>/);
});

const table = await import(`${base}panel-table.js`);

test("a page of the list keeps inside the list and 0 rows per page shows all", () => {
  const list = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual(
    (({ items, ...rest }) => ({ n: items.length, ...rest }))(shared.pageSlice(list, 0, 50)),
    { n: 50, page: 0, pages: 3, from: 1, to: 50, total: 120 }
  );
  assert.equal(shared.pageSlice(list, 9, 50).page, 2);
  assert.equal(shared.pageSlice(list, 2, 50).items.length, 20);
  assert.equal(shared.pageSlice(list, 3, 0).items.length, 120);
  assert.deepEqual(shared.pageSlice([], 0, 50), { items: [], page: 0, pages: 1, from: 0, to: 0, total: 0 });
});

test("sorting can be turned round, online devices stay first", () => {
  const list = [
    { name: "b", online: true }, { name: "a", online: true }, { name: "c", online: false },
  ];
  assert.deepEqual(shared.sortClients(list, "name").map((c) => c.name), ["a", "b", "c"]);
  assert.deepEqual(shared.sortClients(list, "name", true).map((c) => c.name), ["b", "a", "c"]);
});

test("a sparkline leaves gaps for missing values and needs two values", () => {
  assert.equal(shared.sparkLine([1], 96, 26), null);
  assert.equal(shared.sparkLine([null, null, 3], 96, 26), null);
  const { line } = shared.sparkLine([1, null, 3, 4], 90, 20);
  assert.equal(line.split("M").length - 1, 2);
  assert.match(line, /^M0\.0 /);
});

test("the sparkline shows the signal of a Wi-Fi device, the rate of a cable and else the hours online", () => {
  const history = { w: { signal: [-60, -61], rate: [1, 2], online: [1, 1] }, x: { signal: [null, null], rate: [null, null], online: [0, 1] } };
  assert.equal(shared.historySeries({ mac: "w", online: true, link_type: "wlan" }, history).kind, "signal");
  assert.equal(shared.historySeries({ mac: "w", online: true, link_type: "lan" }, history).kind, "rate");
  assert.equal(shared.historySeries({ mac: "w", online: false, link_type: "wlan" }, history).kind, "online");
  assert.equal(shared.historySeries({ mac: "x", online: true, link_type: "lan" }, history).kind, "online");
  assert.equal(shared.historySeries({ mac: "none", online: true }, history), null);
});

test("the table sorts by the header, pages and escapes names", () => {
  const html = table.renderTable({ ...state, sort: "rate", sortDesc: true, page: 0, pageSize: 50, history: null }, t, NOW, data.clients);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /data-sort="name"/);
  assert.match(html, /tv &lt;b&gt;/);
  assert.match(html, /1–2 von 2|1–2 von 2/);
  assert.doesNotMatch(html, /tv <b>/);
});

test("a data volume is written in decimal units and the traffic of the last days is summed", () => {
  assert.equal(shared.formatBytes(812, "en"), "812 B");
  assert.equal(shared.formatBytes(3_400_000, "en"), "3.40 MB");
  assert.equal(shared.formatBytes(1_270_000_000, "en"), "1.27 GB");
  assert.equal(shared.formatBytes(null, "en"), "–");
  const days = { "2026-11-02": [100, 10], "2026-11-01": [50, 5], "2026-10-01": [7, 7] };
  const now = new Date(2026, 10, 2);
  assert.deepEqual(shared.trafficSum(days, 1, now), [100, 10]);
  assert.deepEqual(shared.trafficSum(days, 7, now), [150, 15]);
  assert.deepEqual(shared.trafficSum(days, 30, now), [150, 15]);
  assert.deepEqual(shared.trafficSum(days, 35, now), [157, 22]);
});

test("devices can be sorted by their data volume, the largest first", () => {
  const now = new Date(2026, 10, 2);
  const traffic = {
    a: { "2026-11-02": [10, 5] },
    b: { "2026-11-01": [500, 50], "2026-09-01": [9999, 9999] },
    c: {},
  };
  const volumes = shared.sumVolumes(traffic, 7, now);
  assert.deepEqual(volumes, { a: 15, b: 550 });
  const clients = ["a", "b", "c"].map((mac) => ({ mac, name: mac, online: true }));
  assert.deepEqual(shared.sortClients(clients, "traffic", false, volumes).map((c) => c.mac), ["b", "a", "c"]);
});

test("the days of the line are summed over all devices and the tooltip names time and values", () => {
  const now = new Date(2026, 10, 2);
  const rows = shared.dailyTotals({ a: { "2026-11-02": [10, 1], "2026-11-01": [5, 5] }, b: { "2026-11-02": [20, 2] } }, 3, now);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.down, r.up]), [[0, 0], [5, 5], [30, 3]]);
  assert.match(shared.plotText([1_800_000_000, 1500, 200], { fmt: "rate", range: "day" }, "en"), /↓ 1\.5 Mbit\/s · ↑ 200 kbit\/s$/);
  assert.match(shared.plotText([1_800_000_000, -67], { unit: "dBm" }, "en"), /-67 dBm$/);
});

test("the clean-up search narrows the list and the picker only offers what it shows", () => {
  const found = { ...cleanupState, cleanupQuery: "acme" };
  assert.deepEqual(cleanup.visibleStale(found).map((d) => d.mac), ["a"]);
  assert.match(cleanup.renderStale({ ...cleanupState, cleanupQuery: "zzz" }, t), /Kein Gerät passt zur Suche/);
});

test("the filter page explains each mode and counts the picked devices", () => {
  assert.match(filter.renderFilterControls(page, t), /Nur die Geräte, die du unten ankreuzt/);
  assert.match(filter.renderPickerHead(page, t), /1 ausgewählt/);
  assert.equal(filter.renderPickerHead({ ...page, draft: { ...page.draft, filter_mode: "all" } }, t), "");
  assert.deepEqual(filter.pickable({ ...page, search: "lost" }).map((d) => d.mac), ["y"]);
});

const addresses = await import(`${base}panel-addresses.js`);

const lan = {
  network: { mask: "255.255.255.0", gateway: "192.168.79.1", dhcp: true, pool_from: "192.168.79.100", pool_to: "192.168.79.200", reserved: ["192.168.79.250"] },
  nodes: [{ mac: "M0", name: "FRITZ!Box 7590", role: "master" }],
  clients: [
    { id: "d1", mac: "M1", ip: "192.168.79.10", name: "NAS", online: true },
    { id: "d2", mac: "M2", ip: "192.168.79.150", name: "Wallbox", online: true },
    { id: "d3", mac: "M3", ip: "192.168.79.120", name: "Phone", online: true },
    { id: "d4", mac: "M4", ip: "192.168.79.37", name: "Printer", online: false },
    { id: "d5", mac: "M5", ip: "192.168.79.1", name: "box", online: true },
  ],
  fixed: { M1: { fixed: true }, M2: { fixed: true }, M3: { fixed: false }, M4: { fixed: true }, M5: null },
  own: { notes: {}, names: {}, marks: ["192.168.79.45"], muted: [], blocks: [] },
};

test("masks and addresses are read as numbers", () => {
  assert.equal(addresses.ipToInt("192.168.79.1"), 0xc0a84f01);
  assert.equal(addresses.ipToInt("192.168.79.256"), null);
  assert.equal(addresses.intToIp(0xc0a84f01), "192.168.79.1");
  assert.equal(addresses.prefixOf("255.255.255.0"), 24);
  assert.equal(addresses.prefixOf("255.255.254.0"), 23);
  assert.equal(addresses.prefixOf("255.0.255.0"), null);
});

test("the model sorts the addresses of the /24 by what they are", () => {
  const m = addresses.addressModel(lan);
  const state = (n) => m.cells[n].state;
  assert.equal(m.baseText, "192.168.79.");
  assert.deepEqual([state(0), state(255), state(1), state(10), state(120), state(150), state(37), state(45), state(250), state(60)], ["na", "na", "box", "fix", "dyn", "fix", "offfix", "plan", "res", "free"]);
  assert.equal(m.cells[1].device.name, "FRITZ!Box 7590");
  assert.equal(m.usable, 254);
  assert.equal(m.used, 5);
  assert.equal(m.fixed, 4);
  assert.equal(m.poolSize, 101);
  assert.equal(m.poolUsed, 2);
  assert.equal(m.free, 254 - 5 - 1);
  assert.deepEqual(m.zones.map((z) => [z.id, z.from, z.to]), [["low", 1, 99], ["pool", 100, 200], ["high", 201, 254]]);
});

test("a network smaller than a /24 leaves the rest unusable, a missing gateway still finds the network", () => {
  const small = addresses.addressModel({ ...lan, network: { ...lan.network, mask: "255.255.255.192", pool_from: null, pool_to: null } });
  assert.equal(small.usable, 62);
  assert.equal(small.cells[64].state, "na");
  assert.equal(small.hasPool, false);
  assert.deepEqual(small.zones.map((z) => z.id), ["whole"]);
  assert.equal(addresses.addressModel({ ...lan, network: null }), null);
  assert.ok(addresses.addressModel({ ...lan, network: { ...lan.network, gateway: null } }));
});

test("the hints name what stands out, the worst first", () => {
  const m = addresses.addressModel({ ...lan, clients: [...lan.clients, { id: "d6", mac: "M6", ip: "192.168.79.120", name: "Twin", online: true }] });
  const ids = addresses.addressHints(m, { fixedKnown: true }).map((h) => h.id);
  assert.equal(ids[0], "dup:120");
  assert.ok(ids.includes("res:250"));
  assert.ok(ids.includes("pool-fix:150"));
  assert.ok(ids.includes("offline-fix"));
  assert.ok(ids.includes("pool-usage"));
  assert.ok(!ids.includes("fixed-unknown"));
  assert.ok(addresses.addressHints(m, { fixedKnown: false }).some((h) => h.id === "fixed-unknown"));
});

test("a block must be a range of the network and may not overlap another", () => {
  const own = { blocks: [{ id: 1, name: "Cams", from: 60, to: 69, color: "--b2" }] };
  assert.equal(addresses.checkBlock(own, { name: "Servers", from: 1, to: 19 }), null);
  assert.equal(addresses.checkBlock(own, { name: "", from: 1, to: 19 }).key, "errRange");
  assert.equal(addresses.checkBlock(own, { name: "x", from: 20, to: 10 }).key, "errRange");
  assert.equal(addresses.checkBlock(own, { name: "x", from: 0, to: 10 }).key, "errRange");
  assert.deepEqual(addresses.checkBlock(own, { name: "x", from: 65, to: 70 }), { key: "errOverlap", values: { name: "Cams", from: 60, to: 69 } });
  assert.equal(addresses.blockOf(own, 65).name, "Cams");
  assert.equal(addresses.blockOf(own, 70), null);
});

test("the address page draws the map, escapes names and says what it is still reading", () => {
  const addr = { status: "ready", network: lan.network, own: { ...lan.own, notes: { "192.168.79.10": "<b>x</b>" } }, fixed: lan.fixed, filter: "all", query: "", view: "map", sel: 150, blockMessage: "", progress: { done: 2, total: 5 } };
  const html = addresses.renderAddresses({ t, language: "de", now: NOW, addr, clients: lan.clients, nodes: lan.nodes, backIcon: "" });
  assert.equal((html.match(/data-aip="/g) ?? []).length, 256);
  assert.match(html, /Lese, welche Adressen fest sind … 2 von 5/);
  assert.match(html, /Wallbox/);
  assert.match(html, /feste Adresse mitten im DHCP-Bereich/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  const list = addresses.renderAddresses({ t, language: "de", now: NOW, addr: { ...addr, view: "list", query: "wall" }, clients: lan.clients, nodes: lan.nodes, backIcon: "" });
  assert.match(list, /<tr class="arow" data-aip="150"/);
  assert.doesNotMatch(list, /<tr class="arow" data-aip="10"/);
  assert.match(addresses.renderAddresses({ t, language: "de", now: NOW, addr: { ...addr, network: null }, clients: [], nodes: [], backIcon: "" }), /meldet ihr Netz nicht/);
});

test("a new DHCP range says which devices it touches and what is wrong with it", () => {
  const m = addresses.addressModel(lan);
  assert.equal(addresses.poolChange(m, "", ""), null);
  assert.equal(addresses.poolChange(m, "200", "100").error, "range");
  assert.equal(addresses.poolChange(m, "abc", "100").error, "range");
  assert.equal(addresses.poolChange(m, "0", "100").error, "range");
  assert.equal(addresses.poolChange(m, "1", "100").error, "gateway");
  assert.equal(addresses.poolChange(m, "100", "200").same, true);
  const change = addresses.poolChange(m, "130", "180");
  assert.equal(change.size, 51);
  assert.deepEqual(change.outside.map((d) => d.name), ["Phone"]);
  assert.deepEqual(change.fixedInside.map((d) => d.name), ["Wallbox"]);
  assert.equal(change.tooSmall, false);
  const tiny = addresses.addressModel({ ...lan, clients: [...lan.clients, { id: "d7", mac: "M7", ip: "192.168.79.130", name: "A", online: true }, { id: "d8", mac: "M8", ip: "192.168.79.131", name: "B", online: true }], fixed: { ...lan.fixed, M7: { fixed: false }, M8: { fixed: false } } });
  assert.equal(addresses.poolChange(tiny, "130", "130").tooSmall, true);
});

test("the pool card is only offered to someone who may write, and warns before it is applied", () => {
  const addr = { status: "ready", network: lan.network, own: lan.own, fixed: lan.fixed, filter: "all", query: "", view: "map", sel: null, blockMessage: "", progress: null, poolDraft: { first: "130", last: "180" } };
  const ctx = { t, language: "de", now: NOW, addr, clients: lan.clients, nodes: lan.nodes, backIcon: "" };
  assert.doesNotMatch(addresses.renderAddresses(ctx), /a-poolform/);
  const html = addresses.renderAddresses({ ...ctx, canWrite: true });
  assert.match(html, /a-poolform/);
  assert.match(html, /1 dynamische Geräte<\/b> haben eine Adresse außerhalb des neuen Bereichs \(Phone\)/);
  assert.match(html, /Neuer Bereich \.130 – \.180: 51 Adressen/);
  assert.match(addresses.renderAddresses({ ...ctx, canWrite: true, addr: { ...addr, poolDraft: { first: "9", last: "5" } } }), /die erste nicht größer als die zweite/);
});

test("all pages are tabs, the internet tab carries the state of the line and clean-up its count", () => {
  const html = panel.renderNav({ tab: "internet", data: { internet: { connected: false } } }, t, 3);
  const labels = [...html.matchAll(/<button[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Netzwerk", "Internet", "Adressraum", "Aufräumen", "Einbinden"]);
  assert.match(html, /data-tab="internet" aria-selected="true" aria-label="Internet, Getrennt"/);
  assert.match(html, /<i class="dot " aria-hidden="true"><\/i>/);
  assert.match(html, /Aufräumen<em>3<\/em>/);
  assert.match(panel.renderNav({ tab: "net", data: { internet: { connected: true } } }, t, 0), /<i class="dot on"/);
  assert.doesNotMatch(panel.renderNav({ tab: "net", data: null }, t, 0), /<i class="dot|<em>/);
});

const exporter = await import(`${base}panel-export.js`);

test("the rows of the export are the addresses in use, free ones only when asked for", () => {
  const own = { ...lan.own, names: { M3: "Handy Anna" }, notes: { "192.168.79.150": "Garage; Wand" } };
  const m = addresses.addressModel({ ...lan, own });
  const rows = exporter.addressRows(m, own, t, { free: false });
  assert.deepEqual(rows.map((r) => r.ip), ["192.168.79.1", "192.168.79.10", "192.168.79.37", "192.168.79.45", "192.168.79.120", "192.168.79.150", "192.168.79.250"]);
  assert.deepEqual(rows.map((r) => r.kind), ["box", "fixed", "fixed", "planned", "dynamic", "fixed", "reserved"]);
  assert.equal(rows.find((r) => r.ip.endsWith(".120")).name, "Handy Anna");
  assert.equal(rows.find((r) => r.ip.endsWith(".120")).boxName, "Phone");
  assert.equal(exporter.addressRows(m, own, t, { free: true }).length, 254);
});

test("the CSV has a byte order mark, semicolons and quotes where a cell needs them", () => {
  const own = { ...lan.own, notes: { "192.168.79.150": 'Garage; "Wand"' } };
  const m = addresses.addressModel({ ...lan, own });
  const csv = exporter.toCsv(exporter.addressRows(m, own, t, {}), t, { mac: true });
  assert.ok(csv.startsWith("﻿Adresse;Gerät;Art;Status;Hersteller;MAC;Anbindung;Zuletzt online;Block;Bereich;Notiz\r\n"));
  assert.match(csv, /192\.168\.79\.150;Wallbox;Fest;online;;M2;;;;DHCP-Bereich;"Garage; ""Wand"""\r\n/);
  assert.ok(csv.endsWith("\r\n"));
  assert.doesNotMatch(exporter.toCsv(exporter.addressRows(m, own, t, {}), t, { mac: false }), /;MAC;|;M2;/);
});

test("the JSON keeps the network, the numbers and what the user noted", () => {
  const m = addresses.addressModel(lan);
  const json = JSON.parse(exporter.toJson(m, lan.own, exporter.addressRows(m, lan.own, t, {}), { mac: false, now: new Date("2026-11-02T10:00:00Z") }));
  assert.equal(json.network.address, "192.168.79.0/24");
  assert.deepEqual(json.network.dhcp_range, { from: "192.168.79.100", to: "192.168.79.200" });
  assert.equal(json.summary.used, 5);
  assert.equal(json.addresses[1].address, "192.168.79.10");
  assert.equal("mac" in json.addresses[1], false);
  assert.deepEqual(json.own.planned, ["192.168.79.45"]);
  assert.equal(json.generated, "2026-11-02T10:00:00.000Z");
});

test("the file name carries the network and the day", () => {
  const m = addresses.addressModel(lan);
  assert.equal(exporter.fileName(m, "csv", new Date(2026, 10, 2)), "adressraum-192-168-79-0-24-2026-11-02.csv");
});

test("the print sheet is an A4 document with the numbers, the map, the list and no raw markup", () => {
  const own = { ...lan.own, notes: { "192.168.79.150": "<script>x</script>" }, blocks: [{ id: 1, name: "Kameras", from: 60, to: 69, color: "--b2" }] };
  const m = addresses.addressModel({ ...lan, own });
  const html = exporter.printSheet({ m, own, t, language: "de", opts: { map: true, mac: true }, now: new Date(2026, 10, 2, 14, 35) });
  assert.match(html, /@page \{ size: A4 portrait/);
  assert.match(html, /<h1>Adressraum<\/h1>/);
  assert.match(html, /Stand 2\. November 2026/);
  assert.equal((html.match(/class="cell /g) ?? []).length >= 256, true);
  assert.match(html, /Kameras/);
  assert.match(html, /Adressen in Benutzung \(7\)/);
  assert.doesNotMatch(html, /<script>x/);
  const lean = exporter.printSheet({ m, own, t, language: "de", opts: { map: false, mac: false }, now: new Date() });
  assert.doesNotMatch(lean, /Karte der Adressen/);
  assert.doesNotMatch(lean, /<th>MAC<\/th>/);
});
