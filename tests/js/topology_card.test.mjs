import assert from "node:assert/strict";
import test from "node:test";

globalThis.HTMLElement = class {};

const shared = await import("../../custom_components/fritzbox_network/frontend/shared.js");
const cards = await import("../../custom_components/fritzbox_network/frontend/fritzbox-network-topology-card.js");
const card = { ...shared, ...cards };

const data = {
  nodes: [
    { mac: "aa", name: "Box", role: "master" },
    { mac: "bb", name: "Repeater", role: "slave" },
  ],
  clients: [
    { mac: "01", name: "tv", ip: "192.0.2.1", online: true, ap_mac: "aa", link_type: "lan" },
    { mac: "02", name: "phone", ip: "192.0.2.2", online: true, ap_mac: "bb", link_type: "wlan", signal_dbm: -50 },
    { mac: "03", name: "old", ip: null, online: false, ap_mac: "bb", link_type: "wlan" },
    { mac: "04", name: "lost", ip: null, online: false, ap_mac: null, link_type: null },
    { mac: "05", name: "alpha", ip: null, online: false, ap_mac: "aa", link_type: "lan" },
  ],
};

test("groups the clients by access point, the box first", () => {
  const groups = card.groupTopology(data);
  assert.deepEqual(groups.map((g) => g.node?.name ?? null), ["Box", "Repeater", null]);
  assert.deepEqual(groups[0].clients.map((c) => c.name), ["tv", "alpha"]);
  assert.equal(groups[1].total, 2);
});

test("online devices come before offline ones", () => {
  const [, repeater] = card.groupTopology(data);
  assert.deepEqual(repeater.clients.map((c) => c.name), ["phone", "old"]);
});

test("the filters keep the totals", () => {
  const groups = card.groupTopology(data, "wifi");
  assert.deepEqual(groups[1].clients.map((c) => c.name), ["phone", "old"]);
  assert.equal(groups[0].clients.length, 0);
  assert.equal(groups[0].total, 2);
  assert.deepEqual(
    card.groupTopology(data, "offline").flatMap((g) => g.clients.map((c) => c.name)),
    ["alpha", "old", "lost"]
  );
});

test("the search looks at name, IP and MAC", () => {
  const names = (q) => card.groupTopology(data, "all", q).flatMap((g) => g.clients.map((c) => c.name));
  assert.deepEqual(names("PHONE"), ["phone"]);
  assert.deepEqual(names("192.0.2.1"), ["tv"]);
  assert.deepEqual(names("04"), ["lost"]);
});

test("the search also looks at the vendor", () => {
  const withVendor = { ...data, clients: [{ ...data.clients[0], vendor: "Espressif Inc." }, data.clients[1]] };
  const names = card.groupTopology(withVendor, "all", "espressif").flatMap((g) => g.clients.map((c) => c.name));
  assert.deepEqual(names, ["tv"]);
});

test("the link ratio is the lower one of both directions", () => {
  const client = { rate_download: 150, rate_max_download: 150, rate_upload: 45, rate_max_upload: 150 };
  assert.equal(card.linkRatio(client), 0.3);
  assert.equal(card.linkRatio({ rate_download: 100, rate_max_download: 200 }), 0.5);
  assert.equal(card.linkRatio({ rate_download: 100 }), null);
  assert.equal(card.linkRatio({ rate_download: 1, rate_max_download: 0 }), null);
});

test("a weak link needs an online device and a low ratio", () => {
  const slow = { online: true, rate_download: 45, rate_max_download: 150 };
  assert.equal(card.isWeak(slow), true);
  assert.equal(card.isWeak({ ...slow, online: false }), false);
  assert.equal(card.isWeak({ online: true, rate_download: 100, rate_max_download: 150 }), false);
  assert.equal(card.isWeak({ online: true }), false);
});

