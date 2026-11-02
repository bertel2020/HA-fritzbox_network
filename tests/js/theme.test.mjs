import assert from "node:assert/strict";
import test from "node:test";

globalThis.HTMLElement = class {};

const base = "../../custom_components/fritzbox_network/frontend/";
const theme = await import(`${base}theme.js`);
const texts = await import(`${base}texts.js`);

test("light and dark pick the two colours of a theme", () => {
  const light = Object.fromEntries(theme.lookVars({ theme: "graphite", mode: "ha", size: "m" }, false));
  const dark = Object.fromEntries(theme.lookVars({ theme: "graphite", mode: "ha", size: "m" }, true));
  assert.equal(light["--accent"], "#2f3a48");
  assert.equal(dark["--accent"], "#d4dae2");
  assert.equal(light["--scale"], "1");
});

test("the type is 12.6, 14 and 16 px", () => {
  assert.equal(14 * theme.SIZES.s.scale, 12.6);
  assert.equal(14 * theme.SIZES.m.scale, 14);
  assert.equal(14 * theme.SIZES.l.scale, 16);
});

test("every theme has the same tokens", () => {
  const names = (id) => theme.lookVars({ theme: id, mode: "light", size: "m" }, false).map(([n]) => n).filter((n) => n !== "--b1");
  assert.deepEqual(names("forest"), names("ocean"));
  assert.deepEqual(names("graphite"), names("ocean"));
});

test("the mode decides, and 'ha' follows Home Assistant, then the system", () => {
  assert.equal(theme.isDark("light", true), false);
  assert.equal(theme.isDark("dark", false), true);
  assert.equal(theme.isDark("ha", true), true);
  assert.equal(theme.isDark("ha", undefined, true), true);
  assert.equal(theme.isDark("ha", undefined, false), false);
});

test("font sizes follow the scale and the small ones keep a floor", () => {
  const css = theme.scaleFonts(":host { font: 14px/1.45 Roboto; } .a { font-size: 12px; } .b { font-size: 10px; margin: 11px; } .c { font: inherit; font-size: 16px }");
  assert.match(css, /font: calc\(14px \* var\(--scale, 1\)\)\/1\.45/);
  assert.match(css, /font-size: calc\(12px \* var\(--scale, 1\)\);/);
  assert.match(css, /font-size: max\(10\.5px, calc\(10px \* var\(--scale, 1\)\)\);/);
  assert.match(css, /margin: 11px/);
  assert.match(css, /font-size: calc\(16px \* var\(--scale, 1\)\) }/);
});

test("the menu lists the three themes, modes and sizes in both languages", () => {
  for (const lang of ["de", "en"]) {
    const t = texts.panelTexts(lang);
    const html = theme.renderLookMenu({ theme: "forest", mode: "dark", size: "l" }, t, true);
    assert.equal((html.match(/data-look=/g) ?? []).length, 9);
    assert.match(html, /data-value="forest"[^>]*>|aria-checked="true" data-look="theme" data-value="forest"/);
    assert.equal(theme.renderLookMenu({}, t, false), "");
  }
});
