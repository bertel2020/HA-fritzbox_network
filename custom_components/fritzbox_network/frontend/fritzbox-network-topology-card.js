/* FRITZ!Box Network cards: the topology of the network, its Wi-Fi radios and chosen devices. */

import {
  WEAK_LINK_RATIO,
  BANDS,
  BUSY_UTILIZATION,
  escapeHtml,
  matches,
  linkRatio,
  isWeak,
  countFilters,
  groupTopology,
  signalBars,
  rateText,
  radioInfo,
  detailText,
  radioRows,
  devicesFor,
  bulkPlan,
  signalHtml,
  linkIcon,
} from "./shared.js";

const INTEGRATION = "fritzbox_network";
const FILTERS = ["all", "wifi", "lan", "offline", "weak"];

const TAP_ACTIONS = ["expand", "more-info", "none"];
const TEXT = {
  en: {
    title: "Network",
    all: "All",
    wifi: "Wi-Fi",
    lan: "LAN",
    offline: "Offline",
    weak: "Weak",
    weakTitle: "Weak link: only {percent} % of the possible rate",
    search: "Search…",
    searchTitle: "Search name, IP, MAC or vendor",
    rateTitle: "Download / upload",
    unassigned: "Without access point",
    empty: "No devices match.",
    loading: "Loading…",
    admin: "The topology card needs an administrator account.",
    failed: "Could not load the network.",
    guest: "Guest",
    channel: "Ch {n}",
    radioTitle: "Wi-Fi",
    deviceTitle: "Devices",
    noRadios: "The box reports no radio data.",
    noDevices: "Pick devices in the card editor.",
    unknownDevice: "Unknown device",
    noise: "Noise {n} dBm",
    clients: "Devices on this radio",
    allBlock: "Block all",
    allAllow: "Allow all",
    internetBlock: "Block internet",
    internetAllow: "Allow internet",
    priority: "Priority",
    wol: "Wake on LAN",
    details: "Open device",
    editor: {
      title: "Title",
      entry_id: "FRITZ!Box",
      entry_id_help: "Only needed with more than one box.",
      default_filter: "Filter at the start",
      collapsed: "Start with access points collapsed",
      compact: "Hide search and filters",
      max_height: "Maximum height (px)",
      max_height_help: "Empty or 0: no limit, the list grows with the devices.",
      weak_threshold: "Weak link below (% of the highest rate)",
      weak_threshold_help: "Empty: 33.",
      hide_vendor: "Hide the vendor",
      hide_rate: "Hide the rate",
      hide_signal: "Hide the signal",
      hide_radio: "Hide channel and load of the access points",
      entities: "Devices",
      entities_help: "Devices of the FRITZ!Box Network integration.",
      hide_noise: "Hide the noise",
      hide_clients: "Hide the number of devices",
      tap_action: "Tap on a device",
      tap_action_help: "Empty: show the details and actions.",
      expand: "Show details and actions",
      "more-info": "Open the device",
      none: "Do nothing",
    },
  },
  de: {
    title: "Netzwerk",
    all: "Alle",
    wifi: "WLAN",
    lan: "LAN",
    offline: "Offline",
    weak: "Schwach",
    weakTitle: "Schwache Verbindung: nur {percent} % der möglichen Rate",
    search: "Suchen…",
    searchTitle: "Name, IP, MAC oder Hersteller suchen",
    rateTitle: "Download / Upload",
    unassigned: "Ohne Access Point",
    empty: "Keine passenden Geräte.",
    loading: "Lädt…",
    admin: "Die Topologie-Karte braucht ein Administratorkonto.",
    failed: "Das Netzwerk konnte nicht geladen werden.",
    guest: "Gast",
    channel: "Kanal {n}",
    radioTitle: "WLAN",
    deviceTitle: "Geräte",
    noRadios: "Die Box meldet keine Funkdaten.",
    noDevices: "Wähle Geräte im Karteneditor.",
    unknownDevice: "Unbekanntes Gerät",
    noise: "Rauschen {n} dBm",
    clients: "Geräte auf diesem Funkmodul",
    allBlock: "Alle sperren",
    allAllow: "Alle freigeben",
    internetBlock: "Internet sperren",
    internetAllow: "Internet freigeben",
    priority: "Priorisierung",
    wol: "Wake on LAN",
    details: "Gerät öffnen",
    editor: {
      title: "Titel",
      entry_id: "FRITZ!Box",
      entry_id_help: "Nur bei mehr als einer Box nötig.",
      default_filter: "Filter beim Start",
      collapsed: "Access Points zugeklappt starten",
      compact: "Suche und Filter ausblenden",
      max_height: "Maximale Höhe (px)",
      max_height_help: "Leer oder 0: keine Grenze, die Liste wächst mit den Geräten.",
      weak_threshold: "Schwache Verbindung unter (% der höchsten Rate)",
      weak_threshold_help: "Leer: 33.",
      hide_vendor: "Hersteller ausblenden",
      hide_rate: "Rate ausblenden",
      hide_signal: "Signal ausblenden",
      hide_radio: "Kanal und Auslastung der Access Points ausblenden",
      entities: "Geräte",
      entities_help: "Geräte der Integration FRITZ!Box Netzwerk.",
      hide_noise: "Rauschen ausblenden",
      hide_clients: "Anzahl der Geräte ausblenden",
      tap_action: "Tippen auf ein Gerät",
      tap_action_help: "Leer: Details und Aktionen zeigen.",
      expand: "Details und Aktionen zeigen",
      "more-info": "Gerät öffnen",
      none: "Nichts tun",
    },
  },
};

