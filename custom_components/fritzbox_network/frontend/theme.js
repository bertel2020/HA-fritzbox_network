/* The look of the panel the user chooses: a colour theme, light or dark, and a size of the type. */

import { escapeHtml } from "./shared.js";
import { ic } from "./icons.js";

const KEY = "fritzbox_network_look";
/** Under this size the type is held at the floor, so that the smallest step stays readable. */
const MIN_PX = 10.5;

export const THEME_IDS = ["ocean", "forest", "graphite"];
export const MODE_IDS = ["ha", "light", "dark"];
export const SIZE_IDS = ["s", "m", "l"];
export const SIZES = { s: { px: 12.6, scale: 0.9 }, m: { px: 14, scale: 1 }, l: { px: 16, scale: 16 / 14 } };
export const DEFAULT_LOOK = { theme: "ocean", mode: "ha", size: "m" };

const TOKENS = [
  "--bg", "--surface", "--soft", "--line", "--line-2", "--input-line", "--text", "--muted",
  "--accent", "--accent-hover", "--accent-soft", "--on-accent", "--neutral-soft", "--neutral-text",
];

/** The colours of each theme as [light, dark], in the order of TOKENS. */
const COLORS = {
  ocean: [
    ["#f4f6f9", "#0f1216"], ["#ffffff", "#1b1f24"], ["#f5f7f9", "#22272e"], ["#e1e5ea", "#2d333b"], ["#eef0f3", "#262c33"],
    ["#c3cbd5", "#3a424c"], ["#1b1f24", "#e6e9ed"], ["#5b6270", "#9aa4b1"], ["#0a6aa8", "#5bb2ea"], ["#07507f", "#8ccaf2"],
    ["#eaf3fa", "#16324a"], ["#ffffff", "#0b1a26"], ["#eef1f4", "#2a3038"], ["#3a414c", "#c5ccd5"],
  ],
  forest: [
    ["#f3f7f5", "#0e1513"], ["#ffffff", "#1a2220"], ["#f4f8f6", "#202a27"], ["#dce5e1", "#2b3733"], ["#eaf0ed", "#24302c"],
    ["#bccac4", "#394845"], ["#1a201e", "#e4ebe8"], ["#566360", "#98a8a2"], ["#0f7a6b", "#5fd0be"], ["#0a5a4f", "#8fe0d2"],
    ["#e4f3f0", "#123430"], ["#ffffff", "#08201c"], ["#ecf1ef", "#26312e"], ["#36423e", "#c3d0cb"],
  ],
  graphite: [
    ["#f5f4f2", "#141414"], ["#ffffff", "#1f1f1e"], ["#f6f5f3", "#262625"], ["#e4e2de", "#33322f"], ["#eeedea", "#2a2a28"],
    ["#cbc8c2", "#45433f"], ["#1c1b19", "#ebeae7"], ["#5c5853", "#a9a59f"], ["#2f3a48", "#d4dae2"], ["#1b232d", "#f0f3f6"],
    ["#eceff3", "#2c3139"], ["#ffffff", "#141820"], ["#efeeeb", "#2c2c2a"], ["#3d3a36", "#cfccc6"],
  ],
};

/** Beside the accent the first block of the map is teal, so in the green theme it turns blue. */
const EXTRA = { forest: { "--b1": ["#2c78c4", "#6fb0ee"] } };

/** The look chosen last in this browser; what is missing or unknown falls back to the usual one. */
export function rememberedLook() {
  try {
    const look = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      theme: THEME_IDS.includes(look.theme) ? look.theme : DEFAULT_LOOK.theme,
      mode: MODE_IDS.includes(look.mode) ? look.mode : DEFAULT_LOOK.mode,
      size: SIZE_IDS.includes(look.size) ? look.size : DEFAULT_LOOK.size,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function rememberLook(look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // without storage the panel starts with the usual look next time
  }
}

/** Whether the panel is dark: as chosen, or "ha" as Home Assistant has it, outside of it as the system has it. */
export function isDark(mode, haDark, systemDark = false) {
  if (mode === "light") return false;
  if (mode === "dark") return true;
  return haDark ?? systemDark;
}

/** The custom properties of a look as [name, value] pairs; dark picks the second colour of each. */
export function lookVars(look, dark) {
  const at = dark ? 1 : 0;
  const colors = COLORS[look.theme] ?? COLORS.ocean;
  const vars = TOKENS.map((name, i) => [name, colors[i][at]]);
  for (const [name, pair] of Object.entries(EXTRA[look.theme] ?? {})) vars.push([name, pair[at]]);
  vars.push(["--scale", String((SIZES[look.size] ?? SIZES.m).scale)]);
  return vars;
}

/** Puts a look on an element; the properties of the element win over the defaults of the style sheet. */
export function applyLook(el, look, haDark, systemDark = false) {
  const dark = isDark(look.mode, haDark, systemDark);
  for (const [name, value] of lookVars(look, dark)) el.style.setProperty(name, value);
  el.style.colorScheme = dark ? "dark" : "light";
  return dark;
}

/** The sizes of the type in a style sheet follow the scale; the small ones stop at a floor. */
export function scaleFonts(css) {
  return css.replace(/(?<![-\w])(font(?:-size)?:\s*)(\d+(?:\.\d+)?)px(?=[\s/;}])/g, (_, head, px) => {
    const size = Number(px);
    const scaled = `calc(${px}px * var(--scale, 1))`;
    return `${head}${size < 12 ? `max(${MIN_PX}px, ${scaled})` : scaled}`;
  });
}

/** The menu behind the palette in the header: the colour scheme, light or dark, and the size, as lists to choose from. */
export function renderLookMenu(look, t, open) {
  if (!open) return "";
  const group = (key, ids, names, label) => `<span class="label" aria-hidden="true">${escapeHtml(label)}</span>
    <div role="group" aria-label="${escapeHtml(label)}">${ids.map((id) =>
      `<button role="menuitemradio" aria-checked="${look[key] === id}" data-look="${key}" data-value="${id}" tabindex="-1">${key === "theme" ? `<i class="swatch ${id}"></i>` : ""}<span class="t">${escapeHtml(names[id])}</span></button>`).join("")}</div>`;
  return `<div class="sheet-scrim" data-act="look-close"></div>
    <div class="fmenu lookmenu" id="lookmenu" role="menu" aria-label="${escapeHtml(t.lookTitle)}">
      ${group("theme", THEME_IDS, t.lookThemes, t.lookTheme)}
      ${group("mode", MODE_IDS, t.lookModes, t.lookMode)}
      ${group("size", SIZE_IDS, t.lookSizes, t.lookSize)}
    </div>`;
}

/** The text of the button that opens the menu, for the label of the icon. */
export function lookButton(t, open) {
  return `<button class="iconbtn" id="lookbtn" data-act="look" data-k="look" aria-haspopup="dialog" aria-expanded="${open}" aria-controls="lookmenu" title="${escapeHtml(t.lookTitle)}" aria-label="${escapeHtml(t.lookTitle)}">${ic("palette")}</button>`;
}
