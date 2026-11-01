/* FRITZ!Box Network topology card: the devices of the network by access point. */

const CARD_TYPE = "fritzbox-network-topology-card";
const FILTERS = ["all", "wifi", "lan", "offline", "weak"];

// A device is on a weak link when its current rate is below this part of the
// highest rate the link can do, in one direction or the other.
const WEAK_LINK_RATIO = 1 / 3;

const TAP_ACTIONS = ["expand", "more-info", "none"];
const BANDS = { "2_4ghz": "2.4 GHz", "5ghz": "5 GHz", "6ghz": "6 GHz" };
// from this channel load on, the radio is shown as busy
const BUSY_UTILIZATION = 70;

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

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

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

function matches(client, filter, query, threshold = WEAK_LINK_RATIO) {
  if (query) {
    const haystack = `${client.name} ${client.ip ?? ""} ${client.mac} ${client.vendor ?? ""}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
  }
  if (filter === "wifi") return client.link_type === "wlan";
  if (filter === "lan") return client.link_type === "lan";
  if (filter === "offline") return !client.online;
  if (filter === "weak") return isWeak(client, threshold);
  return true;
}

/** The lower of the current/highest rate ratios of both directions; null if unknown. */
function linkRatio(client) {
  const ratios = [
    [client.rate_download, client.rate_max_download],
    [client.rate_upload, client.rate_max_upload],
  ]
    .filter(([current, max]) => typeof current === "number" && typeof max === "number" && max > 0)
    .map(([current, max]) => current / max);
  return ratios.length ? Math.min(...ratios) : null;
}

/** Only for online devices: the rate of a device that is gone says nothing. */
function isWeak(client, threshold = WEAK_LINK_RATIO) {
  const ratio = linkRatio(client);
  return Boolean(client.online) && ratio !== null && ratio < threshold;
}

/** How many devices the filters with a number in front of them would show. */
function countFilters(data, threshold = WEAK_LINK_RATIO) {
  const clients = data?.clients ?? [];
  return {
    offline: clients.filter((c) => !c.online).length,
    weak: clients.filter((c) => isWeak(c, threshold)).length,
  };
}

/** Groups the clients by access point: the box first, the unassigned ones last. */
function groupTopology(data, filter = "all", query = "", threshold = WEAK_LINK_RATIO) {
  const groups = (data.nodes ?? []).map((node) => ({ node, clients: [], total: 0 }));
  const byMac = new Map(groups.map((g) => [g.node.mac, g]));
  const unassigned = { node: null, clients: [], total: 0 };
  for (const client of data.clients ?? []) {
    const group = byMac.get(client.ap_mac) ?? unassigned;
    group.total += 1;
    if (matches(client, filter, query, threshold)) group.clients.push(client);
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

/** One entry per radio of an access point: band, channel and load, as far as the box says. */
function radioInfo(node, t) {
  return Object.entries(node?.radios ?? {}).map(([band, radio]) => {
    const parts = [BANDS[band] ?? band];
    if (typeof radio.channel === "number") parts.push(t.channel.replace("{n}", radio.channel));
    if (typeof radio.utilization === "number") parts.push(`${radio.utilization} %`);
    return { text: parts.join(" · "), busy: (radio.utilization ?? 0) >= BUSY_UTILIZATION };
  });
}

/** What the expanded row says about the device: IP, MAC, band, signal. */
function detailText(client) {
  const parts = [client.ip, client.mac];
  if (client.band) parts.push(BANDS[client.band] ?? client.band);
  if (typeof client.signal_dbm === "number") parts.push(`${client.signal_dbm} dBm`);
  return parts.filter(Boolean).join(" · ");
}

class FritzboxNetworkTopologyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // once: _build() runs again when the language becomes known
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("keydown", (event) => {
      // the rows and headers are not buttons of their own
      if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("[data-ap], [data-entity], [data-expand]")) {
        event.preventDefault();
        this._onClick(event);
      }
    });
    this._config = normalizeConfig();
    this._filter = "all";
    this._query = "";
    this._collapsed = new Set();
    this._expanded = new Set();
    this._seeded = false;
    this._data = null;
    this._error = null;
    this._unsub = null;
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
    if (this._config.entry_id !== previous.entry_id && this._unsub) {
      this._unsub();
      this._unsub = null;
      this._data = null;
      if (this._hass) this._subscribe();
    }
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
    const language = () => globalThis.document?.documentElement?.lang || globalThis.navigator?.language;
    const options = (values) => ({
      select: {
        mode: "dropdown",
        options: values.map((value) => ({
          value,
          label: (textFor(language())[value] ?? textFor(language()).editor[value]),
        })),
      },
    });
    const number = (min, max, step, unit) => ({
      number: { min, max, step, mode: "box", unit_of_measurement: unit },
    });
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "entry_id", selector: { config_entry: { integration: "fritzbox_network" } } },
        { name: "default_filter", selector: options(FILTERS) },
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
        { name: "tap_action", selector: options(TAP_ACTIONS) },
      ],
      computeLabel: (schema) => textFor(language()).editor[schema.name] ?? schema.name,
      computeHelper: (schema) => textFor(language()).editor[`${schema.name}_help`],
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (hass.language !== this._language) {
      this._language = hass.language;
      if (this._config) this._build();
    }
    if (!this._unsub && !this._subscribing) this._subscribe();
    this._refreshActions();
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

  get _threshold() {
    return this._config.weak_threshold / 100;
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
        this._seedCollapsed();
        this._renderChips();
        this._renderList();
      }, message);
    } catch (err) {
      this._error = err?.code === "unauthorized" ? "admin" : "failed";
      this._renderList();
    } finally {
      this._subscribing = false;
    }
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
        :host { display: block; }
        .controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 8px; align-items: center; }
        .chips { display: contents; }
        input { flex: 1 1 140px; min-width: 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color); background: transparent;
          color: var(--primary-text-color); font: inherit; }
        .chip { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--divider-color);
          background: transparent; color: var(--secondary-text-color); font: inherit;
          font-size: 12px; cursor: pointer; }
        .chip.on { background: var(--primary-color); border-color: var(--primary-color);
          color: var(--text-primary-color, #fff); }
        .list { ${maxHeight ? `max-height: ${maxHeight}px; overflow-y: auto;` : ""} }
        .ap { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer;
          font-weight: 500; border-top: 1px solid var(--divider-color); }
        .apname { display: flex; flex-direction: column; min-width: 0; }
        .radios { display: flex; flex-wrap: wrap; gap: 2px 12px; font-weight: 400; font-size: 12px;
          color: var(--secondary-text-color); }
        .radios .busy { color: var(--warning-color, #ffa600); }
        .detail { padding: 2px 16px 10px 40px; }
        .info { font-size: 12px; color: var(--secondary-text-color); word-break: break-all; }
        .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .ap .count { margin-left: auto; font-weight: 400; font-size: 12px;
          color: var(--secondary-text-color); }
        .row { display: flex; align-items: center; gap: 8px; padding: 6px 16px 6px 40px;
          font-size: 14px; }
        .row.click { cursor: pointer; }
        .row.click:hover { background: var(--secondary-background-color); }
        .ap:focus-visible, .row:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
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

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  /** The buttons of an open row: they change the box, so only the one that was tapped runs. */
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
    const bars = signalBars(client.signal_dbm);
    const signal =
      !config.hide_signal && client.link_type === "wlan"
        ? `<span class="bars" title="${client.signal_dbm ?? ""} dBm">${[1, 2, 3, 4]
            .map((i) => `<i class="${i <= bars ? "on" : ""}" style="height:${3 + i * 2}px"></i>`)
            .join("")}</span>`
        : "";
    const icon = client.link_type === "lan" ? "mdi:ethernet-cable" : client.link_type === "wlan" ? "mdi:wifi" : "mdi:help";
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
        <ha-icon class="link" icon="${icon}"></ha-icon>
        <span class="name">${escapeHtml(client.name)}${client.vendor && !config.hide_vendor ? `<small>${escapeHtml(client.vendor)}</small>` : ""}${client.guest ? `<small>${escapeHtml(t.guest)}</small>` : ""}</span>
        <span class="rate" title="${escapeHtml(t.rateTitle)}">${escapeHtml(rate)}</span>
        ${weak}
        ${signal}
      </div>${open ? this._detail(client) : ""}`;
  }

  /** The open row: what is known about the device and the actions the box allows. */
  _detail(client) {
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
    if (client.entity_id) {
      buttons.push(
        `<button class="chip act" data-action="details" data-entity="${escapeHtml(client.entity_id)}">${escapeHtml(t.details)}</button>`
      );
    }
    return `
      <div class="detail">
        <div class="info">${escapeHtml(detailText(client))}</div>
        <div class="buttons">${buttons.join("")}</div>
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
  module.exports = {
    groupTopology,
    signalBars,
    rateText,
    matches,
    escapeHtml,
    linkRatio,
    isWeak,
    countFilters,
    normalizeConfig,
    radioInfo,
    detailText,
    FritzboxNetworkTopologyCard,
  };
}
