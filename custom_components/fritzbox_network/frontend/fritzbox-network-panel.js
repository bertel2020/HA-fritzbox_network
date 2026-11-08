/* FRITZ!Box Network panel: the whole network in the sidebar, for administrators. */

import {
  STALE_STEPS,
  WEAK_LINK_RATIO,
  escapeHtml,
  formatDuration,
  rememberNote,
  filterChanged,
  nearestStep,
  pagerFor,
  isBlocked,
  pageHash,
  panelCounts,
  plotKeyTarget,
  plotText,
  routeFromHash,
  toggleMac,
} from "./shared.js";
import { fill, panelTexts } from "./texts.js";
import { PANEL_CSS } from "./panel-styles.js";
import { ic } from "./icons.js";
import { applyLook, lookButton, rememberLook, rememberedLook, renderLookMenu, scaleFonts } from "./theme.js";
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
import { renderVpn } from "./panel-vpn.js";
import { renderRoutes } from "./panel-routes.js";
import { captureDefaults, defaultInterface, renderCapture } from "./panel-capture.js";
import { renderConnection } from "./panel-check.js";
import { renderLog } from "./panel-log.js";
import { renderRadio } from "./panel-radio.js";
import { BLOCK_COLORS, ENTRY_KINDS, addressModel, checkBlock, checkEntry, emptyOwn, entryPreview, groupPreview, normalizeOwn, parseRange, poolChange, renderAddresses } from "./panel-addresses.js";
import { addressRows, fileName, printSheet, toCsv, toJson } from "./panel-export.js";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, renderTable } from "./panel-table.js";
import { renderHints } from "./panel-hints.js";
import { enablePlan, renderDevice } from "./panel-device.js";
import { openDialog, openFormDialog, openPasswordDialog, showToast } from "./panel-dialogs.js";
import { dialSuggestions, liveBand, lookupBody, mmss, renderPhone, sinceText } from "./panel-phone.js";
import { HISTORY_PERIODS, PERIODS, PERIOD_DAYS, PHONE_DOMAIN, REVEAL_MS, SIGN_EXPIRES_S, SIGN_REUSE_MS, WS_PARTS, dialable, fetchPhoneWs, parseWsEntries, phoneLoaded, phoneTrigger, readPhoneModel, wsCode } from "./phone-model.js";
import { RESTART_POLL_MS, minSec, nextRestart, renderBoxPage, restarted } from "./panel-box.js";
import { isLastNetwork, passwordRules, randomPassword, renderWlan } from "./panel-wlan.js";
import { bannerHidden, hasCore, hideBanner, renderBanner, renderMigrate } from "./panel-migrate.js";
import { pickedMacs, renderHidden, renderStale, staleList, visibleStale } from "./panel-cleanup.js";
import { pickable, renderFilterControls, renderPicker, renderPickerHead, renderPreview } from "./panel-filter.js";

const DOMAIN = "fritzbox_network";
const BOX_KEY = `${DOMAIN}_panel_box`;
const VIEW_KEY = `${DOMAIN}_panel_view`;
const HISTORY_REFRESH_MS = 300000;
const VPN_HISTORY_REFRESH_MS = 60000;
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

