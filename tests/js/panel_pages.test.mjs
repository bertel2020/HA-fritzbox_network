/* The pages Box, Network › Wi-Fi and Manage › Switch over, the tabs around them, against a fake websocket. */

import assert from "node:assert/strict";
import test from "node:test";

/** A stand-in for an element: remembers what is written into it, finds a stand-in for every selector. */
function fakeEl() {
  const kids = {};
  return {
    innerHTML: "",
    textContent: "",
    value: "",
    type: "",
    title: "",
    hidden: false,
    disabled: false,
    dataset: {},
    parentElement: {},
    attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: { setProperty() {} },
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
const boxPage = await import(`${base}panel-box.js`);
const wlanPage = await import(`${base}panel-wlan.js`);
const migratePage = await import(`${base}panel-migrate.js`);
const dialogs = await import(`${base}panel-dialogs.js`);

const t = texts.panelTexts("de");
const en = texts.panelTexts("en");
const NOW = Date.parse("2026-11-07T14:00:00Z");

// the timers a test leaves behind (restart, password) would keep the run alive
const panels = [];
test.afterEach(() => {
  for (const p of panels.splice(0)) {
    clearTimeout(p._restartTimer);
    clearTimeout(p._secretTimer);
  }
});

/** A panel with a fake Home Assistant: answers[type] is the answer, an Error is thrown, a function is called. */
function makePanel(answers, tab) {
  const p = new panel.FritzboxNetworkPanel();
  panels.push(p);
  const calls = [];
  p._entryId = "e1";
  p._hass = {
    language: "de",
    callWS: async (msg) => {
      calls.push(msg);
      const answer = answers[msg.type.replace("fritzbox_network/", "")];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(msg) : structuredClone(answer);
    },
  };
  p._state.tab = tab;
  p._state.data = { can_write: true, nodes: [], clients: [], internet: { connected: true, external_ipv4: "203.0.113.7" } };
  return { p, calls, root: p.shadowRoot };
}

const typesOf = (calls) => calls.map((c) => c.type.replace("fritzbox_network/", ""));

// ---------- tabs ----------

test("there are five tabs, and the phone one; Wi-Fi, address space and routes are pages of the network, VPN of the internet", () => {
  const nav = panel.renderNav({ tab: "wlan", data: {} }, t, 0);
  const labels = [...nav.matchAll(/<button[^>]*data-tab="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["net", "internet", "box", "phone", "diagnose", "devices"]);
  // hidden by the reader, and FRITZ!Box Telefon not there: no phone tab
  const hidden = panel.renderNav({ tab: "wlan", data: {}, phoneHidden: true }, t, 0);
  assert.deepEqual([...hidden.matchAll(/<button[^>]*data-tab="(\w+)"/g)].map((m) => m[1]), ["net", "internet", "box", "diagnose", "devices"]);
  assert.match(nav, /data-tab="net" aria-selected="true"/);
  assert.deepEqual(panel.TAB_GROUPS.net, ["net", "wlan", "addresses", "routes"]);
  assert.deepEqual(panel.TAB_GROUPS.internet, ["internet", "vpn"]);
  const sub = panel.renderSubTabs("wlan", t, { data: {} });
  assert.deepEqual([...sub.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1]), ["Geräte", "WLAN", "Adressraum", "Routen"]);
  assert.match(sub, /role="tablist" aria-label="Netzwerk"/);
  assert.match(sub, /data-tab="wlan" aria-selected="true"/);
  // the box has one page: no switch
  assert.equal(panel.renderSubTabs("box", t, { data: {} }), "");
  assert.match(panel.renderNav({ tab: "box", data: {} }, t, 0), /data-tab="box" aria-selected="true">Box</);
});

test("VPN is offered only with WireGuard, switching over only while FRITZ!Box Tools is set up", () => {
  assert.deepEqual(panel.pagesOf("internet", { data: { vpn: [] } }), ["internet", "vpn"]);
  assert.deepEqual(panel.pagesOf("internet", { data: { vpn: null } }), ["internet"]);
  assert.equal(panel.renderSubTabs("internet", t, { data: {} }), "");
  assert.match(panel.renderSubTabs("internet", t, { data: { vpn: [] } }), /Verbindung<\/button><button[^>]*data-tab="vpn"/);
  assert.deepEqual(panel.pagesOf("devices", { migrate: null }), ["filter", "cleanup"]);
  assert.deepEqual(panel.pagesOf("devices", { migrate: "failed" }), ["filter", "cleanup"]);
  assert.deepEqual(panel.pagesOf("devices", { migrate: { core: null, rows: [] } }), ["filter", "cleanup"]);
  assert.deepEqual(panel.pagesOf("devices", { migrate: { core: { entry_id: "c" }, rows: [] } }), ["filter", "cleanup", "migrate"]);
  assert.match(panel.renderSubTabs("filter", t, { migrate: { core: { entry_id: "c" } } }), /data-tab="migrate"[^>]*>Umsteigen/);
});

test("the new pages are routes of their own, an old or unknown one leads to the network", async () => {
  const shared = await import(`${base}shared.js`);
  for (const page of ["wlan", "box", "migrate", "vpn", "addresses", "routes"]) assert.deepEqual(shared.routeFromHash(`#/${page}`), { tab: page, device: null });
  assert.deepEqual(shared.routeFromHash("#/nonsense"), { tab: "net", device: null });
});

test("the box tab carries a dot while the box restarts", () => {
  const nav = panel.renderNav({ tab: "net", data: {}, boxRestart: { phase: "down" } }, t, 0);
  assert.match(nav, /data-tab="box" aria-selected="false" aria-label="Box, startet neu">Box<i class="dot warn"/);
  assert.doesNotMatch(panel.renderNav({ tab: "net", data: {}, boxRestart: { phase: "back" } }, t, 0), /dot warn/);
});

// ---------- box ----------

const info = {
  model: "FRITZ!Box 7590 AX",
  firmware: "8.25",
  last_restart: "2026-10-15T03:12:00Z",
  uptime_seconds: 23 * 86400 + 4 * 3600,
  cpu_temperature: 61.5,
  line: { linked: true, access_type: "DSL" },
  bytes_received: 1840000000000,
  bytes_sent: 212000000000,
  can_write: true,
};
const boxCtx = (extra = {}) => ({ t, language: "de", now: NOW, internet: { connected: true, external_ipv4: "203.0.113.7" }, restart: null, reconnect: null, ...extra });

test("the box page shows model, firmware, uptime, temperature, the line and the counters", () => {
  const html = boxPage.renderBoxPage(info, boxCtx());
  assert.match(html, /<h1 id="dtitle" tabindex="-1">Box<\/h1>/);
  assert.match(html, /FRITZ!Box 7590 AX/);
  assert.match(html, /FRITZ!OS 8\.25/);
  assert.match(html, /23 d 4 Std\./);
  assert.match(html, /61,5 °C/);
  assert.match(html, /synchron/);
  assert.match(html, /1,84 TB/);
  assert.match(html, /212 GB/);
  assert.match(html, /chip ok"><i class="dot on" aria-hidden="true"><\/i>läuft/);
  assert.match(html, /data-act="reboot" data-k="reboot" aria-haspopup="dialog">Neu starten …/);
  assert.doesNotMatch(html, /data-act="reboot"[^>]*disabled/);
  assert.match(html, /Beide fragen vorher nach/);
});

test("a box without a temperature says so, an unknown line too, and a hostile model is escaped", () => {
  const html = boxPage.renderBoxPage({ ...info, model: "<b>x</b>", cpu_temperature: null, line: { linked: null, access_type: null }, bytes_sent: null }, boxCtx());
  assert.match(html, /<b class="na">nicht gemeldet<\/b><small>Diese Box nennt keine Temperatur\.<\/small>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /<span class="chip">unbekannt<\/span>/);
  assert.match(html, /<b>–<\/b><small>seit dem Neustart/);
});

test("without the right to write both actions are off and the page says why", () => {
  const html = boxPage.renderBoxPage({ ...info, can_write: false }, boxCtx());
  assert.match(html, /data-act="reconnect"[^>]*disabled/);
  assert.match(html, /data-act="reboot"[^>]*disabled/);
  assert.match(html, /Recht „FRITZ!Box Einstellungen“/);
});

test("the box page says when it is loading or the box does not answer", () => {
  assert.match(boxPage.renderBoxPage(null, boxCtx()), /aria-busy="true"/);
  assert.match(boxPage.renderBoxPage("failed", boxCtx()), /Die Box antwortet nicht\.[\s\S]*data-act="box-retry"/);
});

test("during a restart the page shows the steps, locks the actions and, back, how long it took", () => {
  const requestedAt = NOW - 42000;
  const down = boxPage.renderBoxPage(info, boxCtx({ restart: { phase: "down", requestedAt, unreachableAt: NOW - 30000, backAt: null } }));
  assert.match(down, /role="status" aria-live="polite"><b>Die Box startet neu\. Meist dauert das 2 bis 4 Minuten\./);
  assert.match(down, /Box nicht erreichbar <span class="muted">· seit 0:30/);
  assert.match(down, /data-act="reboot"[^>]*disabled/);
  assert.match(down, /chip warn"><i class="dot warn"[^>]*><\/i>startet neu/);
  assert.match(down, /Warte, bis die Box wieder da ist/);
  const back = boxPage.renderBoxPage(info, boxCtx({ restart: { phase: "back", requestedAt: NOW - 198000, unreachableAt: NOW - 190000, backAt: NOW } }));
  assert.match(back, /progress ok[^>]*><b>Die Box ist wieder da \(nach 3:18\)\./);
  assert.match(back, /dauerte 3:18/);
  assert.match(back, /\(von hier\)/);
  assert.match(back, /data-act="box-restart-clear"/);
  const late = boxPage.renderBoxPage(info, boxCtx({ restart: { phase: "late", requestedAt: NOW - 700000, unreachableAt: NOW - 690000, backAt: null } }));
  assert.match(late, /hintline bad[\s\S]*seit über 10 Minuten nicht erreichbar/);
  assert.match(late, /data-act="box-check"/);
});

test("a restart counts as done only once the box answers as restarted, and gives up after ten minutes", () => {
  const start = { phase: "down", requestedAt: NOW, unreachableAt: null, backAt: null };
  // right after the request the box still answers with its old uptime
  assert.equal(boxPage.nextRestart(start, info, NOW + 5000).phase, "down");
  const away = boxPage.nextRestart(start, null, NOW + 10000);
  assert.equal(away.phase, "down");
  assert.equal(away.unreachableAt, NOW + 10000);
  assert.equal(boxPage.nextRestart(away, null, NOW + 20000).unreachableAt, NOW + 10000);
  const back = boxPage.nextRestart(away, { ...info, uptime_seconds: 60 }, NOW + 198000);
  assert.equal(back.phase, "back");
  assert.equal(boxPage.minSec(back.backAt - back.requestedAt), "3:18");
  // without an uptime the last restart tells it, without either the time away
  assert.equal(boxPage.nextRestart(away, { ...info, uptime_seconds: null, last_restart: new Date(NOW + 60000).toISOString() }, NOW + 120000).phase, "back");
  assert.equal(boxPage.nextRestart(start, { ...info, uptime_seconds: null, last_restart: null }, NOW + 5000).phase, "down");
  assert.equal(boxPage.nextRestart(away, { ...info, uptime_seconds: null, last_restart: null }, NOW + 60000).phase, "back");
  assert.equal(boxPage.nextRestart(away, null, NOW + boxPage.RESTART_GIVE_UP_MS + 1).phase, "late");
});

test("reboot asks with the list of what goes away, then calls box/reboot and starts the restart", async () => {
  const { p, calls, root } = makePanel({ "box/info": info, "box/reboot": {} }, "box");
  await p._loadBox();
  assert.match(p._html["box-view"], /FRITZ!Box 7590 AX/);
  const asked = p._interrupt("reboot");
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /Box neu starten\?/);
  assert.match(dialog.innerHTML, /<li>dieses Panel, falls Home Assistant über die Box angebunden ist<\/li>/);
  dialog.querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(typesOf(calls), ["box/info", "box/reboot"]);
  assert.deepEqual(calls[1], { type: "fritzbox_network/box/reboot", entry_id: "e1" });
  assert.equal(p._state.boxRestart.phase, "down");
  assert.match(p._html["box-view"], /Die Box startet neu/);
  clearTimeout(p._restartTimer);
  // cancelled, nothing is sent
  const again = p._interrupt("reconnect");
  root.els["#dialog"].querySelector("#dlg-no").onclick();
  await again;
  assert.equal(calls.length, 2);
});

test("reconnect calls internet/reconnect and shows the address before and now", async () => {
  const { p, calls, root } = makePanel({ "box/info": info, "internet/reconnect": {} }, "box");
  await p._loadBox();
  const asked = p._interrupt("reconnect");
  root.els["#dialog"].querySelector("#dlg-yes").onclick();
  await asked;
  assert.deepEqual(typesOf(calls), ["box/info", "internet/reconnect"]);
  assert.match(p._html["box-view"], /IPv4 vorher<\/dt><dd class="mono">203\.0\.113\.7/);
  p._state.data.internet.external_ipv4 = "203.0.113.99";
  p._renderBoxPage();
  assert.match(p._html["box-view"], /Wieder verbunden\.[\s\S]*203\.0\.113\.99/);
});

// ---------- Wi-Fi ----------

const wlan = {
  networks: [
    { key: "2_4ghz", band: "2.4", ssid: "FRITZ-RM", enabled: true, bssid: "aa:bb:cc:00:00:01", standard: "802.11ax" },
    { key: "5ghz", band: "5", ssid: "FRITZ-RM", enabled: true, bssid: "aa:bb:cc:00:00:02", standard: "802.11ax" },
  ],
  guest: { enabled: true, ssid: "Gäste <i>" },
  can_write: true,
};
const SECRET = { ssid: "Gäste <i>", security: "WPA", password: "Sonnenblume-42", qr_png_base64: "QUJD" };

test("the Wi-Fi page lists the networks with a switch each and the guest access, escaped", () => {
  const html = wlanPage.renderWlan(wlan, { t, busy: new Set(), secret: null });
  assert.match(html, /role="switch" aria-checked="true" aria-label="WLAN FRITZ-RM, 2.4 GHz" data-act="wlan-switch" data-key="2_4ghz" data-on="0"/);
  assert.match(html, /data-key="5ghz"/);
  assert.match(html, /Alle Bänder haben denselben Namen/);
  assert.match(html, /aria-label="Gastzugang Gäste &lt;i&gt;" data-act="wlan-switch" data-key="guest"/);
  assert.match(html, /data-act="wlan-qr"[^>]*>QR-Code<\/button>/);
  assert.doesNotMatch(html, /<img/);
  const busy = wlanPage.renderWlan(wlan, { t, busy: new Set(["5ghz"]), secret: null });
  assert.match(busy, /class="switch busy"[^>]*data-key="5ghz"[^>]*disabled/);
  assert.match(busy, /wird geschaltet …/);
});

test("the guest card names how the network is secured and who is in it, with a button per device", () => {
  const clients = [
    { id: "a1", name: "Handy <b>", guest: true, online: true },
    { id: "a2", name: "Laptop", guest: false, online: true },
    { id: "a3", name: "Alt", guest: true, online: false },
  ];
  const guest = { ...wlan, guest: { enabled: true, ssid: "Gäste", beacon: "11iandWPA3" } };
  const html = wlanPage.renderWlan(guest, { t, busy: new Set(), secret: null, clients });
  assert.match(html, /<span>WPA2 \+ WPA3<\/span><span>1 Gerät verbunden<\/span>/);
  assert.match(html, /data-dev="a1"><span class="dot on"><\/span>Handy &lt;b&gt;/);
  assert.doesNotMatch(html, /data-dev="a2"|data-dev="a3"/);
  assert.match(wlanPage.renderWlan(guest, { t, busy: new Set(), secret: null, clients: [] }), /keine Geräte verbunden/);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, guest: true, online: true }));
  assert.match(wlanPage.renderWlan(guest, { t, busy: new Set(), secret: null, clients: many }), /\+2 weitere/);
});

test("without the right to write the switches are off, QR and password locked, and the page says why", () => {
  const html = wlanPage.renderWlan({ ...wlan, can_write: false }, { t, busy: new Set(), secret: null });
  assert.match(html, /data-key="2_4ghz"[^>]*disabled/);
  assert.match(html, /data-key="guest"[^>]*disabled/);
  assert.match(html, /Nur zur Ansicht/);
  assert.match(html, /QR-Code und Passwort brauchen das Recht/);
  assert.doesNotMatch(html, /data-act="wlan-qr"|data-act="wlan-pw"/);
});

test("the Wi-Fi page says when the box has no guest access, no Wi-Fi, or did not answer", () => {
  assert.match(wlanPage.renderWlan({ ...wlan, guest: null }, { t, busy: new Set() }), /keinen Gastzugang eingerichtet/);
  assert.match(wlanPage.renderWlan({ ...wlan, networks: [] }, { t, busy: new Set() }), /nennt kein eigenes WLAN/);
  assert.match(wlanPage.renderWlan("failed", { t, error: "UPnPError 401" }), /WLAN-Einstellungen nicht genannt[\s\S]*UPnPError 401[\s\S]*wlan-retry/);
  assert.match(wlanPage.renderWlan({ ...wlan, networks: wlan.networks.map((n) => ({ ...n, enabled: false })) }, { t, busy: new Set() }), /Kein Funknetz der Box ist an/);
});

test("a switch calls wlan/switch and takes the answer as the new list; the guest access needs no question", async () => {
  const { p, calls } = makePanel({ "wlan/list": wlan, "wlan/switch": (msg) => ({ ...wlan, guest: { ...wlan.guest, enabled: msg.enabled } }) }, "wlan");
  await p._loadWlan();
  await p._switchWlan("guest", false);
  assert.deepEqual(calls[1], { type: "fritzbox_network/wlan/switch", entry_id: "e1", key: "guest", enabled: false });
  assert.equal(p._state.wlan.guest.enabled, false);
  assert.match(p._html["wlan-view"], /aria-checked="false"[^>]*data-key="guest"/);
  assert.match(p._html["wlan-view"], /<small><span>aus<\/span><\/small>/);
  assert.doesNotMatch(p._html["wlan-view"], /data-act="wlan-qr"/);
  assert.equal(p._state.wlanBusy.size, 0);
});

test("switching a network off asks; the last one says that the panel and the repeaters may go", async () => {
  assert.equal(wlanPage.isLastNetwork(wlan, "5ghz"), false);
  const one = { ...wlan, networks: [wlan.networks[0], { ...wlan.networks[1], enabled: false }] };
  assert.equal(wlanPage.isLastNetwork(one, "2_4ghz"), true);
  const { p, calls, root } = makePanel({ "wlan/list": one, "wlan/switch": one }, "wlan");
  await p._loadWlan();
  const asked = p._switchWlan("2_4ghz", false);
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /WLAN „FRITZ-RM“ \(2\.4 GHz\) ausschalten\?/);
  assert.match(dialog.innerHTML, /das letzte Funknetz der Box/);
  assert.match(dialog.innerHTML, /verlierst du die Verbindung zu diesem Panel/);
  dialog.querySelector("#dlg-no").onclick();
  await asked;
  assert.deepEqual(typesOf(calls), ["wlan/list"]);
  const again = p._switchWlan("2_4ghz", false);
  dialog.querySelector("#dlg-yes").onclick();
  await again;
  assert.deepEqual(calls[1], { type: "fritzbox_network/wlan/switch", entry_id: "e1", key: "2_4ghz", enabled: false });
  // switching on asks nothing
  await p._switchWlan("5ghz", true);
  assert.deepEqual(calls[2], { type: "fritzbox_network/wlan/switch", entry_id: "e1", key: "5ghz", enabled: true });
});

