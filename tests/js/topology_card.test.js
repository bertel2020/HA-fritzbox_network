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

test("names are escaped", () => {
  assert.equal(card.escapeHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
});
