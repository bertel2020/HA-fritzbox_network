/* FRITZ!Box Network panel: the whole network in the sidebar, for administrators. */

import { WEAK_LINK_RATIO, deviceFromHash, escapeHtml } from "./shared.js";
import { fill, panelTexts } from "./texts.js";
import { PANEL_CSS } from "./panel-styles.js";
import { ic } from "./icons.js";
import { renderChips, renderGroups, renderMeta, visibleClients } from "./panel-network.js";
import { renderDevice, entityState } from "./panel-device.js";
import { openDialog, showToast } from "./panel-dialogs.js";

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

class FritzboxNetworkPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._state = {
      data: null,
      filter: "all",
      query: "",
      sort: "name",
      group: "ap",
      closed: new Set(),
      sel: deviceFromHash(globalThis.location?.hash),
      threshold: WEAK_LINK_RATIO,
    };
    this._html = {};
    this._entries = [];
    this._entryId = null;
    this._error = null;
    this._unsub = null;
    this._updatedAt = 0;
    this._onHash = () => {
      this._state.sel = deviceFromHash(globalThis.location.hash);
      this._update();
    };
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("input", (event) => {
      if (event.target.id === "q") {
        this._state.query = event.target.value;
        this._update();
      }
    });
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
    await this._subscribe();
  }

  async _subscribe() {
    try {
      this._unsub = await this._hass.connection.subscribeMessage(
        (data) => {
          this._state.data = data;
          this._error = null;
          this._updatedAt = Date.now();
          this._update();
        },
        { type: `${DOMAIN}/subscribe_topology`, entry_id: this._entryId }
      );
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
    this._update();
    await this._subscribe();
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
        .busyText { color: var(--warn); }
        .warnIcon { color: var(--warn); display: inline-flex; }
        .hint { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
        .field { display: grid; gap: 4px; margin-top: 12px; }
        .field input { height: 42px; border-radius: 10px; border: 1px solid var(--input-line); background: var(--surface); padding: 0 12px; font: inherit; color: inherit; }
        .tile.wide { grid-column: 1 / -1; }
        .action select { width: auto; max-width: 55%; }
        .note.big { margin: 16px 0; }
        #box { width: auto; max-width: 220px; height: 36px; }
      </style>
      <div class="app">
        <header class="header">
          <div class="brand">
            <ha-menu-button></ha-menu-button>
            <span class="logo">${ic("router")}</span>
            <div><b>${t.title}</b><small id="sub"></small></div>
          </div>
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
    split.hidden = !ready;
    root.querySelector("#live-chip").hidden = !ready;
    if (!ready) return;
    const now = Date.now();
    const master = (state.data.nodes ?? []).find((n) => n.role === "master");
    root.querySelector("#sub").textContent = master ? [master.name, master.model].filter(Boolean).join(" · ") : "";
    split.classList.toggle("detail-open", Boolean(this._selected()));
    this._set("chips", renderChips(state, t, now));
    this._set("meta", renderMeta(state, t, visibleClients(state, now).length));
    this._set("groups", renderGroups(state, t, now));
    this._renderDetail();
    this._tick();
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
    this._update();
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
    } else {
      return;
    }
    this._update();
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
