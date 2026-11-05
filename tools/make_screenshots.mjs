// Renders the side panel and the dashboard cards with sample data in a real browser and writes
// the README screenshots to screenshots/ (German) and screenshots-en/ (English).
//
// Needs playwright-core and @mdi/js, which are not part of the repository, and Google Chrome:
//   npm install --no-save --prefix /some/dir playwright-core @mdi/js
//   NODE_DEPS=/some/dir node tools/make_screenshots.mjs [scene ...]
// CHROME=/path overrides the macOS default path. Scenes: net, map, device, cleanup, filter,
// internet, topology, radio, devices (default: all).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "custom_components/fritzbox_network/frontend");
const require = createRequire(join(process.env.NODE_DEPS ?? process.cwd(), "noop.js"));
const mdi = require("@mdi/js");
const { chromium } = require("playwright-core");

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://shots.local";

const THEMES = {
  light: {
    "--primary-color": "#03a9f4",
    "--primary-text-color": "#212121",
    "--secondary-text-color": "#727272",
    "--card-background-color": "#ffffff",
    "--secondary-background-color": "#e5e5e5",
    "--divider-color": "rgba(0,0,0,0.12)",
    "--error-color": "#db4437",
    "--warning-color": "#ffa600",
    "--success-color": "#43a047",
    "--info-color": "#039be5",
    "--text-primary-color": "#ffffff",
    page: "#f4f4f4",
  },
  dark: {
    "--primary-color": "#03a9f4",
    "--primary-text-color": "#e1e1e1",
    "--secondary-text-color": "#9b9b9b",
    "--card-background-color": "#1c1c1c",
    "--secondary-background-color": "#282828",
    "--divider-color": "rgba(225,225,225,0.12)",
    "--error-color": "#ef5350",
    "--warning-color": "#ffb74d",
    "--success-color": "#66bb6a",
    "--info-color": "#29b6f6",
    "--text-primary-color": "#ffffff",
    page: "#111111",
  },
};

const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600000).toISOString();

// The sample network: documentation addresses only, no real devices.
const BOX = "3c:a6:2f:00:00:01";
const REPEATER_LIVING = "3c:a6:2f:00:00:02";
const REPEATER_GARDEN = "3c:a6:2f:00:00:03";

const id = (mac) => mac.replaceAll(":", "");
const act = (key) => ({
  internet_access: `switch.${key}_internet`,
  priority: `switch.${key}_priority`,
  wake_on_lan: `button.${key}_wol`,
  access_profile: `select.${key}_profile`,
});

function client(mac, name, extra) {
  return {
    mac, id: id(mac), name, ip: null, online: true, guest: false, vendor: null, entity_id: null,
    ap_mac: BOX, link_type: "lan", band: null, ssid: null, port: null, speed: null, vpn: false,
    wan_access: true, priority: false, filter_profile: null, private_mac: false, device_id: null,
    last_online: null, created_at: ago(120), actions: {}, labels: [], signal_dbm: null,
    rate_download: null, rate_upload: null, rate_max_download: null, rate_max_upload: null, ...extra,
  };
}

function lan(mac, key, name, ip, vendor, extra = {}) {
  return client(mac, name, {
    ip, vendor, entity_id: `device_tracker.fritz_${id(mac)}`, device_id: `d_${key}`, actions: act(key),
    rate_download: 1000, rate_upload: 1000, rate_max_download: 1000, rate_max_upload: 1000, ...extra,
  });
}

function wifi(mac, key, name, ip, vendor, ap, signal, rate, extra = {}) {
  return client(mac, name, {
    ip, vendor, entity_id: `device_tracker.fritz_${id(mac)}`, device_id: `d_${key}`, actions: act(key),
    ap_mac: ap, link_type: "wlan", band: rate[2] ?? "5ghz", ssid: "Zuhause", signal_dbm: signal,
    rate_download: rate[0], rate_upload: rate[1], rate_max_download: rate[3] ?? rate[0] + 200,
    rate_max_upload: rate[3] ?? rate[1] + 200, ...extra,
  });
}