test("the QR code and the password are only read on request, shown in a dialog, masked, and dropped when the page is left", async () => {
  const { p, calls, root } = makePanel({ "wlan/list": wlan, "wlan/guest/secret": SECRET }, "wlan");
  await p._loadWlan();
  assert.ok(!typesOf(calls).includes("wlan/guest/secret"));
  await p._onWlanClick({ act: "wlan-qr" });
  assert.deepEqual(typesOf(calls), ["wlan/list", "wlan/guest/secret"]);
  const dialog = root.els["#dialog"];
  const body = () => dialog.querySelector(".dlg-body").innerHTML;
  assert.match(dialog.innerHTML, /Mit Gäste &lt;i&gt; verbinden/);
  assert.match(body(), /<img src="data:image\/png;base64,QUJD" alt="QR-Code zum Verbinden mit Gäste &lt;i&gt;"/);
  assert.doesNotMatch(body(), /Sonnenblume/);
  assert.match(body(), /id="w-pw" aria-label="Passwort">••••••••••••/);
  assert.match(body(), /data-act="wlan-reveal"[^>]*aria-pressed="false" aria-controls="w-pw"/);
  // the page itself carries neither the code nor the password
  assert.doesNotMatch(p._html["wlan-view"], /<img|Sonnenblume|base64/);
  await p._onWlanClick({ act: "wlan-reveal" });
  assert.match(qrPage(p), /Sonnenblume-42/);
  // leaving the page forgets it, in the state and in the dialog
  globalThis.location = { hash: "#/box" };
  p._onHash();
  assert.equal(p._state.wlanSecret, null);
  assert.equal(p._state.wlanReveal, false);
  clearTimeout(p._secretTimer);
});