/** What the phone page remembers while the panel is open: filters, open rows, the player; nothing is stored. */
function phoneUi() {
  return {
    view: "list",
    filter: "all",
    query: "",
    period: "7",
    tables: { bars: false, heat: false },
    book: null,
    bookQuery: "",
    bookOpen: false,
    bookFilter: "all",
    expanded: new Set(),
    revealed: new Set(),
    play: null,
    dial: null,
    blocked: new Set(),
    busy: new Set(),
    rights: "",
    chosen: null,
    // the last good state of each entity, shown while FRITZ!Box Telefon does not reach the box
    cache: new Map(),
  };
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
// the logo of the integration, served next to the scripts
const ICON_URL = new URL("./brand/icon.png", import.meta.url).href;

/**
 * The tabs of the panel and the pages under each, in order. A tab with more than one page shows
 * the switch between them at the top of each; the first page is the one a tab opens at first.
 */
export const TAB_GROUPS = {
  net: ["net", "wlan", "addresses", "routes"],
  internet: ["internet", "vpn"],
  box: ["box", "phone"],
  diagnose: ["diagnose"],
  devices: ["filter", "cleanup", "migrate"],
};
export const TABS = Object.keys(TAB_GROUPS);
// a page named like its tab is called differently in the switch: "Network" › "Devices"
const SUB_LABELS = { net: "netDevices", internet: "connection", box: "boxOverview" };

/** The tab a page belongs to. */
export function groupOf(page) {
  return TABS.find((group) => TAB_GROUPS[group].includes(page)) ?? "net";
}

/** The pages of a tab that are offered: VPN where the box tells its connections, switching over while FRITZ!Box Tools is set up. */
export function pagesOf(group, state) {
  return (TAB_GROUPS[group] ?? []).filter((page) => {
    if (page === "vpn") return Array.isArray(state?.data?.vpn);
    if (page === "migrate") return hasCore(state?.migrate);
    if (page === "phone") return Boolean(state?.phoneFound);
    return true;
  });
}

/**
 * The tab an arrow key leads to inside a tab list: left and right (up and down in the bottom bar's
 * sibling lists too) step around, Home and End go to the ends. Null for any other key.
 */
export function tabKeyTarget(tabs, from, key) {
  if (!tabs.length) return null;
  const at = tabs.indexOf(from);
  const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[key];
  return to === undefined ? null : tabs[(to + tabs.length) % tabs.length];
}

/** The switch between the pages of the tab of the open page; nothing where the tab has only one. */
export function renderSubTabs(active, t, state = {}) {
  const group = groupOf(active);
  const pages = pagesOf(group, state);
  if (pages.length < 2) return "";
  return `<div class="seg subtabs" role="tablist" aria-label="${escapeHtml(t.tabs[group])}">${pages
    .map((id) => {
      const unread = id === "phone" && state.phoneUnread > 0 ? ` <span class="chip info sub-badge">${state.phoneUnread}<span class="sr"> ${escapeHtml(fill(t.phone.unread, { n: "" }).trim())}</span></span>` : "";
      return `<button role="tab" tabindex="${id === active ? 0 : -1}" data-tab="${id}" aria-selected="${id === active}" aria-pressed="${id === active}">${escapeHtml(t.tabs[SUB_LABELS[id] ?? id])}${unread}</button>`;
    })
    .join("")}</div>`;
}

/** The icons of the five tabs, shown in the bar at the bottom of a narrow screen. */
const NAV_ICONS = { net: "network", internet: "globe", box: "router", diagnose: "search", devices: "list" };

/**
 * The five tabs. Internet carries a dot for the state of the line, Box one while it restarts,
 * Manage the number of devices gone for long.
 */
export function renderNav(state, t, stale, icons = false) {
  const line = state.data?.internet;
  const open = groupOf(state.tab);
  const tab = (id, extra = "", label = "") =>
    `<button role="tab" tabindex="${id === open ? 0 : -1}" data-tab="${id}" aria-selected="${id === open}"${label ? ` aria-label="${escapeHtml(label)}"` : ""}>${icons ? `<span class="ni">${ic(NAV_ICONS[id])}${extra}</span><span class="nl">${escapeHtml(t.tabs[id])}</span>` : `${escapeHtml(t.tabs[id])}${extra}`}</button>`;
  const dot = line ? `<i class="dot ${line.connected === false ? "" : "on"}" aria-hidden="true"></i>` : "";
  const label = line ? `${t.tabs.internet}, ${line.connected === false ? t.inet.state.down : t.inet.state.up}` : "";
  const restarting = state.boxRestart && state.boxRestart.phase !== "back";
  // a dot on the box while it restarts, or while a phone rings (from FRITZ!Box Telefon)
  const ringing = Boolean(state.phoneRinging);
  const boxNote = [restarting ? t.boxPage.restarting : "", ringing ? t.phone.ringingTab : ""].filter(Boolean).join(", ");
  return [
    tab("net"),
    tab("internet", dot, label),
    tab("box", restarting || ringing ? `<i class="dot warn" aria-hidden="true"></i>` : "", boxNote ? `${t.tabs.box}, ${boxNote}` : ""),
    tab("diagnose"),
    tab("devices", stale ? `<em>${stale}</em>` : ""),
  ].join("");
}

/** What the address page knows of one box: it is all gone when another box is chosen. */
const addrState = () => ({ status: "loading", network: null, own: null, fixed: {}, filter: "all", query: "", view: "map", sel: null, blockMessage: "", groupsOpen: false, groupDraft: null, entryOpen: false, entryDraft: null, entryMessage: "", progress: null, exportOpts: { free: false, mac: true, map: true, poolNames: true } });

/** The width of the panel up to which the pages are a bar at the bottom: where the content gets its narrow layout too. */
export const COMPACT_WIDTH = 600;

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
      portsFilter: "all",
      routes: null,
      routesSel: null,
      routesFixed: {},
      capture: null,
      captureForm: captureDefaults(null),
      captureSummary: null,
      captureDetecting: false,
      check: null,
      latency: null,
      log: null,
      logGroup: "",
      logKind: null,
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
      addr: addrState(),
      traffic: null,
      trafficRange: 7,
      trend: null,
      closed: new Set(),
      sel: route.device,
      threshold: WEAK_LINK_RATIO,
      view: rememberedView(),
      menu: false,
      look: false,
      names: true,
      // the device "In the network map" points at
      hl: null,
      // entities switched on in the registry, until Home Assistant shows their state
      enabling: new Set(),
      // the page each tab showed last, opened again by the tab
      lastPage: {},
      box: null,
      boxRestart: null,
      boxReconnect: null,
      wlan: null,
      wlanError: "",
      wlanBusy: new Set(),
      // the guest password: only while the Wi-Fi page shows it, never stored anywhere
      wlanSecret: null,
      wlanReveal: false,
      migrate: null,
      migrateFilter: "all",
      migrateHidden: false,
      // the phone page: what FRITZ!Box Telefon is there for, and what the page shows of it
      phoneFound: false,
      phoneUnread: 0,
      phoneRinging: false,
      phoneLive: "",
      phone: phoneUi(),
    };
    // the device page was opened from the list or the map: back is a step back in the history
    this._openedHere = false;
    this._listScroll = 0;
    this._html = {};
    this._look = rememberedLook();
    this._entries = [];
    this._entryId = null;
    // how FRITZ!Box Telefon is read: null (not known yet), "ws" (its commands) or "entities" (older versions)
    this._phoneApi = null;
    this._phoneLegacy = false;
    this._phoneWs = { entries: [], data: null };
    this._error = null;
    this._unsub = null;
    this._updatedAt = 0;
    this._onHash = () => {
      const state = this._state;
      const next = routeFromHash(globalThis.location.hash);
      const entered = next.tab !== state.tab;
      const was = state.sel;
      if (entered && state.tab === "wlan") this._dropSecret();
      if (entered && state.tab === "phone") this._phoneStop();
      state.tab = next.tab;
      state.sel = next.device;
      state.menu = false;
      if (!next.device) this._openedHere = false;
      if (entered) this._enterTab();
      this._update();
      if (state.sel && state.sel !== was) this._showDevicePage();
      else if (!state.sel && was) this._backToList(was);
    };
    this._resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      this._syncCompact();
      this._drawLinks();
      this._phoneResized();
    });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    this.shadowRoot.addEventListener("keydown", (event) => this._onKey(event));
    this.shadowRoot.addEventListener("submit", (event) => {
      if (!["a-blockform", "a-poolform", "a-entryform"].includes(event.target.id)) return;
      event.preventDefault();
      if (event.target.id === "a-poolform") this._applyPool();
      else if (event.target.id === "a-entryform") this._onEntryForm(event.target);
      else this._onAddressForm(event.target);
    });
    // a note the reader opened stays open when the page is drawn again; "toggle" does not bubble
    this.shadowRoot.addEventListener("toggle", (event) => rememberNote(event.target), true);
    this.shadowRoot.addEventListener("pointermove", (event) => this._onPlot(event));
    this.shadowRoot.addEventListener("pointerleave", () => this._hidePlots());
    this.shadowRoot.addEventListener("pointerover", (event) => this._phoneTip(event));
    this.shadowRoot.addEventListener("focusin", (event) => this._phoneTip(event));
    this.shadowRoot.addEventListener("focusin", (event) => this._onPlotFocus(event));
    this.shadowRoot.addEventListener("focusout", (event) => {
      if (event.target?.classList?.contains("plot")) this._hidePlots();
    });
    this.shadowRoot.addEventListener("pointerout", (event) => {
      if (!event.relatedTarget?.closest?.(".plot, .vbar")) this._hidePlots();
    });
  }

  set hass(hass) {
    this._hass = hass;
    const phoneBefore = this._phoneSignature();
    const phoneChanged = this._readPhone();
    this._haDark = hass.themes?.darkMode;
    this._applyLook();
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) menu.hass = hass;
    if (hass.language !== this._language) {
      this._language = hass.language;
      this._build();
    }
    if (!this._started) this._start();
    else {
      this._onHass();
      // the tab and its switch show whether FRITZ!Box Telefon is there, rings or has new messages
      if (this._phoneSignature() !== phoneBefore) this._update();
      else if (phoneChanged && this._state.tab === "phone") this._renderPhone();
    }
    this._phoneSync();
  }

  /** The colours and the size of the type chosen, with light or dark as Home Assistant has it when that is chosen. */
  _applyLook() {
    const system = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    applyLook(this, this._look, this._haDark, system);
  }

  set narrow(narrow) {
    this._narrow = narrow;
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) menu.narrow = narrow;
  }

  // Home Assistant also hands over the route and the panel config; the panel needs neither.
  set route(_route) {}

  set panel(_panel) {}

  /** The bar at the bottom replaces the top one when the panel is narrow, as the content turns narrow with it. */
  _syncCompact() {
    this.toggleAttribute?.("compact", this.clientWidth > 0 && this.clientWidth <= COMPACT_WIDTH);
  }

  connectedCallback() {
    this._syncCompact();
    globalThis.addEventListener("hashchange", this._onHash);
    this._clock = setInterval(() => this._tick(), 5000);
    this._callClock = setInterval(() => this._tickCall(), 1000);
    this._resize?.observe(this);
    if (this._hass && !this._started) this._start();
    if (this._state.boxRestart?.phase === "down") this._pollRestart();
  }

  disconnectedCallback() {
    globalThis.removeEventListener("hashchange", this._onHash);
    clearInterval(this._clock);
    clearInterval(this._callClock);
    clearTimeout(this._enableTimer);
    clearTimeout(this._captureTimer);
    clearTimeout(this._latencyTimer);
    clearTimeout(this._restartTimer);
    this._dropSecret();
    this._phoneStop();
    this._phoneClearTimers();
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
    if (await this._subscribe()) {
      this._enterTab();
      if (this._state.tab !== "migrate") this._loadMigrate({ quiet: true });
    }
  }

  /** Subscribes to the topology of the chosen box; quiet: a failure is the caller's to handle. */
  async _subscribe({ quiet = false } = {}) {
    try {
      if (this._unsub) {
        this._unsub();
        this._unsub = null;
      }
      this._unsub = await this._hass.connection.subscribeMessage(
        (data) => {
          if (data.reload) {
            // the options changed somewhere else and the box reloads: this subscription is gone with it
            this._onBoxReload();
            return;
          }
          this._state.data = data;
          this._error = null;
          this._updatedAt = Date.now();
          this._update();
          this._maybeLoadHistory();
          if (this._state.tab === "vpn" && Date.now() - (this._vpnHistoryAt ?? 0) > VPN_HISTORY_REFRESH_MS) this._loadVpnHistory();
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
    this._resubscribing = true;
    try {
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
    } finally {
      this._resubscribing = false;
    }
  }

  /**
   * The options changed somewhere else, for example in the settings of the integration. Take the
   * subscription up again and bring the open filter page up to date: a draft nobody touched is
   * replaced, one with changes stays, with a note that saving it overwrites what changed.
   */
  async _onBoxReload() {
    if (this._resubscribing) return; // the panel's own change: it takes this up itself
    if (!(await this._resubscribeAfterReload())) return;
    const page = this._state.filterPage;
    if (!page) return;
    if (!filterChanged(page.current, page.draft)) {
      await this._loadFilter();
      return;
    }
    try {
      page.current = (await this._ws("filter/preview")).options;
      showToast(this.shadowRoot, this._t.filter.toastChangedElsewhere);
      await this._runPreview();
    } catch (err) {
      this._fail(err);
    }
  }

  /** Fetches what the page just opened needs. */
  _enterTab() {
    if (this._state.tab === "cleanup") this._loadCleanup();
    else if (this._state.tab === "filter") this._loadFilter();
    else if (this._state.tab === "internet") this._loadPorts();
    else if (this._state.tab === "diagnose") {
      this._loadLatency();
      this._loadCapture();
      this._loadLog();
    }
    else if (this._state.tab === "addresses") this._loadAddresses();
    else if (this._state.tab === "routes") this._loadRoutes();
    else if (this._state.tab === "vpn") this._loadVpnHistory();
    else if (this._state.tab === "box") this._loadBox();
    else if (this._state.tab === "wlan") this._loadWlan();
    else if (this._state.tab === "migrate") this._loadMigrate();
    else if (this._state.tab === "phone") this._phoneSync({ parts: WS_PARTS });
  }

  /**
   * A command to the box that is chosen now. If another box is chosen before the answer comes, the
   * answer belongs to the old one: the promise then never settles, so nothing of the caller
   * (not its result, not its error handling) touches the state of the new box.
   */
  _ws(type, extra = {}) {
    const entryId = this._entryId;
    const answer = this._hass.callWS({ type: `${DOMAIN}/${type}`, entry_id: entryId, ...extra });
    return answer.then(
      (result) => (this._entryId === entryId ? result : new Promise(() => {})),
      (err) => (this._entryId === entryId ? Promise.reject(err) : new Promise(() => {}))
    );
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
      if (this._state.trafficRange === 365) this._loadTrafficYear();
      this._update();
    } catch {
      // without a history the table shows no sparklines; the next poll tries again
      this._historyAt = Date.now() - HISTORY_REFRESH_MS + 30000;
    } finally {
      this._historyBusy = false;
    }
  }

  /** The traffic of the whole year, read only while the year is shown: the list of devices comes with 35 days. */
  async _loadTrafficYear() {
    if (this._trafficYearBusy) return;
    this._trafficYearBusy = true;
    try {
      this._state.trafficYear = (await this._ws("history/traffic")).traffic ?? {};
    } catch {
      this._state.trafficYear ??= null;
    } finally {
      this._trafficYearBusy = false;
    }
    this._update();
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

  /** The sessions of the tunnels for their chart: read when the VPN page opens and now and then while it stays open. */
  async _loadVpnHistory() {
    if (this._vpnHistoryBusy) return;
    this._vpnHistoryBusy = true;
    try {
      this._state.vpnHistory = await this._ws("vpn/history");
      this._vpnHistoryAt = Date.now();
    } catch {
      this._state.vpnHistory ??= {};
    } finally {
      this._vpnHistoryBusy = false;
    }
    if (this._state.tab === "vpn") this._update();
  }

  /** The routes are read when their page opens, not with every update. */
  async _loadRoutes() {
    this._state.routes = null;
    this._state.routesDraft = null;
    this._update();
    try {
      this._state.routes = await this._ws("routes/list");
    } catch {
      this._state.routes = "failed";
    }
    this._update();
  }

  _renderRoutes() {
    const state = this._state;
    this._set(
      "routes-view",
      renderRoutes(state.routes, {
        t: this._t,
        canWrite: Boolean(state.data?.can_write),
        busy: state.routesBusy,
        draft: state.routesDraft,
        adding: state.routesAdding,
        clients: state.data?.clients ?? [],
        sel: state.routesSel,
        fixed: state.routesFixed,
      })
    );
    this._ensureRouteFixed();
  }

  /** Whether the gateway of the selected route has a fixed address: asked once per device, kept for ten minutes. */
  async _ensureRouteFixed() {
    const state = this._state;
    const routes = state.routes?.entries;
    if (!Array.isArray(routes) || !routes.length) return;
    const route = routes.find((r) => r.network === state.routesSel) ?? routes[0];
    const mac = route.device_mac;
    if (!mac) return;
    const known = state.routesFixed[mac];
    if (known && (known.pending || Date.now() - known.at < 600000)) return;
    state.routesFixed[mac] = { pending: true, at: 0, value: null };
    try {
      const { reservation } = await this._ws("device/ip", { mac });
      state.routesFixed[mac] = { at: Date.now(), value: reservation ?? null };
    } catch {
      state.routesFixed[mac] = { at: Date.now(), value: null };
    }
    if (state.tab === "routes") this._renderRoutes();
  }

  /** The form of a new route: the fields are drawn again at every key, the focus stays where it was. */
  _onRouteInput(el) {
    const state = this._state;
    const key = { "r-net": "network", "r-gw": "gateway", "r-metric": "metric" }[el.id];
    state.routesDraft = { ...state.routesDraft, [key]: el.value };
    this._renderRoutes();
    const box = this.shadowRoot.querySelector(`#${el.id}`);
    box?.focus({ preventScroll: true });
    box?.setSelectionRange?.(el.value.length, el.value.length);
  }

  async _addRoute() {
    const state = this._state;
    const draft = state.routesDraft;
    if (!draft || state.routesAdding) return;
    const net = draft.network.trim();
    state.routesAdding = true;
    this._renderRoutes();
    try {
      state.routes = await this._ws("routes/add", { network: net, gateway: draft.gateway.trim(), metric: Number(draft.metric) });
      state.routesDraft = null;
      showToast(this.shadowRoot, fill(this._t.routesPage.toastAdded, { name: net }));
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    } finally {
      state.routesAdding = false;
      this._renderRoutes();
    }
  }

  async _deleteRoute(network) {
    const state = this._state;
    const text = this._t.routesPage;
    const route = state.routes?.entries?.find((r) => r.network === network);
    const ok = await openDialog(this.shadowRoot, this._t, {
      title: text.delete.title,
      body: fill(text.delete.body, { net: network, gateway: route?.gateway ?? "" }),
      ok: text.delete.ok,
      danger: true,
    });
    if (!ok) return;
    state.routesBusy = new Set([...(state.routesBusy ?? []), network]);
    this._renderRoutes();
    try {
      state.routes = await this._ws("routes/delete", { network });
      showToast(this.shadowRoot, fill(text.toastDeleted, { name: network }));
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    } finally {
      state.routesBusy = new Set([...state.routesBusy].filter((id) => id !== network));
      this._renderRoutes();
    }
  }

  /** Switches a route; the button waits until the box shows it in the new state. */
  async _switchRoute(network, enabled) {
    const state = this._state;
    state.routesBusy = new Set([...(state.routesBusy ?? []), network]);
    this._renderRoutes();
    const text = this._t.routesPage;
    try {
      const result = await this._ws("routes/switch", { network, enabled });
      state.routes = result;
      showToast(this.shadowRoot, fill(enabled ? text.toastOn : text.toastOff, { name: network }));
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    } finally {
      state.routesBusy = new Set([...state.routesBusy].filter((id) => id !== network));
      this._renderRoutes();
    }
  }

  /** The recordings are read when the internet page opens and while one runs. */
  async _loadCapture() {
    clearTimeout(this._captureTimer);
    try {
      const state = this._state;
      const first = !state.capture || state.capture === "failed";
      state.capture = await this._ws("capture/status");
      if (first) state.captureForm = captureDefaults(state.capture.limits);
      // the box may offer other interfaces than last time: keep the choice only if it is still there
      if (!state.capture.interfaces.some((i) => i.id === state.captureForm.interface)) {
        state.captureForm.interface = defaultInterface(state.capture.interfaces);
      }
    } catch {
      this._state.capture = "failed";
    }
    this._update();
    if (this._state.tab === "diagnose" && this._state.capture?.job?.state === "running") {
      this._captureTimer = setTimeout(() => this._loadCapture(), 1000);
    }
  }

  /** The course of the connection is read when the page opens, and again every minute while it is open and recorded. */
  async _loadLatency() {
    clearTimeout(this._latencyTimer);
    try {
      this._state.latency = await this._ws("diagnose/latency");
    } catch {
      this._state.latency = "failed";
    }
    this._update();
    if (this._state.tab === "diagnose" && this._state.latency?.enabled) {
      this._latencyTimer = setTimeout(() => this._loadLatency(), 60000);
    }
  }

  async _switchLatency(enabled) {
    const state = this._state;
    try {
      state.latency = await this._ws("diagnose/latency/switch", { enabled });
      this._update();
      clearTimeout(this._latencyTimer);
      if (state.latency.enabled) this._latencyTimer = setTimeout(() => this._loadLatency(), 5000);
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }

  async _loadLog() {
    const state = this._state;
    const group = state.logGroup;
    try {
      const log = await this._ws("diagnose/log", group ? { group } : {});
      if (state.logGroup === group) state.log = log;
    } catch {
      state.log = "failed";
    }
    this._update();
  }

  async _runCheck() {
    this._state.check = "running";
    this._update();
    try {
      this._state.check = await this._ws("diagnose/check");
    } catch {
      this._state.check = "failed";
    }
    this._update();
  }

  async _onCapture(ds) {
    const t = this._t;
    const c = t.inet.capture;
    const state = this._state;
    try {
      if (ds.act === "cap-start") {
        const form = state.captureForm;
        state.capture = await this._ws("capture/start", { interface: form.interface, seconds: form.seconds, mb: form.mb, ...(form.mac ? { mac: form.mac } : {}) });
        showToast(this.shadowRoot, c.toastStarted);
        this._update();
        this._captureTimer = setTimeout(() => this._loadCapture(), 1000);
      } else if (ds.act === "cap-device") {
        state.captureForm = { ...state.captureForm, interface: state.captureForm.interface.startsWith("2-") ? defaultInterface(state.capture.interfaces) : state.captureForm.interface, mac: this._selected()?.mac ?? "" };
        globalThis.location.hash = "#/diagnose";
        return;
      } else if (ds.act === "cap-detect") {
        state.captureDetecting = true;
        this._update();
        try {
          const found = await this._ws("capture/bands");
          state.capture = found;
          const names = Object.entries(found.bands).map(([id, band]) => `${found.interfaces.find((i) => i.id === id)?.label ?? id} = ${t.bandGroups[band] ?? band}`);
          const open = found.undecided.map((id) => found.interfaces.find((i) => i.id === id)?.label ?? id);
          showToast(this.shadowRoot, names.length ? fill(c.detectDone, { found: names.join(", "), open: open.length ? fill(c.detectOpen, { names: open.join(", ") }) : "" }) : c.detectNone);
        } finally {
          state.captureDetecting = false;
          this._update();
        }
      } else if (ds.act === "cap-sum") {
        state.captureSummary = { name: ds.name, data: await this._ws("capture/summary", { name: ds.name }) };
        this._update();
      } else if (ds.act === "cap-stop") {
        await this._ws("capture/stop");
        await this._loadCapture();
      } else if (ds.act === "cap-del") {
        const ok = await openDialog(this.shadowRoot, t, { title: c.deleteTitle, body: c.deleteBody, list: [ds.name], ok: c.delete, danger: true });
        if (!ok) return;
        await this._ws("capture/delete", { name: ds.name });
        if (state.captureSummary?.name === ds.name) state.captureSummary = null;
        await this._loadCapture();
      } else if (ds.act === "cap-dl") {
        const response = await this._hass.fetchWithAuth(`${state.capture.url}${encodeURIComponent(ds.name)}`);
        if (!response.ok) throw new Error(String(response.status));
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await response.blob());
        link.download = ds.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      }
    } catch (err) {
      const busy = err?.code === "busy";
      showToast(this.shadowRoot, busy ? c.toastBusy : fill(t.toastFailed, { error: err?.message ?? err }));
    }
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
    // everything read from the old box, and the marks of reads still on their way
    Object.assign(this._state, {
      history: null, traffic: null, trafficYear: null, trend: null, ip: null,
      vpnHistory: null, addr: addrState(), capture: null, captureSummary: null,
      check: null, latency: null, log: null, routesSel: null, routesFixed: {}, wlanError: "",
    });
    for (const busy of ["_historyBusy", "_trafficYearBusy", "_vpnHistoryBusy", "_trendBusy", "_ipBusy", "_fixedBusy"]) this[busy] = false;
    this._historyAt = null;
    this._vpnHistoryAt = null;
    this._state.enabling = new Set();
    this._state.cleanup = null;
    this._state.cleanupDays = null;
    this._state.picked = new Set();
    this._state.filterPage = null;
    this._state.ports = null;
    this._state.routes = null;
    this._state.routesDraft = null;
    clearTimeout(this._restartTimer);
    this._dropSecret();
    Object.assign(this._state, { box: null, boxRestart: null, boxReconnect: null, wlan: null, wlanBusy: new Set(), migrate: null, migrateFilter: "all", migrateHidden: false });
    this._phoneStop();
    this._phoneClearTimers();
    this._state.phone = phoneUi();
    this._readPhone();
    this._update();
    if (await this._subscribe()) {
      this._enterTab();
      if (this._state.tab !== "migrate") this._loadMigrate({ quiet: true });
    }
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
            <img class="logo" src="${ICON_URL}" alt="" width="40" height="40">
            <div><b>${t.title}</b><small class="subline"><span id="sub"></span><span class="fresh" id="live-chip" hidden><span class="dot on"></span><span class="t" id="live"></span></span></small></div>
          </div>
          <nav role="tablist" id="nav" aria-label="${t.navLabel}"></nav>
          <div class="header-end">
            <select id="box" aria-label="${t.box}" hidden></select>
            <span id="lookhost"></span>
            <a class="iconbtn intlink" href="/config/integrations/integration/${DOMAIN}" data-act="integration" title="${escapeHtml(t.integrationTitle)}" aria-label="${escapeHtml(t.integrationTitle)}">${ic("external")}</a>
          </div>
        </header>
        <div id="lookmenuhost"></div>
        <div id="callbar"></div>
        <main>
          <div id="migbanner"></div>
          <div id="note"></div>
          <div id="subtabs"></div>
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
          <div id="vpn-view" hidden></div>
          <div id="diagnose-view" hidden></div>
          <div id="addresses-view" hidden></div>
          <div id="routes-view" hidden></div>
          <div id="box-view" hidden></div>
          <div id="phone-view" hidden></div>
          <div id="wlan-view" hidden></div>
          <div id="migrate-view" hidden></div>
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
      <nav role="tablist" id="bnav" aria-label="${t.navLabel}"></nav>
      <div class="backdrop" id="backdrop"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" id="dialog"></div></div>
      <div class="toast" id="toast" role="status"></div>`;
    const menu = this.shadowRoot.querySelector("ha-menu-button");
    if (menu) {
      menu.hass = this._hass;
      menu.narrow = this._narrow;
    }
    const style = this.shadowRoot.querySelector("style");
    style.textContent = scaleFonts(style.textContent);
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
    // a tip that is open on a chart stays open: the pointer has not moved, only the drawing was renewed
    const hadTip = Boolean(this._pointer && el.querySelector(".plot .tip:not([hidden]), .vbar .tip:not([hidden])"));
    el.innerHTML = html;
    if (again) el.querySelector(again)?.focus({ preventScroll: true });
    if (hadTip) {
      const hit = this.shadowRoot.elementFromPoint?.(this._pointer.x, this._pointer.y);
      if (hit?.closest?.(".plot, .vbar")) this._onPlot({ target: hit, clientX: this._pointer.x });
    }
  }

  /** The parsed data of a chart, kept per element: the pointer moves far more often than a chart is drawn. */
  _chartData(el, key) {
    this._chartCache ??= new WeakMap();
    let cached = this._chartCache.get(el);
    if (!cached || cached.raw !== el.dataset[key]) {
      cached = { raw: el.dataset[key], value: JSON.parse(el.dataset[key]) };
      this._chartCache.set(el, cached);
    }
    return cached.value;
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

  /** The running seconds of a call, in the card, the list row and the bar. */
  _tickCall() {
    const els = this.shadowRoot?.querySelectorAll("[data-ph-since]");
    if (!els?.length) return;
    const now = new Date();
    for (const el of els) {
      const text = sinceText(el.dataset.phSince, now);
      if (text && el.textContent !== text) el.textContent = text;
    }
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
    this._set("lookhost", lookButton(t, state.look));
    this._set("lookmenuhost", renderLookMenu(this._look, t, state.look));
    const netView = root.querySelector("#net-view");
    if (!netView) return;
    this._readPhone();
    this._renderCallBar(ready);
    // without FRITZ!Box Telefon there is no phone page: its address leads to the box
    if (state.tab === "phone" && !state.phoneFound && this._hass && Object.keys(this._hass.entities ?? {}).length) {
      state.tab = "box";
      globalThis.location?.replace?.(pageHash("box"));
      this._enterTab();
    }
    const tab = state.tab;
    state.lastPage[groupOf(tab)] = tab;
    const onDevice = tab === "net" && Boolean(state.sel);
    netView.hidden = !ready || tab !== "net" || onDevice;
    root.querySelector("#device-view").hidden = !ready || !onDevice;
    for (const page of ["internet", "vpn", "box", "phone", "diagnose", "wlan", "addresses", "routes", "cleanup", "filter", "migrate"]) {
      root.querySelector(`#${page}-view`).hidden = !ready || tab !== page;
    }
    root.querySelector("#live-chip").hidden = !ready;
    const stale = ready ? panelCounts(state.data, Date.now(), state.threshold).stale : 0;
    this._set("nav", ready ? renderNav(state, t, stale) : "");
    this._set("bnav", ready ? renderNav(state, t, stale, true) : "");
    this._set("subtabs", ready && !onDevice ? renderSubTabs(tab, t, state) : "");
    this._set("migbanner", ready ? renderBanner(state.migrate, { t, hidden: state.migrateHidden, tab }) : "");
    if (!ready) return;
    const now = Date.now();
    const master = (state.data.nodes ?? []).find((n) => n.role === "master");
    root.querySelector("#sub").textContent = master ? [master.name, master.model].filter(Boolean).join(" · ") : "";
    this._tick();
    if (tab === "internet") return this._renderInternet();
    if (tab === "vpn") return this._renderVpn();
    if (tab === "diagnose") return this._renderDiagnose();
    if (tab === "addresses") return this._renderAddresses();
    if (tab === "routes") return this._renderRoutes();
    if (tab === "box") return this._renderBoxPage();
    if (tab === "phone") return this._renderPhone();
    if (tab === "wlan") return this._renderWlan();
    if (tab === "migrate") return this._renderMigrate();
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
    if (event.type === "pointermove") this._pointer = { x: event.clientX, y: event.clientY };
    const vbar = event.target?.closest?.(".vbar");
    if (vbar) return this._onVbar(vbar, event);
    this._hideVbars();
    const plot = event.target?.closest?.(".plot");
    if (!plot) return this._hidePlots();
    const pts = this._chartData(plot, "pts");
    const box = plot.getBoundingClientRect();
    if (pts.length < 2 || !box.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    // a chart drawn by time (the load of the line) is read by time, the others by the number of the point
    let i = Math.round(ratio * (pts.length - 1));
    if (plot.dataset.mode === "time") {
      const first = pts[0][0];
      const wanted = first + ratio * Math.max(pts[pts.length - 1][0] - first, 1);
      i = pts.reduce((best, p, k) => (Math.abs(p[0] - wanted) < Math.abs(pts[best][0] - wanted) ? k : best), 0);
    } else if (plot.dataset.mode === "bars") {
      i = Math.min(pts.length - 1, Math.floor(ratio * pts.length));
    }
    this._showPlotPoint(plot, pts, i, box.width);
  }

  /** The cursor and the tip at point i of a chart; a slider also says it to a screen reader. */
  _showPlotPoint(plot, pts, i, width) {
    let x = (i / (pts.length - 1)) * width;
    if (plot.dataset.mode === "time") {
      const first = pts[0][0];
      x = ((pts[i][0] - first) / Math.max(pts[pts.length - 1][0] - first, 1)) * width;
    } else if (plot.dataset.mode === "bars") {
      x = ((i + 0.5) / pts.length) * width;
    }
    const text = plotText(pts[i], plot.dataset, this._hass?.language);
    const cursor = plot.querySelector(".cursor");
    const tip = plot.querySelector(".tip");
    tip.textContent = text;
    cursor.style.left = `${x}px`;
    cursor.hidden = tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), width - tip.offsetWidth / 2)}px`;
    if (plot.getAttribute?.("role") === "slider") {
      plot.setAttribute("aria-valuemin", "0");
      plot.setAttribute("aria-valuemax", String(pts.length - 1));
      plot.setAttribute("aria-valuenow", String(i));
      plot.setAttribute("aria-valuetext", text);
    }
    plot.dataset.at = String(i);
  }

  /** A chart read with the keyboard: arrows, Home, End and the pages move along its points. */
  _onPlotKey(plot, event) {
    const pts = this._chartData(plot, "pts");
    const width = plot.getBoundingClientRect().width;
    if (event.key === "Escape") {
      this._hidePlots();
      return true;
    }
    if (pts.length < 2 || !width) return false;
    const from = plot.dataset.at === undefined ? pts.length - 1 : Number(plot.dataset.at);
    const to = plotKeyTarget(pts.length, from, event.key);
    if (to === null) return false;
    event.preventDefault();
    this._showPlotPoint(plot, pts, to, width);
    return true;
  }

  /** A chart that gets the focus from the keyboard shows its latest point. */
  _onPlotFocus(event) {
    const plot = event.target;
    if (!plot?.classList?.contains("plot") || plot.matches?.(":focus-visible") === false) return;
    const pts = this._chartData(plot, "pts");
    const width = plot.getBoundingClientRect().width;
    if (pts.length < 2 || !width) return;
    this._showPlotPoint(plot, pts, plot.dataset.at === undefined ? pts.length - 1 : Number(plot.dataset.at), width);
  }

  /** What a tunnel did where the pointer is: its state there and, for a connection, when and how long. */
  _onVbar(bar, event) {
    const box = bar.getBoundingClientRect();
    if (!box.width) return;
    const from = Number(bar.dataset.from);
    const to = Number(bar.dataset.to);
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const moment = from + ratio * (to - from);
    const segment = this._chartData(bar, "segs").find(([a, b]) => moment >= a && moment <= b);
    if (!segment) return;
    const t = this._t.vpnPage;
    const language = this._hass?.language;
    const at = (sec) => new Date(sec * 1000).toLocaleString(language || "en", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const [a, b, state] = segment;
    const lines = [t.tip[state]];
    if (state === "up") lines.push(`${at(a)} – ${b >= to - 60 ? t.now : at(b)}`, fill(t.tip.duration, { time: formatDuration(b - a, this._t.inet.units) }));
    else lines.push(at(moment));
    const tip = bar.querySelector(".tip");
    const cursor = bar.querySelector(".cursor");
    tip.innerHTML = lines.map((line, i) => (i ? escapeHtml(line) : `<b>${escapeHtml(line)}</b>`)).join("<br>");
    const x = ratio * box.width;
    cursor.style.left = `${x}px`;
    cursor.hidden = tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), box.width - tip.offsetWidth / 2)}px`;
  }

  _hideVbars() {
    for (const el of this.shadowRoot.querySelectorAll(".vbar .cursor, .vbar .tip")) el.hidden = true;
  }

  _hidePlots() {
    this._pointer = null;
    this._hideVbars();
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
        traffic: this._state.trafficRange === 365 ? (this._state.trafficYear ?? this._state.traffic) : this._state.traffic,
        trafficRange: this._state.trafficRange,
        portsFilter: this._state.portsFilter,
        clients: this._state.data?.clients ?? [],
      })
    );
  }

  _renderVpn() {
    const state = this._state;
    this._set("vpn-view", renderVpn(state.data, { t: this._t, now: Date.now() / 1000, language: this._hass?.language, vpnRange: state.vpnRange, vpnHistory: state.vpnHistory, canWrite: Boolean(state.data?.can_write), busy: state.vpnBusy }));
  }

  /** Switches a WireGuard connection; the button waits until the box shows the new state. */
  async _switchVpn(key, enabled) {
    const state = this._state;
    state.vpnBusy = new Set([...(state.vpnBusy ?? []), key]);
    this._renderVpn();
    const name = state.data?.vpn?.find((c) => c.key === key)?.name ?? "";
    try {
      await this._ws("vpn/switch", { key, enabled });
      showToast(this.shadowRoot, fill(enabled ? this._t.vpnPage.toastOn : this._t.vpnPage.toastOff, { name }));
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    } finally {
      state.vpnBusy = new Set([...state.vpnBusy].filter((id) => id !== key));
      this._renderVpn();
    }
  }

  _renderDiagnose() {
    const t = this._t;
    this._set(
      "diagnose-view",
      `<div class="phead"><h1 id="dtitle" tabindex="-1">${escapeHtml(t.diag.title)}</h1><p class="lead">${escapeHtml(t.diag.lead)}</p></div>` +
        renderConnection(this._state.check, this._state.latency, { t, language: this._hass?.language, now: Date.now() / 1000 }) +
        `<div class="diagrow">${renderRadio(this._state.data, { t, language: this._hass?.language })}${renderLog(this._state.log, { t, group: this._state.logGroup, kind: this._state.logKind })}</div>` +
        renderCapture(this._state.capture, {
          t,
          language: this._hass?.language,
          canWrite: Boolean(this._state.data?.can_write),
          form: this._state.captureForm,
          detecting: this._state.captureDetecting,
          clients: this._state.data?.clients ?? [],
          summary: this._state.captureSummary,
        })
    );
  }

  _renderAddresses() {
    const root = this.shadowRoot;
    const active = root.activeElement;
    // typing a note or a name: the page is drawn again when the field is left, not under the fingers
    if (active && root.querySelector("#addresses-view")?.contains(active) && active.matches("textarea, [data-aown], #a-bn, #a-br, #a-en, #a-er, #a-eno, #a-pf, #a-pt")) return;
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
      addr.own = normalizeOwn(result.own);
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
    // the notes of a box are only sent once they are read from it
    if (addr.status !== "ready") return;
    try {
      await this._ws("address/save", { own: addr.own });
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** Closes the dialog of the address groups and gives the focus back to its button. */
  _closeGroups() {
    const addr = this._state.addr;
    addr.groupsOpen = false;
    addr.blockMessage = "";
    addr.groupDraft = null;
    this._leaveField();
    this._renderAddresses();
    this.shadowRoot.querySelector('[data-agroups="open"]')?.focus();
  }

  /** Closes the dialog of the manual entry and gives the focus back to the button that opened it. */
  _closeEntry() {
    const addr = this._state.addr;
    addr.entryOpen = false;
    addr.entryMessage = "";
    addr.entryDraft = null;
    this._leaveField();
    this._renderAddresses();
    this.shadowRoot.querySelector('[data-aentry="new"]')?.focus();
  }

  /** The entry form as typed so far, kept so that a redraw does not lose it; the line under the fields follows. */
  _onEntryInput(el) {
    const addr = this._state.addr;
    const data = new FormData(el.closest("form"));
    addr.entryDraft = {
      id: data.get("id") ? Number(data.get("id")) : null,
      kind: data.get("kind") ?? "hold",
      name: String(data.get("name") ?? ""),
      range: String(data.get("range") ?? ""),
      note: String(data.get("note") ?? ""),
    };
    const m = this._addressModel();
    const line = this.shadowRoot.querySelector("#a-eprev");
    if (!m || !line) return;
    const preview = entryPreview(m, addr.own ?? emptyOwn(), addr.entryDraft, this._t.addr);
    line.textContent = preview.text || this._t.addr.entries.rangeHint;
    line.classList.toggle("ok", preview.ok);
  }

  /** The entry form was sent: a new entry or the changes of one. */
  _onEntryForm(form) {
    const addr = this._state.addr;
    const own = addr.own ?? emptyOwn();
    const data = new FormData(form);
    const id = data.get("id") ? Number(data.get("id")) : null;
    const range = parseRange(String(data.get("range") ?? ""));
    const entry = { id, kind: data.get("kind"), ...(range ?? { from: NaN, to: NaN }) };
    const problem = checkEntry(own, entry);
    addr.entryDraft = { id, kind: entry.kind, name: String(data.get("name") ?? ""), range: String(data.get("range") ?? ""), note: String(data.get("note") ?? "") };
    if (problem) {
      addr.entryMessage = fill(this._t.addr.entries[problem.key], problem.values ?? {});
      this._leaveField();
      this._renderAddresses();
      return;
    }
    const saved = { id: id ?? Date.now(), name: String(data.get("name") ?? "").trim(), from: entry.from, to: entry.to, kind: ENTRY_KINDS.includes(entry.kind) ? entry.kind : "hold", note: String(data.get("note") ?? "").trim() };
    own.entries = id ? own.entries.map((x) => (x.id === id ? saved : x)) : [...own.entries, saved];
    addr.own = own;
    this._saveOwn();
    addr.entryOpen = false;
    addr.entryDraft = null;
    addr.entryMessage = "";
    this._leaveField();
    this._update();
    this.shadowRoot.querySelector('[data-aentry="new"]')?.focus();
  }

  /** What is typed in the form of a group, kept so that a redraw does not lose it; the line under the fields follows. */
  _onGroupInput(el) {
    const addr = this._state.addr;
    const form = el.closest("form");
    const data = new FormData(form);
    addr.groupDraft = { id: data.get("id") ? Number(data.get("id")) : null, name: String(data.get("name") ?? ""), range: String(data.get("range") ?? ""), color: data.get("color") ?? BLOCK_COLORS[0] };
    const m = this._addressModel();
    const line = this.shadowRoot.querySelector("#a-bprev");
    if (!m || !line) return;
    const preview = groupPreview(addr.own ?? emptyOwn(), m.baseText, addr.groupDraft, this._t.addr);
    line.textContent = preview.text || this._t.addr.groups.rangeHint;
    line.classList.toggle("ok", preview.ok);
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
    else if (ds.aexport) {
      if (ds.aexport === "scroll") this.shadowRoot.querySelector("#a-export")?.scrollIntoView({ behavior: "smooth", block: "start" });
      else this._exportAddresses(ds.aexport);
      return true;
    }
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
    } else if (ds.agroups === "open") {
      addr.groupsOpen = true;
      addr.blockMessage = "";
      addr.own = own;
      this._renderAddresses();
      this.shadowRoot.querySelector("#a-bn")?.focus();
      return true;
    } else if (ds.agroups === "close") {
      this._closeGroups();
      return true;
    } else if (ds.agroups === "cancel") {
      addr.groupDraft = null;
      addr.blockMessage = "";
      this._renderAddresses();
      return true;
    } else if (ds.agedit) {
      const b = own.blocks.find((x) => String(x.id) === ds.agedit);
      if (b) {
        addr.groupDraft = { id: b.id, name: b.name, range: b.from === b.to ? `.${b.from}` : `.${b.from}-.${b.to}`, color: b.color };
        addr.blockMessage = "";
        this._leaveField();
        this._renderAddresses();
        this.shadowRoot.querySelector("#a-bn")?.focus();
      }
      return true;
    } else if (ds.aentry === "new" || ds.aentry === "edit") {
      const e = ds.aentry === "edit" ? own.entries.find((x) => String(x.id) === ds.aid) : null;
      const at = ds.an !== undefined ? `.${ds.an}` : "";
      addr.entryDraft = e
        ? { id: e.id, kind: e.kind, name: e.name, range: e.from === e.to ? `.${e.from}` : `.${e.from}-.${e.to}`, note: e.note ?? "" }
        : { id: null, kind: "hold", name: "", range: at, note: "" };
      addr.entryOpen = true;
      addr.entryMessage = "";
      addr.own = own;
      this._renderAddresses();
      this.shadowRoot.querySelector("#a-en")?.focus();
      return true;
    } else if (ds.aentry === "close") {
      this._closeEntry();
      return true;
    } else if (ds.aentry === "del") {
      own.entries = own.entries.filter((x) => String(x.id) !== ds.aid);
      this._saveOwn();
    } else if (ds.adel) {
      own.blocks = own.blocks.filter((b) => String(b.id) !== ds.adel);
      this._saveOwn();
    } else return false;
    addr.own = own;
    this._update();
    return true;
  }

  /** The address space as a file or as the sheet; what is asked for is in the options of the card. */
  _exportAddresses(kind) {
    const m = this._addressModel();
    if (!m) return;
    const addr = this._state.addr;
    const own = addr.own ?? emptyOwn();
    const t = this._t;
    const opts = addr.exportOpts;
    const now = new Date();
    if (kind === "print") {
      this._openSheet(printSheet({ m, own, t, language: this._hass?.language, opts, now }));
      return;
    }
    const rows = addressRows(m, own, t, { free: opts.free });
    if (kind === "csv") this._download(fileName(m, "csv", now), "text/csv;charset=utf-8", toCsv(rows, t, { mac: opts.mac }));
    else this._download(fileName(m, "json", now), "application/json", toJson(m, own, rows, { mac: opts.mac, now }));
  }

  _download(name, type, text) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = name;
    this.shadowRoot.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** The sheet in a window of its own, where it can be looked at and printed; from a frame where a window is refused. */
  _openSheet(html) {
    const win = globalThis.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.document.getElementById("print")?.addEventListener("click", () => win.print());
      setTimeout(() => {
        win.focus();
        win.print();
      }, 500);
      return;
    }
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.append(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    setTimeout(() => {
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    }, 500);
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
    const name = String(data.get("name") ?? "").trim();
    const range = parseRange(String(data.get("range") ?? ""));
    const id = data.get("id") ? Number(data.get("id")) : null;
    const block = { name, ...(range ?? { from: NaN, to: NaN }) };
    const problem = checkBlock(own, { ...block, id });
    if (problem) {
      addr.blockMessage = fill(this._t.addr.groups[problem.key], problem.values ?? {});
      addr.groupDraft = { id, name: String(data.get("name") ?? ""), range: String(data.get("range") ?? ""), color: data.get("color") ?? BLOCK_COLORS[0] };
    } else {
      const color = BLOCK_COLORS.includes(data.get("color")) ? data.get("color") : BLOCK_COLORS[0];
      if (id) own.blocks = own.blocks.map((b) => (b.id === id ? { id, ...block, color } : b));
      else own.blocks.push({ id: Date.now(), ...block, color });
      addr.own = own;
      addr.blockMessage = "";
      addr.groupDraft = null;
      this._saveOwn();
    }
    // the form is drawn anew, empty after a group and with the message after a mistake
    this._leaveField();
    this._renderAddresses();
    this.shadowRoot.querySelector("#a-bn")?.focus();
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

  /** Esc closes the menu or the device, the arrows go through the menu and the tab lists, j and k page, / searches. */
  _onKey(event) {
    const root = this.shadowRoot;
    const state = this._state;
    if (root.querySelector("#backdrop")?.classList.contains("open")) return;
    if (event.key === "Escape" && state.addr?.entryOpen) return this._closeEntry();
    if (event.key === "Escape" && state.addr?.groupsOpen) return this._closeGroups();
    const target = event.target;
    if (target?.classList?.contains("plot") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (this._onPlotKey(target, event)) return;
    }
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
    const look = root.querySelector("#lookmenu");
    if (state.look && look?.contains(target)) {
      const items = [...look.querySelectorAll('[role="menuitemradio"]')];
      const at = items.indexOf(target);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
      if (to !== undefined && items.length) {
        event.preventDefault();
        items[(to + items.length) % items.length].focus();
        return;
      }
      if (event.key === "Tab") {
        state.look = false;
        this._update();
        return;
      }
    }
    if (event.key === "Escape") {
      if (state.tab === "phone") this._phoneTip(null);
      if (state.look) {
        event.preventDefault();
        state.look = false;
        this._update();
        root.querySelector("#lookbtn")?.focus();
        return;
      }
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
    if (target.getAttribute?.("role") === "tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const list = target.closest?.('[role="tablist"]');
      const next = list && tabKeyTarget([...list.querySelectorAll('[role="tab"]')], target, event.key);
      if (next) {
        event.preventDefault();
        // the focus moves, Enter or Space opens the page: the bar is drawn anew on a click
        next.focus();
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
    if (el.name === "color" && el.closest("#a-blockform")) return this._onGroupInput(el);
    if (el.name === "kind" && el.closest("#a-entryform")) return this._onEntryInput(el);
    if (el.dataset?.aopt) {
      this._state.addr.exportOpts = { ...this._state.addr.exportOpts, [el.dataset.aopt]: el.checked };
      return this._update();
    }
    if (el.id === "cap-if" || el.id === "cap-sec" || el.id === "cap-mb" || el.id === "cap-dev") {
      const form = this._state.captureForm;
      if (el.id === "cap-if") form.interface = el.value;
      else if (el.id === "cap-dev") {
        form.mac = el.value;
        return this._update();
      }
      else form[el.id === "cap-sec" ? "seconds" : "mb"] = Number(el.value);
      return;
    }
    if (el.id === "sort") {
      this._state.sort = el.value;
      this._state.sortDesc = false;
    } else if (el.id === "pagesize") {
      this._state.pageSize = Number(el.value);
      rememberPageSize(this._state.pageSize);
    } else if (el.id === "group") this._state.group = el.value;
    else if (el.id === "box") return this._switchBox(el.value);
    else if (el.id === "ph-entry") return this._phoneChooseEntry(el.value);
    else if (el.matches("[data-profile]")) return this._deviceAction("filter_profile", el.value, this._t.toastProfile);
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
    } else if (el.id === "a-bn" || el.id === "a-br") {
      this._onGroupInput(el);
    } else if (el.id === "a-en" || el.id === "a-er" || el.id === "a-eno") {
      this._onEntryInput(el);
    } else if (el.id === "r-net" || el.id === "r-gw" || el.id === "r-metric") {
      this._onRouteInput(el);
    } else if (el.id === "ph-q" || el.id === "ph-bq" || el.id === "ph-seek") {
      this._onPhoneInput(el);
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
    if (event.target.id === "a-groups") return this._closeGroups();
    if (event.target.id === "a-entries") return this._closeEntry();
    const target = event.target.closest("button, a[data-act], [data-filter], [data-ap], [data-dev], [data-act], [data-aip]");
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
    } else if (ds.vrange) {
      state.vpnRange = ds.vrange;
      this._renderVpn();
      this.shadowRoot.querySelector(`[data-vrange="${ds.vrange}"]`)?.focus();
      return;
    } else if (ds.trange) {
      state.trafficRange = Number(ds.trange);
      if (state.trafficRange === 365) this._loadTrafficYear();
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
    } else if (ds.act === "look" || ds.act === "look-close") {
      state.look = ds.act === "look" && !state.look;
      this._update();
      this.shadowRoot.querySelector(state.look ? "#lookmenu [aria-checked=true]" : "#lookbtn")?.focus();
      return;
    } else if (ds.look) {
      this._look = { ...this._look, [ds.look]: ds.value };
      rememberLook(this._look);
      this._applyLook();
      this._update();
      this.shadowRoot.querySelector(`#lookmenu [data-look="${ds.look}"][data-value="${ds.value}"]`)?.focus();
      return;
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
    } else if (ds.act === "integration") {
      // the settings of the integration, inside Home Assistant and without loading it again
      event.preventDefault();
      globalThis.history.pushState(null, "", target.getAttribute("href"));
      globalThis.dispatchEvent(new CustomEvent("location-changed", { composed: true }));
      return;
    } else if (ds.logKind) {
      state.logKind = state.logKind === ds.logKind ? null : ds.logKind;
      this._update();
      return;
    } else if (ds.logGroup !== undefined) {
      state.logGroup = ds.logGroup;
      state.logKind = null;
      state.log = null;
      this._update();
      this._loadLog();
      return;
    } else if (ds.act === "vpn-switch") {
      return this._switchVpn(ds.key, ds.on === "1");
    } else if (ds.act === "ports-filter") {
      state.portsFilter = ds.f;
      return this._renderInternet();
    } else if (ds.act === "route-pick") {
      state.routesSel = ds.network;
      return this._renderRoutes();
    } else if (ds.act === "route-new") {
      state.routesDraft = { network: "", gateway: "", metric: "10" };
      this._renderRoutes();
      this.shadowRoot.querySelector("#r-net")?.focus();
      return;
    } else if (ds.act === "route-cancel") {
      state.routesDraft = null;
      return this._renderRoutes();
    } else if (ds.act === "route-add") {
      return this._addRoute();
    } else if (ds.act === "route-delete") {
      return this._deleteRoute(ds.network);
    } else if (ds.act === "route-switch") {
      return this._switchRoute(ds.network, ds.on === "1");
    } else if (ds.act === "latency-switch") {
      return this._switchLatency(ds.on === "1");
    } else if (ds.act === "check-run") {
      return this._runCheck();
    } else if (ds.act?.startsWith("cap-")) {
      return this._onCapture(ds);
    } else if (ds.act === "copy-value") {
      return this._copyValue(ds.value);
    } else if (ds.act === "reconnect" || ds.act === "reboot") {
      return this._interrupt(ds.act);
    } else if (ds.act?.startsWith("box-")) {
      return this._onBoxClick(ds.act);
    } else if (ds.act?.startsWith("wlan-")) {
      return this._onWlanClick(ds);
    } else if (ds.act?.startsWith("mig-")) {
      return this._onMigrateClick(ds);
    } else if (ds.act?.startsWith("ph-")) {
      return this._onPhoneClick(ds);
    } else if (ds.act === "back") {
      this._leaveDevice();
      return;
    } else if (ds.sw) {
      return this._toggle(ds.sw);
    } else if (ds.act === "wol") {
      return this._deviceAction("wake_on_lan", undefined, t.toastWol);
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
      // a tab opens the page of it that was open last, a switch of pages the page itself
      let page = ds.tab;
      if (target.closest("#nav, #bnav")) {
        const offered = pagesOf(ds.tab, state);
        page = offered.includes(state.lastPage[ds.tab]) ? state.lastPage[ds.tab] : (offered[0] ?? ds.tab);
      }
      globalThis.location.hash = pageHash(page);
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
    const state = this._state;
    const a = t.boxPage.actions;
    const ok = await openDialog(this.shadowRoot, t, {
      title: a[`${kind}Title`],
      body: a[`${kind}Body`],
      list: kind === "reboot" ? a.rebootList : null,
      ok: a[`${kind}Ok`],
      danger: true,
    });
    if (!ok) return;
    const before = state.data?.internet?.external_ipv4 ?? null;
    try {
      await this._ws(kind === "reconnect" ? "internet/reconnect" : "box/reboot");
      if (kind === "reconnect") state.boxReconnect = { before, at: Date.now() };
      else {
        state.boxReconnect = null;
        state.boxRestart = { phase: "down", requestedAt: Date.now(), unreachableAt: null, backAt: null };
        this._pollRestart();
      }
      showToast(this.shadowRoot, a[kind === "reconnect" ? "toastReconnect" : "toastReboot"]);
      this._update();
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** What box/info tells about the box; while it restarts the questions of the restart keep it fresh. */
  async _loadBox() {
    const state = this._state;
    if (state.boxRestart?.phase === "down") return;
    if (state.box === "failed") state.box = null;
    this._update();
    try {
      state.box = await this._ws("box/info");
    } catch {
      state.box = "failed";
    }
    this._update();
  }

  _renderBoxPage() {
    const state = this._state;
    this._set(
      "box-view",
      renderBoxPage(state.box, {
        t: this._t,
        language: this._hass?.language,
        now: Date.now(),
        internet: state.data?.internet ?? null,
        restart: state.boxRestart,
        reconnect: state.boxReconnect,
      })
    );
  }

  /** During a restart: asks the box every few seconds until it answers as restarted, or gives up after ten minutes. */
  _pollRestart() {
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(async () => {
      const state = this._state;
      const restart = state.boxRestart;
      if (restart?.phase !== "down") return;
      let info = null;
      try {
        info = await this._ws("box/info");
      } catch {
        info = null;
      }
      if (state.boxRestart !== restart) return; // another box was chosen or the band was hidden meanwhile
      const next = nextRestart(restart, info, Date.now());
      state.boxRestart = next;
      if (info) state.box = info;
      if (next.phase === "back") showToast(this.shadowRoot, fill(this._t.boxPage.restart.back, { time: minSec(next.backAt - next.requestedAt) }));
      this._update();
      if (next.phase === "down") this._pollRestart();
    }, RESTART_POLL_MS);
  }

  async _onBoxClick(act) {
    const state = this._state;
    if (act === "box-retry") {
      state.box = null;
      return this._loadBox();
    }
    if (act === "box-restart-clear") state.boxRestart = null;
    else if (act === "box-reconnect-clear") state.boxReconnect = null;
    else if (act === "box-check" && state.boxRestart) {
      const restart = state.boxRestart;
      let info = null;
      try {
        info = await this._ws("box/info");
      } catch {
        info = null;
      }
      if (info && restarted(info, restart, Date.now())) {
        state.box = info;
        state.boxRestart = { ...restart, phase: "back", backAt: Date.now() };
        showToast(this.shadowRoot, fill(this._t.boxPage.restart.back, { time: minSec(state.boxRestart.backAt - restart.requestedAt) }));
      } else showToast(this.shadowRoot, this._t.boxPage.restart.late);
    }
    this._update();
    this.shadowRoot.querySelector("#dtitle")?.focus({ preventScroll: true });
  }

  /** The radio networks of the box, read when the page opens. */
  async _loadWlan() {
    const state = this._state;
    state.wlanError = "";
    if (state.wlan === "failed") state.wlan = null;
    this._update();
    try {
      state.wlan = await this._ws("wlan/list");
    } catch (err) {
      state.wlan = "failed";
      state.wlanError = err?.message ?? "";
    }
    this._update();
  }

  _renderWlan() {
    const state = this._state;
    this._set("wlan-view", renderWlan(state.wlan, { t: this._t, busy: state.wlanBusy, secret: state.wlanSecret, reveal: state.wlanReveal, error: state.wlanError, clients: state.data?.clients ?? [] }));
  }

  /** Forgets the guest password and draws the page without it, so that it is not kept in the page either. */
  _dropSecret() {
    clearTimeout(this._secretTimer);
    const state = this._state;
    if (state.wlanSecret === null && !state.wlanReveal) return;
    state.wlanSecret = null;
    state.wlanReveal = false;
    this._renderWlan();
  }

  /** Switches a network or the guest access; switching a main network off asks first, the last one says what is lost. */
  async _switchWlan(key, enabled) {
    const t = this._t;
    const w = t.wlan;
    const state = this._state;
    const wlan = state.wlan;
    if (!wlan || typeof wlan !== "object") return;
    const net = key === "guest" ? wlan.guest : (wlan.networks ?? []).find((n) => n.key === key);
    if (!net) return;
    const ssid = net.ssid || (key === "guest" ? w.guest.name : w.noName);
    const name = key === "guest" ? ssid : `${ssid} (${fill(w.band, { band: net.band })})`;
    if (!enabled && key !== "guest") {
      const last = isLastNetwork(wlan, key);
      const ok = await openDialog(this.shadowRoot, t, {
        title: fill(w.offTitle, { ssid, band: net.band }),
        body: last ? w.offLastBody : w.offBody,
        list: last ? w.offLast : null,
        ok: w.offOk,
        danger: true,
      });
      if (!ok) return;
    }
    state.wlanBusy = new Set([...state.wlanBusy, key]);
    this._renderWlan();
    try {
      state.wlan = await this._ws("wlan/switch", { key, enabled });
      if (key === "guest" && !enabled) this._dropSecret();
      showToast(this.shadowRoot, fill(enabled ? w.toastOn : w.toastOff, { name }));
    } catch (err) {
      showToast(this.shadowRoot, fill(t.toastFailed, { error: err?.message ?? err }));
    } finally {
      state.wlanBusy = new Set([...state.wlanBusy].filter((k) => k !== key));
      this._renderWlan();
      // the switch was locked while the box switched: the focus goes back to it
      const active = this.shadowRoot.activeElement;
      if (!active || active === this) this.shadowRoot.querySelector(`[data-k="wl-${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    }
  }

  /** The guest password with its QR code, on request only, and forgotten after five minutes at the latest. */
  async _loadSecret() {
    const state = this._state;
    state.wlanSecret = "loading";
    this._renderWlan();
    try {
      const secret = await this._ws("wlan/guest/secret");
      if (state.wlanSecret !== "loading" || state.tab !== "wlan") return;
      state.wlanSecret = secret;
      state.wlanReveal = false;
      clearTimeout(this._secretTimer);
      this._secretTimer = setTimeout(() => this._dropSecret(), 300000);
    } catch (err) {
      if (state.wlanSecret === "loading") state.wlanSecret = null;
      const text = err?.code === "unauthorized" ? this._t.wlan.guest.qrLocked : fill(this._t.toastFailed, { error: err?.message ?? err });
      showToast(this.shadowRoot, text);
    }
    this._renderWlan();
    this.shadowRoot.querySelector('[data-k="wlan-reveal"], [data-k="wlan-hideqr"], [data-k="wlan-qr"]')?.focus({ preventScroll: true });
  }

  async _onWlanClick(ds) {
    const state = this._state;
    const act = ds.act;
    if (act === "wlan-retry") return this._loadWlan();
    if (act === "wlan-switch") return this._switchWlan(ds.key, ds.on === "1");
    if (act === "wlan-qr") return this._loadSecret();
    if (act === "wlan-hideqr") {
      this._dropSecret();
      this.shadowRoot.querySelector('[data-k="wlan-qr"]')?.focus({ preventScroll: true });
      return;
    }
    if (act === "wlan-reveal") {
      if (!state.wlanSecret?.password) return;
      state.wlanReveal = !state.wlanReveal;
      return this._renderWlan();
    }
    if (act === "wlan-copy") {
      const password = state.wlanSecret?.password;
      if (!password) return;
      try {
        await globalThis.navigator.clipboard.writeText(password);
        showToast(this.shadowRoot, this._t.wlan.guest.copied);
      } catch (err) {
        showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
      }
      return;
    }
    if (act === "wlan-pw") return this._changeGuestPassword();
  }

  /** Puts a value (an address) on the clipboard and says so. */
  async _copyValue(value) {
    if (!value) return;
    try {
      await globalThis.navigator.clipboard.writeText(value);
      showToast(this.shadowRoot, fill(this._t.inet.copied, { value }));
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
  }

  /** The dialog for a new guest password; the password goes to the box and is forgotten right after. */
  async _changeGuestPassword() {
    const t = this._t;
    const p = t.wlan.pw;
    const ssid = this._state.wlan?.guest?.ssid || t.wlan.guest.name;
    const ok = await openPasswordDialog(this.shadowRoot, t, {
      title: p.title,
      lead: fill(p.lead, { ssid }),
      warn: p.kick,
      rules: passwordRules,
      generate: () => randomPassword(),
      submit: async (password) => {
        await this._ws("wlan/guest/password", { password });
      },
    });
    if (!ok) return;
    // the old QR code no longer works
    this._dropSecret();
    showToast(this.shadowRoot, p.done);
  }

  /** Whether FRITZ!Box Tools is set up for this box, and what switching over would take over; only reads. */
  async _loadMigrate({ quiet = false } = {}) {
    const state = this._state;
    if (!quiet) {
      state.migrate = null;
      this._update();
    }
    try {
      state.migrate = await this._ws("migrate/scan");
    } catch {
      // a failure on the way is no reason for a note; on the page it says so
      state.migrate = quiet ? null : "failed";
    }
    state.migrateHidden = hasCore(state.migrate) && bannerHidden(state.migrate.core.entry_id);
    this._update();
  }

  _renderMigrate() {
    this._set("migrate-view", renderMigrate(this._state.migrate, { t: this._t, filter: this._state.migrateFilter }));
  }

  _onMigrateClick(ds) {
    const state = this._state;
    if (ds.act === "mig-open") {
      globalThis.location.hash = "#/migrate";
      return;
    }
    if (ds.act === "mig-later") {
      if (hasCore(state.migrate)) hideBanner(state.migrate.core.entry_id);
      state.migrateHidden = true;
      showToast(this.shadowRoot, this._t.migrate.banner.toastLater);
      this._update();
      this.shadowRoot.querySelector("#dtitle, #q")?.focus({ preventScroll: true });
      return;
    }
    if (ds.act === "mig-rescan") return this._loadMigrate();
    if (ds.act === "mig-filter") {
      state.migrateFilter = ds.f;
      this._renderMigrate();
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

  async _toggle(kind) {
    const t = this._t;
    const client = this._selected();
    if (!client) return;
    const turnOff = kind === "internet_access" ? !isBlocked(client) : Boolean(client.priority);
    const done =
      kind === "internet_access"
        ? fill(turnOff ? t.toastBlocked : t.toastAllowed, { name: client.name })
        : turnOff
          ? t.toastPriorityOff
          : t.toastPriorityOn;
    await this._deviceAction(kind, !turnOff, done);
  }

  /** Changes the open device at the box itself; a refusal shows as a toast with what the box says. */
  async _deviceAction(action, value, success) {
    const client = this._selected();
    if (!client) return;
    try {
      await this._ws("device/action", { mac: client.mac, action, ...(value === undefined ? {} : { value }) });
      showToast(this.shadowRoot, success);
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.toastFailed, { error: err?.message ?? err }));
    }
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

  // ---------- the phone page (Box › Phone, from FRITZ!Box Telefon) ----------

  /** A call that is going on is shown at the top of every page but the phone page, which has its own band. */
  _renderCallBar(ready) {
    const state = this._state;
    const show = ready && state.tab !== "phone" && state.phoneFound && this._phone?.monitor;
    const band = show ? liveBand(this._phone, { t: this._t, language: this._hass?.language, now: new Date(), ui: state.phone }) : "";
    this._set("callbar", band ? `<div class="callbar">${band}</div>` : "");
  }

  /** What the tabs show of the phone: whether it is there, rings, has new messages. */
  _phoneSignature() {
    const state = this._state;
    return `${state.phoneFound}|${state.phoneUnread}|${state.phoneRinging}|${state.phoneLive}`;
  }

  /**
   * Reads what FRITZ!Box Telefon has into the model of the page: the answers of its commands, or
   * its entities with an older version; only when one of the entities, the registries, the
   * answers or the chosen entry changed. Returns whether anything changed.
   */
  _readPhone() {
    const hass = this._hass;
    if (!hass) return false;
    const ui = this._state.phone;
    const key = [hass.entities, hass.devices, hass.config, this._entryId, ui.chosen, this._phoneApi, this._phoneWs];
    const ids = this._phoneIds ?? [];
    if (this._phoneKey && key.every((v, i) => v === this._phoneKey[i]) && ids.every((id, i) => hass.states?.[id] === this._phoneRefs[i])) return false;
    const model = readPhoneModel(hass, this._entryId, { api: this._phoneApi, legacy: this._phoneLegacy, ws: this._phoneWs, chosen: ui.chosen, cache: ui.cache });
    this._phone = model;
    this._phoneKey = key;
    this._phoneIds = model.entry ? Object.values(model.entry.entities).flat().filter(Boolean) : [];
    this._phoneRefs = this._phoneIds.map((id) => hass.states?.[id]);
    const state = this._state;
    state.phoneFound = model.found;
    state.phoneUnread = model.found ? model.unread : 0;
    state.phoneRinging = Boolean(model.found && model.ringing);
    const m = model.found ? model.monitor : null;
    state.phoneLive = m && m.state !== "idle" ? [m.state, m.from, m.fromName, m.with, m.withName, m.to, m.toName].join("~") : "";
    return true;
  }

  /** Draws again after new answers: the tabs where the badge or the dot changed, else the page. */
  _phoneRefresh() {
    const before = this._phoneSignature();
    this._phoneKey = null;
    this._readPhone();
    if (this._phoneSignature() !== before) this._update();
    else if (this._state.tab === "phone") this._renderPhone();
  }

  /**
   * Asks fritzbox_phone/entries whether FRITZ!Box Telefon has the commands. unknown_command: an
   * older version, the page reads its entities and says so in one muted line. Another refusal:
   * the entities for now, asked again a minute later.
   */
  async _phoneDetect(key) {
    this._phoneDetecting = true;
    this._phoneDetectKey = key;
    try {
      const result = await this._hass.callWS({ type: `${PHONE_DOMAIN}/entries` });
      this._phoneWs = { ...this._phoneWs, entries: parseWsEntries(result) };
      this._phoneApi = "ws";
      this._phoneLegacy = false;
    } catch (err) {
      this._phoneApi = "entities";
      this._phoneLegacy = wsCode(err) === "unknown_command";
      if (!this._phoneLegacy) {
        this._phoneDetectKey = null;
        this._phoneRetryAt = Date.now() + 60000;
      }
    } finally {
      this._phoneDetecting = false;
    }
    this._phoneRefresh();
    this._phoneSync({ parts: WS_PARTS });
  }

  /**
   * Keeps the answers of the commands up to date while the page is open: all parts when the entry
   * is new, calls, answering machines and phone books when fritzbox_phone has new data (its
   * entities changed), the statistics for the view and period shown, and the parts asked for.
   */
  _phoneSync({ parts = null } = {}) {
    const hass = this._hass;
    if (!hass || !phoneLoaded(hass)) return;
    const key = [hass.config, hass.devices];
    const stale = !this._phoneDetectKey || key.some((v, i) => v !== this._phoneDetectKey[i]);
    if (this._phoneApi === null || (stale && Date.now() >= (this._phoneRetryAt ?? 0))) {
      if (!this._phoneDetecting) this._phoneDetect(key);
      return;
    }
    if (this._phoneApi !== "ws" || this._state.tab !== "phone") return;
    const entry = this._phone?.entry;
    if (!entry || entry.loaded === false) return;
    const ui = this._state.phone;
    const data = this._phoneWs.data;
    const want = new Set(parts ?? []);
    if (!data || data.entryId !== entry.entryId) for (const part of WS_PARTS) want.add(part);
    const trigger = phoneTrigger(hass, entry);
    const before = this._phoneTriggerRefs;
    if (before && (trigger.length !== before.length || trigger.some((st, i) => st !== before[i]))) for (const part of ["calls", "tams", "phonebooks"]) want.add(part);
    this._phoneTriggerRefs = trigger;
    const periods = this._phone.historyDays > 0 ? HISTORY_PERIODS : PERIODS;
    const days = PERIOD_DAYS[periods.includes(ui.period) ? ui.period : "7"];
    if (ui.view === "stats" && (want.has("calls") || data?.stats?.days !== days || data?.entryId !== entry.entryId)) want.add("stats");
    if (want.size) this._phoneFetch(entry.entryId, want, days);
  }

  /** One round of commands; a round asked for meanwhile follows once this one is in. */
  async _phoneFetch(entryId, parts, days) {
    if (this._phoneFetching) {
      const pending = this._phonePending;
      this._phonePending = { entryId, days, parts: new Set([...(pending?.entryId === entryId ? pending.parts : []), ...parts]) };
      return;
    }
    this._phoneFetching = true;
    try {
      const got = await fetchPhoneWs((msg) => this._hass.callWS(msg), entryId, { parts, days });
      const old = this._phoneWs.data?.entryId === entryId ? this._phoneWs.data : { entryId };
      this._phoneWs = { ...this._phoneWs, data: { ...old, ...got, at: Date.now() } };
      // the entry is gone or no longer loaded: ask again which entries there are, in a while
      if (Object.values(got).some((part) => part?.code === "not_found")) {
        this._phoneDetectKey = null;
        this._phoneRetryAt = Date.now() + 30000;
      }
    } finally {
      this._phoneFetching = false;
    }
    this._phoneRefresh();
    const next = this._phonePending;
    this._phonePending = null;
    if (next) await this._phoneFetch(next.entryId, next.parts, next.days);
  }

  _renderPhone() {
    this._readPhone();
    const view = this.shadowRoot.querySelector("#phone-view");
    const width = view?.clientWidth || this._phoneWidth || 640;
    this._phoneWidth = width;
    this._set("phone-view", renderPhone(this._phone, { t: this._t, language: this._hass?.language, now: new Date(), ui: this._state.phone, width }));
  }

  /** The charts are drawn as wide as the page: again when it changed noticeably. */
  _phoneResized() {
    const state = this._state;
    if (state.tab !== "phone" || state.phone.view !== "stats") return;
    const width = this.shadowRoot.querySelector("#phone-view")?.clientWidth;
    if (width && Math.abs(width - (this._phoneWidth ?? 0)) > 8) this._renderPhone();
  }

  /** The tooltip of a column or cell of the statistics, for the mouse and the focus; null hides it. */
  _phoneTip(event) {
    if (this._state.tab !== "phone") return;
    const root = this.shadowRoot;
    for (const tip of root.querySelectorAll(".ph-tip")) tip.hidden = true;
    const g = event?.target?.closest?.("[data-tip]");
    const wrap = g?.closest?.(".ph-vwrap");
    const tip = wrap?.querySelector(".ph-tip");
    if (!tip) return;
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    const r = g.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(0, r.left - w.left + r.width / 2 - tip.offsetWidth / 2), Math.max(0, w.width - tip.offsetWidth))}px`;
    tip.style.top = `${Math.max(0, r.top - w.top - tip.offsetHeight - 6)}px`;
  }

  /** Service calls of FRITZ!Box Telefon always go to the device of the entry shown (several boxes need it). */
  _phoneTarget() {
    const device = this._phone?.entry?.deviceId;
    return device ? { device_id: device } : undefined;
  }

  /**
   * One service of FRITZ!Box Telefon. A refusal shows as a toast with what Home Assistant says; one
   * of the box itself (box_request_failed) also as a note at the top. Returns the answer, or
   * undefined after a failure.
   */
  async _phoneService(service, data, { target = this._phoneTarget(), response = false } = {}) {
    try {
      const result = await this._hass.callService(PHONE_DOMAIN, service, data, target || undefined, false, response);
      return result ?? true;
    } catch (err) {
      const message = err?.message ?? String(err);
      if (err?.translation_key === "box_request_failed" || /box_request_failed/.test(message)) {
        this._state.phone.rights = message;
        this._renderPhone();
      }
      showToast(this.shadowRoot, fill(this._t.phone.failed, { error: message }));
      return undefined;
    }
  }

  _phoneFocus(k) {
    this.shadowRoot.querySelector(`[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  }

  _phoneClearTimers() {
    clearTimeout(this._phoneDialTimer);
    for (const timer of (this._phoneRevealTimers ?? new Map()).values()) clearTimeout(timer);
    this._phoneRevealTimers = new Map();
  }

  /** In privacy mode a tapped row shows for 15 seconds, then folds and hides again. */
  _phoneReveal(key) {
    const ui = this._state.phone;
    this._phoneRevealTimers ??= new Map();
    clearTimeout(this._phoneRevealTimers.get(key));
    ui.revealed.add(key);
    ui.expanded.add(key);
    this._phoneRevealTimers.set(
      key,
      setTimeout(() => {
        ui.revealed.delete(key);
        ui.expanded.delete(key);
        this._phoneRevealTimers.delete(key);
        if (this._state.tab === "phone") this._renderPhone();
      }, REVEAL_MS)
    );
    this._renderPhone();
    this._phoneFocus(`ph-r-${key}`);
  }

  _phoneChooseEntry(key) {
    this._phoneStop();
    const ui = this._state.phone;
    Object.assign(ui, { chosen: key, expanded: new Set(), revealed: new Set(), book: null, rights: "", dial: null });
    this._readPhone();
    this._update();
    this._phoneSync();
  }

  _onPhoneInput(el) {
    const ui = this._state.phone;
    if (el.id === "ph-seek") {
      const audio = this._phoneAudio;
      if (audio && ui.play) audio.currentTime = Number(el.value);
      return;
    }
    if (el.id === "ph-q") ui.query = el.value;
    else ui.bookQuery = el.value;
    this._renderPhone();
    const box = this.shadowRoot.querySelector(`#${el.id}`);
    box?.focus({ preventScroll: true });
    box?.setSelectionRange?.(el.value.length, el.value.length);
  }

  _phoneMessage(entityId, index) {
    const tam = this._phone?.tams?.find((x) => x.entityId === entityId);
    const msg = tam?.messages.find((m) => m.index === Number(index));
    return tam && msg ? { tam, msg } : null;
  }

  /** The data that names a message for the services: the key makes them refuse a renumbered one. */
  _phoneMessageData(tam, msg, extra = {}) {
    return { entity_id: tam.entityId, message_index: msg.index, ...(msg.key ? { message_key: msg.key } : {}), ...extra };
  }

  async _onPhoneClick(ds) {
    const state = this._state;
    const ui = state.phone;
    const model = this._phone;
    const act = ds.act;
    const redraw = (k) => {
      this._renderPhone();
      if (k) this._phoneFocus(k);
    };
    if (act === "ph-view") {
      ui.view = ds.phVal === "stats" ? "stats" : "list";
      redraw(`ph-v-${ui.view}`);
      return this._phoneSync();
    }
    if (act === "ph-period") {
      ui.period = ds.phVal;
      redraw(`ph-per-${ds.phVal}`);
      this._phoneSync();
      showToast(this.shadowRoot, fill(this._t.phone.stats.changed, { period: this._t.phone.stats.period[ds.phVal] ?? ds.phVal }));
      return;
    }
    if (act === "ph-table") {
      ui.tables = { ...ui.tables, [ds.phVal]: !ui.tables[ds.phVal] };
      return redraw(`ph-tb-${ds.phVal}`);
    }
    if (act === "ph-filter") {
      ui.filter = ds.phVal;
      return redraw(`ph-f-${ds.phVal}`);
    }
    if (act === "ph-reset") {
      ui.filter = "all";
      ui.query = "";
      return redraw("ph-f-all");
    }
    if (act === "ph-bookopen") {
      ui.bookOpen = !ui.bookOpen;
      return redraw("ph-bookopen");
    }
    if (act === "ph-bookfilter") {
      ui.bookFilter = ds.phVal;
      return redraw(`ph-bf-${ds.phVal}`);
    }
    if (act === "ph-newcontact") return this._phoneContact("");
    if (act === "ph-book") {
      ui.book = ds.phEnt;
      return redraw(`ph-b-${ds.phEnt}`);
    }
    if (act === "ph-row" || act === "ph-open") {
      const key = ds.phKey;
      if (model?.privacy && !ui.revealed.has(key)) return this._phoneReveal(key);
      if (ui.expanded.has(key)) ui.expanded.delete(key);
      else ui.expanded.add(key);
      return redraw(`ph-r-${key}`);
    }
    if (!model?.found) return;
    if (act === "ph-dial") return this._phoneDial(ds.phNum ?? "", ds.phName ?? "");
    if (act === "ph-hangup") return this._phoneHangup();
    if (act === "ph-block") return this._phoneBlock(ds.phNum, ds.phName ?? "");
    if (act === "ph-unblock") return this._phoneUnblock(ds.phNum);
    if (act === "ph-contact") return this._phoneContact(ds.phNum, ds.phName ?? "");
    if (act === "ph-lookup") return this._phoneLookup(ds.phNum);
    if (act === "ph-play") return this._phonePlay(ds.phEnt, ds.phIdx);
    if (act === "ph-speaker") return this._phoneSpeaker(ds.phEnt, ds.phIdx);
    if (act === "ph-download") return this._phoneDownload(ds.phEnt, ds.phIdx);
    if (act === "ph-mark") return this._phoneMark(ds.phEnt, ds.phIdx);
    if (act === "ph-delete") return this._phoneDelete(ds.phEnt, ds.phIdx);
    if (act === "ph-tamsw") return this._phoneTamSwitch(ds.phEnt, ds.phVal === "1", ds.phName ?? "");
    if (act === "ph-jump") {
      const tam = model.tams.find((x) => x.tamIndex === Number(ds.phTam));
      if (!tam) return;
      const key = `m:${tam.entityId}:${Number(ds.phIdx)}`;
      ui.view = "list";
      ui.expanded.add(key);
      redraw(`ph-r-${key}`);
      this.shadowRoot.querySelector(`#ph-msg-${CSS.escape(String(tam.tamIndex))}-${CSS.escape(String(ds.phIdx))}`)?.scrollIntoView?.({ block: "center" });
    }
  }

  /** The dial dialog: a number or a name from the phone books, checked like the service checks it. */
  async _phoneDial(number = "", name = "") {
    const t = this._t;
    const d = t.phone.dial;
    const model = this._phone;
    let picked = name;
    const value = await openFormDialog(this.shadowRoot, t, {
      title: d.title,
      html: `<label class="field"><span class="label">${escapeHtml(d.field)}</span><input id="ph-dial-in" type="text" value="${escapeHtml(number)}" inputmode="tel" autocomplete="off" aria-describedby="ph-dial-help" aria-controls="ph-dial-sugg"></label>
        <div id="ph-dial-sugg"></div>
        <p class="hint" id="ph-dial-help">${escapeHtml(d.help)}</p>`,
      ok: d.ok,
      focus: "#ph-dial-in",
      onOpen: (dialog) => {
        const input = dialog.querySelector("#ph-dial-in");
        const sugg = dialog.querySelector("#ph-dial-sugg");
        input.oninput = () => {
          picked = "";
          sugg.innerHTML = dialSuggestions(model?.contacts ?? [], input.value, model?.privacy, t);
          dialog.querySelector("#dlg-msg").textContent = "";
        };
        sugg.onclick = (event) => {
          const button = event.target?.closest?.("[data-pick]");
          if (!button) return;
          input.value = button.dataset.pick;
          picked = button.dataset.pname ?? "";
          sugg.innerHTML = "";
          input.focus();
        };
      },
      validate: (dialog) => (dialable(dialog.querySelector("#ph-dial-in").value) ? null : d.invalid),
      read: (dialog) => dialog.querySelector("#ph-dial-in").value.trim(),
    });
    if (value === null) return;
    if ((await this._phoneService("dial", { number: value })) === undefined) return;
    const ui = this._state.phone;
    ui.dial = { number: value, name: picked, at: Date.now() };
    clearTimeout(this._phoneDialTimer);
    this._phoneDialTimer = setTimeout(() => {
      ui.dial = null;
      if (this._state.tab === "phone") this._renderPhone();
    }, 90000);
    showToast(this.shadowRoot, d.started);
    this._renderPhone();
  }

  /** hangup only cancels dialling started with dial, never a call in progress. */
  async _phoneHangup() {
    if ((await this._phoneService("hangup", {})) === undefined) return;
    this._state.phone.dial = null;
    clearTimeout(this._phoneDialTimer);
    showToast(this.shadowRoot, this._t.phone.dial.cancelled);
    this._renderPhone();
  }

  async _phoneBlock(number, name = "") {
    const t = this._t;
    const b = t.phone.block;
    if (!number) return;
    const label = await openFormDialog(this.shadowRoot, t, {
      title: b.title,
      html: `<p>${escapeHtml(fill(b.body, { number }))}</p>
        <label class="field"><span class="label">${escapeHtml(b.name)}</span><input id="ph-blk-name" type="text" maxlength="64" value="${escapeHtml(name.slice(0, 64))}" placeholder="${escapeHtml(b.placeholder)}"></label>
        <ul>${b.list.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`,
      ok: b.ok,
      danger: true,
      read: (dialog) => dialog.querySelector("#ph-blk-name").value.trim().slice(0, 64),
    });
    if (label === null) return;
    if ((await this._phoneService("block_number", { number, ...(label ? { name: label } : {}) })) === undefined) return;
    const ui = this._state.phone;
    ui.blocked.add(number);
    this._renderPhone();
    this._phoneSync({ parts: ["blocklist"] });
    showToast(this.shadowRoot, fill(b.done, { number }), {
      label: b.undo,
      run: async () => {
        if ((await this._phoneService("unblock_number", { number })) === undefined) return;
        ui.blocked.delete(number);
        this._renderPhone();
        this._phoneSync({ parts: ["blocklist"] });
        showToast(this.shadowRoot, fill(b.undone, { number }));
      },
    });
  }

  /** Releases a number of the box's block list, after asking; the list is read again from the box. */
  async _phoneUnblock(number) {
    const t = this._t;
    const b = t.phone.block;
    if (!number) return;
    const shown = this._phone?.privacy ? "•••" : number;
    const ok = await openDialog(this.shadowRoot, t, { title: b.unblockTitle, body: fill(b.unblockBody, { number: shown }), ok: b.unblockOk });
    if (!ok) return;
    if ((await this._phoneService("unblock_number", { number })) === undefined) return;
    this._state.phone.blocked.delete(number);
    this._renderPhone();
    this._phoneSync({ parts: ["blocklist"] });
    showToast(this.shadowRoot, fill(b.undone, { number: shown }));
  }

  /**
   * add_contact with the id of a phone book as fritzbox_phone reports it (command phonebooks, or
   * the attribute phonebook_id); with several the dialog offers the choice. An older version tells
   * no ids: then the first one (id 0), and the dialog says so.
   */
  async _phoneContact(number, suggestion = "") {
    const t = this._t;
    const c = t.phone.contact;
    // without a number (the button of the phone book) the dialog asks for it
    const ask = !number;
    const all = this._phone?.books ?? [];
    const books = all.filter((b) => Number.isInteger(b.phonebookId));
    const bookName = all.length === 1 ? fill(c.bookName, { name: all[0].name }) : "";
    const bookHtml =
      books.length > 1
        ? `<label class="field"><span class="label">${escapeHtml(c.bookField)}</span><select id="ph-ct-book">${books.map((b) => `<option value="${b.phonebookId}">${escapeHtml(b.name)}</option>`).join("")}</select></label>`
        : books.length === 1
          ? `<p class="hint">${escapeHtml(fill(c.bookIn, { name: books[0].name }))}</p>`
          : `<p class="hint">${escapeHtml(fill(c.book, { name: bookName }))}</p>`;
    const pickBook = (dialog) => {
      if (books.length > 1) {
        const id = Number(dialog.querySelector("#ph-ct-book").value);
        return books.some((b) => b.phonebookId === id) ? id : books[0].phonebookId;
      }
      return books.length === 1 ? books[0].phonebookId : 0;
    };
    // a number from a call can also go to a contact that is already there (needs the action of fritzbox_phone)
    const canAdd = !ask && !this._phone?.privacy && Boolean(this._hass?.services?.[PHONE_DOMAIN]?.add_number_to_contact);
    const existing = canAdd
      ? all.flatMap((b) => (Number.isInteger(b.phonebookId) ? b.contacts.filter((x) => x.uniqueid).map((x) => ({ book: b.phonebookId, id: x.uniqueid, name: x.name })) : []))
      : [];
    const joinHtml = existing.length
      ? `<label class="field"><span class="label">${escapeHtml(c.mode)}</span><select id="ph-ct-mode"><option value="new">${escapeHtml(c.modeNew)}</option><option value="add">${escapeHtml(c.modeAdd)}</option></select></label>
        <div id="ph-ct-join" hidden>
          <label class="field"><span class="label">${escapeHtml(c.contact)}</span><select id="ph-ct-who">${existing.map((x) => `<option value="${escapeHtml(`${x.book}:${x.id}`)}">${escapeHtml(x.name || "?")}</option>`).join("")}</select></label>
          <label class="field"><span class="label">${escapeHtml(c.kind)}</span><select id="ph-ct-kind">${["home", "mobile", "work", "other"].map((k) => `<option value="${k}">${escapeHtml(c.kinds[k])}</option>`).join("")}</select></label>
        </div>`
      : "";
    const joining = (dialog) => dialog.querySelector("#ph-ct-mode")?.value === "add";
    const answer = await openFormDialog(this.shadowRoot, t, {
      title: c.title,
      onOpen: (dialog) => {
        const mode = dialog.querySelector("#ph-ct-mode");
        if (!mode) return;
        mode.onchange = () => {
          const add = joining(dialog);
          dialog.querySelector("#ph-ct-join").hidden = !add;
          dialog.querySelector("#ph-ct-new").hidden = add;
        };
      },
      html: `${ask ? `<label class="field"><span class="label">${escapeHtml(c.numberField)}</span><input id="ph-ct-num" type="tel" maxlength="40" inputmode="tel" autocomplete="off"></label>` : `<p class="mono">${escapeHtml(fill(c.number, { number }))}</p>`}
        ${joinHtml}
        <div id="ph-ct-new"><label class="field"><span class="label">${escapeHtml(c.name)}</span><input id="ph-ct-name" type="text" maxlength="64" value="${escapeHtml(suggestion.slice(0, 64))}"></label>
        ${suggestion ? `<p class="hint">${escapeHtml(c.suggestion)}</p>` : ""}
        ${bookHtml}</div>`,
      ok: c.ok,
      focus: ask ? "#ph-ct-num" : "#ph-ct-name",
      validate: (dialog) => {
        if (joining(dialog)) return null;
        if (ask && !dialable(dialog.querySelector("#ph-ct-num").value.trim())) return c.noNumber;
        return dialog.querySelector("#ph-ct-name").value.trim() ? null : c.noName;
      },
      read: (dialog) => (joining(dialog)
        ? { join: dialog.querySelector("#ph-ct-who").value, kind: dialog.querySelector("#ph-ct-kind").value, number }
        : { name: dialog.querySelector("#ph-ct-name").value.trim().slice(0, 64), book: pickBook(dialog), number: ask ? dialog.querySelector("#ph-ct-num").value.trim() : number }),
    });
    if (answer === null) return;
    if (answer.join) {
      const [bookId, contactId] = answer.join.split(":");
      const who = existing.find((x) => `${x.book}:${x.id}` === answer.join)?.name ?? "";
      if ((await this._phoneService("add_number_to_contact", { number, contact_id: contactId, number_type: answer.kind, phonebook_id: Number(bookId) })) === undefined) return;
      showToast(this.shadowRoot, fill(c.addedTo, { name: who }));
      this._phoneSync({ parts: ["phonebooks"] });
      return;
    }
    const { name, book } = answer;
    number = answer.number;
    if ((await this._phoneService("add_contact", { number, name, phonebook_id: book })) === undefined) return;
    showToast(this.shadowRoot, fill(c.done, { name }));
    this._phoneSync({ parts: ["phonebooks"] });
  }

  /** lookup_number answers with what FRITZ!Box Telefon knows about a number; shown in a dialog. */
  async _phoneLookup(number) {
    const t = this._t;
    if (!number) return;
    const result = await this._phoneService("lookup_number", { number }, { response: true });
    if (result === undefined) return;
    await openFormDialog(this.shadowRoot, t, {
      title: fill(t.phone.lookup.title, { number }),
      html: lookupBody(result?.response ?? result, t),
      close: t.phone.lookup.close,
    });
  }

  /** A signed address of a recording, asked for an hour and used again for 50 minutes (like the card). */
  async _phoneSigned(path) {
    this._phoneSigns ??= new Map();
    const known = this._phoneSigns.get(path);
    if (known && Date.now() - known.at < SIGN_REUSE_MS) return known.path;
    const signed = await this._hass.callWS({ type: "auth/sign_path", path, expires: SIGN_EXPIRES_S });
    this._phoneSigns.set(path, { path: signed.path, at: Date.now() });
    return signed.path;
  }

  /** The audio element lives outside the drawn page, so a new state does not stop the playback. */
  _phoneAudioEl() {
    if (this._phoneAudio || typeof Audio === "undefined") return this._phoneAudio ?? null;
    const audio = new Audio();
    const ui = () => this._state.phone;
    const show = () => {
      const play = ui().play;
      if (!play) return;
      play.pos = audio.currentTime || 0;
      if (Number.isFinite(audio.duration)) play.total = audio.duration;
      const root = this.shadowRoot;
      const seek = root.querySelector("#ph-seek");
      const pos = root.querySelector("#ph-pt");
      const total = root.querySelector("#ph-ptotal");
      if (pos) pos.textContent = mmss(play.pos);
      if (total) total.textContent = mmss(play.total);
      if (seek) {
        seek.max = String(Math.max(1, Math.round(play.total)));
        seek.value = String(Math.floor(play.pos));
        seek.setAttribute("aria-valuetext", fill(this._t.phone.tam.seekText, { pos: mmss(play.pos), total: mmss(play.total) }));
      }
    };
    audio.addEventListener?.("timeupdate", show);
    audio.addEventListener?.("loadedmetadata", show);
    audio.addEventListener?.("ended", () => {
      if (ui().play) ui().play.paused = true;
      if (this._state.tab === "phone") this._renderPhone();
    });
    this._phoneAudio = audio;
    return audio;
  }

  _phoneStop() {
    this._phoneAudio?.pause?.();
    if (this._state.phone) this._state.phone.play = null;
  }

  /** Plays a message here in the browser; a new one is marked as read, like the card does. */
  async _phonePlay(entityId, index) {
    const t = this._t;
    const found = this._phoneMessage(entityId, index);
    if (!found || !found.msg.hasRecording) return;
    const { tam, msg } = found;
    const ui = this._state.phone;
    const audio = this._phoneAudioEl();
    const k = `ph-p-m:${entityId}:${msg.index}`;
    if (ui.play && ui.play.entityId === entityId && ui.play.index === msg.index) {
      ui.play.paused = !ui.play.paused;
      try {
        if (ui.play.paused) audio?.pause();
        else await audio?.play();
      } catch (err) {
        showToast(this.shadowRoot, fill(t.phone.tam.playFailed, { error: err?.message ?? err }));
      }
      this._renderPhone();
      return this._phoneFocus(k);
    }
    this._phoneStop();
    try {
      const src = await this._phoneSigned(msg.recordingPath);
      ui.play = { entityId, index: msg.index, paused: false, pos: 0, total: 0 };
      if (audio) {
        audio.src = src;
        this._renderPhone();
        this._phoneFocus(k);
        await audio.play();
      } else this._renderPhone();
    } catch (err) {
      ui.play = null;
      this._renderPhone();
      showToast(this.shadowRoot, fill(t.phone.tam.playFailed, { error: err?.message ?? err }));
      return;
    }
    if (msg.isNew) {
      try {
        await this._hass.callService(PHONE_DOMAIN, "mark_message_read", this._phoneMessageData(tam, msg, { read: true }), undefined, false);
      } catch (err) {
        showToast(this.shadowRoot, fill(t.phone.tam.markFailed, { error: err?.message ?? err }));
      }
    }
  }

  /** Downloads a recording through a signed address, never with the old download service (it leaves the file unprotected under /local). */
  async _phoneDownload(entityId, index) {
    const found = this._phoneMessage(entityId, index);
    if (!found?.msg.hasRecording) return;
    try {
      const href = await this._phoneSigned(found.msg.recordingPath);
      const link = document.createElement("a");
      link.href = href;
      link.download = `fritzbox-message-${found.tam.tamIndex ?? 0}-${found.msg.index}`;
      link.click();
    } catch (err) {
      showToast(this.shadowRoot, fill(this._t.phone.failed, { error: err?.message ?? err }));
    }
  }

  async _phoneMark(entityId, index) {
    const found = this._phoneMessage(entityId, index);
    if (!found) return;
    const read = found.msg.isNew;
    if ((await this._phoneService("mark_message_read", this._phoneMessageData(found.tam, found.msg, { read }), { target: null })) === undefined) return;
    showToast(this.shadowRoot, read ? this._t.phone.tam.markedRead : this._t.phone.tam.markedUnread);
  }

  async _phoneDelete(entityId, index) {
    const t = this._t;
    const a = t.phone.tam;
    const found = this._phoneMessage(entityId, index);
    if (!found) return;
    const { tam, msg } = found;
    const name = msg.name || msg.reverseName || msg.number;
    const who = this._phone.privacy || !name ? "" : fill(a.deleteWho, { name });
    const ok = await openDialog(this.shadowRoot, t, { title: a.deleteTitle, body: fill(a.deleteBody, { who, date: msg.dateText || "–" }), ok: a.deleteOk, danger: true });
    if (!ok) return;
    if ((await this._phoneService("delete_message", this._phoneMessageData(tam, msg), { target: null })) === undefined) return;
    const ui = this._state.phone;
    if (ui.play?.entityId === entityId && ui.play.index === msg.index) this._phoneStop();
    this._renderPhone();
    showToast(this.shadowRoot, a.deleted);
  }

  /** play_message on a speaker of Home Assistant; FRITZ!Box Telefon hands it a signed address. */
  async _phoneSpeaker(entityId, index) {
    const t = this._t;
    const a = t.phone.tam;
    const found = this._phoneMessage(entityId, index);
    if (!found) return;
    const players = Object.entries(this._hass.states ?? {})
      .filter(([id, s]) => id.startsWith("media_player.") && s?.state !== "unavailable")
      .map(([id, s]) => [id, s.attributes?.friendly_name || id])
      .sort((x, y) => String(x[1]).localeCompare(String(y[1])));
    if (!players.length) return showToast(this.shadowRoot, a.speakerNone);
    const player = await openFormDialog(this.shadowRoot, t, {
      title: a.speakerTitle,
      html: `<label class="field"><span class="label">${escapeHtml(a.speakerField)}</span><select id="ph-mp">${players.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("")}</select></label><p class="hint">${escapeHtml(a.speakerHint)}</p>`,
      ok: a.speakerOk,
      focus: "#ph-mp",
      read: (dialog) => dialog.querySelector("#ph-mp").value || players[0][0],
    });
    if (player === null) return;
    if ((await this._phoneService("play_message", this._phoneMessageData(found.tam, found.msg, { media_player: player }), { target: null })) === undefined) return;
    showToast(this.shadowRoot, fill(a.speakerDone, { name: players.find(([id]) => id === player)?.[1] ?? player }));
  }

  /** Switches an answering machine without asking; the toast offers to undo it. */
  async _phoneTamSwitch(switchId, on, name) {
    const t = this._t;
    const a = t.phone.tam;
    const ui = this._state.phone;
    if (!switchId) return;
    const run = async (value) => {
      ui.busy.add(switchId);
      this._renderPhone();
      try {
        await this._hass.callService("switch", value ? "turn_on" : "turn_off", { entity_id: switchId }, undefined, false);
        return true;
      } catch (err) {
        showToast(this.shadowRoot, fill(t.phone.failed, { error: err?.message ?? err }));
        return false;
      } finally {
        ui.busy.delete(switchId);
        this._renderPhone();
        this._phoneFocus(`ph-sw-${switchId}`);
      }
    };
    if (!(await run(on))) return;
    showToast(this.shadowRoot, fill(on ? a.toastOn : a.toastOff, { name }), {
      label: t.phone.block.undo,
      run: async () => {
        if (await run(!on)) showToast(this.shadowRoot, fill(!on ? a.toastOn : a.toastOff, { name }));
      },
    });
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