// A VDSL line with the sample throughput of the last two hours; documentation addresses only.
function internet(en) {
  const now = Math.round(Date.now() / 1000);
  const samples = Array.from({ length: 120 }, (_, i) => {
    const wave = Math.sin(i / 9);
    return [now - (119 - i) * 30, Math.round(Math.max(300, 18000 + 16000 * wave + (i % 11) * 700)), Math.round(2500 + 1200 * Math.sin(i / 5))];
  });
  const band = (from, to, base, dip) => Array.from({ length: to - from }, (_, i) => Math.round(base - ((i * 7) % 13) - (i > dip ? 8 : 0)));
  const gap = (n) => Array(n).fill(0);
  return {
    connected: true, uptime: 65439, last_error: "ERROR_NONE", access_type: "DSL", rate_down: 56316, rate_up: 11260,
    external_ipv4: "203.0.113.7", external_ipv6: "2001:db8::1", ipv6_prefix: "2001:db8:1::", ipv6_prefix_length: 56,
    dns: ["198.51.100.1", "198.51.100.2", "2001:db8::53"],
    dsl: {
      modulation: "VDSL", profile: "17a", rate_down: 56316, rate_up: 11260, max_rate_down: 96347, max_rate_up: 34957,
      noise_margin_down: 17, noise_margin_up: 22, attenuation_down: 7, attenuation_up: 7, fec_errors: 96, crc_errors: 0,
      spectrum_down: [...gap(1), ...band(0, 12, 112, 8), ...gap(5), ...band(0, 22, 80, 15), ...gap(8), ...band(0, 16, 66, 11)],
      spectrum_up: [...gap(7), ...band(0, 14, 88, 99), ...gap(10), ...band(0, 20, 60, 12), ...gap(13)],
    },
    throughput: { down: samples.at(-1)[1], up: samples.at(-1)[2] }, samples,
    events: [
      { time: ago(0, 11), kind: "ip_changed", detail: "203.0.113.7" },
      { time: ago(0, 11), kind: "reconnected", detail: null },
    ],
  };
}

