const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

globalThis.HTMLElement = class {};

const card = require(
  path.join(
    __dirname,
    "../../custom_components/fritzbox_network/frontend/fritzbox-network-topology-card.js"
  )
);

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
    tap_action: "more-info",
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
  assert.equal(config.tap_action, "more-info");
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

test("names are escaped", () => {
  assert.equal(card.escapeHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
});
