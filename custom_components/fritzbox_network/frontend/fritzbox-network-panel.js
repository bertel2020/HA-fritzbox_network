/* FRITZ!Box Network panel: the whole network in the sidebar, for administrators. */

import {
  STALE_STEPS,
  WEAK_LINK_RATIO,
  escapeHtml,
  filterChanged,
  nearestStep,
  pagerFor,
  panelCounts,
  plotText,
  routeFromHash,
  toggleMac,
} from "./shared.js";
import { fill, panelTexts } from "./texts.js";
import { PANEL_CSS } from "./panel-styles.js";
import { ic } from "./icons.js";
import {
  groupPlan,
  listOrder,
  renderChips,
  renderFilterMenu,
  renderGroupBar,
  renderGroups,
  renderMeta,
  visibleClients,
} from "./panel-network.js";
import { drawLinks, mapOrder, renderMap } from "./panel-map.js";
import { renderInternet } from "./panel-internet.js";
import { BLOCK_COLORS, addressModel, checkBlock, emptyOwn, poolChange, renderAddresses } from "./panel-addresses.js";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, renderTable } from "./panel-table.js";
import { renderHints } from "./panel-hints.js";
import { enablePlan, renderDevice, entityState } from "./panel-device.js";
import { openDialog, showToast } from "./panel-dialogs.js";
import { pickedMacs, renderHidden, renderStale, staleList, visibleStale } from "./panel-cleanup.js";
import { pickable, renderFilterControls, renderPicker, renderPickerHead, renderPreview } from "./panel-filter.js";

const DOMAIN = "fritzbox_network";
const BOX_KEY = `${DOMAIN}_panel_box`;
const VIEW_KEY = `${DOMAIN}_panel_view`;
const HISTORY_REFRESH_MS = 300000;
const PAGE_KEY = "fritzbox_network_page_size";
const VIEWS = ["list", "map"];

function remembered() {
  try {
    return sessionStorage.getItem(BOX_KEY);
  } catch {
    return null;
  }
}

function remember(entryId) {
  try {
    sessionStorage.setItem(BOX_KEY, entryId);
  } catch {
    // a private window may refuse; the choice then only lasts until the next reload
  }
}

/** The rows per page chosen last in this browser. */
function rememberedPageSize() {
  try {
    const size = Number(localStorage.getItem(PAGE_KEY));
    return PAGE_SIZES.includes(size) && localStorage.getItem(PAGE_KEY) !== null ? size : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function rememberPageSize(size) {
  try {
    localStorage.setItem(PAGE_KEY, String(size));
  } catch {
    // without storage the panel starts with the usual size next time
  }
}

/** The view chosen last in this browser, list or map; the list the first time. */
function rememberedView() {
  try {
    const view = localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(view) ? view : "list";
  } catch {
    return "list";
  }
}

function rememberView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // without storage the panel starts with the list next time
  }
}

