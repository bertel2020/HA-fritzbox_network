/* The look of the panel: the tokens and shapes of the other panels of the same author. */

export const PANEL_CSS = `
  :host {
        --bg: light-dark(#f4f6f9, #0f1216);
    --surface: light-dark(#fff, #1b1f24);
    --soft: light-dark(#f5f7f9, #22272e);
    --line: light-dark(#e1e5ea, #2d333b);
    --line-2: light-dark(#eef0f3, #262c33);
    --input-line: light-dark(#c3cbd5, #3a424c);
    --text: light-dark(#1b1f24, #e6e9ed);
    --muted: light-dark(#5b6270, #9aa4b1);
    --accent: light-dark(#0a6aa8, #5bb2ea);
    --accent-hover: light-dark(#07507f, #8ccaf2);
    --accent-soft: light-dark(#eaf3fa, #16324a);
    --on-accent: light-dark(#fff, #0b1a26);
    --focus: #7db8e0;
    --ok: light-dark(#1e6b34, #7fd49a);
    --ok-soft: light-dark(#e6f4ea, #173a24);
    --warn: light-dark(#8a4b00, #f2c27a);
    --warn-soft: light-dark(#fff1de, #3a2a12);
    --bad: light-dark(#a1261b, #f2a29a);
    --bad-soft: light-dark(#fdecea, #3d1c19);
    --neutral-soft: light-dark(#eef1f4, #2a3038);
    --radius: 18px;
    --shadow-c: light-dark(rgb(16 24 40 / 14%), rgb(0 0 0 / 40%));
    --shadow: 0 1px 2px var(--shadow-c), 0 6px 18px -10px var(--shadow-c);
  }
  * { box-sizing: border-box; }
  :host { display: block; min-height: 100%; background: var(--bg); color: var(--text); font: 14px/1.45 Roboto, "Noto Sans", system-ui, sans-serif; }
  .app { container: app / inline-size; min-height: 100%; }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: 0; padding: 0; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  svg.i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

  /* header */
  .header { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 0 24px; padding: 0 max(16px, calc((100% - 1200px) / 2 + 24px)); }
  .brand { display: flex; align-items: center; gap: 12px; padding: 10px 0; min-height: 60px; min-width: 0; }
  .menu { display: none; width: 40px; height: 40px; margin-left: -10px; place-items: center; border-radius: 50%; color: var(--text); }
  .menu:hover { background: var(--neutral-soft); }
  .logo { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); border: 1px solid var(--line); }
  .brand b { display: block; font-size: 18px; font-weight: 500; line-height: 1.2; white-space: nowrap; }
  .brand small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav { display: flex; gap: 4px; padding: 8px 0; }
  nav button { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: 20px; font-weight: 500; color: var(--muted); white-space: nowrap; transition: background .15s, color .15s; }
  nav button:hover { color: var(--text); background: var(--neutral-soft); }
  nav button[aria-selected="true"] { color: var(--accent-hover); background: var(--accent-soft); }
  nav em { font-style: normal; font-size: 11px; font-weight: 600; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--warn-soft); color: var(--warn); }
  .header-end { display: flex; align-items: center; gap: 8px; }
  @container app (max-width: 900px) {
    .header { gap: 0; }
    nav { order: 3; width: 100%; padding-top: 0; }
    nav button { flex: 1; justify-content: center; padding: 0 8px; }
  }
  @container app (max-width: 760px) { .menu { display: grid; } .header-end .chip.live span.t { display: none; } }

  main { max-width: 1200px; margin: 0 auto; padding: 24px 24px 64px; }
  @container app (max-width: 600px) { main { padding: 16px 16px 56px; } }

  /* shared bits */
  .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 11px; border-radius: 13px; background: var(--neutral-soft); color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .chip.ok { background: var(--ok-soft); color: var(--ok); }
  .chip.warn { background: var(--warn-soft); color: var(--warn); }
  .chip.bad { background: var(--bad-soft); color: var(--bad); }
  .chip.info { background: var(--accent-soft); color: var(--accent-hover); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--input-line); flex: none; }
  .dot.on { background: var(--ok); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .card + .card { margin-top: 16px; }
  h2 { font-size: 16px; font-weight: 500; margin: 0; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .muted { color: var(--muted); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 18px; border-radius: 20px; font-weight: 500; white-space: nowrap; border: 1px solid var(--input-line); background: var(--surface); }
  .btn:hover { background: var(--soft); }
  .btn.p { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .btn.p:hover { background: var(--accent-hover); }
  .btn.d { color: var(--bad); border-color: transparent; background: none; }
  .btn.d:hover { background: var(--bad-soft); }
  .btn.dp { background: var(--bad); border-color: var(--bad); color: var(--surface); }
  .btn[disabled] { opacity: .55; cursor: default; }
  .bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 14px; width: 20px; flex: none; }
  .bars i { width: 3px; background: var(--line); border-radius: 1px; }
  .bars i.on { background: var(--ok); }
  .bars.mid i.on { background: var(--warn); }
  .bars.low i.on { background: var(--bad); }

  /* network tab */
  .split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
  .list-col, .detail-col { min-width: 0; }
  @container app (min-width: 900px) { .split { grid-template-columns: minmax(0, 1fr) 390px; } }
  @container app (max-width: 899px) {
    .split.detail-open .list-col { display: none; }
    .split:not(.detail-open) .detail-col { display: none; }
  }
  .toolbar { padding: 16px; display: grid; gap: 12px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .fchip { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: 20px; border: 1px solid var(--line); color: var(--muted); font-weight: 500; white-space: nowrap; }
  .fchip b { font-weight: 600; font-size: 12px; }
  .fchip:hover { color: var(--text); background: var(--soft); }
  .fchip[aria-pressed="true"] { color: var(--accent-hover); border-color: var(--accent); background: var(--accent-soft); }
  .fields { display: grid; grid-template-columns: minmax(0, 1fr) 170px 170px; gap: 8px; }
  @container app (max-width: 700px) { .fields { grid-template-columns: 1fr 1fr; } .fields .search { grid-column: 1 / -1; } }
  .search { position: relative; }
  .search svg { position: absolute; left: 12px; top: 12px; color: var(--muted); }
  .search kbd { position: absolute; right: 10px; top: 9px; font: 12px monospace; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
  input[type="search"], select { width: 100%; height: 42px; border-radius: 10px; border: 1px solid var(--input-line); background: var(--surface); padding: 0 12px; }
  input[type="search"] { padding-left: 38px; }
  .meta { color: var(--muted); font-size: 12px; padding: 0 4px; }

  .ap { margin-top: 16px; overflow: hidden; }
  .ap-head { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; text-align: left; min-width: 0; }
  .ap-head .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); flex: none; }
  .ap-head .who { flex: 1; min-width: 0; }
  .ap-head .who b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-head .who small { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-head .count { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .ap-head .chev { color: var(--muted); transition: transform .15s; }
  .ap.closed .chev { transform: rotate(-90deg); }
  .ap.closed .ap-body { display: none; }
  .radios { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 0 16px 12px; }
  .radios::-webkit-scrollbar { display: none; }
  .radio { flex: none; background: var(--soft); border-radius: 12px; padding: 8px 12px; min-width: 150px; }
  .radio .top { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  .radio .top b { font-weight: 500; }
  .meter { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin-top: 6px; }
  .meter i { display: block; height: 100%; background: var(--ok); }
  .meter i.busy { background: var(--warn); }
  .dev { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; border-top: 1px solid var(--line); text-align: left; min-width: 0; }
  .dev:hover { background: color-mix(in srgb, var(--soft) 60%, transparent); }
  .dev[aria-current="true"] { background: var(--accent-soft); }
  .dev .who { flex: 1; min-width: 0; }
  .dev .who b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dev .who small { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dev .end { display: flex; align-items: center; gap: 10px; flex: none; color: var(--muted); font-size: 12px; }
  .dev .link { color: var(--muted); }
  .dev.off .who b { color: var(--muted); }
  @container app (max-width: 480px) { .dev .rate { display: none; } }
  .empty { display: grid; justify-items: center; gap: 6px; padding: 48px 16px; text-align: center; color: var(--muted); }
  .empty b { color: var(--text); font-weight: 500; }

  /* detail */
  .detail-col { position: sticky; top: 76px; }
  @container app (max-width: 899px) { .detail-col { position: static; } }
  .detail { padding: 20px; }
  .back { display: none; align-items: center; gap: 6px; color: var(--accent-hover); font-weight: 500; margin: 0 0 12px -6px; min-height: 40px; padding: 0 8px; border-radius: 20px; }
  .back:hover { background: var(--accent-soft); }
  @container app (max-width: 899px) { .back { display: inline-flex; } }
  .detail h1 { font-size: 22px; font-weight: 500; margin: 0 0 8px; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
  .tile { background: var(--soft); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .tile b { display: block; font-size: 20px; font-weight: 500; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section { margin-top: 20px; }
  .section > .label { display: block; margin-bottom: 8px; }
  dl { margin: 0; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px 12px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .mono { font-family: var(--code-font-family, ui-monospace, monospace); font-size: 13px; }
  .action { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-2); }
  .action:first-of-type { border-top: 0; }
  .action div small { display: block; color: var(--muted); font-size: 12px; }
  .switch { position: relative; width: 52px; height: 32px; border-radius: 16px; background: #aeb6c1; flex: none; transition: background .15s; }
  .switch::after { content: ""; position: absolute; top: 4px; left: 4px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(20px); }
  .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

  /* cleanup + filter */
  .pad { padding: 20px; }
  .lead { color: var(--muted); margin: 4px 0 16px; max-width: 70ch; }
  .range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 8px; }
  .range label { flex: 1 1 100%; }
  input[type="range"] { flex: 1 1 140px; min-width: 0; accent-color: var(--accent); }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-2); min-width: 0; }
  .row .who { flex: 1; min-width: 0; }
  .row .who b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .who small { display: block; color: var(--muted); font-size: 12px; }
  input[type="checkbox"] { width: 20px; height: 20px; accent-color: var(--accent); flex: none; }
  .selbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding: 12px 16px; border-radius: 12px; background: var(--accent-soft); }
  .seg { display: inline-grid; grid-auto-flow: column; border: 1px solid var(--input-line); border-radius: 10px; overflow: hidden; max-width: 100%; }
  .seg button { padding: 0 14px; min-height: 40px; font-weight: 500; color: var(--muted); border-left: 1px solid var(--input-line); white-space: nowrap; }
  .seg button:first-child { border-left: 0; }
  .seg button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
  @container app (max-width: 600px) { .seg { grid-auto-flow: row; width: 100%; } .seg button { border-left: 0; border-top: 1px solid var(--input-line); text-align: left; } .seg button:first-child { border-top: 0; } }
  .opts { margin: 16px 0; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .stat { border-radius: 12px; padding: 12px; background: var(--soft); }
  .stat b { display: block; font-size: 22px; font-weight: 500; }
  .stat.bad { background: var(--bad-soft); color: var(--bad); }
  .stat.ok { background: var(--ok-soft); color: var(--ok); }
  .note { border-radius: 12px; padding: 12px 14px; margin-top: 12px; background: var(--warn-soft); color: var(--warn); }
  .two { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
  @container app (min-width: 900px) { .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .two .card + .card { margin-top: 0; } }

  /* dialog + toast */
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 40%); display: none; place-items: center; z-index: 20; padding: 16px; }
  .backdrop.open { display: grid; }
  .dialog { width: min(440px, 100%); background: var(--surface); border-radius: 16px; padding: 24px; box-shadow: 0 6px 24px rgb(0 0 0 / 28%); max-height: 90vh; overflow: auto; }
  .dialog h2 { margin-bottom: 8px; }
  .dialog ul { margin: 8px 0; padding-left: 20px; max-height: 140px; overflow: auto; }
  .dialog .btn-row { justify-content: flex-end; margin-top: 20px; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); opacity: 0; transition: .2s; background: var(--text); color: var(--surface); padding: 10px 18px; border-radius: 12px; max-width: min(560px, calc(100vw - 32px)); z-index: 30; pointer-events: none; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
`;
