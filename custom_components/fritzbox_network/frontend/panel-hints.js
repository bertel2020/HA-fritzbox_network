/* Notes on the network that stand out: a busy Wi-Fi radio, a repeater that hangs on a weak link, a new firmware. */

import { BUSY_UTILIZATION, escapeHtml } from "./shared.js";
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
  const firmware = data?.firmware;
  if (firmware?.latest && firmware.latest !== firmware.installed) {
    hints.push({ level: "info", key: "firmware", values: { version: firmware.latest } });
  }
  return hints;
}

/** The card with the hints; nothing where there are none. */
export function renderHints(data, t) {
  const hints = networkHints(data, t);
  if (!hints.length) return "";
  return `<section class="card sec hints" aria-label="${escapeHtml(t.netHintsLabel)}">${hints
    .map(
      (h) =>
        `<p class="hintline ${h.level}"><span aria-hidden="true">${ic(h.level === "info" ? "check" : "alert")}</span><span>${escapeHtml(fill(t.netHints[h.key], h.values))}</span></p>`
    )
    .join("")}</section>`;
}