function textFor(language) {
  return TEXT[String(language ?? "en").split("-")[0]] ?? TEXT.en;
}

function documentLanguage() {
  return globalThis.document?.documentElement?.lang || globalThis.navigator?.language;
}

/** The schema of a visual editor with its labels in the language of the page. */
function editorForm(schema) {
  return {
    schema,
    computeLabel: (item) => textFor(documentLanguage()).editor[item.name] ?? item.name,
    computeHelper: (item) => textFor(documentLanguage()).editor[`${item.name}_help`],
  };
}

function selectOptions(values) {
  const t = textFor(documentLanguage());
  return {
    select: { mode: "dropdown", options: values.map((value) => ({ value, label: t[value] ?? t.editor[value] })) },
  };
}

const configEntry = { config_entry: { integration: INTEGRATION } };

/** The options with their defaults; a value that makes no sense falls back to the default. */
function normalizeConfig(config = {}) {
  const number = (value, min, max, fallback) =>
    typeof value === "number" && value >= min && value <= max ? value : fallback;
  return {
    title: config.title || undefined,
    entry_id: config.entry_id || undefined,
    default_filter: FILTERS.includes(config.default_filter) ? config.default_filter : "all",
    collapsed: Boolean(config.collapsed),
    compact: Boolean(config.compact),
    max_height: number(config.max_height, 0, 10000, 0),
    weak_threshold: number(config.weak_threshold, 1, 99, Math.round(WEAK_LINK_RATIO * 100)),
    hide_vendor: Boolean(config.hide_vendor),
    hide_rate: Boolean(config.hide_rate),
    hide_signal: Boolean(config.hide_signal),
    hide_radio: Boolean(config.hide_radio),
    tap_action: TAP_ACTIONS.includes(config.tap_action) ? config.tap_action : "expand",
  };
}

function normalizeRadioConfig(config = {}) {
  return {
    title: config.title || undefined,
    entry_id: config.entry_id || undefined,
    hide_noise: Boolean(config.hide_noise),
    hide_clients: Boolean(config.hide_clients),
  };
}

function normalizeDeviceConfig(config = {}) {
  const entities = [config.entities].flat().filter((id) => typeof id === "string" && id);
  return {
    title: config.title || undefined,
    entry_id: config.entry_id || undefined,
    entities,
    hide_rate: Boolean(config.hide_rate),
    hide_signal: Boolean(config.hide_signal),
  };
}

