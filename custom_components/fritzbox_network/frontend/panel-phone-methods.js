/**
 * The phone page of the panel (Box > Phone, from FRITZ!Box Telefon): the call bar, the calls, the book, the messages.
 *
 * Methods of the panel element, kept apart from the rest of the class: they are added to its
 * prototype by `mixin()` and run with `this` as the panel.
 */
import { openDialog, openFormDialog, showToast } from "./panel-dialogs.js";
import { dialSuggestions, liveBand, lookupBody, mmss, renderPhone } from "./panel-phone.js";
import { HISTORY_PERIODS, PERIODS, PERIOD_DAYS, PHONE_DOMAIN, REVEAL_MS, SIGN_EXPIRES_S, SIGN_REUSE_MS, WS_PARTS, dialable, fetchPhoneWs, parseWsEntries, phoneLoaded, phoneTrigger, readPhoneModel, wsCode } from "./phone-model.js";
import { escapeHtml } from "./shared.js";
import { fill } from "./texts.js";

export class PhoneMethods {
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
    if (!this._phone?.found && this._phoneInstalled === undefined) this._phoneCheckInstalled();
    const view = this.shadowRoot.querySelector("#phone-view");
    const width = view?.clientWidth || this._phoneWidth || 640;
    this._phoneWidth = width;
    this._set("phone-view", renderPhone(this._phone, { t: this._t, language: this._hass?.language, now: new Date(), ui: this._state.phone, width, installed: this._phoneInstalled ?? null, hidden: this._state.phoneHidden }));
  }

  /** Whether Home Assistant knows the integration FRITZ!Box Telefon at all: true (installed, not set up), false, or null where it does not say. */
  async _phoneCheckInstalled() {
    this._phoneInstalled = null;
    try {
      await this._hass.callWS({ type: "manifest/get", integration: PHONE_DOMAIN });
      this._phoneInstalled = true;
    } catch (err) {
      this._phoneInstalled = wsCode(err) === "not_found" ? false : null;
    }
    if (this._state.tab === "phone") this._renderPhone();
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
}