function sample(lang) {
  const en = lang === "en";
  const kids = en ? "Kids" : "Kinder";
  const labels = [
    { id: "kids", name: en ? "Kids" : "Kinder", icon: "mdi:account-child", color: "blue" },
    { id: "guests", name: en ? "Guests" : "Gäste", icon: "mdi:account-group", color: "green" },
    { id: "work", name: en ? "Work" : "Arbeit", icon: "mdi:briefcase", color: "orange" },
  ];
  const clients = [
    lan("3c:a6:2f:10:00:01", "nas", "NAS", "192.168.178.20", "Synology Inc."),
    lan("3c:a6:2f:10:00:02", "tv", en ? "Living room TV" : "Fernseher Wohnzimmer", "192.168.178.31", "Samsung Electronics", {
      labels: ["kids"], rate_download: 1000, rate_upload: 1000, wan_access: false,
    }),
    lan("3c:a6:2f:10:00:03", "printer", en ? "Office printer" : "Drucker Büro", "192.168.178.45", "Brother Industries", {
      ap_mac: REPEATER_LIVING, rate_download: 100, rate_upload: 100, rate_max_download: 100, rate_max_upload: 100,
    }),
    lan("3c:a6:2f:10:00:04", "desk", en ? "Desktop PC" : "Arbeits-PC", "192.168.178.50", "ASUSTek Computer", {
      ap_mac: REPEATER_LIVING, labels: ["work"],
    }),
    wifi("3c:a6:2f:20:00:01", "phone1", "Pixel 9 Anna", "192.168.178.61", "Google", BOX, -48, [866, 780], { labels: ["kids"] }),
    wifi("3c:a6:2f:20:00:02", "phone2", "iPhone Ben", "192.168.178.62", null, BOX, -57, [650, 585], { private_mac: true }),
    wifi("3c:a6:2f:20:00:03", "laptop", "MacBook Pro", "192.168.178.63", "Apple", REPEATER_LIVING, -52, [866, 866], { labels: ["work"] }),
    wifi("3c:a6:2f:20:00:04", "tablet", en ? "Kids tablet" : "Kindertablet", "192.168.178.64", "Amazon Technologies", REPEATER_LIVING, -71, [86, 72, "5ghz", 433], {
      labels: ["kids"], priority: true,
    }),
    wifi("3c:a6:2f:20:00:05", "speaker", en ? "Kitchen speaker" : "Küchenlautsprecher", "192.168.178.70", "Sonos", BOX, -62, [72, 72, "2_4ghz", 144]),
    wifi("3c:a6:2f:20:00:06", "camera", en ? "Garden camera" : "Gartenkamera", "192.168.178.71", "Espressif", REPEATER_GARDEN, -78, [29, 29, "2_4ghz", 144]),
    wifi("3c:a6:2f:20:00:07", "plug", en ? "Smart plug" : "Steckdose Terrasse", "192.168.178.72", "Espressif", REPEATER_GARDEN, -66, [72, 72, "2_4ghz", 72]),
    wifi("3c:a6:2f:20:00:08", "guest1", en ? "Guest phone" : "Gast-Handy", "192.168.179.2", "Samsung Electronics", BOX, -60, [433, 390], {
      guest: true, ssid: en ? "Guest" : "Gäste", labels: ["guests"],
    }),
    client("3c:a6:2f:30:00:01", en ? "Old laptop" : "Altes Notebook", {
      online: false, vendor: "Lenovo", ap_mac: REPEATER_LIVING, link_type: "wlan", last_online: ago(3), actions: act("oldlaptop"),
      device_id: "d_oldlaptop", entity_id: "device_tracker.fritz_3ca62f300001",
    }),
    client("3c:a6:2f:30:00:02", "Raspberry Pi", {
      online: false, vendor: "Raspberry Pi Trading", last_online: ago(1, 5), actions: act("pi"), device_id: "d_pi",
      entity_id: "device_tracker.fritz_3ca62f300002",
    }),
  ];
  const topology = {
    entry_id: "box1",
    can_write: true,
    labels,
    internet: internet(en),
    firmware: null,
    nodes: [
      {
        mac: BOX, name: "FRITZ!Box 7590", role: "master", model: "FRITZ!Box 7590",
        radios: { "2_4ghz": { channel: 6, utilization: 34, noise_dbm: -92 }, "5ghz": { channel: 100, utilization: 52, noise_dbm: -96 } },
      },
      {
        mac: REPEATER_LIVING, name: en ? "Repeater living room" : "Repeater Wohnzimmer", role: "slave", model: "FRITZ!Repeater 6000",
        uplink: { type: "wlan", band: "5ghz", signal_dbm: -58 },
        radios: { "2_4ghz": { channel: 11, utilization: 21, noise_dbm: -93 }, "5ghz": { channel: 44, utilization: 78, noise_dbm: -94 } },
      },
      {
        mac: REPEATER_GARDEN, name: en ? "Repeater garden" : "Repeater Garten", role: "slave", model: "FRITZ!Repeater 1200",
        uplink: { type: "lan", band: null, signal_dbm: null },
        radios: { "2_4ghz": { channel: 1, utilization: 12, noise_dbm: -90 }, "5ghz": { channel: 36, utilization: 5, noise_dbm: -97 } },
      },
    ],
    clients,
  };
  const device = (c) => ({ mac: c.mac, id: c.id, name: c.name, vendor: c.vendor, ip: c.ip });
  const cleanup = {
    days: 30,
    devices: [
      [en ? "Old printer" : "Alter Drucker", "HP Inc.", 214],
      [en ? "Guest tablet" : "Gast-Tablet", "Lenovo", 142],
      ["Fire TV Stick", "Amazon Technologies", 96],
      [en ? "Holiday laptop" : "Urlaubs-Laptop", "Dell", 71],
      ["ESP32-3f9a", "Espressif", 48],
      [en ? "Neighbour phone" : "Handy Nachbar", null, 37],
    ].map(([name, vendor, days], i) => ({
      mac: `3c:a6:2f:40:00:0${i}`, id: id(`3c:a6:2f:40:00:0${i}`), name, vendor, ip: null,
      last_online: ago(days), days,
    })),
    hidden: [
      { mac: "3c:a6:2f:50:00:01", id: id("3c:a6:2f:50:00:01"), name: en ? "Smart bulb (old)" : "Lampe (alt)" },
    ],
  };
  const all = clients.map(device);
  const filterPreview = {
    options: { filter_mode: "all", filter_devices: [], ignore_guests: true, ignore_private_macs: false },
    keep: all.filter((d) => d.id !== "3ca62f200008"),
    add: [],
    remove: all.filter((d) => d.id === "3ca62f200008"),
    devices: all.slice().sort((a, b) => a.name.localeCompare(b.name)),
  };
  const states = {};
  for (const c of clients) {
    for (const [name, entity] of Object.entries(c.actions)) {
      states[entity] = {
        entity_id: entity,
        state: name === "internet_access" ? (c.wan_access ? "on" : "off")
          : name === "priority" ? (c.priority ? "on" : "off")
          : name === "wake_on_lan" ? "unknown" : kids,
        attributes: name === "access_profile" ? { options: [en ? "Standard" : "Standard", kids, en ? "Unrestricted" : "Unbeschränkt"] } : {},
      };
    }
  }
  const ports = {
    entries: [
      { description: "Nextcloud", protocol: "TCP", external_port: 443, internal_port: 8443, client: "192.168.178.20", device_id: id("3c:a6:2f:10:00:01"), device_name: "NAS", enabled: true, lease: 0 },
      { description: en ? "Game console" : "Spielkonsole", protocol: "UDP", external_port: 3074, internal_port: 3074, client: "192.168.178.64", device_id: id("3c:a6:2f:20:00:04"), device_name: en ? "Kids tablet" : "Kindertablet", enabled: true, lease: 3600 },
    ],
  };
  return { topology, cleanup, filterPreview, ports, states };
}

