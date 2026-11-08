/**
 * The address page of the panel: the network of the box, the fixed addresses, the notes and blocks of the user.
 *
 * Methods of the panel element, kept apart from the rest of the class: they are added to its
 * prototype by `mixin()` and run with `this` as the panel.
 */
import { BLOCK_COLORS, ENTRY_KINDS, addressModel, checkBlock, checkEntry, emptyOwn, entryPreview, groupPreview, normalizeOwn, parseRange, poolChange, renderAddresses } from "./panel-addresses.js";
import { openDialog, showToast } from "./panel-dialogs.js";
import { addressRows, fileName, printSheet, toCsv, toJson } from "./panel-export.js";
import { fill } from "./texts.js";

export class AddressMethods {
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
}
