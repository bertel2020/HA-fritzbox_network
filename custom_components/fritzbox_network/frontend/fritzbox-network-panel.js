/* FRITZ!Box Network panel: the whole network in the sidebar, for administrators. */

import {
  WEAK_LINK_RATIO,
  escapeHtml,
  filterChanged,
  panelCounts,
  routeFromHash,
  toggleMac,
} from "./shared.js";
import { fill, panelTexts } from "./texts.js";
import { PANEL_CSS } from "./panel-styles.js";
import { ic } from "./icons.js";
import { renderChips, renderGroups, renderMeta, visibleClients } from "./panel-network.js";
import { renderDevice, entityState } from "./panel-device.js";
import { openDialog, showToast } from "./panel-dialogs.js";
import { pickedMacs, renderHidden, renderStale, staleList } from "./panel-cleanup.js";
import { renderFilterControls, renderPicker, renderPreview } from "./panel-filter.js";

const DOMAIN = "fritzbox_network";
const BOX_KEY = `${DOMAIN}_panel_box`;

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

/** The pages of the panel as tabs; the clean-up tab says how many devices have been gone for long. */
function renderNav(state, t, stale) {
  const tab = (id, badge) =>
    `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${escapeHtml(t.tabs[id])}${badge ? `<em>${badge}</em>` : ""}</button>`;
  return `${tab("net")}${tab("cleanup", stale)}${tab("filter")}`;
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
      data: null,
      filter: "all",
      query: "",
      sort: "name",
      group: "ap",
      closed: new Set(),
      sel: route.device,
      threshold: WEAK_LINK_RATIO,
    };
    this._html = {};
    this._entries = [];
    this._entryId = null;
    this._error = null;
    this._unsub = null;
    this._updatedAt = 0;
    this._onHash = () => {
      const next = routeFromHash(globalThis.location.hash);
      const entered = next.tab !== this._state.tab;
      this._state.tab = next.tab;
      this._state.sel = next.device;
      if (entered) this._enterTab();
      this._update();
    };
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    this.shadowRoot.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/INPUT|SELECT/.test(this.shadowRoot.activeElement?.tagName ?? "")) {
        event.preventDefault();
        this.shadowRoot.querySelector("#q")?.focus();
      }
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
    if (this._hass && !this._started) this._start();
  }

  disconnectedCallback() {
    globalThis.removeEventListener("hashchange", this._onHash);
    clearInterval(this._clock);
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
          if (this._state.tab === "cleanup") this._loadCleanup();
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
  }

  _ws(type, extra = {}) {
    return this._hass.callWS({ type: `${DOMAIN}/${type}`, entry_id: this._entryId, ...extra });
  }

  async _loadCleanup() {
    try {
      const result = await this._ws("cleanup/list");
      const state = this._state;
      state.cleanup = result;
      state.cleanupDays ??= result.days;
      const offered = new Set(result.devices.map((d) => d.mac));
      state.picked = new Set([...state.picked].filter((mac) => offered.has(mac)));
      this._update();
    } catch (err) {
      this._fail(err);
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
    this._state.cleanup = null;
    this._state.cleanupDays = null;
    this._state.picked = new Set();
    this._state.filterPage = null;
    this._update();
    if (await this._subscribe()) this._enterTab();
  }

  _onHass() {
    // the switches of the open device move on their own: draw it again when one did
    const signature = this._actionStates();
    if (signature !== this._signature) {
      this._signature = signature;
      this._renderDetail();
    }
  }

  _selected() {
    return (this._state.data?.clients ?? []).find((c) => c.id === this._state.sel) ?? null;
  }

  _actionStates() {
    const client = this._selected();
    return Object.values(client?.actions ?? {})
      .map((id) => `${id}=${entityState(this._hass, id)?.state}`)
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
        .picker { max-height: 320px; overflow: auto; margin-top: 8px; }
        label.row { cursor: pointer; }
        .pickhead { margin-top: 16px; }
        label.search { display: block; }
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
            <span class="chip ok live" id="live-chip" hidden><span class="dot on"></span><span class="t" id="live"></span></span>
          </div>
        </header>
        <main>
          <div id="note"></div>
          <div class="split" id="split" hidden>
            <div class="list-col">
              <div class="card toolbar">
                <div class="chips" id="chips" role="group" aria-label="${t.filterGroup}"></div>
                <div class="fields">
                  <label class="search"><span class="sr">${t.search}</span>${ic("search")}<input type="search" id="q" placeholder="${t.search}" title="${t.searchTitle}" aria-label="${t.searchTitle}" value="${escapeHtml(state.query)}"><kbd>/</kbd></label>
                  <label><span class="sr">${t.sort}</span><select id="sort">${Object.entries(t.sorts).map(([k, v]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                  <label><span class="sr">${t.group}</span><select id="group">${Object.entries(t.groups).map(([k, v]) => `<option value="${k}" ${k === state.group ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                </div>
                <div class="meta" id="meta"></div>
              </div>
              <div id="groups"></div>
            </div>
            <aside class="detail-col" id="detail"></aside>
          </div>
          <div class="two" id="cleanup-view" hidden>
            <section class="card pad">
              <h2>${t.cleanup.title}</h2><p class="lead">${t.cleanup.lead}</p>
              <div class="range"><label for="days">${t.cleanup.since}</label><input type="range" id="days" min="7" max="365" value="${state.cleanupDays ?? 30}"><b id="days-label"></b></div>
              <div id="stale"></div>
            </section>
            <section class="card pad"><h2>${t.cleanup.hiddenTitle}</h2><p class="lead">${t.cleanup.hiddenLead}</p><div id="hidden"></div></section>
          </div>
          <div class="two" id="filter-view" hidden>
            <section class="card pad">
              <h2>${t.filter.title}</h2><p class="lead">${t.filter.lead}</p>
              <div id="f-controls"></div>
              <div id="f-picker-wrap" hidden>
                <h2 class="pickhead">${t.filter.pickTitle}</h2>
                <label class="search"><span class="sr">${t.filter.pickSearch}</span>${ic("search")}<input type="search" id="f-search" placeholder="${t.filter.pickSearch}" aria-label="${t.filter.pickSearch}"></label>
                <div id="f-picker"></div>
              </div>
            </section>
            <section class="card pad"><h2>${t.filter.preview}</h2><p class="lead">${t.filter.previewLead}</p><div id="f-preview"></div></section>
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
    this._renderBox();
    this._update();
  }

  /** Writes HTML into a part only when it changed, so a poll does not flicker or lose the scroll. */
  _set(id, html) {
    const el = this.shadowRoot.querySelector(`#${id}`);
    if (!el || this._html[id] === html) return;
    this._html[id] = html;
    el.innerHTML = html;
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
    live.textContent = fill(this._t.live, { n: Math.round((Date.now() - this._updatedAt) / 1000) });
  }

  _update() {
    const root = this.shadowRoot;
    const t = this._t;
    const state = this._state;
    const note = this._error ? `<div class="card note-card"><div class="empty"><b>${t[this._error]}</b></div></div>` : "";
    const ready = Boolean(state.data) && !this._error;
    this._set("note", note || (state.data ? "" : `<div class="card"><div class="empty"><span>${t.loading}</span></div></div>`));
    const split = root.querySelector("#split");
    if (!split) return;
    const tab = state.tab;
    split.hidden = !ready || tab !== "net";
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
    if (tab === "cleanup") return this._renderCleanup();
    if (tab === "filter") return this._renderFilter();
    split.classList.toggle("detail-open", Boolean(this._selected()));
    this._set("chips", renderChips(state, t, now));
    this._set("meta", renderMeta(state, t, visibleClients(state, now).length));
    this._set("groups", renderGroups(state, t, now));
    this._renderDetail();
  }

  _renderCleanup() {
    const state = this._state;
    const t = this._t;
    const days = state.cleanupDays ?? 30;
    const range = this.shadowRoot.querySelector("#days");
    if (range && Number(range.value) !== days) range.value = days;
    this.shadowRoot.querySelector("#days-label").textContent = fill(t.cleanup.days, { n: days });
    this._set("stale", renderStale(state, t, Date.now()));
    this._set("hidden", renderHidden(state, t));
  }

  _renderFilter() {
    const page = this._state.filterPage;
    const t = this._t;
    this._set("f-controls", renderFilterControls(page, t));
    const wrap = this.shadowRoot.querySelector("#f-picker-wrap");
    if (wrap) wrap.hidden = !page || page.draft.filter_mode === "all";
    this._set("f-picker", renderPicker(page, t));
    this._set("f-preview", renderPreview(page, t));
  }

  _renderDetail() {
    const state = this._state;
    this._set(
      "detail",
      renderDevice(this._selected(), {
        t: this._t,
        now: Date.now(),
        data: state.data,
        hass: this._hass,
        threshold: state.threshold,
      })
    );
  }

  _onChange(event) {
    const el = event.target;
    if (el.id === "sort") this._state.sort = el.value;
    else if (el.id === "group") this._state.group = el.value;
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
    } else if (el.id === "days") {
      this._state.cleanupDays = Number(el.value);
      this._renderCleanup();
    } else if (el.id === "f-search" && this._state.filterPage) {
      this._state.filterPage.search = el.value;
      this._renderFilter();
    }
  }

  _onClick(event) {
    const t = this._t;
    const target = event.target.closest("button, [data-filter], [data-ap], [data-dev]");
    if (!target) return;
    const ds = target.dataset;
    const state = this._state;
    if (ds.filter) {
      state.filter = ds.filter;
    } else if (ds.ap) {
      if (state.closed.has(ds.ap)) state.closed.delete(ds.ap);
      else state.closed.add(ds.ap);
    } else if (ds.dev) {
      globalThis.location.hash = `#/device/${ds.dev}`;
      return;
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
    } else if (ds.tab) {
      globalThis.location.hash = ds.tab === "net" ? "#/" : `#/${ds.tab}`;
      return;
    } else if (ds.act === "pick-all") {
      for (const d of staleList(state)) state.picked.add(d.mac);
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
    if (globalThis.history.length > 1 && globalThis.location.hash) globalThis.history.back();
    else globalThis.location.hash = "";
    this._state.sel = null;
    this._update();
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
    if (!client?.device_id) return;
    globalThis.history.pushState(null, "", `/config/devices/device/${client.device_id}`);
    globalThis.dispatchEvent(new CustomEvent("location-changed"));
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
