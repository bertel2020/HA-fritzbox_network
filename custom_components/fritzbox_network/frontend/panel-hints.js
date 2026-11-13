/* Notes on the network that stand out: a busy Wi-Fi radio, a repeater that hangs on a weak link, a new firmware. */

import { BUSY_UTILIZATION, escapeHtml, noteOpen } from "./shared.js";
import { ic } from "./icons.js";
import { fill } from "./texts.js";

// a repeater linked by Wi-Fi at or below this signal (dBm) is a weak link for all devices behind it
export const UPLINK_WEAK_DBM = -75;

/**
 * What stands out in the network, most serious first: [{ level, key, values }] with the key of
 * the text in t.netHints. Every hint is about one thing the user can act on.
 */
export function networkHints(data, t) {
  const hints = [];
  for (const node of data?.nodes ?? []) {
    for (const [band, radio] of Object.entries(node.radios ?? {})) {
      if (typeof radio.utilization === "number" && radio.utilization >= BUSY_UTILIZATION) {
        hints.push({
          level: "warn",
          key: "radioBusy",
          values: { name: node.name, band: t.bandGroups[band] ?? band, percent: radio.utilization },
        });
      }
    }
    const uplink = node.uplink;
    if (uplink?.type === "wlan" && typeof uplink.signal_dbm === "number" && uplink.signal_dbm <= UPLINK_WEAK_DBM) {
      hints.push({ level: "warn", key: "uplinkWeak", values: { name: node.name, dbm: uplink.signal_dbm } });
    }
  }
  for (const repeater of data?.lost_repeaters ?? []) {
    hints.push({ level: "warn", key: "repeaterLost", values: { name: repeater.name } });
  }
  const firmware = data?.firmware;
  if (firmware?.latest && firmware.latest !== firmware.installed) {
    hints.push({ level: "info", key: "firmware", values: { version: firmware.latest } });
  }
  return hints;
}

// hints about the radios and the mesh: their details are on the Wi-Fi page
const ON_WLAN = new Set(["radioBusy", "uplinkWeak", "repeaterLost"]);

/**
 * The card with the hints, folded to one line: the first hint and how many more there are. Opened,
 * it shows all of them, a hint about the radios with the way to the Wi-Fi page. Nothing where
 * there are none.
 */
export function renderHints(data, t) {
  const hints = networkHints(data, t);
  if (!hints.length) return "";
  const icon = (level) => `<span aria-hidden="true">${ic(level === "info" ? "check" : "alert")}</span>`;
  const first = hints[0];
  const more = hints.length > 1 ? `<span class="chip">${escapeHtml(fill(t.netHintsMore, { n: hints.length - 1 }))}</span>` : "";
  const key = "net-hints";
  const lines = hints
    .map(
      (h) =>
        `<p class="hintline ${h.level}">${icon(h.level)}<span>${escapeHtml(fill(t.netHints[h.key], h.values))}${ON_WLAN.has(h.key) ? ` <button class="tlink" data-tab="wlan" data-k="hint-wlan-${h.key}">${escapeHtml(t.toWlan)} ›</button>` : ""}</span></p>`
    )
    .join("");
  return `<details class="card sec hints hintsum" data-note="${key}" aria-label="${escapeHtml(t.netHintsLabel)}"${noteOpen(key) ? " open" : ""}>
    <summary class="hintline ${first.level}">${icon(first.level)}<span class="one">${escapeHtml(fill(t.netHints[first.key], first.values))}</span><span class="all">${escapeHtml(t.netHintsLabel)}</span>${more}<span class="chev">${ic("chev")}</span></summary>
    <div class="hintall">${lines}</div></details>`;
}