test("the weak filter shows only the weak ones", () => {
  const weak = { mac: "09", name: "slow", online: true, ap_mac: "aa", link_type: "wlan", rate_download: 40, rate_max_download: 150 };
  const names = card.groupTopology({ nodes: data.nodes, clients: [...data.clients, weak] }, "weak").flatMap((g) => g.clients.map((c) => c.name));
  assert.deepEqual(names, ["slow"]);
});

test("the group without an access point only exists when needed", () => {
  const groups = card.groupTopology({ nodes: data.nodes, clients: [data.clients[0]] });
  assert.equal(groups.length, 2);
});

test("a topology without mesh puts everything in one group", () => {
  const groups = card.groupTopology({ nodes: [], clients: data.clients });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].node, null);
});

test("signal bars", () => {
  assert.deepEqual([-40, -60, -70, -90, null].map(card.signalBars), [4, 3, 2, 1, 0]);
});

test("rate text", () => {
  assert.equal(card.rateText({ rate_download: 866.4, rate_upload: 780 }), "866 / 780 Mbit/s");
  assert.equal(card.rateText({}), "");
});

test("the weak threshold can be changed", () => {
  const client = { online: true, rate_download: 60, rate_max_download: 100 };
  assert.equal(card.isWeak(client), false);
  assert.equal(card.isWeak(client, 0.7), true);
  const weak = { mac: "09", name: "slow", online: true, ap_mac: "aa", link_type: "wlan", ...client };
  const names = (threshold) =>
    card.groupTopology({ nodes: data.nodes, clients: [weak] }, "weak", "", threshold).flatMap((g) => g.clients.map((c) => c.name));
  assert.deepEqual(names(0.5), []);
  assert.deepEqual(names(0.7), ["slow"]);
});

test("the filters with a number count offline and weak devices", () => {
  const weak = { mac: "09", name: "slow", online: true, rate_download: 40, rate_max_download: 150 };
  assert.deepEqual(card.countFilters({ clients: [...data.clients, weak] }), { offline: 3, weak: 1 });
  assert.deepEqual(card.countFilters(null), { offline: 0, weak: 0 });
});

test("the config gets its defaults and drops values that make no sense", () => {
  assert.deepEqual(card.normalizeConfig(), {
    title: undefined,
    entry_id: undefined,
    default_filter: "all",
    collapsed: false,
    compact: false,
    max_height: 0,
    weak_threshold: 33,
    hide_vendor: false,
    hide_rate: false,
    hide_signal: false,
    hide_radio: false,
    tap_action: "expand",
  });
  const config = card.normalizeConfig({
    title: "",
    default_filter: "bogus",
    max_height: -5,
    weak_threshold: 500,
    tap_action: "explode",
    compact: 1,
  });
  assert.equal(config.title, undefined);
  assert.equal(config.default_filter, "all");
  assert.equal(config.max_height, 0);
  assert.equal(config.weak_threshold, 33);
  assert.equal(config.tap_action, "expand");
  assert.equal(config.compact, true);
  const set = card.normalizeConfig({ default_filter: "weak", max_height: 300, weak_threshold: 50, tap_action: "none" });
  assert.deepEqual(
    [set.default_filter, set.max_height, set.weak_threshold, set.tap_action],
    ["weak", 300, 50, "none"]
  );
});

test("the editor form names every option of the config", async () => {
  const form = await card.FritzboxNetworkTopologyCard.getConfigForm();
  const names = form.schema.flatMap((item) => (item.schema ? item.schema : [item])).map((item) => item.name);
  assert.deepEqual(
    names.sort(),
    Object.keys(card.normalizeConfig()).sort()
  );
  for (const name of names) {
    assert.notEqual(form.computeLabel({ name }), name, `${name} has a label`);
  }
});