function qrPage(p) {
  return wlanPage.qrContent(p._state.wlanSecret, p._state.wlanReveal, t.wlan.guest);
}

test("closing the QR dialog forgets the password; without the right the box refuses it", async () => {
  const { p, root } = makePanel({ "wlan/list": wlan, "wlan/guest/secret": SECRET }, "wlan");
  await p._loadWlan();
  await p._onWlanClick({ act: "wlan-qr" });
  assert.ok(p._state.wlanSecret);
  root.els["#dialog"].querySelector("#dlg-no").onclick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p._state.wlanSecret, null);
  const refused = makePanel({ "wlan/list": wlan, "wlan/guest/secret": Object.assign(new Error("No right"), { code: "unauthorized" }) }, "wlan");
  await refused.p._loadWlan();
  await refused.p._onWlanClick({ act: "wlan-qr" });
  assert.equal(refused.p._state.wlanSecret, null);
  assert.match(refused.root.els["#toast"].textContent, /brauchen das Recht/);
});

test("the password rules are those of WPA, and a generated password keeps them", () => {
  const ok = (p, q) => wlanPage.passwordRules(p, q).map((r) => [r.key, r.ok]);
  assert.deepEqual(ok("", ""), [["ruleLength", null], ["ruleAscii", null], ["ruleSpace", null], ["ruleSame", null]]);
  assert.deepEqual(ok("short", "short"), [["ruleLength", false], ["ruleAscii", true], ["ruleSpace", true], ["ruleSame", true]]);
  assert.equal(wlanPage.passwordOk("Grüne-Wiese-12", "Grüne-Wiese-12"), false);
  assert.equal(wlanPage.passwordOk(" leading-space", " leading-space"), false);
  assert.equal(wlanPage.passwordOk("x".repeat(64), "x".repeat(64)), false);
  assert.equal(wlanPage.passwordOk("Sonnenblume-42", "Sonnenblume-43"), false);
  assert.equal(wlanPage.passwordOk("Sonnenblume-42", "Sonnenblume-42"), true);
  const made = wlanPage.randomPassword();
  assert.match(made, /^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  assert.doesNotMatch(made, /[01lIO]/);
  assert.equal(wlanPage.passwordOk(made, made), true);
});

test("the password dialog checks while typing, sends only a valid password and empties its fields", async () => {
  const root = fakeRoot();
  const sent = [];
  const asked = dialogs.openPasswordDialog(root, t, {
    title: t.wlan.pw.title,
    lead: "Für Gäste",
    warn: t.wlan.pw.kick,
    rules: wlanPage.passwordRules,
    generate: () => "abcd-EFGH-2345-wxyz",
    submit: async (password) => {
      sent.push(password);
    },
  });
  const dialog = root.els["#dialog"];
  assert.match(dialog.innerHTML, /id="dlg-pw1" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off"[^>]* aria-describedby="dlg-rules"/);
  assert.match(dialog.innerHTML, /id="dlg-show" aria-pressed="false" aria-controls="dlg-pw1 dlg-pw2"/);
  assert.doesNotMatch(dialog.innerHTML, /value=/);
  const pw1 = dialog.querySelector("#dlg-pw1");
  const pw2 = dialog.querySelector("#dlg-pw2");
  const yes = dialog.querySelector("#dlg-yes");
  pw1.value = "kurz";
  pw1.oninput();
  assert.equal(yes.disabled, true);
  assert.match(dialog.querySelector("#dlg-rules").innerHTML, /<li class="bad">8 bis 63 Zeichen/);
  pw2.value = "kurz";
  pw2.oninput();
  assert.equal(yes.disabled, true);
  dialog.querySelector("#dlg-gen").onclick();
  assert.equal(pw1.value, "abcd-EFGH-2345-wxyz");
  assert.equal(yes.disabled, false);
  await yes.onclick();
  assert.equal(await asked, true);
  assert.deepEqual(sent, ["abcd-EFGH-2345-wxyz"]);
  assert.equal(pw1.value, "");
  assert.equal(pw2.value, "");
});

test("a new guest password goes to wlan/guest/password and the QR code is dropped", async () => {
  const { p, calls, root } = makePanel({ "wlan/list": wlan, "wlan/guest/secret": SECRET, "wlan/guest/password": { password: "x" } }, "wlan");
  await p._loadWlan();
  await p._onWlanClick({ act: "wlan-qr" });
  const changing = p._changeGuestPassword();
  const dialog = root.els["#dialog"];
  dialog.querySelector("#dlg-pw1").value = "Neues-Passwort-7";
  dialog.querySelector("#dlg-pw2").value = "Neues-Passwort-7";
  dialog.querySelector("#dlg-pw1").oninput();
  await dialog.querySelector("#dlg-yes").onclick();
  await changing;
  assert.deepEqual(calls.at(-1), { type: "fritzbox_network/wlan/guest/password", entry_id: "e1", password: "Neues-Passwort-7" });
  assert.equal(p._state.wlanSecret, null);
  assert.doesNotMatch(JSON.stringify(p._state, (k, v) => (v instanceof Set ? [...v] : v)), /Neues-Passwort|Sonnenblume/);
});

// ---------- switching over ----------

const scan = {
  core: { entry_id: "core1", title: "FRITZ!Box 7590 AX", state: "loaded", same_box: true },
  rows: [
    { core_entity_id: "sensor.fritz_cpu", core_name: "CPU-Temperatur", group: "box", status: "migrate", reason: "", target_entity_id: "sensor.fritz_network_cpu_temperature", notes: ["approximate"], used_by: ["automation.too_hot"] },
    { core_entity_id: "switch.fritz_guest", core_name: "Gast <b>", group: "box", status: "conflict", reason: "claimed_twice", target_entity_id: "switch.fritz_network_guest_wifi", notes: [], used_by: [] },
    { core_entity_id: "button.fritz_cleanup", core_name: "Bereinigen", group: "box", status: "none", reason: "not_covered", target_entity_id: null, notes: [], used_by: [] },
    { core_entity_id: "device_tracker.tab", core_name: "Galaxy Tab", group: "client", status: "skip", reason: "not_made_here", target_entity_id: null, notes: [], used_by: [] },
  ],
  token: "abc",
};

test("the preview counts the results, groups the rows and names the reasons; nothing can be taken over yet", () => {
  assert.deepEqual(migratePage.migrateCounts(scan.rows), { all: 4, migrate: 1, conflict: 1, none: 1, skip: 1 });
  const html = migratePage.renderMigrate(scan, { t, filter: "all" });
  assert.match(html, /Von FRITZ!Box Tools umsteigen/);
  assert.match(html, /Übernehmen gibt es noch nicht/);
  assert.doesNotMatch(html, /data-act="mig-run"|Übernehmen …/);
  assert.match(html, /<div class="tile ok"><span class="label">Übernehmen<\/span><b>1<\/b>/);
  assert.match(html, /<div class="tile bad"><span class="label">Konflikte<\/span><b>1<\/b>/);
  assert.match(html, /data-f="all"[^>]*aria-pressed="true">Alle<b>4<\/b>/);
  assert.match(html, /<span>Box<\/span><span>3<\/span>[\s\S]*<span>Netzwerkgeräte<\/span><span>1<\/span>/);
  assert.match(html, /sensor\.fritz_network_cpu_temperature<\/b><span class="mono">bekommt die ID links/);
  assert.match(html, /Ungefähres Gegenstück[\s\S]*In 1 Automationen benutzt: automation\.too_hot/);
  assert.match(html, /Zwei Entitäten von FRITZ!Box Tools passen/);
  assert.match(html, /Gast &lt;b&gt;/);
  assert.match(html, /Dafür gibt es hier keine Entität/);
  assert.match(html, /nicht eingebunden \(Verwalten › Einbinden\)/);
  const conflicts = migratePage.renderMigrate(scan, { t, filter: "conflict" });
  assert.match(conflicts, /switch\.fritz_guest/);
  assert.doesNotMatch(conflicts, /sensor\.fritz_cpu|Netzwerkgeräte/);
});

test("the preview says when it is read, failed, or FRITZ!Box Tools is missing or for another box", () => {
  assert.match(migratePage.renderMigrate(null, { t }), /aria-busy="true"/);
  assert.match(migratePage.renderMigrate("failed", { t }), /ließen sich nicht lesen[\s\S]*mig-rescan/);
  assert.match(migratePage.renderMigrate({ core: null, rows: [], token: "" }, { t }), /nicht eingerichtet/);
  assert.match(migratePage.renderMigrate({ ...scan, core: { ...scan.core, same_box: false, title: "Ferienhaus" } }, { t }), /für eine andere Box[\s\S]*„Ferienhaus“/);
});

test("the note above the pages shows for the same box, not on the page itself, and Later hides it for 30 days", () => {
  const banner = migratePage.renderBanner(scan, { t, hidden: false, tab: "net" });
  assert.match(banner, /class="banner " role="region" aria-label="Hinweis"/);
  assert.match(banner, /FRITZ!Box Tools fragt dieselbe Box ab/);
  assert.match(banner, /data-act="mig-open"[^>]*>Umsteigen …/);
  assert.match(migratePage.renderBanner({ ...scan, core: { ...scan.core, state: "not_loaded" } }, { t, tab: "net" }), /banner info[\s\S]*Ansehen/);
  assert.equal(migratePage.renderBanner(scan, { t, hidden: false, tab: "migrate" }), "");
  assert.equal(migratePage.renderBanner(scan, { t, hidden: true, tab: "net" }), "");
  assert.equal(migratePage.renderBanner({ ...scan, core: { ...scan.core, same_box: false } }, { t, tab: "net" }), "");
  assert.equal(migratePage.renderBanner({ core: null, rows: [] }, { t, tab: "net" }), "");

  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(migratePage.bannerHidden("core1", NOW, storage), false);
  assert.equal(migratePage.hideBanner("core1", NOW, storage), true);
  assert.equal(migratePage.bannerHidden("core1", NOW + 29 * 86400000, storage), true);
  assert.equal(migratePage.bannerHidden("core1", NOW + 31 * 86400000, storage), false);
  assert.equal(migratePage.bannerHidden("other", NOW, storage), false);
  // a browser that refuses the storage: no note hidden, no error
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(migratePage.bannerHidden("core1", NOW, broken), false);
  assert.equal(migratePage.hideBanner("core1", NOW, broken), false);
});

test("the panel asks migrate/scan, shows the note, and Later takes it away", async () => {
  const { p, calls } = makePanel({ "migrate/scan": scan }, "net");
  p._state.view = "list";
  await p._loadMigrate({ quiet: true });
  assert.deepEqual(calls[0], { type: "fritzbox_network/migrate/scan", entry_id: "e1" });
  assert.match(p._html.migbanner, /FRITZ!Box Tools fragt dieselbe Box ab/);
  assert.deepEqual(panel.pagesOf("devices", p._state), ["filter", "cleanup", "migrate"]);
  p._onMigrateClick({ act: "mig-later" });
  assert.equal(p._state.migrateHidden, true);
  assert.equal(p._html.migbanner, "");
});

test("a failing scan leaves no note and no page to switch over", async () => {
  const { p } = makePanel({ "migrate/scan": Object.assign(new Error("Unknown command."), { code: "unknown_command" }) }, "filter");
  await p._loadMigrate({ quiet: true });
  assert.equal(p._state.migrate, null);
  assert.deepEqual(panel.pagesOf("devices", p._state), ["filter", "cleanup"]);
  await p._loadMigrate();
  assert.equal(p._state.migrate, "failed");
});

test("all new texts exist in both languages", () => {
  for (const key of ["boxPage", "wlan", "migrate"]) assert.ok(en[key] && t[key]);
  assert.equal(en.tabs.wlan, "Wi-Fi");
  assert.equal(t.tabs.migrate, "Umsteigen");
  assert.equal(en.boxPage.actions.rebootList.length, t.boxPage.actions.rebootList.length);
});

// ---------- another box is chosen ----------

test("an answer that comes after another box was chosen is dropped, and nothing of the old box stays", async () => {
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const { p, calls } = makePanel({ "history/summary": () => slow, "address/overview": { network: null, own: null } });
  p._subscribe = async () => false;
  p._update = () => {};
  p._state.history = { "aa:bb": { online: [1] } };
  p._state.addr.status = "ready";
  p._historyAt = 0;

  const reading = p._maybeLoadHistory();
  assert.equal(p._historyBusy, true);
  await p._switchBox("e2");

  // the state of the old box is gone, and the new box is read at once
  assert.equal(p._state.history, null);
  assert.equal(p._state.addr.status, "loading");
  assert.equal(p._historyBusy, false);
  assert.equal(p._historyAt, null);

  // the old answer arrives late: it must not land in the new box
  release({ devices: { "old:mac": { online: [1] } }, traffic: { "old:mac": [1] } });
  await Promise.race([reading, new Promise((r) => setTimeout(r, 20))]);
  assert.equal(p._state.history, null);
  assert.equal(p._state.traffic, null);

  // the new box asks with its own id
  p._historyBusy = false;
  p._hass.callWS = async (msg) => {
    calls.push(msg);
    return { devices: { "new:mac": { online: [1] } }, traffic: {} };
  };
  await p._maybeLoadHistory();
  assert.deepEqual(Object.keys(p._state.history), ["new:mac"]);
  assert.equal(calls.at(-1).entry_id, "e2");
});

test("the notes of an address page that is not read yet are not sent to a box", async () => {
  const { p, calls } = makePanel({});
  p._state.addr.status = "loading";
  p._state.addr.own = null;
  await p._saveOwn();
  assert.deepEqual(calls, []);
});

// ---------- keyboard on the tab lists ----------

test("the arrows step around a tab list, Home and End go to its ends, other keys do nothing", () => {
  const tabs = ["net", "internet", "box"];
  assert.equal(panel.tabKeyTarget(tabs, "net", "ArrowRight"), "internet");
  assert.equal(panel.tabKeyTarget(tabs, "box", "ArrowRight"), "net");
  assert.equal(panel.tabKeyTarget(tabs, "net", "ArrowLeft"), "box");
  assert.equal(panel.tabKeyTarget(tabs, "internet", "Home"), "net");
  assert.equal(panel.tabKeyTarget(tabs, "internet", "End"), "box");
  assert.equal(panel.tabKeyTarget(tabs, "net", "Enter"), null);
  assert.equal(panel.tabKeyTarget([], "net", "ArrowRight"), null);
});

test("only the open tab is in the tab order, the others are reached with the arrows", () => {
  const nav = panel.renderNav({ tab: "wlan", data: {} }, t, 0);
  assert.equal([...nav.matchAll(/<button role="tab" tabindex="0"/g)].length, 1);
  assert.match(nav, /tabindex="0" data-tab="net" aria-selected="true"/);
  assert.match(nav, /tabindex="-1" data-tab="internet" aria-selected="false"/);
  const sub = panel.renderSubTabs("wlan", t, { data: {} });
  assert.match(sub, /tabindex="0" data-tab="wlan"/);
  assert.match(sub, /tabindex="-1" data-tab="addresses"/);
});

test("an arrow on a tab moves the focus to the next one", () => {
  const { p } = makePanel({}, "net");
  const mk = (name) => ({ name, focus() { focused = name; }, getAttribute: () => "tab" });
  let focused = null;
  const buttons = [mk("a"), mk("b"), mk("c")];
  const list = { querySelectorAll: () => buttons };
  for (const b of buttons) b.closest = () => list;
  let prevented = false;
  p._onKey({ key: "ArrowRight", target: buttons[0], preventDefault: () => (prevented = true) });
  assert.equal(focused, "b");
  assert.equal(prevented, true);
});

// ---------- the width the bar at the bottom follows ----------

test("the bar at the bottom follows the width of the panel, not of the window", async () => {
  const styles = await import(`${base}panel-styles.js`);
  const css = Object.values(styles).find((v) => typeof v === "string" && v.includes("#bnav"));
  assert.ok(css);
  // no media query of the window decides about the bars any more
  assert.doesNotMatch(css, /@media[^{]*\{\s*#nav/);
  assert.match(css, /:host\(\[compact\]\) #nav \{ display: none; \}/);
  assert.match(css, /:host\(\[compact\]\) #bnav \{ display: flex/);

  const { p } = makePanel({}, "net");
  const flags = [];
  p.toggleAttribute = (name, on) => flags.push([name, on]);
  for (const width of [1200, panel.COMPACT_WIDTH, panel.COMPACT_WIDTH + 1, 0]) {
    Object.defineProperty(p, "clientWidth", { value: width, configurable: true });
    p._syncCompact();
  }
  assert.deepEqual(flags, [["compact", false], ["compact", true], ["compact", false], ["compact", false]]);
});

// ---------- keyboard on the charts ----------

test("a key moves along the points of a chart, not past its ends", async () => {
  const { plotKeyTarget, plotAttrs } = await import(`${base}shared.js`);
  assert.equal(plotKeyTarget(10, 4, "ArrowRight"), 5);
  assert.equal(plotKeyTarget(10, 4, "ArrowLeft"), 3);
  assert.equal(plotKeyTarget(10, 9, "ArrowRight"), 9);
  assert.equal(plotKeyTarget(10, 0, "ArrowLeft"), 0);
  assert.equal(plotKeyTarget(10, 4, "Home"), 0);
  assert.equal(plotKeyTarget(10, 4, "End"), 9);
  assert.equal(plotKeyTarget(100, 50, "PageUp"), 60);
  assert.equal(plotKeyTarget(10, 4, "a"), null);
  assert.equal(plotKeyTarget(0, 0, "Home"), null);
  assert.match(plotAttrs('Speed "now"'), /role="slider" tabindex="0" aria-orientation="horizontal" aria-label="Speed &quot;now&quot;"/);
});

test("every chart of the pages is drawn with the attributes for the keyboard", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["panel-internet.js", "panel-device.js"]) {
    const source = readFileSync(new URL(`${base}${file}`, import.meta.url), "utf8");
    const plots = source.match(/class="plot"/g) ?? [];
    assert.ok(plots.length > 0, file);
    assert.equal((source.match(/class="plot" \$\{plotAttrs\(/g) ?? []).length, plots.length, file);
  }
});

test("a key on a chart shows the point and tells it to a screen reader", () => {
  const { p } = makePanel({}, "net");
  const attrs = {};
  const tip = { hidden: true, style: {}, offsetWidth: 40, textContent: "" };
  const cursor = { hidden: true, style: {} };
  const plot = {
    dataset: { pts: JSON.stringify([[1000, 10], [1060, 20], [1120, 30]]), unit: "dBm", range: "day" },
    classList: { contains: (c) => c === "plot" },
    getAttribute: (n) => (n === "role" ? "slider" : null),
    setAttribute: (n, v) => (attrs[n] = v),
    getBoundingClientRect: () => ({ width: 300, left: 0 }),
    querySelector: (s) => (s === ".tip" ? tip : cursor),
  };
  let prevented = 0;
  const key = (k) => p._onKey({ key: k, target: plot, preventDefault: () => prevented++ });
  key("ArrowLeft"); // the first key starts at the latest point
  assert.equal(attrs["aria-valuenow"], "1");
  assert.match(attrs["aria-valuetext"], /20 dBm/);
  assert.equal(tip.hidden, false);
  key("Home");
  assert.equal(attrs["aria-valuenow"], "0");
  key("End");
  assert.equal(attrs["aria-valuenow"], "2");
  assert.equal(prevented, 3);
  key("x");
  assert.equal(prevented, 3);
});
