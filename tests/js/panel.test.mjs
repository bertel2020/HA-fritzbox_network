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
  assert.match(html, /Ohne Access Point/);
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
  assert.match(html, /1 Geräte ausblenden/);
});

test("a device that fell out of the offer is no longer picked", () => {
  assert.deepEqual(cleanup.pickedMacs(cleanupState), ["a"]);
  assert.match(cleanup.renderStale({ ...cleanupState, picked: new Set() }, t, NOW), /data-act="hide"[^>]*disabled/);
});

test("the clean-up page says when all is tidy, and lists the hidden devices", () => {
  assert.match(cleanup.renderStale({ ...cleanupState, cleanupDays: 365 }, t, NOW), /Alles aufgeräumt/);
  assert.match(cleanup.renderStale({ cleanup: null, picked: new Set() }, t, NOW), /Lädt/);
  assert.match(cleanup.renderHidden(cleanupState, t), /data-unhide="z"/);
  assert.match(cleanup.renderHidden({ cleanup: { hidden: [] } }, t), /Nichts ausgeblendet/);
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