const SCENES = {
  net: { kind: "panel", viewport: [1280, 820], hash: "" },
  map: { kind: "panel", viewport: [1280, 1100], hash: "", view: "map" },
  internet: { kind: "panel", viewport: [1280, 1740], hash: "#/internet" },
  device: { kind: "panel", viewport: [1280, 1160], hash: "#/device/3ca62f200004" },
  cleanup: { kind: "panel", viewport: [1280, 760], hash: "#/cleanup" },
  filter: { kind: "panel", viewport: [1280, 920], hash: "#/filter" },
  topology: { kind: "card", viewport: [460, 700], type: "fritzbox-network-topology-card", config: {} },
  radio: { kind: "card", viewport: [460, 420], type: "fritzbox-network-radio-card", config: {} },
  devices: {
    kind: "card", viewport: [460, 420], type: "fritzbox-network-device-card",
    config: { entities: ["device_tracker.fritz_3ca62f200004", "device_tracker.fritz_3ca62f100002", "device_tracker.fritz_3ca62f200001"] },
  },
};

const LANGS = { de: "screenshots", en: "screenshots-en" };
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".png": "image/png" };
const brand = join(frontend, "..", "brand");

const iconPath = (name) => mdi["mdi" + name.replace(/^mdi:/, "").replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())];