test("the radios of an access point show band, channel and load", () => {
  const t = { channel: "Ch {n}" };
  const node = {
    radios: {
      "2_4ghz": { channel: 1, utilization: 12 },
      "5ghz": { channel: 100, utilization: 85 },
      "6ghz": {},
    },
  };
  assert.deepEqual(card.radioInfo(node, t), [
    { text: "2.4 GHz · Ch 1 · 12 %", busy: false },
    { text: "5 GHz · Ch 100 · 85 %", busy: true },
    { text: "6 GHz", busy: false },
  ]);
  assert.deepEqual(card.radioInfo({}, t), []);
  assert.deepEqual(card.radioInfo(null, t), []);
});

test("the detail line has IP, MAC, band and signal as far as known", () => {
  assert.equal(
    card.detailText({ ip: "192.0.2.2", mac: "aa:bb", band: "5ghz", signal_dbm: -52 }),
    "192.0.2.2 · aa:bb · 5 GHz · -52 dBm"
  );
  assert.equal(card.detailText({ ip: null, mac: "aa:bb" }), "aa:bb");
});

test("the radio rows count the online devices on each band", () => {
  const radios = {
    nodes: [
      { mac: "aa", name: "Box", role: "master", radios: { "5ghz": { channel: 100, utilization: 40, noise_dbm: -90 }, "2_4ghz": { channel: 1 } } },
      { mac: "bb", name: "Repeater", role: "slave", radios: {} },
    ],
    clients: [
      { mac: "01", online: true, ap_mac: "aa", band: "5ghz" },
      { mac: "02", online: true, ap_mac: "aa", band: "5ghz" },
      { mac: "03", online: false, ap_mac: "aa", band: "5ghz" },
      { mac: "04", online: true, ap_mac: "bb", band: "5ghz" },
    ],
  };
  const rows = card.radioRows(radios);
  assert.deepEqual(rows.map((r) => r.node.name), ["Box"]);
  assert.deepEqual(rows[0].bands.map((b) => [b.label, b.channel, b.utilization, b.noise_dbm, b.clients]), [
    ["5 GHz", 100, 40, -90, 2],
    ["2.4 GHz", 1, null, null, 0],
  ]);
  assert.deepEqual(card.radioRows(null), []);
});

test("the chosen devices keep the order of the config and show the missing ones", () => {
  const found = card.devicesFor(
    { clients: [{ entity_id: "device_tracker.a", name: "a" }, { entity_id: "device_tracker.b", name: "b" }] },
    ["device_tracker.b", "device_tracker.x", "device_tracker.a"]
  );
  assert.deepEqual(found.map((d) => d.client?.name ?? null), ["b", null, "a"]);
  assert.deepEqual(card.devicesFor(null, ["device_tracker.a"]), [{ entity: "device_tracker.a", client: null }]);
});

test("the button for all devices blocks when all are online-capable, else allows", () => {
  const on = (state) => ({ state });
  assert.deepEqual(card.bulkPlan(["a", "b"], { a: on("on"), b: on("on") }), { block: true, entities: ["a", "b"] });
  assert.deepEqual(card.bulkPlan(["a", "b"], { a: on("on"), b: on("off") }), { block: false, entities: ["b"] });
  assert.deepEqual(card.bulkPlan(["a", "b"], { a: on("unavailable"), b: on("on") }), { block: true, entities: ["b"] });
  assert.deepEqual(card.bulkPlan(["a"], {}), { block: false, entities: [] });
});

test("the configs of the radio and the device card", () => {
  assert.deepEqual(card.normalizeRadioConfig({ hide_noise: 1, title: "" }), {
    title: undefined,
    entry_id: undefined,
    hide_noise: true,
    hide_clients: false,
  });
  assert.deepEqual(card.normalizeDeviceConfig({ entities: "device_tracker.a" }).entities, ["device_tracker.a"]);
  assert.deepEqual(card.normalizeDeviceConfig({ entities: ["device_tracker.a", "", 5] }).entities, ["device_tracker.a"]);
  assert.deepEqual(card.normalizeDeviceConfig().entities, []);
});