/** The element that scrolls the panel: the panel itself, an ancestor of it in Home Assistant, or the page. */
function scrollerOf(el) {
  for (let node = el; node; node = node.parentElement ?? node.getRootNode?.().host ?? null) {
    if (node.nodeType !== 1) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (/(auto|scroll)/.test(overflow) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * The pages of the panel as tabs. The internet tab carries a dot for the state of the line, the
 * clean-up tab says how many devices have been gone for long.
 */
export function renderNav(state, t, stale) {
  const line = state.data?.internet;
  const tab = (id, extra = "", label = "") =>
    `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}"${label ? ` aria-label="${escapeHtml(label)}"` : ""}>${escapeHtml(t.tabs[id])}${extra}</button>`;
  const dot = line ? `<i class="dot ${line.connected === false ? "" : "on"}" aria-hidden="true"></i>` : "";
  const label = line ? `${t.tabs.internet}, ${line.connected === false ? t.inet.state.down : t.inet.state.up}` : "";
  return [
    tab("net"),
    tab("internet", dot, label),
    tab("addresses"),
    tab("cleanup", stale ? `<em>${stale}</em>` : ""),
    tab("filter"),
  ].join("");
}

class FritzboxNetworkPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const route = routeFromHash(globalThis.location?.hash);
    this._state = {
      tab: route.tab,
      cleanup: null,
      cleanupDays: null,
      picked: new Set(),
      filterPage: null,
      ports: null,
      data: null,
      filter: "all",
      query: "",
      sort: "name",
      sortDesc: false,
      group: "flat",
      page: 0,
      pageSize: rememberedPageSize(),
      history: null,
      ip: null,
      addr: { status: "loading", network: null, own: null, fixed: {}, filter: "all", query: "", view: "map", sel: null, blockMessage: "", progress: null },
      traffic: null,
      trafficRange: 7,
      trend: null,
      closed: new Set(),
      sel: route.device,
      threshold: WEAK_LINK_RATIO,
      view: rememberedView(),
      menu: false,
      names: true,
      // the device "In the network map" points at
      hl: null,
      // entities switched on in the registry, until Home Assistant shows their state
      enabling: new Set(),
    };
    // the device page was opened from the list or the map: back is a step back in the history
    this._openedHere = false;
    this._listScroll = 0;
    this._html = {};
    this._entries = [];
    this._entryId = null;
    this._error = null;
    this._unsub = null;
    this._updatedAt = 0;
    this._onHash = () => {
      const state = this._state;
      const next = routeFromHash(globalThis.location.hash);
      const entered = next.tab !== state.tab;
      const was = state.sel;
      state.tab = next.tab;
      state.sel = next.device;
      state.menu = false;
      if (!next.device) this._openedHere = false;
      if (entered) this._enterTab();
      this._update();
      if (state.sel && state.sel !== was) this._showDevicePage();
      else if (!state.sel && was) this._backToList(was);
    };
    this._resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this._drawLinks());
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    this.shadowRoot.addEventListener("keydown", (event) => this._onKey(event));
    this.shadowRoot.addEventListener("submit", (event) => {
      if (event.target.id !== "a-blockform" && event.target.id !== "a-poolform") return;
      event.preventDefault();
      if (event.target.id === "a-poolform") this._applyPool();
      else this._onAddressForm(event.target);
    });
    this.shadowRoot.addEventListener("pointermove", (event) => this._onPlot(event));
    this.shadowRoot.addEventListener("pointerleave", () => this._hidePlots());
    this.shadowRoot.addEventListener("pointerout", (event) => {
      if (!event.relatedTarget?.closest?.(".plot")) this._hidePlots();
    });
  }

  set hass(hass) {
    this._hass = hass;
    this.style.colorScheme = hass.themes?.darkMode ? "dark" : "light";
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) menu.hass = hass;
    if (hass.language !== this._language) {
      this._language = hass.language;
      this._build();
    }
    if (!this._started) this._start();
    else this._onHass();
  }

  set narrow(narrow) {
    this._narrow = narrow;
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) menu.narrow = narrow;
  }

  // Home Assistant also hands over the route and the panel config; the panel needs neither.
  set route(_route) {}

  set panel(_panel) {}

  connectedCallback() {
    globalThis.addEventListener("hashchange", this._onHash);
    this._clock = setInterval(() => this._tick(), 5000);
    this._resize?.observe(this);
    if (this._hass && !this._started) this._start();
  }

  disconnectedCallback() {
    globalThis.removeEventListener("hashchange", this._onHash);
    clearInterval(this._clock);
    clearTimeout(this._enableTimer);
    this._resize?.disconnect();
    this._stop();
  }

  get _t() {
    return panelTexts(this._hass?.language);
  }

  async _start() {
    if (this._started || !this._hass) return;
    this._started = true;
    try {
      this._entries = await this._hass.callWS({ type: `${DOMAIN}/entries` });
    } catch (err) {
      this._fail(err);
      return;
    }
    if (!this._entries.length) {
      this._error = "noBox";
      this._update();
      return;
    }
    const saved = remembered();
    this._entryId = this._entries.some((e) => e.entry_id === saved)
      ? saved
      : this._entries[0].entry_id;
    this._renderBox();
    if (await this._subscribe()) this._enterTab();
  }

  /** Subscribes to the topology of the chosen box; quiet: a failure is the caller's to handle. */
  async _subscribe({ quiet = false } = {}) {
    try {
      this._unsub = await this._hass.connection.subscribeMessage(
        (data) => {
          this._state.data = data;
          this._error = null;
          this._updatedAt = Date.now();
          this._update();
          this._maybeLoadHistory();
          if (this._state.tab === "cleanup") this._loadCleanup();
          if (this._state.tab === "addresses" && this._state.addr.status === "ready") this._loadFixed();
        },
        { type: `${DOMAIN}/subscribe_topology`, entry_id: this._entryId }
      );
      return true;
    } catch (err) {
      if (!quiet) this._fail(err);
      return false;
    }
  }

  /**
   * The entry reloads after some changes of the options (showing devices again, the filter) and
   * the subscription belongs to the coordinator that is gone: take it up again once the box is back.
   */
  async _resubscribeAfterReload() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (await this._subscribe({ quiet: true })) return true;
    }
    this._fail({});
    return false;
  }

  /** Fetches what the page just opened needs. */
  _enterTab() {
    if (this._state.tab === "cleanup") this._loadCleanup();
    else if (this._state.tab === "filter") this._loadFilter();
    else if (this._state.tab === "internet") this._loadPorts();
    else if (this._state.tab === "addresses") this._loadAddresses();
  }

  _ws(type, extra = {}) {
    return this._hass.callWS({ type: `${DOMAIN}/${type}`, entry_id: this._entryId, ...extra });
  }

  /** The sparklines come from the history of the box: read now and then, not with every poll. */
  async _maybeLoadHistory() {
    if (this._historyBusy || (this._historyAt && Date.now() - this._historyAt < HISTORY_REFRESH_MS)) return;
    this._historyBusy = true;
    try {
      const summary = await this._ws("history/summary");
      this._state.history = summary.devices;
      this._state.traffic = summary.traffic ?? {};
      this._historyAt = Date.now();
      this._update();
    } catch {
      // without a history the table shows no sparklines; the next poll tries again
      this._historyAt = Date.now() - HISTORY_REFRESH_MS + 30000;
    } finally {
      this._historyBusy = false;
    }
  }

  async _loadCleanup() {
    try {
      const result = await this._ws("cleanup/list");
      const state = this._state;
      state.cleanup = result;
      state.cleanupDays ??= nearestStep(result.days);
      const offered = new Set(result.devices.map((d) => d.mac));
      state.picked = new Set([...state.picked].filter((mac) => offered.has(mac)));
      this._update();
    } catch (err) {
      this._fail(err);
    }
  }

  /** The port forwardings are read when the internet page opens, not with every update. */
  async _loadPorts() {
    this._state.ports = null;
    try {
      this._state.ports = await this._ws("ports/list");
    } catch {
      this._state.ports = "failed";
    }
    this._update();
  }

  async _loadFilter() {
    try {
      const result = await this._ws("filter/preview");
      this._state.filterPage = {
        current: result.options,
        draft: { ...result.options, filter_devices: [...result.options.filter_devices] },
        preview: result,
        search: "",
      };
      this._update();
    } catch (err) {
      this._fail(err);
    }
  }

  _schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._runPreview(), 150);
  }

  async _runPreview() {
    const page = this._state.filterPage;
    if (!page) return;
    const seq = (this._previewSeq = (this._previewSeq ?? 0) + 1);
    try {
      const result = await this._ws("filter/preview", { options: page.draft });
      if (seq !== this._previewSeq) return; // a newer choice has been sent since
      page.preview = result;
      this._renderFilter();
    } catch (err) {
      this._fail(err);
    }
  }

  _stop() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._started = false;
  }

  _fail(err) {
    this._error = err?.code === "unauthorized" ? "admin" : "failed";
    this._update();
  }

  /** Another box was chosen: start over with its data. */
  async _switchBox(entryId) {
    this._entryId = entryId;
    remember(entryId);
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._state.data = null;
    this._state.sel = null;
    this._state.enabling = new Set();
    this._state.cleanup = null;
    this._state.cleanupDays = null;
    this._state.picked = new Set();
    this._state.filterPage = null;
    this._state.ports = null;
    this._update();
    if (await this._subscribe()) this._enterTab();
  }

  _onHass() {
    const enabling = this._state.enabling;
    // the entities just switched on are back once Home Assistant shows their state after the reload
    if (enabling.size && [...enabling].every((id) => this._hass.states?.[id])) this._enabled();
    // the switches of the open device and of a group move on their own: draw them again when one did
    const signature = this._actionStates();
    if (signature !== this._signature) {
      this._signature = signature;
      this._renderDetail();
      if (this._state.data && this._state.tab === "net") {
        this._set("groupbar", renderGroupBar(this._state, this._t, this._hass));
      }
    }
  }

  _selected() {
    return (this._state.data?.clients ?? []).find((c) => c.id === this._state.sel) ?? null;
  }

  _actionStates() {
    const state = this._state;
    const clients = [this._selected()];
    if (state.filter.startsWith("label:")) {
      clients.push(...(state.data?.clients ?? []).filter((c) => c.labels?.includes(state.filter.slice(6))));
    }
    return clients
      .flatMap((c) => Object.values(c?.actions ?? {}))
      .map((id) => `${id}=${this._hass?.states?.[id]?.state ?? "-"}`)
      .join(",");
  }

  _build() {
    const t = this._t;
    const state = this._state;
    this.shadowRoot.innerHTML = `
      <style>${PANEL_CSS}
        [hidden] { display: none !important; }
        .busyText { color: var(--warn); }
        .warnIcon { color: var(--warn); display: inline-flex; }
        .hint { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
        .field { display: grid; gap: 4px; margin-top: 12px; }
        .field input { height: 42px; border-radius: 10px; border: 1px solid var(--input-line); background: var(--surface); padding: 0 12px; font: inherit; color: inherit; }
        .tile.wide { grid-column: 1 / -1; }
        .action select { width: auto; max-width: 55%; }
        .note.big { margin: 16px 0; }
        #box { width: auto; max-width: 220px; height: 36px; }
        .btn-row.tight { margin-top: 0; }
        .muted.spaced { margin: 12px 0 0; }
        .note.bad { background: var(--bad-soft); color: var(--bad); }
        .seg-wrap { margin: 8px 0; }
        .picker { max-height: 360px; overflow: auto; margin-top: 4px; }
        label.row { cursor: pointer; }
        .pickhead { margin-top: 16px; }
        .groupbar { margin-top: 16px; display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
        .groupbar .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); flex: none; }
        .groupbar .who { flex: 1; min-width: 0; }
        .groupbar .who b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .groupbar .who small { color: var(--muted); font-size: 12px; }
        .fchip svg.i { width: 14px; height: 14px; }
        label.search { display: block; }
        .tools.map .list-only { display: none; }
      </style>
      <div class="app">
        <header class="header">
          <div class="brand">
            <ha-menu-button></ha-menu-button>
            <span class="logo">${ic("router")}</span>
            <div><b>${t.title}</b><small id="sub"></small></div>
          </div>
          <nav role="tablist" id="nav" aria-label="${t.navLabel}"></nav>
          <div class="header-end">
            <select id="box" aria-label="${t.box}" hidden></select>
            <span class="fresh" id="live-chip" hidden><span class="dot on"></span><span class="t" id="live"></span></span>
          </div>
        </header>
        <main>
          <div id="note"></div>
          <div id="net-view" hidden>
            <div id="hints"></div>
            <div class="card toolbar">
              <div class="tools" id="tools">
                <label class="search"><span class="sr">${t.search}</span>${ic("search")}<input type="search" id="q" placeholder="${t.search}" title="${t.searchTitle}" aria-label="${t.searchTitle}" aria-describedby="meta" value="${escapeHtml(state.query)}"><kbd aria-hidden="true">/</kbd></label>
                <label class="list-only"><span class="sr">${t.sort}</span><select id="sort">${Object.entries(t.sorts).map(([k, v]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                <label class="list-only"><span class="sr">${t.group}</span><select id="group">${Object.entries(t.groups).map(([k, v]) => `<option value="${k}" ${k === state.group ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                <div class="seg viewsw" role="group" aria-label="${t.viewLabel}">${VIEWS.map((v) => `<button data-view="${v}" aria-pressed="${state.view === v}">${ic(v)}${t.views[v]}</button>`).join("")}</div>
              </div>
              <div class="chipwrap">
                <div class="chips" id="chips" role="group" aria-label="${t.filterGroup}"></div>
                <div id="menuhost"></div>
              </div>
              <div class="meta" id="meta" aria-live="polite"></div>
            </div>
            <div id="groupbar"></div>
            <div id="body"></div>
          </div>
          <div id="device-view" hidden></div>
          <div id="internet-view" hidden></div>
          <div id="addresses-view" hidden></div>
          <div class="col" id="cleanup-view" hidden>
            <div class="phead"><h1>${t.cleanup.title}</h1><p class="lead">${t.cleanup.lead}</p></div>
            <section class="card pad">
              <div class="range"><span id="days-head">${t.cleanup.since}</span><div id="days-seg"></div></div>
              <label class="search"><span class="sr">${t.cleanup.search}</span>${ic("search")}<input type="search" id="c-search" placeholder="${t.cleanup.search}" aria-label="${t.cleanup.search}"></label>
              <div id="stale"></div>
            </section>
            <section class="card pad" id="hidden"></section>
          </div>
          <div class="col" id="filter-view" hidden>
            <div class="phead"><h1>${t.filter.title}</h1><p class="lead">${t.filter.lead}</p></div>
            <div id="f-controls"></div>
            <section class="card pad" id="f-picker-wrap" hidden>
              <h2>${t.filter.pickTitle}</h2>
              <label class="search"><span class="sr">${t.filter.pickSearch}</span>${ic("search")}<input type="search" id="f-search" placeholder="${t.filter.pickSearch}" aria-label="${t.filter.pickSearch}"></label>
              <div class="selhead" id="f-picker-head"></div>
              <div id="f-picker"></div>
            </section>
            <div id="f-preview"></div>
          </div>
        </main>
      </div>
      <div class="backdrop" id="backdrop"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" id="dialog"></div></div>
      <div class="toast" id="toast" role="status"></div>`;
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) {
      menu.hass = this._hass;
      menu.narrow = this._narrow;
    }
    this._html = {};
    this._resize?.observe(this.shadowRoot.querySelector("#body"));
    this._renderBox();
    this._update();
  }

  /**
   * Writes HTML into a part only when it changed, so a poll does not flicker or lose the scroll.
   * A control that had the focus gets it back in the new HTML.
   */
  _set(id, html) {
    const el = this.shadowRoot.querySelector(`#${id}`);
    if (!el || this._html[id] === html) return;
    this._html[id] = html;
    const active = this.shadowRoot.activeElement;
    const ds = active && el.contains(active) ? active.dataset : null;
    const again = ds?.k ? `[data-k="${CSS.escape(ds.k)}"]` : ds?.dev ? `[data-dev="${CSS.escape(ds.dev)}"]` : null;
    el.innerHTML = html;
    if (again) el.querySelector(again)?.focus({ preventScroll: true });
  }

  _renderBox() {
    const box = this.shadowRoot.querySelector("#box");
    if (!box) return;
    box.hidden = this._entries.length < 2;
    box.innerHTML = this._entries
      .map(
        (e) =>
          `<option value="${escapeHtml(e.entry_id)}" ${e.entry_id === this._entryId ? "selected" : ""}>${escapeHtml(e.title)}</option>`
      )
      .join("");
  }

  _tick() {
    const live = this.shadowRoot.querySelector("#live");
    if (!live || !this._updatedAt) return;
    const n = Math.round((Date.now() - this._updatedAt) / 1000);
    live.textContent = fill(this._t.liveShort, { n });
    live.parentElement.title = fill(this._t.live, { n });
  }

  _update() {
    const root = this.shadowRoot;
    const t = this._t;
    const state = this._state;
    const note = this._error ? `<div class="card note-card"><div class="empty"><b>${t[this._error]}</b></div></div>` : "";
    const ready = Boolean(state.data) && !this._error;
    this._set("note", note || (state.data ? "" : `<div class="card"><div class="empty"><span>${t.loading}</span></div></div>`));
    const netView = root.querySelector("#net-view");
    if (!netView) return;
    const tab = state.tab;
    const onDevice = tab === "net" && Boolean(state.sel);
    netView.hidden = !ready || tab !== "net" || onDevice;
    root.querySelector("#device-view").hidden = !ready || !onDevice;
    root.querySelector("#internet-view").hidden = !ready || tab !== "internet";
    root.querySelector("#addresses-view").hidden = !ready || tab !== "addresses";
    root.querySelector("#cleanup-view").hidden = !ready || tab !== "cleanup";
    root.querySelector("#filter-view").hidden = !ready || tab !== "filter";
    root.querySelector("#live-chip").hidden = !ready;
    const stale = ready ? panelCounts(state.data, Date.now(), state.threshold).stale : 0;
    this._set("nav", ready ? renderNav(state, t, stale) : "");
    if (!ready) return;
    const now = Date.now();
    const master = (state.data.nodes ?? []).find((n) => n.role === "master");
    root.querySelector("#sub").textContent = master ? [master.name, master.model].filter(Boolean).join(" · ") : "";
    this._tick();
    if (tab === "internet") return this._renderInternet();
    if (tab === "addresses") return this._renderAddresses();
    if (tab === "cleanup") return this._renderCleanup();
    if (tab === "filter") return this._renderFilter();
    if (onDevice) return this._renderDetail();
    const map = state.view === "map";
    root.querySelector("#tools").classList.toggle("map", map);
    for (const button of root.querySelectorAll(".viewsw [data-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    }
    state.language = this._hass?.language;
    for (const [id, value] of [["sort", state.sort], ["group", state.group]]) {
      const select = root.querySelector(`#${id}`);
      if (select && select.value !== value) select.value = value;
    }
    const listKey = [state.filter, state.query, state.sort, state.sortDesc, state.group, state.pageSize].join("|");
    if (this._listKey !== listKey) state.page = 0;
    this._listKey = listKey;
    const shown = visibleClients(state, now);
    this._set("hints", renderHints(state.data, t));
    this._set("chips", renderChips(state, t, now));
    this._set("menuhost", renderFilterMenu(state, t, now));
    this._set("meta", renderMeta(state, t, shown.length));
    this._set("groupbar", renderGroupBar(state, t, this._hass));
    this._set("body", map ? renderMap(state, t, now, shown) : state.group === "flat" ? renderTable(state, t, now, shown) : renderGroups(state, t, now));
    this._drawLinks();
  }

  /** The value under the pointer on a chart of the trend: a cursor line and the time with the value. */
  _onPlot(event) {
    const plot = event.target?.closest?.(".plot");
    if (!plot) return this._hidePlots();
    const pts = JSON.parse(plot.dataset.pts);
    const box = plot.getBoundingClientRect();
    if (pts.length < 2 || !box.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    // a chart drawn by time (the load of the line) is read by time, the others by the number of the point
    let i = Math.round(ratio * (pts.length - 1));
    let x = (i / (pts.length - 1)) * box.width;
    if (plot.dataset.mode === "time") {
      const first = pts[0][0];
      const span = Math.max(pts[pts.length - 1][0] - first, 1);
      const wanted = first + ratio * span;
      i = pts.reduce((best, p, k) => (Math.abs(p[0] - wanted) < Math.abs(pts[best][0] - wanted) ? k : best), 0);
      x = ((pts[i][0] - first) / span) * box.width;
    } else if (plot.dataset.mode === "bars") {
      i = Math.min(pts.length - 1, Math.floor(ratio * pts.length));
      x = ((i + 0.5) / pts.length) * box.width;
    }
    const cursor = plot.querySelector(".cursor");
    const tip = plot.querySelector(".tip");
    tip.textContent = plotText(pts[i], plot.dataset, this._hass?.language);
    cursor.style.left = `${x}px`;
    cursor.hidden = tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), box.width - tip.offsetWidth / 2)}px`;
  }

  _hidePlots() {
    for (const el of this.shadowRoot.querySelectorAll(".plot .cursor, .plot .tip")) el.hidden = true;
  }

  /** The lines of the map follow the islands: after each drawing and when the width changes. */
  _drawLinks() {
    const state = this._state;
    if (state.view !== "map" || state.sel || state.tab !== "net") return;
    drawLinks(this.shadowRoot);
  }

  _renderInternet() {
    const language = this._hass?.language;
    this._set(
      "internet-view",
      renderInternet(this._state.data?.internet ?? null, {
        t: this._t,
        language,
        now: Date.now(),
        canWrite: Boolean(this._state.data?.can_write),
        ports: this._state.ports,
        traffic: this._state.traffic,
        trafficRange: this._state.trafficRange,
        clients: this._state.data?.clients ?? [],
      })
    );
  }

  _renderAddresses() {
    const root = this.shadowRoot;
    const active = root.activeElement;
    // typing a note or a name: the page is drawn again when the field is left, not under the fingers
    if (active && root.querySelector("#addresses-view")?.contains(active) && active.matches("textarea, [data-aown], #a-bn, #a-bf, #a-bt, #a-pf, #a-pt")) return;
    this._set(
      "addresses-view",
      renderAddresses({
        t: this._t,
        language: this._hass?.language,
        now: Date.now(),
        addr: this._state.addr,
        clients: this._state.data?.clients ?? [],
        nodes: this._state.data?.nodes ?? [],
        canWrite: Boolean(this._state.data?.can_write),
      })
    );
  }

  /** The network of the box and the notes of the user are read when the page opens; the fixed addresses follow. */
  async _loadAddresses() {
    const addr = this._state.addr;
    if (addr.network === null) addr.status = "loading";
    // what the box said about the fixed addresses is read again after a while, not at every visit
    if (Date.now() - (addr.fixedAt ?? 0) > 600000) {
      addr.fixed = {};
      addr.fixedAt = Date.now();
    }
    this._update();
    try {
      const result = await this._ws("address/overview");
      addr.network = result.network;
      addr.own = { ...emptyOwn(), ...(result.own ?? {}) };
      addr.status = "ready";
    } catch {
      addr.status = "failed";
    }
    this._update();
    if (addr.status === "ready") this._loadFixed();
  }

  /** Which addresses are fixed: the box says it per device, so a few at a time while the page is open. */
  async _loadFixed() {
    const addr = this._state.addr;
    if (this._fixedBusy) return;
    this._fixedBusy = true;
    try {
      while (this._state.tab === "addresses") {
        const todo = (this._state.data?.clients ?? []).filter((c) => c.ip && !(c.mac in addr.fixed)).map((c) => c.mac);
        const total = Object.keys(addr.fixed).length + todo.length;
        if (!todo.length) break;
        addr.progress = { done: Object.keys(addr.fixed).length, total };
        this._update();
        const { reservations } = await this._ws("address/fixed", { macs: todo.slice(0, 8) });
        for (const mac of todo.slice(0, 8)) addr.fixed[mac] = reservations[mac] ?? null;
      }
    } catch {
      // without the answers the devices show as dynamic and the hint says so
    } finally {
      addr.progress = null;
      this._fixedBusy = false;
      this._update();
    }
  }

  async _saveOwn() {
    const addr = this._state.addr;
    try {
      await this._ws("address/save", { own: addr.own });
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** The clicks of the address page; false where the click is none of its own. */
  _onAddressClick(ds) {
    const addr = this._state.addr;
    const own = addr.own ?? emptyOwn();
    if (ds.aip !== undefined) {
      const n = Number(ds.aip);
      if (addr.sel === n) return true;
      addr.sel = n;
    } else if (ds.afilter) addr.filter = ds.afilter;
    else if (ds.aview) addr.view = ds.aview;
    else if (ds.apool === "reset") addr.poolDraft = null;
    else if (ds.ahint) {
      if (ds.an === undefined) return true;
      addr.sel = Number(ds.an);
    } else if (ds.amute) {
      if (!own.muted.includes(ds.amute)) own.muted.push(ds.amute);
      this._saveOwn();
    } else if (ds.aunmute !== undefined) {
      own.muted = [];
      this._saveOwn();
    } else if (ds.adel) {
      own.blocks = own.blocks.filter((b) => String(b.id) !== ds.adel);
      this._saveOwn();
    } else if (ds.amark) {
      const ip = `${this._addressBase()}${ds.amark}`;
      own.marks = own.marks.includes(ip) ? own.marks.filter((m) => m !== ip) : [...own.marks, ip];
      this._saveOwn();
    } else return false;
    addr.own = own;
    this._update();
    return true;
  }

  /** Leaves the field in the address page, so that the page is drawn again with what was entered. */
  _leaveField() {
    const active = this.shadowRoot.activeElement;
    if (active?.matches?.("input, textarea, select")) active.blur();
  }

  /** The model of the page as the clients and the box say it now. */
  _addressModel() {
    const addr = this._state.addr;
    return addressModel({ network: addr.network, clients: this._state.data?.clients ?? [], nodes: this._state.data?.nodes ?? [], fixed: addr.fixed, own: addr.own ?? emptyOwn() });
  }

  /** The range the box hands out now, as last octets for the fields. */
  _currentPool() {
    const m = this._addressModel();
    return { first: m?.hasPool ? String(m.poolFrom) : "", last: m?.hasPool ? String(m.poolTo) : "" };
  }

  /** The new DHCP range, after the user has seen which devices it touches. */
  async _applyPool() {
    const t = this._t;
    const addr = this._state.addr;
    const m = this._addressModel();
    const draft = addr.poolDraft;
    const change = m && draft ? poolChange(m, draft.first, draft.last) : null;
    if (!change || change.error || change.same || change.tooSmall) return;
    const ok = await openDialog(this.shadowRoot, t, {
      title: t.addr.pool.dialogTitle,
      body: fill(t.addr.pool.dialogBody, { from: change.from, to: change.to }),
      list: change.outside.map((d) => `${d.name} (${m.baseText}${d.n})`),
      ok: t.addr.pool.dialogOk,
      danger: change.outside.length > 0,
    });
    if (!ok) return;
    try {
      await this._ws("address/pool", { first: `${m.baseText}${change.from}`, last: `${m.baseText}${change.to}` });
      addr.poolDraft = null;
      showToast(this.shadowRoot, t.addr.pool.toastDone);
      this._leaveField();
      await this._loadAddresses();
    } catch (err) {
      const text = t.addr.pool.errors[err?.message] ?? err?.message ?? err;
      showToast(this.shadowRoot, fill(t.toastFailed, { error: text }));
    }
  }

  /** "192.168.79." of the network the page shows. */
  _addressBase() {
    const m = /^(\d+\.\d+\.\d+)\./.exec(this._state.addr.network?.gateway ?? "");
    return m ? `${m[1]}.` : "";
  }

  _onAddressOwn(el) {
    const addr = this._state.addr;
    const own = addr.own ?? emptyOwn();
    const value = el.value.trim();
    const [store, key] = el.dataset.aown === "note" ? [own.notes, el.dataset.ip] : [own.names, el.dataset.mac];
    if (value) store[key] = value;
    else delete store[key];
    addr.own = own;
    this._saveOwn();
    // the field is still focused while the change event runs: draw the page when the focus has left
    setTimeout(() => this._update(), 0);
  }

  _onAddressForm(form) {
    const addr = this._state.addr;
    const own = addr.own ?? emptyOwn();
    const data = new FormData(form);
    const block = { name: String(data.get("name") ?? "").trim(), from: Number(data.get("from")), to: Number(data.get("to")) };
    const problem = checkBlock(own, block);
    if (problem) {
      addr.blockMessage = fill(this._t.addr.blocks[problem.key], problem.values ?? {});
    } else {
      const color = BLOCK_COLORS.includes(data.get("color")) ? data.get("color") : BLOCK_COLORS[0];
      own.blocks.push({ id: Date.now(), ...block, color });
      addr.own = own;
      addr.blockMessage = "";
      this._saveOwn();
    }
    // the form is drawn anew, empty after a block and with the message after a mistake
    form.reset();
    this._leaveField();
    this._renderAddresses();
  }

  _renderCleanup() {
    const state = this._state;
    const t = this._t;
    const days = state.cleanupDays ?? 30;
    this._set(
      "days-seg",
      `<div class="seg" role="radiogroup" aria-labelledby="days-head">${STALE_STEPS.map(
        (n) => `<button role="radio" aria-checked="${n === days}" aria-pressed="${n === days}" data-days="${n}">${escapeHtml(fill(t.cleanup[n === 365 ? "year" : "days"], { n }))}</button>`
      ).join("")}</div>`
    );
    this._set("stale", renderStale(state, t));
    this._set("hidden", renderHidden(state, t));
  }

  _renderFilter() {
    const page = this._state.filterPage;
    const t = this._t;
    this._set("f-controls", renderFilterControls(page, t));
    const wrap = this.shadowRoot.querySelector("#f-picker-wrap");
    if (wrap) wrap.hidden = !page || page.draft.filter_mode === "all";
    this._set("f-picker-head", renderPickerHead(page, t));
    this._set("f-picker", renderPicker(page, t));
    this._set("f-preview", renderPreview(page, t));
  }

  /** The devices in the order of the view the device was opened from: the order for paging. */
  _order() {
    const state = this._state;
    const now = Date.now();
    return state.view === "map" ? mapOrder(state.data, visibleClients(state, now)) : listOrder(state, now);
  }

  _renderDetail() {
    const state = this._state;
    if (!state.sel || !state.data) return;
    this._set(
      "device-view",
      renderDevice(this._selected(), {
        t: this._t,
        now: Date.now(),
        data: state.data,
        hass: this._hass,
        threshold: state.threshold,
        pager: pagerFor(this._order(), state.sel),
        view: state.view,
        enabling: state.enabling,
        trend: state.trend,
        ip: state.ip,
        language: this._hass?.language,
      })
    );
    this._maybeLoadTrend();
    this._maybeLoadIp();
  }

  /** Whether the box always gives the open device the same address: read once when its page opens. */
  async _maybeLoadIp() {
    const client = this._selected();
    const known = this._state.ip;
    if (!client || this._ipBusy || (known?.mac === client.mac && Date.now() - known.at < HISTORY_REFRESH_MS)) return;
    this._ipBusy = true;
    try {
      const { reservation } = await this._ws("device/ip", { mac: client.mac });
      this._state.ip = { mac: client.mac, reservation, at: Date.now() };
    } catch {
      this._state.ip = { mac: client.mac, reservation: null, at: Date.now() };
    } finally {
      this._ipBusy = false;
    }
    if (this._selected()?.mac === client.mac) this._renderDetail();
  }

  /** The history of the open device, read when it is opened and now and then while it stays open. */
  async _maybeLoadTrend() {
    const client = this._selected();
    const trend = this._state.trend;
    if (!client || this._trendBusy) return;
    if (trend?.mac === client.mac && Date.now() - trend.at < HISTORY_REFRESH_MS) return;
    this._trendBusy = true;
    try {
      const data = await this._ws("history/device", { mac: client.mac });
      this._state.trend = { mac: client.mac, data, at: Date.now(), range: trend?.mac === client.mac ? trend.range : "day" };
    } catch {
      this._state.trend = { mac: client.mac, data: null, at: Date.now() - HISTORY_REFRESH_MS + 30000, range: "day" };
    } finally {
      this._trendBusy = false;
    }
    if (this._selected()?.mac === client.mac) this._renderDetail();
  }

  /** A device page was opened or paged to: from the top, with the focus on its name. */
  _showDevicePage() {
    const scroller = scrollerOf(this);
    if (scroller) scroller.scrollTop = 0;
    this.shadowRoot.querySelector("#dtitle")?.focus({ preventScroll: true });
  }

  /** Back from a device: the list or the map where it was, the focus on the device last open. */
  _backToList(was) {
    const root = this.shadowRoot;
    if (this._reveal) {
      const node = root.querySelector(`.nd[data-dev="${CSS.escape(this._reveal)}"]`);
      this._reveal = null;
      node?.scrollIntoView?.({ block: "center" });
      node?.focus({ preventScroll: true });
      return;
    }
    const scroller = scrollerOf(this);
    if (scroller) scroller.scrollTop = this._listScroll;
    if (this._afterBack === "search") {
      this._afterBack = null;
      root.querySelector("#q")?.focus();
      return;
    }
    root.querySelector(`#body [data-dev="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
  }

  _openDevice(id) {
    this._listScroll = scrollerOf(this)?.scrollTop ?? 0;
    this._state.hl = null;
    this._openedHere = true;
    globalThis.location.hash = `#/device/${id}`;
  }

  /** Esc closes the menu or the device, the arrows go through the menu, j and k page, / searches. */
  _onKey(event) {
    const root = this.shadowRoot;
    const state = this._state;
    if (root.querySelector("#backdrop")?.classList.contains("open")) return;
    const target = event.target;
    const menu = root.querySelector("#fmenu");
    if (state.menu && menu?.contains(target)) {
      const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
      const at = items.indexOf(target);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
      if (to !== undefined && items.length) {
        event.preventDefault();
        items[(to + items.length) % items.length].focus();
        return;
      }
      if (event.key === "Tab") {
        this._setMenu(false, false);
        return;
      }
    }
    if (event.key === "Escape") {
      if (state.menu) {
        event.preventDefault();
        this._setMenu(false);
        return;
      }
      if ((state.sel && state.tab === "net") && !/SELECT/.test(target.tagName)) {
        event.preventDefault();
        this._leaveDevice();
        return;
      }
    }
    if (event.key === "ArrowDown" && target.id === "morebtn") {
      event.preventDefault();
      this._setMenu(true);
      return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "/" && state.tab === "net") {
      event.preventDefault();
      if (state.sel) {
        this._afterBack = "search";
        this._leaveDevice();
      } else root.querySelector("#q")?.focus();
      return;
    }
    if (state.sel && (event.key === "j" || event.key === "k")) {
      const button = root.querySelector(`#device-view [data-k="${event.key === "j" ? "next" : "prev"}"]`);
      if (button && !button.disabled) {
        event.preventDefault();
        globalThis.location.replace(`#/device/${button.dataset.go}`);
      }
    }
  }

  /** Opens or closes the "More" menu; open, the focus goes to the chosen item or the first. */
  _setMenu(open, focus = true) {
    this._state.menu = open;
    this._update();
    if (!focus) return;
    const root = this.shadowRoot;
    if (open) {
      (root.querySelector('#fmenu [aria-checked="true"]') ?? root.querySelector('#fmenu [role="menuitemradio"]'))?.focus();
    } else root.querySelector("#morebtn")?.focus();
  }

  _onChange(event) {
    const el = event.target;
    if (el.dataset?.aown) return this._onAddressOwn(el);
    if (el.id === "sort") {
      this._state.sort = el.value;
      this._state.sortDesc = false;
    } else if (el.id === "pagesize") {
      this._state.pageSize = Number(el.value);
      rememberPageSize(this._state.pageSize);
    } else if (el.id === "group") this._state.group = el.value;
    else if (el.id === "box") return this._switchBox(el.value);
    else if (el.matches("[data-profile]")) return this._call("select", "select_option", { option: el.value }, el.dataset.entity, this._t.toastProfile);
    else if (el.dataset.pick) {
      const picked = this._state.picked;
      if (picked.has(el.dataset.pick)) picked.delete(el.dataset.pick);
      else picked.add(el.dataset.pick);
    } else if (el.dataset.fpick) {
      const page = this._state.filterPage;
      page.draft.filter_devices = toggleMac(page.draft.filter_devices, el.dataset.fpick);
      this._schedulePreview();
    }
    this._update();
  }

  _onInput(event) {
    const el = event.target;
    if (el.id === "q") {
      this._state.query = el.value;
      this._update();
    } else if (el.id === "a-q" || el.id === "a-pf" || el.id === "a-pt") {
      const addr = this._state.addr;
      if (el.id === "a-q") addr.query = el.value;
      else {
        const draft = addr.poolDraft ?? this._currentPool();
        addr.poolDraft = { ...draft, [el.id === "a-pf" ? "first" : "last"]: el.value };
      }
      this._renderAddresses();
      const box = this.shadowRoot.querySelector(`#${el.id}`);
      box?.focus({ preventScroll: true });
      box?.setSelectionRange?.(el.value.length, el.value.length);
    } else if (el.id === "c-search") {
      this._state.cleanupQuery = el.value;
      this._renderCleanup();
    } else if (el.id === "f-search" && this._state.filterPage) {
      this._state.filterPage.search = el.value;
      this._renderFilter();
    }
  }

  _onClick(event) {
    const t = this._t;
    const target = event.target.closest("button, [data-filter], [data-ap], [data-dev], [data-act], [data-aip]");
    if (!target || target.disabled) return;
    const ds = target.dataset;
    const state = this._state;
    if (ds.filter) {
      const fromMenu = Boolean(target.closest("#fmenu"));
      state.filter = ds.filter;
      state.menu = false;
      this._update();
      const root = this.shadowRoot;
      (fromMenu ? root.querySelector("#morebtn") : root.querySelector(`#chips [data-k="f-${CSS.escape(ds.filter)}"]`))?.focus();
      return;
    } else if (ds.range) {
      if (state.trend) state.trend.range = ds.range;
      this._update();
      this.shadowRoot.querySelector(`[data-range="${ds.range}"]`)?.focus();
      return;
    } else if (ds.trange) {
      state.trafficRange = Number(ds.trange);
      this._update();
      this.shadowRoot.querySelector(`[data-trange="${ds.trange}"]`)?.focus();
      return;
    } else if (ds.sort) {
      state.sortDesc = state.sort === ds.sort ? !state.sortDesc : false;
      state.sort = ds.sort;
      this._update();
      this.shadowRoot.querySelector(`[data-sort="${ds.sort}"]`)?.focus();
      return;
    } else if (ds.act === "page-prev" || ds.act === "page-next") {
      state.page += ds.act === "page-next" ? 1 : -1;
      this._update();
      this.shadowRoot.querySelector(`[data-act="${ds.act}"]:not([disabled])`)?.focus();
      return;
    } else if (ds.act === "menu") {
      return this._setMenu(!state.menu);
    } else if (ds.act === "menu-close") {
      return this._setMenu(false);
    } else if (ds.view) {
      state.view = ds.view;
      state.hl = null;
      state.menu = false;
      rememberView(ds.view);
      this._update();
      this.shadowRoot.querySelector(`.viewsw [data-view="${ds.view}"]`)?.focus();
      return;
    } else if (ds.days) {
      state.cleanupDays = Number(ds.days);
      this._update();
      this.shadowRoot.querySelector(`#days-seg [data-days="${ds.days}"]`)?.focus();
      return;
    } else if (ds.act === "names") {
      state.names = !state.names;
    } else if (ds.ap) {
      if (state.closed.has(ds.ap)) state.closed.delete(ds.ap);
      else state.closed.add(ds.ap);
    } else if (ds.dev) {
      return this._openDevice(ds.dev);
    } else if (ds.go) {
      globalThis.location.replace(`#/device/${ds.go}`);
      return;
    } else if (ds.enable) {
      return this._enable(ds.enable);
    } else if (ds.act === "show-map") {
      return this._showInMap();
    } else if (state.tab === "addresses" && this._onAddressClick(ds, target)) {
      return;
    } else if (ds.act === "internet") {
      globalThis.location.hash = "#/internet";
      return;
    } else if (ds.act === "reconnect" || ds.act === "reboot") {
      return this._interrupt(ds.act);
    } else if (ds.act === "back") {
      this._leaveDevice();
      return;
    } else if (ds.sw) {
      return this._toggle(ds.sw, ds.entity);
    } else if (ds.act === "wol") {
      return this._call("button", "press", {}, ds.entity, t.toastWol);
    } else if (ds.act === "rename") {
      return this._rename();
    } else if (ds.act === "ha") {
      return this._openInHa();
    } else if (ds.label) {
      return this._toggleLabel(ds.label);
    } else if (ds.act === "new-group") {
      return this._newGroup();
    } else if (ds.act === "group-bulk") {
      return this._groupBulk();
    } else if (ds.act === "logbook" || ds.act === "history") {
      return this._navigate(`/${ds.act}?entity_id=${encodeURIComponent(this._selected()?.entity_id ?? "")}`);
    } else if (ds.tab) {
      globalThis.location.hash = ds.tab === "net" ? "#/" : `#/${ds.tab}`;
      return;
    } else if (ds.act === "pick-all") {
      for (const d of visibleStale(state)) state.picked.add(d.mac);
    } else if (ds.act === "pick-none") {
      state.picked.clear();
    } else if (ds.act === "toggle-hidden") {
      state.hiddenOpen = !state.hiddenOpen;
    } else if (ds.act === "fpick-all") {
      const page = state.filterPage;
      const chosen = new Set(page.draft.filter_devices);
      for (const d of pickable(page)) chosen.add(d.mac);
      page.draft.filter_devices = [...chosen];
      this._schedulePreview();
    } else if (ds.act === "fpick-none") {
      state.filterPage.draft.filter_devices = [];
      this._schedulePreview();
    } else if (ds.act === "hide") {
      return this._hide();
    } else if (ds.unhide) {
      return this._unhide(ds.unhide);
    } else if (ds.mode) {
      state.filterPage.draft.filter_mode = ds.mode;
      this._schedulePreview();
    } else if (ds.ft) {
      state.filterPage.draft[ds.ft] = !state.filterPage.draft[ds.ft];
      this._schedulePreview();
    } else if (ds.act === "apply") {
      return this._applyFilter();
    } else {
      return;
    }
    this._update();
  }

  /** An action that interrupts the network: it asks first and says what the box answered. */
  async _interrupt(kind) {
    const t = this._t;
    const a = t.inet.actions;
    const ok = await openDialog(this.shadowRoot, t, {
      title: a[`${kind}Title`],
      body: a[`${kind}Body`],
      ok: a[`${kind}Ok`],
      danger: true,
    });
    if (!ok) return;
    try {
      await this._ws(kind === "reconnect" ? "internet/reconnect" : "box/reboot");
      showToast(this.shadowRoot, a[kind === "reconnect" ? "toastReconnect" : "toastReboot"]);
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  async _hide() {
    const t = this._t;
    const state = this._state;
    const macs = pickedMacs(state);
    if (!macs.length) return;
    const names = staleList(state).filter((d) => macs.includes(d.mac)).map((d) => d.name);
    const ok = await openDialog(this.shadowRoot, t, {
      title: fill(t.cleanup.hideTitle, { n: macs.length }),
      body: t.cleanup.hideBody,
      list: names,
      ok: fill(t.cleanup.hide, { n: macs.length }),
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await this._ws("devices/hide", { macs });
      for (const mac of result.hidden) state.picked.delete(mac);
      showToast(this.shadowRoot, fill(t.cleanup.toastHidden, { n: result.hidden.length }));
      if (result.refused.length) {
        showToast(this.shadowRoot, fill(t.cleanup.toastRefused, { n: result.refused.length }));
      }
      await this._loadCleanup();
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  async _unhide(mac) {
    const t = this._t;
    try {
      await this._ws("devices/unhide", { macs: [mac] });
      showToast(this.shadowRoot, t.cleanup.toastUnhidden);
      // the entry reloads: the subscription must be taken up again before the list is read
      if (await this._resubscribeAfterReload()) await this._loadCleanup();
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  async _applyFilter() {
    const t = this._t;
    const page = this._state.filterPage;
    if (!page?.preview || !filterChanged(page.current, page.draft)) return;
    const { remove, add } = page.preview;
    const ok = await openDialog(this.shadowRoot, t, {
      title: t.filter.applyTitle,
      body: fill(t.filter.applyBody, { remove: remove.length, add: add.length }),
      list: remove.map((d) => d.name),
      ok: t.filter.apply,
      danger: remove.length > 0,
    });
    if (!ok) return;
    try {
      await this._ws("filter/apply", { options: page.draft, expected_remove: remove.map((d) => d.mac) });
    } catch (err) {
      if (err?.code === "changed") {
        showToast(this.shadowRoot, t.filter.toastChanged);
        await this._runPreview();
      } else {
        showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
      }
      return;
    }
    showToast(this.shadowRoot, t.filter.toastApplied);
    if (await this._resubscribeAfterReload()) await this._loadFilter();
  }

  _leaveDevice() {
    // without a history entry of our own (opened by link) back would leave the panel
    if (this._openedHere) globalThis.history.back();
    else globalThis.location.hash = "#/";
  }

  /** Back to the map with the device marked; a filter that hides it is lifted first. */
  _showInMap() {
    const state = this._state;
    const id = state.sel;
    if (!id) return;
    state.view = "map";
    rememberView("map");
    state.hl = id;
    if (!visibleClients(state, Date.now()).some((c) => c.id === id)) {
      state.filter = "all";
      state.query = "";
      const q = this.shadowRoot.querySelector("#q");
      if (q) q.value = "";
    }
    this._reveal = id;
    this._leaveDevice();
  }

  /**
   * Switches entities of the device on in the registry. Home Assistant reloads the integration
   * after a short delay; until their state shows, the rows say so, then the panel subscribes again.
   */
  async _enable(which) {
    const t = this._t;
    const state = this._state;
    const entities =
      which === "all"
        ? enablePlan(this._selected(), this._hass, Boolean(state.data?.can_write), state.enabling)
        : [which];
    if (!entities.length) return;
    for (const entity of entities) state.enabling.add(entity);
    this._renderDetail();
    let delay = 30;
    try {
      for (const entity of entities) {
        const result = await this._hass.callWS({
          type: "config/entity_registry/update",
          entity_id: entity,
          disabled_by: null,
        });
        if (typeof result?.reload_delay === "number") delay = result.reload_delay;
      }
    } catch (err) {
      for (const entity of entities) state.enabling.delete(entity);
      this._renderDetail();
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
      return;
    }
    showToast(this.shadowRoot, fill(t.toastEnabled, { s: delay }));
    // should the states never show, the panel still takes up the subscription again
    clearTimeout(this._enableTimer);
    this._enableTimer = setTimeout(() => this._enabled(), (delay + 60) * 1000);
  }

  /** The integration is back after switching entities on: the subscription of the old one is gone. */
  _enabled() {
    clearTimeout(this._enableTimer);
    this._state.enabling = new Set();
    this._signature = null;
    this._resubscribeAfterReload();
    this._renderDetail();
  }

  async _toggle(kind, entityId) {
    const t = this._t;
    const client = this._selected();
    const state = entityState(this._hass, entityId);
    if (!client || !state) return;
    const turnOff = state.state === "on";
    const done =
      kind === "internet_access"
        ? fill(turnOff ? t.toastBlocked : t.toastAllowed, { name: client.name })
        : turnOff
          ? t.toastPriorityOff
          : t.toastPriorityOn;
    await this._call("switch", turnOff ? "turn_off" : "turn_on", {}, entityId, done);
  }

  async _rename() {
    const t = this._t;
    const client = this._selected();
    if (!client?.entity_id) return;
    const name = await openDialog(this.shadowRoot, t, {
      title: t.renameTitle,
      body: t.renameBody,
      field: { label: t.renameField, value: client.name },
      ok: t.renameOk,
    });
    if (name === null || name === client.name) return;
    await this._call(DOMAIN, "set_name", { name }, client.entity_id, t.toastRenamed);
  }

  _openInHa() {
    const client = this._selected();
    if (client?.device_id) this._navigate(`/config/devices/device/${client.device_id}`);
  }

  _navigate(path) {
    globalThis.history.pushState(null, "", path);
    globalThis.dispatchEvent(new CustomEvent("location-changed"));
  }

  /** Puts the device in a group or takes it out: the label on its "Internet access" entity. */
  async _toggleLabel(labelId) {
    const client = this._selected();
    const entity = client?.actions?.internet_access;
    if (!entity) return;
    await this._setLabels(entity, toggleMac(client.labels ?? [], labelId), this._t.toastGroupChanged);
  }

  async _setLabels(entityId, labels, success) {
    try {
      await this._hass.callWS({ type: "config/entity_registry/update", entity_id: entityId, labels });
      showToast(this.shadowRoot, success);
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }

  async _newGroup() {
    const t = this._t;
    const client = this._selected();
    const entity = client?.actions?.internet_access;
    if (!entity) return;
    const name = await openDialog(this.shadowRoot, t, {
      title: t.newGroupTitle,
      body: t.newGroupBody,
      field: { label: t.newGroupField, value: "" },
      ok: t.newGroupOk,
    });
    if (name === null) return;
    try {
      const label = await this._hass.callWS({ type: "config/label_registry/create", name });
      await this._setLabels(entity, toggleMac(client.labels ?? [], label.label_id), fill(t.toastGroupCreated, { name }));
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** Blocks or allows every device of the group at once, after naming them. */
  async _groupBulk() {
    const t = this._t;
    const state = this._state;
    if (!state.filter.startsWith("label:")) return;
    const plan = groupPlan(state.data, state.filter.slice(6), this._hass);
    if (!plan.entities.length) return;
    const n = plan.entities.length;
    const ok = await openDialog(this.shadowRoot, t, {
      title: fill(plan.block ? t.bulkBlockTitle : t.bulkAllowTitle, { n }),
      body: plan.block ? t.bulkBlockBody : t.bulkAllowBody,
      list: plan.names,
      ok: plan.block ? t.groupBlockAll : t.groupAllowAll,
      danger: plan.block,
    });
    if (!ok) return;
    try {
      await this._hass.callService("switch", plan.block ? "turn_off" : "turn_on", {
        entity_id: plan.entities,
      });
      showToast(this.shadowRoot, fill(plan.block ? t.toastBulkBlocked : t.toastBulkAllowed, { n }));
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** One call to Home Assistant; a refusal shows as a toast with what Home Assistant says. */
  async _call(domain, service, data, entityId, success) {
    try {
      await this._hass.callService(domain, service, data, { entity_id: entityId });
      showToast(this.shadowRoot, success);
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("fritzbox-network-panel")) {
  customElements.define("fritzbox-network-panel", FritzboxNetworkPanel);
}

export { FritzboxNetworkPanel };
