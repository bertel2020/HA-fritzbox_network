/* FRITZ!Box Network topology card: the devices of the network by access point. */

const CARD_TYPE = "fritzbox-network-topology-card";
const FILTERS = ["all", "wifi", "lan", "offline"];

const TEXT = {
  en: {
    title: "Network",
    all: "All",
    wifi: "Wi-Fi",
    lan: "LAN",
    offline: "Offline",
    search: "Search name, IP, MAC or vendor",
    unassigned: "Without access point",
    empty: "No devices match.",
    loading: "Loading…",
    admin: "The topology card needs an administrator account.",
    failed: "Could not load the network.",
    guest: "Guest",
  },
  de: {
    title: "Netzwerk",
    all: "Alle",
    wifi: "WLAN",
    lan: "LAN",
    offline: "Offline",
    search: "Name, IP, MAC oder Hersteller suchen",
    unassigned: "Ohne Access Point",
    empty: "Keine passenden Geräte.",
    loading: "Lädt…",
    admin: "Die Topologie-Karte braucht ein Administratorkonto.",
    failed: "Das Netzwerk konnte nicht geladen werden.",
    guest: "Gast",
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function matches(client, filter, query) {
  if (query) {
    const haystack = `${client.name} ${client.ip ?? ""} ${client.mac} ${client.vendor ?? ""}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
  }
  if (filter === "wifi") return client.link_type === "wlan";
  if (filter === "lan") return client.link_type === "lan";
  if (filter === "offline") return !client.online;
  return true;
}

/** Groups the clients by access point: the box first, the unassigned ones last. */
function groupTopology(data, filter = "all", query = "") {
  const groups = (data.nodes ?? []).map((node) => ({ node, clients: [], total: 0 }));
  const byMac = new Map(groups.map((g) => [g.node.mac, g]));
  const unassigned = { node: null, clients: [], total: 0 };
  for (const client of data.clients ?? []) {
    const group = byMac.get(client.ap_mac) ?? unassigned;
    group.total += 1;
    if (matches(client, filter, query)) group.clients.push(client);
  }
  for (const group of [...groups, unassigned]) {
    group.clients.sort(
      (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
    );
  }
  return unassigned.total ? [...groups, unassigned] : groups;
}

/** 0 (unknown) to 4 bars from the signal in dBm. */
function signalBars(dbm) {
  if (typeof dbm !== "number") return 0;
  if (dbm > -55) return 4;
  if (dbm > -65) return 3;
  if (dbm > -75) return 2;
  return 1;
}

function rateText(client) {
  const down = client.rate_download;
  const up = client.rate_upload;
  if (!down && !up) return "";
  return `${Math.round(down ?? 0)} / ${Math.round(up ?? 0)} Mbit/s`;
}

class FritzboxNetworkTopologyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // once: _build() runs again when the language becomes known
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this._filter = "all";
    this._query = "";
    this._collapsed = new Set();
    this._data = null;
    this._error = null;
    this._unsub = null;
  }

  setConfig(config) {
    this._config = { entry_id: undefined, title: undefined, ...config };
    this._build();
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig() {
    return {};
  }

  set hass(hass) {
    this._hass = hass;
    if (hass.language !== this._language) {
      this._language = hass.language;
      if (this._config) this._build();
    }
    if (!this._unsub && !this._subscribing) this._subscribe();
  }

  connectedCallback() {
    if (this._hass && !this._unsub && !this._subscribing) this._subscribe();
  }

  disconnectedCallback() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  get _t() {
    const language = (this._hass?.language ?? "en").split("-")[0];
    return TEXT[language] ?? TEXT.en;
  }

  async _subscribe() {
    if (!this._hass?.connection) return;
    this._subscribing = true;
    try {
      const message = { type: "fritzbox_network/subscribe_topology" };
      if (this._config?.entry_id) message.entry_id = this._config.entry_id;
      this._unsub = await this._hass.connection.subscribeMessage((data) => {
        this._data = data;
        this._error = null;
        this._renderList();
      }, message);
    } catch (err) {
      this._error = err?.code === "unauthorized" ? "admin" : "failed";
      this._renderList();
    } finally {
      this._subscribing = false;
    }
  }

  _build() {
    const t = this._t;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 8px; align-items: center; }
        input { flex: 1 1 140px; min-width: 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color); background: transparent;
          color: var(--primary-text-color); font: inherit; }
        .chip { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--divider-color);
          background: transparent; color: var(--secondary-text-color); font: inherit;
          font-size: 12px; cursor: pointer; }
        .chip.on { background: var(--primary-color); border-color: var(--primary-color);
          color: var(--text-primary-color, #fff); }
        .ap { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer;
          font-weight: 500; border-top: 1px solid var(--divider-color); }
        .ap .count { margin-left: auto; font-weight: 400; font-size: 12px;
          color: var(--secondary-text-color); }
        .row { display: flex; align-items: center; gap: 8px; padding: 6px 16px 6px 40px;
          font-size: 14px; }
        .row.click { cursor: pointer; }
        .row.click:hover { background: var(--secondary-background-color); }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
          background: var(--disabled-text-color); }
        .dot.on { background: var(--success-color, #43a047); }
        .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .name small { color: var(--secondary-text-color); margin-left: 6px; }
        .rate { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
        .link { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
        .bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 12px; width: 18px; flex: none; }
        .bars i { width: 3px; background: var(--divider-color); border-radius: 1px; display: block; }
        .bars i.on { background: var(--success-color, #43a047); }
        .note { padding: 16px; color: var(--secondary-text-color); }
      </style>
      <ha-card header="${escapeHtml(this._config?.title ?? t.title)}">
        <div class="controls">
          <input type="search" placeholder="${escapeHtml(t.search)}" value="${escapeHtml(this._query)}" />
          ${FILTERS.map(
            (f) =>
              `<button class="chip${f === this._filter ? " on" : ""}" data-filter="${f}">${escapeHtml(t[f])}</button>`
          ).join("")}
        </div>
        <div class="list"></div>
      </ha-card>`;
    const root = this.shadowRoot;
    root.querySelector("input").addEventListener("input", (event) => {
      this._query = event.target.value;
      this._renderList();
    });
    this._renderList();
  }

  _onClick(event) {
    const chip = event.target.closest("[data-filter]");
    if (chip) {
      this._filter = chip.dataset.filter;
      this.shadowRoot
        .querySelectorAll(".chip")
        .forEach((c) => c.classList.toggle("on", c === chip));
      this._renderList();
      return;
    }
    const ap = event.target.closest("[data-ap]");
    if (ap) {
      const key = ap.dataset.ap;
      if (this._collapsed.has(key)) this._collapsed.delete(key);
      else this._collapsed.add(key);
      this._renderList();
      return;
    }
    const row = event.target.closest("[data-entity]");
    if (row) {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: row.dataset.entity },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  _renderList() {
    const list = this.shadowRoot?.querySelector(".list");
    if (!list) return;
    const t = this._t;
    if (this._error) {
      list.innerHTML = `<div class="note">${escapeHtml(t[this._error])}</div>`;
      return;
    }
    if (!this._data) {
      list.innerHTML = `<div class="note">${escapeHtml(t.loading)}</div>`;
      return;
    }
    const groups = groupTopology(this._data, this._filter, this._query);
    if (!groups.some((g) => g.clients.length)) {
      list.innerHTML = `<div class="note">${escapeHtml(t.empty)}</div>`;
      return;
    }
    list.innerHTML = groups
      .map((group) => {
        const key = group.node?.mac ?? "none";
        const open = !this._collapsed.has(key);
        const icon = group.node?.role === "master" ? "mdi:router-wireless" : "mdi:access-point";
        const title = group.node ? group.node.name : t.unassigned;
        const rows = open ? group.clients.map((c) => this._row(c)).join("") : "";
        return `
          <div class="ap" data-ap="${escapeHtml(key)}">
            <ha-icon icon="mdi:chevron-${open ? "down" : "right"}"></ha-icon>
            <ha-icon icon="${group.node ? icon : "mdi:help-network-outline"}"></ha-icon>
            <span>${escapeHtml(title)}</span>
            <span class="count">${group.clients.length} / ${group.total}</span>
          </div>${rows}`;
      })
      .join("");
  }

  _row(client) {
    const t = this._t;
    const bars = signalBars(client.signal_dbm);
    const signal =
      client.link_type === "wlan"
        ? `<span class="bars" title="${client.signal_dbm ?? ""} dBm">${[1, 2, 3, 4]
            .map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${3 + i * 2}px"></i>`)
            .join("")}</span>`
        : "";
    const icon = client.link_type === "lan" ? "mdi:ethernet-cable" : client.link_type === "wlan" ? "mdi:wifi" : "mdi:help";
    const entity = client.entity_id ? ` data-entity="${escapeHtml(client.entity_id)}"` : "";
    return `
      <div class="row${client.entity_id ? " click" : ""}"${entity}>
        <span class="dot${client.online ? " on" : ""}"></span>
        <ha-icon class="link" icon="${icon}"></ha-icon>
        <span class="name">${escapeHtml(client.name)}${client.vendor ? `<small>${escapeHtml(client.vendor)}</small>` : ""}${client.guest ? `<small>${escapeHtml(t.guest)}</small>` : ""}</span>
        <span class="rate">${escapeHtml(rateText(client))}</span>
        ${signal}
      </div>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, FritzboxNetworkTopologyCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "FRITZ!Box Network topology",
    description: "The devices of the network by access point, with Wi-Fi or LAN and signal.",
  });
}

if (typeof module !== "undefined") {
  module.exports = { groupTopology, signalBars, rateText, matches, escapeHtml };
}
