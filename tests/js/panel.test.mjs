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

test("the chips show a number and leave out filters with nothing to show", () => {
  const html = network.renderChips(state, t, NOW);
  assert.match(html, /data-filter="all"[^>]*>Alle<b>2<\/b>/);
  assert.match(html, /data-filter="blocked"[^>]*>Gesperrt<b>1<\/b>/);
  assert.doesNotMatch(html, /data-filter="guest"/);
  assert.match(network.renderChips({ ...state, filter: "guest" }, t, NOW), /data-filter="guest"/);
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
  assert.equal(device.actionStatus(client, "priority", { states: {} }, true).reason, "noEntity");
  assert.equal(device.actionStatus(client, "priority", hass, true).reason, null);
  assert.equal(
    device.actionStatus({ ...client, ip: null }, "wake_on_lan", hass, true, { needsIp: false }).reason,
    null
  );
  assert.equal(device.entityState({ states: { x: { state: "unavailable" } } }, "x"), null);
});

test("the device page shows the data and the actions", () => {
  const html = device.renderDevice(data.clients[0], { t, now: NOW, data, hass, threshold: 1 / 3 });
  assert.match(html, /<h1>tv &lt;b&gt;<\/h1>/);
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

test("no device selected shows a hint", () => {
  assert.match(device.renderDevice(null, { t, now: NOW, data, hass }), /Kein Gerät gewählt/);
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

test("a group shows as a chip with its count, and as a bar when it is the filter", () => {
  const chips = network.renderChips(groupState, t, NOW);
  assert.match(chips, /data-filter="label:kids" aria-pressed="true"/);
  assert.match(chips, /Kinder &lt;i&gt;/);
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