const SHARED_CSS = `
  :host { display: block; container-type: inline-size; }
  .chip { flex: none; white-space: nowrap; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--divider-color);
    background: transparent; color: var(--secondary-text-color); font: inherit;
    font-size: 12px; cursor: pointer; }
  .chip.on { background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff); }
  [role="button"]:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
    background: var(--disabled-text-color); }
  .dot.on { background: var(--success-color, #43a047); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name small { color: var(--secondary-text-color); margin-left: 6px; }
  .rate { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
  .link { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .weak { --mdc-icon-size: 16px; color: var(--warning-color, #ffa600); }
  .bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 12px; width: 18px; flex: none; }
  .bars i { width: 3px; background: var(--divider-color); border-radius: 1px; display: block; }
  .bars i.on { background: var(--success-color, #43a047); }
  .note { padding: 16px; color: var(--secondary-text-color); }
  .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  /* on a narrow card the secondary columns go, so no line breaks */
  @container (max-width: 400px) {
    .rate, .name small, .noise { display: none; }
  }
`;

/** Gets the topology from the integration and keeps it; the cards only draw it. */
class FritzboxNetworkCardBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // once: _build() runs again when the language becomes known
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("keydown", (event) => {
      // the rows and headers are not buttons of their own
      if ((event.key === "Enter" || event.key === " ") && event.target.matches?.('[role="button"]')) {
        event.preventDefault();
        this._onClick(event);
      }
    });
    this._data = null;
    this._error = null;
    this._unsub = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (hass.language !== this._language) {
      this._language = hass.language;
      if (this._config) this._build();
    }
    if (!this._unsub && !this._subscribing) this._subscribe();
    this._onHass();
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
    return textFor(this._hass?.language);
  }

  async _subscribe() {
    if (!this._hass?.connection) return;
    this._subscribing = true;
    try {
      const message = { type: `${INTEGRATION}/subscribe_topology` };
      if (this._config?.entry_id) message.entry_id = this._config.entry_id;
      this._unsub = await this._hass.connection.subscribeMessage((data) => {
        this._data = data;
        this._error = null;
        this._onData();
      }, message);
    } catch (err) {
      this._error = err?.code === "unauthorized" ? "admin" : "failed";
      this._onError();
    } finally {
      this._subscribing = false;
    }
  }

  /** Another box was chosen: start over with its data. */
  _resubscribe() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._data = null;
    if (this._hass) this._subscribe();
  }

  _onHass() {}

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  /** The buttons of a device: they change the box, so only the one that was tapped runs. */
  _act(action, entityId) {
    if (action === "details") return this._moreInfo(entityId);
    if (!this._hass || !entityId) return;
    if (action === "wake_on_lan") {
      this._hass.callService("button", "press", { entity_id: entityId });
      return;
    }
    const on = this._hass.states?.[entityId]?.state === "on";
    this._hass.callService("switch", on ? "turn_off" : "turn_on", { entity_id: entityId });
  }

  /** The buttons of a device that the box allows now, as the card draws them. */
  _actionButtons(client) {
    const t = this._t;
    const states = this._hass?.states ?? {};
    const actions = client.actions ?? {};
    const usable = (name) => actions[name] && states[actions[name]] && states[actions[name]].state !== "unavailable";
    const button = (name, label, extra = "") =>
      `<button class="chip act${extra}" data-action="${name}" data-entity="${escapeHtml(actions[name])}">${escapeHtml(label)}</button>`;
    const buttons = [];
    if (usable("internet_access")) {
      const allowed = states[actions.internet_access].state === "on";
      buttons.push(button("internet_access", allowed ? t.internetBlock : t.internetAllow));
    }
    if (usable("priority")) {
      buttons.push(button("priority", t.priority, states[actions.priority].state === "on" ? " on" : ""));
    }
    if (usable("wake_on_lan")) buttons.push(button("wake_on_lan", t.wol));
    return buttons;
  }
}