const HARNESS = (theme, name) => {
  const vars = Object.entries(theme).filter(([k]) => k.startsWith("--")).map(([k, v]) => `${k}:${v}`).join(";");
  return `<!doctype html><html><body style="margin:0;background:${theme.page};${vars};font-family:Roboto,system-ui,sans-serif;font-size:14px;color:var(--primary-text-color)">
<div id="host" style="${name === "card" ? "padding:16px" : "height:100vh"}"></div></body></html>`;
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const n of names) if (!SCENES[n]) throw new Error(`unknown scene ${n}`);
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME=/path`);

const cardSource = readFileSync(join(frontend, "fritzbox-network-topology-card.js"), "utf-8");
const iconNames = new Set([...cardSource.matchAll(/mdi:[a-z0-9-]+/g)].map((m) => m[0]));
const iconMap = Object.fromEntries([...iconNames].map((n) => [n, iconPath(n)]));

const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [lang, dir] of Object.entries(LANGS)) {
    const outDir = join(root, dir);
    mkdirSync(outDir, { recursive: true });
    const data = sample(lang);
    for (const [themeName, theme] of Object.entries(THEMES)) {
      for (const name of names) {
        const scene = SCENES[name];
        const [width, height] = scene.viewport;
        const context = await browser.newContext({
          viewport: { width, height }, deviceScaleFactor: 2, colorScheme: themeName, locale: lang === "en" ? "en-GB" : "de-DE",
        });
        const page = await context.newPage();
        page.on("pageerror", (err) => console.error(`[${lang} ${themeName} ${name}]`, err.message));
        await page.route(`${ORIGIN}/**`, (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/") return route.fulfill({ contentType: "text/html", body: HARNESS(theme, scene.kind) });
          // Home Assistant serves the brand folder next to the frontend files
          const inBrand = path.startsWith("/brand/");
          const base = inBrand ? brand : frontend;
          const file = inBrand ? join(brand, path.slice(7)) : join(frontend, path);
          if (!file.startsWith(base) || !existsSync(file)) return route.fulfill({ status: 404 });
          return route.fulfill({ contentType: TYPES[extname(file)] ?? "text/plain", body: readFileSync(file) });
        });
        await page.goto(`${ORIGIN}/${scene.hash ?? ""}`);
        await page.evaluate((map) => {
          window.__paths = map;
          customElements.define("ha-menu-button", class extends HTMLElement {});
          customElements.define("ha-card", class extends HTMLElement {
            static get observedAttributes() { return ["header"]; }
            connectedCallback() { this.render(); }
            attributeChangedCallback() { this.render(); }
            render() {
              if (this._slotted) return;
              this._slotted = true;
              const shadow = this.attachShadow({ mode: "open" });
              shadow.innerHTML = `<style>:host{display:block;background:var(--card-background-color);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.2);overflow:hidden;color:var(--primary-text-color)}
                .h{padding:16px 16px 8px;font-size:20px;font-weight:500}</style><div class="h"></div><slot></slot>`;
              const head = shadow.querySelector(".h");
              const sync = () => { head.textContent = this.getAttribute("header") ?? ""; head.hidden = !head.textContent; };
              sync();
              new MutationObserver(sync).observe(this, { attributes: true });
            }
          });
          customElements.define("ha-icon", class extends HTMLElement {
            static get observedAttributes() { return ["icon"]; }
            attributeChangedCallback() { this.render(); }
            connectedCallback() { this.render(); }
            render() {
              const d = window.__paths[this.getAttribute("icon")];
              const shadow = this.shadowRoot || this.attachShadow({ mode: "open" });
              shadow.innerHTML = `<style>:host{display:inline-flex;width:24px;height:24px}</style>${
                d ? `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="${d}"/></svg>` : ""}`;
            }
          });
        }, iconMap);
        await page.addScriptTag({
          type: "module",
          content: `import "${ORIGIN}/${scene.kind === "panel" ? "fritzbox-network-panel.js" : "fritzbox-network-topology-card.js"}";
            window.__ready = true;`,
        });
        await page.waitForFunction(() => window.__ready === true);
        await page.evaluate(
          async ({ scene, data, lang, dark }) => {
            const hass = {
              language: lang, locale: { language: lang }, themes: { darkMode: dark },
              states: data.states, entities: {}, callService: async () => {},
              callWS: async (msg) => {
                switch (msg.type) {
                  case "fritzbox_network/entries": return [{ entry_id: "box1", title: lang === "en" ? "Home" : "Zuhause" }];
                  case "fritzbox_network/cleanup/list": return data.cleanup;
                  case "fritzbox_network/filter/preview": return data.filterPreview;
                  case "fritzbox_network/ports/list": return data.ports;
                  case "fritzbox_network/history/device": {
                    const c = data.topology.clients.find((x) => x.mac === msg.mac);
                    const make = (count, step) => Array.from({ length: count }, (_, i) => [
                      i * step, 1, c?.link_type === "wlan" ? Math.round((c.signal_dbm ?? -60) + 6 * Math.sin(i / 7) + (i % 5)) : null,
                      Math.round((c?.rate_download ?? 100) * (0.8 + 0.2 * Math.sin(i / 5))),
                    ]);
                    const pad = (n) => String(n).padStart(2, "0");
                    const traffic = {};
                    for (let i = 0; i < 20; i++) {
                      const d = new Date(Date.now() - i * 86400000);
                      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                      const down = (0.6 + 0.5 * Math.sin(i / 2) ** 2) * 1e9;
                      traffic[key] = [Math.round(i === 0 ? 1.26e9 : down), Math.round(i === 0 ? 3.68e8 : down / 7)];
                    }
                    return { day: make(288, 300), week: make(168, 3600), traffic };
                  }
                  case "fritzbox_network/history/summary": {
                    // a steady wobble per device, so the sparklines have something to draw
                    const devices = {};
                    data.topology.clients.forEach((c, n) => {
                      const wave = (base, amp) => Array.from({ length: 24 }, (_, i) => Math.round((base + amp * Math.sin((i + n * 3) / 3)) * 10) / 10);
                      devices[c.mac] = {
                        online: Array.from({ length: 24 }, (_, i) => (c.online || i < 12 ? 1 : 0)),
                        signal: c.link_type === "wlan" ? wave(c.signal_dbm ?? -60, 5) : Array(24).fill(null),
                        rate: wave(c.rate_download ?? 100, (c.rate_download ?? 100) / 5),
                      };
                    });
                    return { devices };
                  }
                  default: return {};
                }
              },
              connection: {
                subscribeMessage: async (callback) => {
                  setTimeout(() => callback(data.topology), 0);
                  return () => {};
                },
              },
            };
            // the card shows the states of its devices' switches; give the ones that only the cards use
            const host = document.getElementById("host");
            let el;
            if (scene.kind === "panel") {
              // the panel starts with the view chosen last
              localStorage.setItem("fritzbox_network_panel_view", scene.view ?? "list");
              el = document.createElement("fritzbox-network-panel");
              el.style.cssText = "display:block;height:100vh;overflow:auto";
              host.appendChild(el);
              el.narrow = false;
              el.hass = hass;
            } else {
              el = document.createElement(scene.type);
              el.style.cssText = "display:block;width:428px";
              host.appendChild(el);
              el.setConfig(scene.config);
              el.hass = hass;
            }
          },
          { scene, data, lang, dark: themeName === "dark" }
        );
        await page.waitForTimeout(600);
        await page.mouse.move(0, 0);
        const target = scene.kind === "panel" ? page : page.locator(scene.type);
        await target.screenshot({ path: join(outDir, `${name}-${themeName}.png`) });
        await context.close();
        console.log(`${dir}/${name}-${themeName}.png`);
      }
    }
  }
} finally {
  await browser.close();
}