test("the editors of the other cards name every option", async () => {
  for (const [form, config] of [
    [await card.FritzboxNetworkRadioCard.getConfigForm(), card.normalizeRadioConfig()],
    [await card.FritzboxNetworkDeviceCard.getConfigForm(), card.normalizeDeviceConfig()],
  ]) {
    const names = form.schema.flatMap((item) => (item.schema ? item.schema : [item])).map((item) => item.name);
    assert.deepEqual(names.sort(), Object.keys(config).sort());
    for (const name of names) assert.notEqual(form.computeLabel({ name }), name);
  }
});

test("names are escaped", () => {
  assert.equal(card.escapeHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
});

const NOW = Date.parse("2026-11-01T12:00:00Z");
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const panelData = {
  nodes: [
    { mac: "aa", name: "Box", role: "master", radios: {} },
    { mac: "bb", name: "Repeater", role: "slave", radios: {} },
  ],
  clients: [
    { mac: "01", id: "01", name: "tv", online: true, ap_mac: "aa", link_type: "lan", rate_download: 1000, created_at: day(100) },
    { mac: "02", id: "02", name: "phone", online: true, ap_mac: "bb", link_type: "wlan", band: "5ghz", signal_dbm: -50, rate_download: 30, rate_max_download: 150, created_at: day(2), wan_access: false },
    { mac: "03", id: "03", name: "guest", online: true, ap_mac: "bb", link_type: "wlan", band: "2_4ghz", signal_dbm: -70, guest: true, created_at: day(1) },
    { mac: "04", id: "04", name: "old", online: false, ap_mac: null, link_type: null, last_online: day(60), created_at: day(300) },
    { mac: "05", id: "05", name: "recent", online: false, ap_mac: "aa", link_type: "lan", last_online: day(3), created_at: day(300) },
    { mac: "06", id: "06", name: "unknown", online: false, ap_mac: "aa", link_type: "lan", created_at: day(300) },
  ],
};

test("days since a time, and none for an unknown one", () => {
  assert.equal(card.daysSince(day(3), NOW), 3);
  assert.equal(card.daysSince(day(0), NOW), 0);
  assert.equal(card.daysSince(null, NOW), null);
  assert.equal(card.daysSince("garbage", NOW), null);
});

test("the panel filters count what they would show", () => {
  const counts = card.panelCounts(panelData, NOW);
  assert.deepEqual(counts, {
    all: 6, online: 3, offline: 3, wlan: 2, lan: 3, guest: 1, blocked: 1, weak: 1, new: 2, stale: 1, unassigned: 1,
  });
});

test("a device the box says nothing about is not blocked", () => {
  assert.equal(card.isBlocked({ wan_access: false }), true);
  assert.equal(card.isBlocked({ wan_access: true }), false);
  assert.equal(card.isBlocked({ wan_access: null }), false);
  assert.equal(card.isBlocked({}), false);
});

test("a device is stale only when its time online is known and old enough", () => {
  const names = (f) => card.panelClients(panelData, { filter: f, now: NOW }).map((c) => c.name);
  assert.deepEqual(names("stale"), ["old"]);
  assert.deepEqual(names("new"), ["guest", "phone"]);
});

test("the list sorts online devices first, then by the chosen key", () => {
  const names = (sort) => card.panelClients(panelData, { sort, now: NOW }).map((c) => c.name);
  assert.deepEqual(names("name"), ["guest", "phone", "tv", "old", "recent", "unknown"]);
  assert.deepEqual(names("signal"), ["phone", "guest", "tv", "old", "recent", "unknown"]);
  assert.deepEqual(names("rate").slice(0, 3), ["tv", "phone", "guest"]);
  assert.deepEqual(names("last").slice(3), ["recent", "old", "unknown"]);
});

test("the search works on top of the filter", () => {
  const found = card.panelClients(panelData, { filter: "online", query: "PHO", now: NOW });
  assert.deepEqual(found.map((c) => c.name), ["phone"]);
});

test("groups by access point keep empty ones only while nothing narrows the list", () => {
  const all = card.panelClients(panelData, { now: NOW });
  assert.deepEqual(card.panelGroups(panelData, all).map((g) => g.key), ["aa", "bb", "none"]);
  const narrow = card.panelClients(panelData, { filter: "guest", now: NOW });
  assert.deepEqual(card.panelGroups(panelData, narrow, "ap", true).map((g) => g.key), ["bb"]);
  const lonely = { ...panelData, clients: [panelData.clients[0]] };
  assert.deepEqual(card.panelGroups(lonely, lonely.clients).map((g) => g.key), ["aa", "bb"]);
});

test("groups by band and a flat list", () => {
  const all = card.panelClients(panelData, { now: NOW });
  assert.deepEqual(card.panelGroups(panelData, all, "band").map((g) => g.key), ["lan", "2_4ghz", "5ghz", "none"]);
  assert.deepEqual(card.panelGroups(panelData, all, "flat").map((g) => g.clients.length), [6]);
});

test("the head of an access point sums up its online devices", () => {
  assert.deepEqual(card.apSummary(panelData, panelData.nodes[1]), { wlan: 2, lan: 0, minRate: 30 });
  assert.deepEqual(card.apSummary(panelData, panelData.nodes[0]), { wlan: 0, lan: 1, minRate: 1000 });
  assert.deepEqual(card.apSummary({ clients: [] }, panelData.nodes[0]), { wlan: 0, lan: 0, minRate: null });
});

test("the route names a device only for a valid hash", () => {
  assert.equal(card.deviceFromHash("#/device/3c2af4a1b2c3"), "3c2af4a1b2c3");
  assert.equal(card.deviceFromHash("#/device/<script>"), null);
  assert.equal(card.deviceFromHash("#/other"), null);
  assert.equal(card.deviceFromHash(""), null);
});

test("the route names the page", () => {
  assert.deepEqual(card.routeFromHash(""), { tab: "net", device: null });
  assert.deepEqual(card.routeFromHash("#/cleanup"), { tab: "cleanup", device: null });
  assert.deepEqual(card.routeFromHash("#/filter"), { tab: "filter", device: null });
  assert.deepEqual(card.routeFromHash("#/device/3c2af4a1b2c3"), { tab: "net", device: "3c2af4a1b2c3" });
  assert.deepEqual(card.routeFromHash("#/nonsense"), { tab: "net", device: null });
});

test("the clean-up slider keeps the devices gone for at least that long", () => {
  const devices = [{ days: 10 }, { days: 30 }, { days: 200 }];
  assert.deepEqual(card.staleSince(devices, 30).map((d) => d.days), [30, 200]);
  assert.deepEqual(card.staleSince(devices, 365), []);
  assert.deepEqual(card.staleSince(null, 30), []);
});

test("a MAC is added to a list or taken out of it", () => {
  assert.deepEqual(card.toggleMac(["a"], "b"), ["a", "b"]);
  assert.deepEqual(card.toggleMac(["a", "b"], "a"), ["b"]);
});

test("the filter draft counts as changed only when it differs from the filter in force", () => {
  const current = { filter_mode: "include", filter_devices: ["a", "b"], ignore_guests: false, ignore_private_macs: false };
  assert.equal(card.filterChanged(current, { ...current, filter_devices: ["b", "a"] }), false);
  assert.equal(card.filterChanged(current, { ...current, filter_devices: ["a"] }), true);
  assert.equal(card.filterChanged(current, { ...current, ignore_guests: true }), true);
  assert.equal(card.filterChanged(current, { ...current, filter_mode: "exclude" }), true);
  // with "all" the list of devices does not matter
  const all = { ...current, filter_mode: "all" };
  assert.equal(card.filterChanged(all, { ...all, filter_devices: [] }), false);
  assert.equal(card.filterChanged(null, all), false);
});