class FritzboxNetworkTopologyCard extends FritzboxNetworkCardBase {
  constructor() {
    super();
    this._config = normalizeConfig();
    this._filter = "all";
    this._query = "";
    this._collapsed = new Set();
    this._expanded = new Set();
    this._seeded = false;
  }

  setConfig(config) {
    const previous = this._config;
    this._config = normalizeConfig(config);
    // keep the filter the user picked unless the option for it changed
    if (this._config.default_filter !== previous.default_filter) {
      this._filter = this._config.default_filter;
    }
    if (this._config.collapsed !== previous.collapsed) {
      this._collapsed.clear();
      this._seeded = false;
    }
    if (this._config.compact) this._query = "";
    this._seedCollapsed();
    this._build();
    if (this._config.entry_id !== previous.entry_id) this._resubscribe();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  static getStubConfig() {
    return {};
  }

  /** The visual editor: Home Assistant draws the form from this schema. */
  static async getConfigForm() {
    const number = (min, max, step, unit) => ({
      number: { min, max, step, mode: "box", unit_of_measurement: unit },
    });
    return editorForm([
      { name: "title", selector: { text: {} } },
      { name: "entry_id", selector: configEntry },
      { name: "default_filter", selector: selectOptions(FILTERS) },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "collapsed", selector: { boolean: {} } },
          { name: "compact", selector: { boolean: {} } },
        ],
      },
      { name: "max_height", selector: number(0, 2000, 10, "px") },
      { name: "weak_threshold", selector: number(1, 99, 1, "%") },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "hide_vendor", selector: { boolean: {} } },
          { name: "hide_rate", selector: { boolean: {} } },
          { name: "hide_signal", selector: { boolean: {} } },
          { name: "hide_radio", selector: { boolean: {} } },
        ],
      },
      { name: "tap_action", selector: selectOptions(TAP_ACTIONS) },
    ]);
  }

  _onHass() {
    this._refreshActions();
  }

  _onData() {
    this._seedCollapsed();
    this._renderChips();
    this._renderList();
  }

  _onError() {
    this._renderList();
  }

  /** The switches of an open row change on their own; draw it again when one did. */
  _refreshActions() {
    const signature = this._actionStates();
    if (signature !== this._actionSignature) {
      this._actionSignature = signature;
      this._renderList();
    }
  }

  _actionStates() {
    if (!this._expanded.size || !this._data) return "";
    return this._data.clients
      .filter((c) => this._expanded.has(c.mac))
      .flatMap((c) => Object.values(c.actions ?? {}))
      .map((id) => `${id}=${this._hass?.states?.[id]?.state}`)
      .join(",");
  }

  get _threshold() {
    return this._config.weak_threshold / 100;
  }

  /** With the option on, every access point starts collapsed, once per data and option. */
  _seedCollapsed() {
    if (this._seeded || !this._data) return;
    this._seeded = true;
    if (!this._config.collapsed) return;
    for (const node of this._data.nodes ?? []) this._collapsed.add(node.mac);
    this._collapsed.add("none");
  }

  _build() {
    const t = this._t;
    const { compact, max_height: maxHeight } = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_CSS}
        .controls { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 8px; }
        .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
        .chips::-webkit-scrollbar { display: none; }
        input { box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color); background: transparent;
          color: var(--primary-text-color); font: inherit; }
        .list { ${maxHeight ? `max-height: ${maxHeight}px; overflow-y: auto;` : ""} }
        .ap { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer;
          font-weight: 500; border-top: 1px solid var(--divider-color); }
        .apname { display: flex; flex-direction: column; flex: 1; min-width: 0; white-space: nowrap; }
        .radios { overflow: hidden; text-overflow: ellipsis; font-weight: 400; font-size: 12px;
          color: var(--secondary-text-color); }
        .radios span + span { margin-left: 12px; }
        .radios .busy { color: var(--warning-color, #ffa600); }
        .detail { padding: 2px 16px 10px 40px; }
        .info { font-size: 12px; color: var(--secondary-text-color); word-break: break-all; }
        .ap .count { flex: none; margin-left: auto; font-weight: 400; font-size: 12px;
          color: var(--secondary-text-color); }
        .row { display: flex; align-items: center; gap: 8px; padding: 6px 16px 6px 40px;
          font-size: 14px; }
        .row.click { cursor: pointer; }
        .row.click:hover { background: var(--secondary-background-color); }
      </style>
      <ha-card header="${escapeHtml(this._config.title ?? t.title)}">
        ${
          compact
            ? ""
            : `<div class="controls">
          <input type="search" placeholder="${escapeHtml(t.search)}" title="${escapeHtml(
                t.searchTitle
              )}" aria-label="${escapeHtml(t.searchTitle)}" value="${escapeHtml(this._query)}" />
          <span class="chips"></span>
        </div>`
        }
        <div class="list"></div>
      </ha-card>`;
    this.shadowRoot.querySelector("input")?.addEventListener("input", (event) => {
      this._query = event.target.value;
      this._renderList();
    });
    this._renderChips();
    this._renderList();
  }

  _onClick(event) {
    const chip = event.target.closest("[data-filter]");
    if (chip) {
      this._filter = chip.dataset.filter;
      this._renderChips();
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
    const action = event.target.closest("[data-action]");
    if (action) {
      this._act(action.dataset.action, action.dataset.entity);
      return;
    }
    const expand = event.target.closest("[data-expand]");
    if (expand) {
      const mac = expand.dataset.expand;
      if (this._expanded.has(mac)) this._expanded.delete(mac);
      else this._expanded.add(mac);
      this._actionSignature = this._actionStates();
      this._renderList();
      return;
    }
    const row = event.target.closest("[data-entity]");
    if (row) this._moreInfo(row.dataset.entity);
  }

  /** The filter chips; the ones with a number only show devices that would be found. */
  _renderChips() {
    const chips = this.shadowRoot?.querySelector(".chips");
    if (!chips) return;
    const t = this._t;
    const counts = countFilters(this._data, this._threshold);
    chips.innerHTML = FILTERS.filter(
      (f) => f !== "weak" || counts.weak || this._filter === "weak"
    )
      .map((f) => {
        const label = counts[f] ? `${t[f]} ${counts[f]}` : t[f];
        return `<button class="chip${f === this._filter ? " on" : ""}" data-filter="${f}">${escapeHtml(label)}</button>`;
      })
      .join("");
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
    const groups = groupTopology(this._data, this._filter, this._query, this._threshold);
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
        const radios = this._config.hide_radio
          ? ""
          : radioInfo(group.node, t)
              .map((r) => `<span class="${r.busy ? "busy" : ""}">${escapeHtml(r.text)}</span>`)
              .join("");
        return `
          <div class="ap" data-ap="${escapeHtml(key)}" role="button" tabindex="0" aria-expanded="${open}">
            <ha-icon icon="mdi:chevron-${open ? "down" : "right"}"></ha-icon>
            <ha-icon icon="${group.node ? icon : "mdi:help-network-outline"}"></ha-icon>
            <span class="apname">${escapeHtml(title)}${radios ? `<small class="radios">${radios}</small>` : ""}</span>
            <span class="count">${group.clients.length} / ${group.total}</span>
          </div>${rows}`;
      })
      .join("");
  }

  _row(client) {
    const t = this._t;
    const config = this._config;
    const signal = !config.hide_signal && client.link_type === "wlan" ? signalHtml(client) : "";
    const ratio = linkRatio(client);
    const weak = isWeak(client, this._threshold)
      ? `<ha-icon class="weak" icon="mdi:wifi-alert" title="${escapeHtml(
          t.weakTitle.replace("{percent}", Math.round(ratio * 100))
        )}"></ha-icon>`
      : "";
    const expand = config.tap_action === "expand";
    const open = expand && this._expanded.has(client.mac);
    const clickable = expand || (Boolean(client.entity_id) && config.tap_action === "more-info");
    const target = expand
      ? ` data-expand="${escapeHtml(client.mac)}" aria-expanded="${open}"`
      : ` data-entity="${escapeHtml(client.entity_id)}"`;
    const entity = clickable ? `${target} role="button" tabindex="0"` : "";
    const rate = config.hide_rate ? "" : rateText(client);
    return `
      <div class="row${clickable ? " click" : ""}"${entity}>
        <span class="dot${client.online ? " on" : ""}"></span>
        <ha-icon class="link" icon="${linkIcon(client)}"></ha-icon>
        <span class="name">${escapeHtml(client.name)}${client.vendor && !config.hide_vendor ? `<small>${escapeHtml(client.vendor)}</small>` : ""}${client.guest ? `<small>${escapeHtml(t.guest)}</small>` : ""}</span>
        <span class="rate" title="${escapeHtml(t.rateTitle)}">${escapeHtml(rate)}</span>
        ${weak}
        ${signal}
      </div>${open ? this._detail(client) : ""}`;
  }

  /** The open row: what is known about the device and the actions the box allows. */
  _detail(client) {
    const buttons = this._actionButtons(client);
    if (client.entity_id) {
      buttons.push(
        `<button class="chip act" data-action="details" data-entity="${escapeHtml(client.entity_id)}">${escapeHtml(this._t.details)}</button>`
      );
    }
    return `
      <div class="detail">
        <div class="info">${escapeHtml(detailText(client))}</div>
        <div class="buttons">${buttons.join("")}</div>
      </div>`;
  }
}

/** The Wi-Fi radios of the access points: channel, load and noise, and the devices on each. */
class FritzboxNetworkRadioCard extends FritzboxNetworkCardBase {
  constructor() {
    super();
    this._config = normalizeRadioConfig();
  }

  setConfig(config) {
    const previous = this._config;
    this._config = normalizeRadioConfig(config);
    this._build();
    if (this._config.entry_id !== previous.entry_id) this._resubscribe();
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  static getStubConfig() {
    return {};
  }

  static async getConfigForm() {
    return editorForm([
      { name: "title", selector: { text: {} } },
      { name: "entry_id", selector: configEntry },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "hide_noise", selector: { boolean: {} } },
          { name: "hide_clients", selector: { boolean: {} } },
        ],
      },
    ]);
  }

  _onData() {
    this._render();
  }

  _onError() {
    this._render();
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_CSS}
        .ap { display: flex; align-items: center; gap: 8px; padding: 10px 16px 4px; font-weight: 500; min-width: 0;
          border-top: 1px solid var(--divider-color); }
        .ap:first-child { border-top: 0; }
        .band { display: flex; align-items: center; gap: 12px; padding: 4px 16px 4px 40px; font-size: 14px; }
        .bandname { width: 64px; flex: none; }
        .ch, .noise, .cnt { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
        .meter { flex: 1 1 40px; min-width: 24px; height: 8px; border-radius: 4px; overflow: hidden;
          background: var(--divider-color); }
        .meter i { display: block; height: 100%; background: var(--success-color, #43a047); }
        .meter i.busy { background: var(--warning-color, #ffa600); }
        .pct { flex: none; width: 40px; text-align: right; font-size: 12px; }
        .cnt { display: inline-flex; align-items: center; gap: 2px; --mdc-icon-size: 14px; }
      </style>
      <ha-card header="${escapeHtml(this._config.title ?? this._t.radioTitle)}"><div class="list"></div></ha-card>`;
    this._render();
  }

  _render() {
    const list = this.shadowRoot?.querySelector(".list");
    if (!list) return;
    const t = this._t;
    if (this._error || !this._data) {
      list.innerHTML = `<div class="note">${escapeHtml(this._error ? t[this._error] : t.loading)}</div>`;
      return;
    }
    const rows = radioRows(this._data);
    if (!rows.length) {
      list.innerHTML = `<div class="note">${escapeHtml(t.noRadios)}</div>`;
      return;
    }
    const { hide_noise: hideNoise, hide_clients: hideClients } = this._config;
    list.innerHTML = rows
      .map(({ node, bands }) => {
        const icon = node.role === "master" ? "mdi:router-wireless" : "mdi:access-point";
        const lines = bands
          .map((b) => {
            const busy = (b.utilization ?? 0) >= BUSY_UTILIZATION;
            const load = b.utilization === null ? "" : `<span class="pct">${b.utilization} %</span>`;
            const meter =
              b.utilization === null
                ? `<span class="meter"></span>`
                : `<span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.utilization}"><i class="${busy ? "busy" : ""}" style="width:${Math.min(100, b.utilization)}%"></i></span>`;
            return `
              <div class="band">
                <span class="bandname">${escapeHtml(b.label)}</span>
                <span class="ch">${b.channel === null ? "" : escapeHtml(t.channel.replace("{n}", b.channel))}</span>
                ${meter}${load}
                ${hideNoise || b.noise_dbm === null ? "" : `<span class="noise">${escapeHtml(t.noise.replace("{n}", b.noise_dbm))}</span>`}
                ${hideClients ? "" : `<span class="cnt" title="${escapeHtml(t.clients)}"><ha-icon icon="mdi:devices"></ha-icon>${b.clients}</span>`}
              </div>`;
          })
          .join("");
        return `<div class="ap"><ha-icon icon="${icon}"></ha-icon><span>${escapeHtml(node.name)}</span></div>${lines}`;
      })
      .join("");
  }
}

/** Chosen devices with their link and the actions that matter: internet, Wake on LAN. */
class FritzboxNetworkDeviceCard extends FritzboxNetworkCardBase {
  constructor() {
    super();
    this._config = normalizeDeviceConfig();
  }

  setConfig(config) {
    const previous = this._config;
    this._config = normalizeDeviceConfig(config);
    this._build();
    if (this._config.entry_id !== previous.entry_id) this._resubscribe();
  }

  getCardSize() {
    return 1 + this._config.entities.length * 2;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  static getStubConfig() {
    return { entities: [] };
  }

  static async getConfigForm() {
    return editorForm([
      { name: "title", selector: { text: {} } },
      {
        name: "entities",
        selector: { entity: { multiple: true, filter: { integration: INTEGRATION, domain: "device_tracker" } } },
      },
      { name: "entry_id", selector: configEntry },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "hide_rate", selector: { boolean: {} } },
          { name: "hide_signal", selector: { boolean: {} } },
        ],
      },
    ]);
  }

  _onData() {
    this._render();
  }

  _onError() {
    this._render();
  }

  _onHass() {
    const signature = this._switchStates();
    if (signature !== this._signature) {
      this._signature = signature;
      this._render();
    }
  }

  /** The device list is the one place where the state of the switches shows: redraw when one moves. */
  _switchStates() {
    const states = this._hass?.states ?? {};
    return devicesFor(this._data, this._config.entities)
      .flatMap(({ client }) => Object.values(client?.actions ?? {}))
      .map((id) => `${id}=${states[id]?.state}`)
      .join(",");
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_CSS}
        .dev { padding: 8px 16px; border-top: 1px solid var(--divider-color); }
        .dev:first-child { border-top: 0; }
        .head { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
        .ap { font-size: 12px; color: var(--secondary-text-color); margin-left: 16px; }
        .all { padding: 8px 16px 12px; }
      </style>
      <ha-card header="${escapeHtml(this._config.title ?? this._t.deviceTitle)}"><div class="list"></div></ha-card>`;
    this._signature = this._switchStates();
    this._render();
  }

  _onClick(event) {
    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "bulk") {
      const plan = this._bulk();
      if (plan.entities.length && this._hass) {
        this._hass.callService("switch", plan.block ? "turn_off" : "turn_on", { entity_id: plan.entities });
      }
      return;
    }
    if (action) {
      this._act(action.dataset.action, action.dataset.entity);
      return;
    }
    const head = event.target.closest("[data-entity]");
    if (head) this._moreInfo(head.dataset.entity);
  }

  _bulk() {
    const switches = devicesFor(this._data, this._config.entities)
      .map(({ client }) => client?.actions?.internet_access)
      .filter(Boolean);
    return bulkPlan(switches, this._hass?.states ?? {});
  }

  _render() {
    const list = this.shadowRoot?.querySelector(".list");
    if (!list) return;
    const t = this._t;
    if (!this._config.entities.length) {
      list.innerHTML = `<div class="note">${escapeHtml(t.noDevices)}</div>`;
      return;
    }
    if (this._error || !this._data) {
      list.innerHTML = `<div class="note">${escapeHtml(this._error ? t[this._error] : t.loading)}</div>`;
      return;
    }
    const nodes = new Map((this._data.nodes ?? []).map((n) => [n.mac, n.name]));
    const devices = devicesFor(this._data, this._config.entities);
    const rows = devices
      .map(({ entity, client }) => {
        if (!client) {
          return `<div class="dev"><div class="head"><span class="dot"></span><span class="name">${escapeHtml(t.unknownDevice)}<small>${escapeHtml(entity)}</small></span></div></div>`;
        }
        const signal = !this._config.hide_signal && client.link_type === "wlan" ? signalHtml(client) : "";
        const rate = this._config.hide_rate ? "" : rateText(client);
        const accessPoint = nodes.get(client.ap_mac);
        return `
          <div class="dev">
            <div class="head" data-entity="${escapeHtml(entity)}" role="button" tabindex="0">
              <span class="dot${client.online ? " on" : ""}"></span>
              <ha-icon class="link" icon="${linkIcon(client)}"></ha-icon>
              <span class="name">${escapeHtml(client.name)}${accessPoint ? `<small>${escapeHtml(accessPoint)}</small>` : ""}</span>
              <span class="rate" title="${escapeHtml(t.rateTitle)}">${escapeHtml(rate)}</span>
              ${signal}
            </div>
            <div class="buttons">${this._actionButtons(client).join("")}</div>
          </div>`;
      })
      .join("");
    const plan = this._bulk();
    const switches = devices.filter(({ client }) => client?.actions?.internet_access).length;
    const all =
      switches > 1 && plan.entities.length
        ? `<div class="all"><button class="chip act" data-action="bulk">${escapeHtml(plan.block ? t.allBlock : t.allAllow)}</button></div>`
        : "";
    list.innerHTML = rows + all;
  }
}

const CARDS = [
  {
    type: "fritzbox-network-topology-card",
    element: FritzboxNetworkTopologyCard,
    name: "FRITZ!Box Network topology",
    description: "The devices of the network by access point, with Wi-Fi or LAN and signal.",
  },
  {
    type: "fritzbox-network-radio-card",
    element: FritzboxNetworkRadioCard,
    name: "FRITZ!Box Network Wi-Fi",
    description: "Channel, load and noise of the Wi-Fi radios of the box and its repeaters.",
  },
  {
    type: "fritzbox-network-device-card",
    element: FritzboxNetworkDeviceCard,
    name: "FRITZ!Box Network devices",
    description: "Chosen devices with their link, block or allow internet, and Wake on LAN.",
  },
];

if (typeof customElements !== "undefined") {
  window.customCards = window.customCards || [];
  for (const { type, element, name, description } of CARDS) {
    if (customElements.get(type)) continue;
    customElements.define(type, element);
    window.customCards.push({ type, name, description });
  }
}

export {
  normalizeConfig,
  normalizeRadioConfig,
  normalizeDeviceConfig,
  FritzboxNetworkTopologyCard,
  FritzboxNetworkRadioCard,
  FritzboxNetworkDeviceCard,
};
