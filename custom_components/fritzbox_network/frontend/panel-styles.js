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
    --up: light-dark(#7a4bc2, #b79af0);
    --ok: light-dark(#1e6b34, #7fd49a);
    --ok-soft: light-dark(#e6f4ea, #173a24);
    --warn: light-dark(#8a4b00, #f2c27a);
    --warn-soft: light-dark(#fff1de, #3a2a12);
    --bad: light-dark(#a1261b, #f2a29a);
    --bad-soft: light-dark(#fdecea, #3d1c19);
    --neutral-soft: light-dark(#eef1f4, #2a3038);
    --neutral-text: light-dark(#3a414c, #c5ccd5);
    --warn-line: light-dark(#f3d19e, #6b4a1c);
    --bad-line: light-dark(#f2b8b5, #6e2f2a);
    --code-bg: light-dark(#14181d, #0b0e11);
    --code-text: #d7dee6;
    --scale: 1;
    --radius: 18px;
    --shadow-c: light-dark(rgb(16 24 40 / 14%), rgb(0 0 0 / 40%));
    --shadow: 0 1px 2px var(--shadow-c), 0 6px 18px -10px var(--shadow-c);
    --link: light-dark(#8e98a6, #6b7684);
    --fixed: var(--up);
    --fixed-soft: light-dark(#f0e9fb, #2c2342);
    --free: var(--neutral-soft);
    --b1: light-dark(#0f8b8d, #5fd0d2);
    --b2: light-dark(#d9730d, #f5a560);
    --b3: light-dark(#c2417c, #f08cbb);
    --b4: light-dark(#4f8a10, #a5d96a);
    --b5: light-dark(#6b5b95, #b3a6d9);
  }
  * { box-sizing: border-box; }
  :host { display: block; min-height: 100%; background: var(--bg); color: var(--text); font: 14px/1.45 Roboto, "Noto Sans", system-ui, sans-serif; }
  .app { container: app / inline-size; min-height: 100%; }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: 0; padding: 0; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  svg.i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* header: logo and title on the left, the pages as pills and the link to the settings on the right */
  .header { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; align-items: center; gap: 0 24px;
    padding: 0 max(16px, calc((100% - 1200px) / 2 + 24px)); }
  .brand { display: flex; align-items: center; gap: 12px; padding: 10px 0; min-height: 60px; min-width: 0; flex: 1 1 auto; }
  .brand > div { min-width: 0; }
  .menu { display: none; width: 40px; height: 40px; margin-left: -10px; place-items: center; border-radius: 50%; color: var(--text); }
  .menu:hover { background: var(--neutral-soft); }
  .logo { width: 36px; height: 36px; border-radius: 10px; object-fit: cover; flex: none; }
  .brand b { display: block; font-size: 18px; font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .brand small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; padding: 8px 0; }
  nav button { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 18px; font-weight: 500; color: var(--muted); white-space: nowrap; border-radius: 22px; transition: color .15s, background .15s; }
  nav button:hover { color: var(--text); background: var(--neutral-soft); }
  nav button[aria-selected="true"] { color: var(--accent-hover); background: var(--accent-soft); }
  nav em { font-style: normal; font-size: 11px; font-weight: 600; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--warn-soft); color: var(--warn); }
  .header-end { display: flex; align-items: center; gap: 14px; flex: none; }
  .intlink { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 18px; border: 1px solid var(--input-line); border-radius: 22px; background: var(--surface); color: var(--accent-hover); font-weight: 500; text-decoration: none; white-space: nowrap; }
  .intlink:hover { background: var(--accent-soft); border-color: var(--accent); }
  .intlink svg.i { width: 18px; height: 18px; }
  .fresh { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; white-space: nowrap; }
  .fresh .dot { width: 8px; height: 8px; box-shadow: 0 0 0 3px var(--ok-soft); }
  nav .dot { width: 7px; height: 7px; }
  /* six pages need about 1180 px next to the title and the link; below that they get a row of their own */
  @container app (max-width: 1180px) { nav { order: 3; flex: 1 1 100%; padding-bottom: 8px; } }
  @container app (max-width: 760px) { .menu { display: grid; } }
  @container app (max-width: 520px) { .fresh .t { display: none; } .intlink span { display: none; } .intlink { padding: 0 12px; } .header-end { gap: 10px; } }

  main { max-width: 1200px; margin: 0 auto; padding: 24px 24px 64px; }
  @container app (max-width: 600px) { main { padding: 16px 16px 56px; } }

  /* shared bits */
  .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 11px; border-radius: 13px; background: var(--neutral-soft); color: var(--neutral-text); font-size: 12px; font-weight: 500; white-space: nowrap; }
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
  .toolbar { padding: 16px; display: grid; gap: 12px; }
  .tools { display: grid; grid-template-columns: minmax(0, 1fr) 160px 170px auto; gap: 8px; align-items: center; }
  .tools.map { grid-template-columns: minmax(0, 1fr) auto; }
  @container app (max-width: 700px) {
    .tools { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .tools .search, .tools .viewsw { grid-column: 1 / -1; }
    .tools.map { grid-template-columns: minmax(0, 1fr); }
  }
  .search { position: relative; }
  .search svg { position: absolute; left: 12px; top: 12px; color: var(--muted); }
  .search kbd { position: absolute; right: 10px; top: 9px; font: 12px monospace; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
  @container app (max-width: 700px) { .search kbd { display: none; } }
  input[type="search"], select { width: 100%; height: 42px; border-radius: 10px; border: 1px solid var(--input-line); background: var(--surface); padding: 0 12px; min-width: 0; }
  input[type="search"] { padding-left: 38px; }
  .seg.viewsw { display: flex; }
  .seg.viewsw button { flex: 1; justify-content: center; display: inline-flex; align-items: center; gap: 6px; }
  @container app (max-width: 600px) {
    .seg.viewsw button { border-top: 0; border-left: 1px solid var(--input-line); }
    .seg.viewsw button:first-child { border-left: 0; }
  }
  .meta { color: var(--muted); font-size: 12px; padding: 0 4px; }

  /* the filters: three fixed chips, the chosen other one, and "More". Wraps, never scrolls sideways. */
  .chipwrap { position: relative; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .fchip { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 20px; border: 1px solid var(--line); color: var(--muted); font-weight: 500; white-space: nowrap; background: var(--surface); }
  .fchip b { font-weight: 600; font-size: 12px; }
  .fchip:hover { color: var(--text); background: var(--soft); }
  .fchip[aria-pressed="true"] { color: var(--accent-hover); border-color: var(--accent); background: var(--accent-soft); }
  .fchip.more[aria-expanded="true"] { border-color: var(--accent); }
  .fchip .x { margin-right: -4px; display: inline-grid; }
  @container app (max-width: 600px) {
    .chips { gap: 6px; }
    .fchip { padding: 0 9px; }
    .fchip.more > svg.i:first-child, .fchip.more b { display: none; }
    .maphead .aslist { display: none; }
  }
  .fmenu { position: absolute; z-index: 12; top: calc(100% + 6px); left: 0; width: 300px; max-width: 100%; max-height: 420px; overflow: auto; padding: 8px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 30px var(--shadow-c); }
  svg.i.fill { fill: currentColor; stroke: none; }
  .iconbtn { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--muted); }
  .iconbtn svg.i { width: 24px; height: 24px; }
  .iconbtn:hover, .iconbtn[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent-hover); }
  /* outside the header, which holds fixed boxes inside itself because of its blur */
  .fmenu.lookmenu { position: fixed; top: 76px; left: auto; right: max(16px, calc((100vw - 1200px) / 2 + 24px)); width: 320px; max-width: calc(100vw - 32px); padding: 8px; }
  .lookmenu [role="group"] + .label { margin-top: 4px; border-top: 1px solid var(--line-2); padding-top: 12px; }
  .lookmenu [aria-checked="true"] { font-weight: 500; }
  .fmenu.lookmenu { max-height: calc(100vh - 92px); }
  .fmenu.lookmenu [aria-checked="true"], .fmenu.lookmenu [aria-checked="true"]:focus-visible { background: var(--accent-soft); }
  .swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--muted); }
  .swatch.ocean { background: #0a6aa8; }
  .swatch.forest { background: #0f7a6b; }
  .swatch.graphite { background: #2f3a48; }
  .fmenu .label { display: block; padding: 8px 10px 4px; }
  .fmenu [role="menuitemradio"] { display: flex; width: 100%; align-items: center; gap: 10px; min-height: 40px; padding: 0 10px; border-radius: 8px; text-align: left; }
  .fmenu [role="menuitemradio"]:hover, .fmenu [role="menuitemradio"]:focus-visible { background: var(--soft); }
  .fmenu [role="menuitemradio"] .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fmenu [role="menuitemradio"] b { font-size: 12px; color: var(--muted); font-weight: 600; }
  .fmenu [aria-checked="true"] { color: var(--accent-hover); background: var(--accent-soft); }
  .fmenu .ck { width: 18px; display: inline-grid; flex: none; }
  .sheet-scrim { position: fixed; inset: 0; z-index: 11; background: transparent; }
  @container app (max-width: 600px) {
    .sheet-scrim { background: rgb(0 0 0 / 35%); }
    .fmenu { position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-width: none; max-height: 75vh; border-radius: 20px 20px 0 0; padding: 8px 12px 20px; }
    .fmenu.lookmenu { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-width: none; max-height: 85vh; padding: 8px 12px 20px; }
    .fmenu::before { content: ""; display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--input-line); margin: 4px auto 8px; }
    .fmenu [role="menuitemradio"] { min-height: 48px; }
  }

  .ap { margin-top: 16px; overflow: hidden; }
  .ap-head { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; text-align: left; min-width: 0; }
  .ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); flex: none; }
  .who { flex: 1; min-width: 0; }
  .who b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-head .count { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .ap-head .chev { color: var(--muted); transition: transform .15s; display: inline-grid; }
  .ap.closed .chev { transform: rotate(-90deg); }
  .ap.closed .ap-body { display: none; }
  .radios { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; }
  .radio { flex: 1 1 150px; max-width: 260px; background: var(--soft); border-radius: 12px; padding: 8px 12px; min-width: 0; }
  .radio .top { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  .radio .top b { font-weight: 500; }
  .meter { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin-top: 6px; }
  .meter i { display: block; height: 100%; background: var(--ok); }
  .meter i.busy { background: var(--warn); }
  .dev { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; border-top: 1px solid var(--line); text-align: left; min-width: 0; min-height: 56px; }
  .dev:hover { background: color-mix(in srgb, var(--soft) 60%, transparent); }
  .dev .end { display: flex; align-items: center; gap: 10px; flex: none; color: var(--muted); font-size: 12px; }
  .dev .link { color: var(--muted); display: inline-grid; }
  .dev.off .who b { color: var(--muted); }
  @container app (max-width: 480px) { .dev .rate, .dev .link { display: none; } }
  .empty { display: grid; justify-items: center; gap: 6px; padding: 48px 16px; text-align: center; color: var(--muted); }
  .empty b { color: var(--text); font-weight: 500; }

  /* network map: islands per access point, devices as buttons on their lines */
  .mapcard { margin-top: 16px; padding: 16px; }
  .maphead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
  .maphead h2 { flex: 1 1 auto; }
  .btn.sm { min-height: 34px; padding: 0 14px; font-size: 13px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-2); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .lg-line { width: 26px; height: 0; border-top: 2px solid var(--link); display: inline-block; flex: none; }
  .lg-line.wlan { border-top-style: dashed; }
  .lg-line.unknown { border-top-style: dotted; }
  .lg-dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; border: 2px solid var(--ok); background: var(--ok-soft); }
  .lg-dot.off { border: 2px dashed var(--input-line); background: var(--surface); }
  .lg-dot.blk { border-color: var(--bad); background: var(--bad-soft); }
  .lg-dot.weak { border-color: var(--warn); background: var(--warn-soft); }
  .lg-dot.sq { border-radius: 4px; }
  .isl { position: relative; }
  .isl svg.links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .isl svg.links path { fill: none; stroke: var(--link); stroke-width: 2; }
  .isl svg.links path.wlan { stroke-dasharray: 6 5; }
  .isl svg.links path.unknown { stroke-dasharray: 2 4; }
  .inet { display: flex; justify-content: center; margin-bottom: 22px; }
  .inet .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 14px; background: var(--neutral-soft); color: var(--text); font: inherit; font-size: 12px; font-weight: 500; position: relative; border: 1px solid transparent; }
  button.pill { cursor: pointer; }
  button.pill:hover { border-color: var(--accent); }
  .inet .pill .dot { width: 8px; height: 8px; }
  .inet .rates { display: flex; flex-direction: column; line-height: 1.15; }
  .inet .rates small { font-weight: 400; color: var(--muted); font-size: 11px; white-space: nowrap; }
  .isles { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 28px 16px; position: relative; }
  .isle { position: relative; border: 1px solid var(--line); border-radius: 16px; background: var(--soft); padding: 12px; min-width: 0; }
  .isle.root { grid-column: 1 / -1; background: color-mix(in srgb, var(--accent-soft) 45%, var(--soft)); }
  .isle.root .buses { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 16px; }
  .isle.lost { border-style: dashed; }
  .isle-h { display: flex; align-items: center; gap: 10px; min-width: 0; margin-bottom: 10px; }
  .isle-h .ico { width: 34px; height: 34px; }
  .isle-up { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin: -4px 0 8px; min-width: 0; }
  .loads { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 10px; }
  .load { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--surface); color: var(--muted); border: 1px solid var(--line); white-space: nowrap; }
  .load.busy { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
  .bus { border-left: 2px solid var(--link); padding: 0 0 4px 10px; margin: 0 0 10px 6px; min-width: 0; }
  .bus.wlan { border-left-style: dashed; }
  .bus.none { border-left-style: dotted; }
  .bus-h { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
  .nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 6px 4px; }
  .isl.compact .nodes { grid-template-columns: repeat(auto-fill, 44px); gap: 4px; }
  .nd { display: grid; justify-items: center; align-content: start; gap: 3px; padding: 4px 2px; border-radius: 10px; min-width: 0; text-align: center; }
  .nd:hover { background: var(--surface); }
  .nd .c { position: relative; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 600;
    border: 2px solid var(--ok); background: var(--ok-soft); color: var(--ok); }
  .nd.lan .c { border-radius: 9px; }
  .nd.off .c { border: 2px dashed var(--input-line); background: var(--surface); color: var(--muted); }
  .nd.weak .c { border-color: var(--warn); background: var(--warn-soft); color: var(--warn); }
  .nd.blk .c { border-color: var(--bad); background: var(--bad-soft); color: var(--bad); }
  .nd .bd { position: absolute; top: -5px; right: -6px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 700; border: 2px solid var(--soft); }
  .nd.weak .bd { background: var(--warn); color: var(--surface); }
  .nd.blk .bd { background: var(--bad); color: var(--surface); }
  .nd .sg { position: absolute; bottom: -4px; right: -6px; display: inline-flex; gap: 1px; align-items: flex-end; height: 10px; padding: 1px 2px; border-radius: 3px; background: var(--surface); }
  .nd .sg i { width: 2px; background: var(--line); }
  .nd .sg i.on { background: var(--ok); }
  .nd .sg.mid i.on { background: var(--warn); }
  .nd .sg.low i.on { background: var(--bad); }
  .nd .nm { font-size: 11px; line-height: 1.25; color: var(--text); max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; hyphens: auto; }
  .nd.off .nm { color: var(--muted); }
  .isl.compact .nd .nm { display: none; }
  .nd.hl .c { box-shadow: 0 0 0 4px var(--focus); }
  .hidden-note { font-size: 12px; color: var(--muted); margin: 0 0 4px 18px; }
  @container app (max-width: 600px) {
    .mapcard, .toolbar { padding: 12px; }
    .isles { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .isle:not(.root) { margin-left: 26px; }
    .isle { padding: 10px; }
    .nodes { grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); }
    .inet { justify-content: flex-start; margin-bottom: 14px; }
  }

  /* the device as a page of its own */
  .dhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
  .dhead h1 { flex-basis: 100%; order: 3; min-width: 0; font-size: 24px; font-weight: 500; margin: 4px 0 0; letter-spacing: -.01em; overflow-wrap: anywhere; line-height: 1.25; }
  .dhead h1:focus { outline: none; }
  .dhead h1:focus-visible { outline: 3px solid var(--focus); }
  .back { display: inline-flex; align-items: center; gap: 6px; color: var(--accent-hover); font-weight: 500; min-height: 40px; padding: 0 10px 0 6px; border-radius: 20px; flex: none; margin-left: -6px; }
  .back:hover { background: var(--accent-soft); }
  .pager { display: inline-flex; align-items: center; gap: 2px; color: var(--muted); font-size: 12px; flex: none; margin-left: auto; }
  .icon-btn { width: 40px; height: 40px; border-radius: 50%; display: inline-grid; place-items: center; color: var(--muted); flex: none; }
  .icon-btn:hover { background: var(--neutral-soft); color: var(--text); }
  .icon-btn[disabled] { opacity: .4; cursor: default; }
  .chips-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .dsecs { display: grid; gap: 12px; margin-top: 14px; }
  .dsecs .card + .card { margin-top: 0; }
  @container app (min-width: 900px) { .dsecs { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; } .dsecs .wide { grid-column: 1 / -1; } }
  .sec { padding: 16px; min-width: 0; }
  .sec > .label { display: block; margin-bottom: 10px; }
  .path { display: flex; align-items: center; min-width: 0; padding-bottom: 22px; }
  .path .pn { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 0 1 auto; padding: 6px 10px; border-radius: 12px; background: var(--soft); }
  .path .pn b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path .pn.me { background: var(--accent-soft); color: var(--accent-hover); }
  /* the line sits on the middle of the nodes whatever the label is; the label hangs below it */
  .path .pl { flex: 1 1 40px; min-width: 36px; position: relative; font-size: 11px; color: var(--muted); padding: 0 4px; text-align: center; }
  .path .pl i { display: block; width: 100%; border-top: 2px solid var(--link); margin: 0; }
  .path .pl span { position: absolute; left: 0; right: 0; top: 8px; }
  .path .pl.wlan i { border-top-style: dashed; }
  .path .pl.unknown i { border-top-style: dotted; }
  .path .pl.weak i { border-color: var(--warn); }
  .path .pl.weak { color: var(--warn); }
  @container app (max-width: 700px) {
    .path { flex-direction: column; align-items: stretch; padding-bottom: 0; }
    .path .pl span { position: static; }
    .path .pl { min-height: 34px; display: grid; grid-template-columns: auto 1fr; align-items: center; justify-items: start; gap: 10px; padding: 0 0 0 18px; text-align: left; }
    .path .pl i { width: 0; height: 30px; border-top: 0; border-left: 2px solid var(--link); margin: 0; }
    .path .pl.wlan i { border-left-style: dashed; }
    .path .pl.unknown i { border-left-style: dotted; }
    .path .pl.weak i { border-color: var(--warn); }
  }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 12px; }
  .tile { background: var(--soft); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .tile b { display: block; font-size: 18px; font-weight: 500; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .section { margin-top: 18px; }
  .section > .label { display: block; margin-bottom: 8px; }
  dl { margin: 0; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px 12px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .mono { font-family: var(--code-font-family, ui-monospace, monospace); font-size: 13px; }
  .action { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-2); min-height: 56px; flex-wrap: wrap; }
  .sec > .label + .action, .note + .action { border-top: 0; padding-top: 0; }
  .action > div:first-child { flex: 1 1 160px; min-width: 0; }
  .action small { display: block; color: var(--muted); font-size: 12px; }
  .action .ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; max-width: 100%; }
  .action select { width: auto; min-width: 150px; max-width: 100%; }
  .val { font-weight: 500; }
  .val-line { display: block; font-weight: 500; font-size: 15px; }
  .switch { position: relative; width: 52px; height: 32px; border-radius: 16px; background: #aeb6c1; flex: none; transition: background .15s; }
  .switch::after { content: ""; position: absolute; top: 4px; left: 4px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(20px); }
  .switch[disabled] { opacity: .55; cursor: default; }
  .inet-status { display: flex; align-items: center; gap: 10px; border-radius: 8px; padding: 10px 12px; margin-bottom: 4px; font-weight: 500; }
  .inet-status .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: currentColor; }
  .inet-status .switch { margin-left: auto; }
  .inet-status.ok { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
  .inet-status.bad { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); }
  .sec > .inet-status + .action { border-top: 0; }
  .entities-note { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-2); font-size: 12px; color: var(--muted); }
  .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .sec .note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 12px; font-size: 13px; }
  .sec .note span { flex: 1 1 180px; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

  /* cleanup + filter */
  .pad { padding: 20px; }
  .lead { color: var(--muted); margin: 4px 0 16px; max-width: 70ch; }
  .range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 8px; }
  .range > span { flex: 1 1 100%; font-weight: 500; }
  #days-seg .seg { grid-auto-flow: column; width: auto; flex-wrap: wrap; }
  @container app (max-width: 600px) { #days-seg .seg { grid-template-columns: repeat(3, 1fr); grid-auto-flow: row; } #days-seg .seg button { text-align: center; border-top: 1px solid var(--input-line); } #days-seg .seg button:nth-child(3n+1) { border-left: 0; } #days-seg .seg button:nth-child(-n+3) { border-top: 0; } }
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
  .col > * + *, #f-controls > * + * { margin-top: 16px; }
  .phead h1 { font-size: 24px; font-weight: 500; margin: 4px 0 0; letter-spacing: -.01em; }
  .phead .lead { margin: 6px 0 0; }
  .col h2 { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
  .col label.search { margin: 12px 0 4px; }
  .count { color: var(--muted); font-size: 13px; margin: 12px 0 4px; }
  .crows { margin-top: 4px; }
  .crow { cursor: pointer; }
  .crow .since { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .crow:has(input:checked) { background: var(--accent-soft); margin: 0 -12px; padding-left: 12px; padding-right: 12px; border-radius: 8px; }
  .sticky { position: sticky; bottom: 12px; z-index: 2; box-shadow: var(--shadow); }
  .btn.danger, .btn.p.danger { background: var(--bad); border-color: var(--bad); color: var(--bg); }
  .btn.p.danger:hover { filter: brightness(1.08); }
  .foldhead { display: flex; align-items: center; gap: 10px; width: 100%; padding: 0; font: inherit; font-size: 16px; font-weight: 500; color: var(--text); text-align: left; }
  .foldhead em { font-style: normal; font-size: 12px; color: var(--muted); background: var(--neutral-soft); border-radius: 10px; padding: 1px 8px; }
  .foldhead .chev { margin-left: auto; color: var(--muted); }
  button.foldhead { cursor: pointer; }
  #hidden .hint { margin: 8px 0 0; }
  #hidden .lead { margin: 10px 0 4px; }
  .modecards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  @container app (max-width: 700px) { .modecards { grid-template-columns: minmax(0, 1fr); } }
  .modecard { text-align: left; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow); cursor: pointer; font: inherit; color: var(--text); display: flex; flex-direction: column; gap: 4px; }
  .modecard small { color: var(--muted); font-size: 12px; line-height: 1.4; }
  .modecard:hover { border-color: var(--accent); }
  .modecard[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
  .modecard[aria-pressed="true"] b { color: var(--accent-hover); }
  .selhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 8px 0; }
  .selhead .count { margin: 0; }
  .applybar { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
  .applybar .sum { display: flex; flex-wrap: wrap; gap: 8px 10px; }
  .applybar .note, .applybar .muted { margin: 10px 0 0; font-size: 13px; }
  .applybar .btn-row { margin-top: 12px; }
  .pill2 { border-radius: 14px; padding: 4px 12px; background: var(--neutral-soft); color: var(--muted); font-size: 13px; }
  .pill2 b { color: var(--text); font-size: 15px; font-weight: 600; margin-right: 2px; }
  .pill2.ok { background: var(--ok-soft); color: var(--ok); }
  .pill2.bad { background: var(--bad-soft); color: var(--bad); }
  #internet-view .card + .card, #internet-view .card + .two, #internet-view .two + .card { margin-top: 16px; }
  #internet-view .two > .card { margin-top: 0; }
  .hero { background: linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--surface); }
  .live { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .live b { display: block; font-size: 26px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .live .dn b { color: var(--accent); }
  .live .upl b { color: var(--up); }
  .live .gl { color: var(--muted); font-size: 12px; }
  .tile .since { color: var(--warn); font-size: 11px; text-transform: none; letter-spacing: 0; }
  .tile .cmp { display: flex; flex-wrap: wrap; gap: 2px 6px; align-items: center; margin-top: 2px; font-size: 12px; color: var(--muted); }
  .tile .chip { white-space: nowrap; border-radius: 8px; padding: 0 6px; font-size: 11px; font-weight: 500; background: var(--neutral-soft, var(--soft)); color: var(--text); }
  .tile .chip.hi { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
  .tile .chip.lo { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
  .tile .peak { margin-top: 6px; font-size: 12px; color: var(--muted); }
  #internet-view svg.spark.mini { height: 34px; margin-top: 8px; }
  .spark.mini rect.bd { fill: var(--accent); }
  .spark.mini rect.bu { fill: var(--up); }
  .spark.mini rect.gap { fill: none; stroke: var(--line); stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
  .month { margin-top: 8px; background: var(--soft); border-radius: 12px; padding: 10px 12px; }
  .month .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; }
  .month .meter { display: flex; height: 8px; margin-top: 8px; border-radius: 4px; overflow: hidden; background: var(--line); }
  .month .meter i { display: block; height: 100%; }
  .month .meter .d { background: var(--accent); }
  .month .meter .u { background: var(--up); }
  .subhead { margin: 16px 0 6px; font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .plot { position: relative; touch-action: pan-y; }
  .plot .cursor { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--muted); pointer-events: none; }
  .plot .tip { position: absolute; top: 4px; transform: translateX(-50%); padding: 3px 8px; border-radius: 8px; background: var(--text); color: var(--bg); font-size: 12px; font-weight: 500; white-space: nowrap; pointer-events: none; z-index: 1; }
  #internet-view svg.spark { width: 100%; height: 72px; }
  #internet-view svg.spark.days { height: 90px; }
  .live ~ .gauge .gv { display: none; }
  .live ~ .gauge .gs { grid-column: 2 / 4; }
  .spark.days rect.bd { fill: var(--accent); }
  .spark.days rect.bu { fill: var(--up); }
  .topdev .rank { display: none; }
  .topdev .bar { display: flex; }
  .topdev .bar i.bd { background: var(--accent); }
  .topdev .bar i.bu { background: var(--up); }
  .spectrum { margin-top: 16px; }
  figure.spec { margin: 14px 0 0; }
  figure.spec figcaption { font-size: 13px; margin-bottom: 4px; }
  figure.spec figcaption small { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .specbox { position: relative; padding-left: 26px; }
  .specbox .yax { position: absolute; left: 0; top: 0; bottom: 0; width: 22px; }
  .specbox .yax span { position: absolute; right: 0; transform: translateY(50%); font-size: 11px; color: var(--muted); }
  .specbox .plot svg { width: 100%; height: 150px; display: block; background: var(--soft); border-radius: 8px; }
  .specbox .plot .tip { top: -4px; transform: translate(-50%, -100%); }
  .specbox rect { fill: var(--accent); }
  figure.spec.su rect { fill: var(--up); }
  .specbox rect.dip { fill: var(--warn); }
  .sgrid line { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .savg { stroke: var(--text); stroke-width: 1; stroke-dasharray: 4 3; opacity: .55; vector-effect: non-scaling-stroke; }
  .xax { position: relative; height: 16px; margin-left: 26px; }
  .xax span { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--muted); }
  .xax em { position: absolute; right: 0; font-style: normal; font-size: 11px; color: var(--muted); }
  .specverdict { margin: 12px 0 0; padding: 8px 12px; border-radius: 10px; background: var(--soft); }
  .specverdict.bad { background: var(--warn-soft); color: var(--warn); }
  ul.ports { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  ul.ports li { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; padding: 8px 0; border-top: 1px solid var(--line); }
  ul.ports li:first-child { border-top: 0; }
  .capform { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; align-items: end; margin: 8px 0; }
  .capform input[type="number"] { width: 100%; height: 42px; border-radius: 10px; border: 1px solid var(--input-line); background: var(--surface); padding: 0 12px; min-width: 0; }
  .caprun { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; align-items: center; margin: 8px 0; }
  .caprun small { color: var(--muted); }
  ul.checksteps li.bad .pdesc { color: var(--danger, #b3261e); }
  .apblock + .apblock { margin-top: 14px; }
  .aphead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 12px; }
  .aphead small { color: var(--muted); }
  ul.radios { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 12px; }
  .vpntiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
  .vpnlist { list-style: none; margin: 8px 0 0; padding: 0; }
  .vpnrow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .vpnrow:first-child { border-top: 0; }
  .vpnrow .i { width: 20px; height: 20px; color: var(--muted); }
  .vpnrow.up .i { color: var(--ok); }
  .routerow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .routerow:first-child { border-top: 0; }
  .routerow .i { width: 20px; height: 20px; color: var(--muted); }
  .routerow.on .i { color: var(--ok); }
  .routerow.down .i { color: var(--bad); }
  .routerow.off .routenet { opacity: .6; }
  .routerow .switch[aria-checked="true"] { background: var(--ok); }
  .routenet { flex: 1; min-width: 0; }
  .routepick { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
  .routepick:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .routerow { border-radius: 10px; padding-left: 8px; padding-right: 8px; }
  .routerow:hover { background: var(--soft); }
  .routerow[aria-current="true"] { background: var(--accent-soft); }
  .routelayout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; margin-top: 16px; }
  @container app (max-width: 900px) { .routelayout { grid-template-columns: minmax(0, 1fr); } }
  .routelayout > .card + .card { margin-top: 0; }
  .routedetail dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 12px 0 0; }
  .routedetail dt { color: var(--muted); }
  .routedetail dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .routedetail .ahint { margin: 8px 0 0; }
  .rschema { display: grid; justify-items: center; margin: 10px 0 12px; }
  .rnode { border: 1px solid var(--line); background: var(--soft); border-radius: 10px; padding: 5px 12px; text-align: center; min-width: 190px; max-width: 100%; line-height: 1.3; }
  .rnode b { display: block; font-weight: 500; overflow-wrap: anywhere; }
  .rnode small { color: var(--muted); font-size: 12px; }
  .rnode.gw { border-color: var(--ok); }
  .rnode.gw.down { border-color: var(--bad); background: var(--bad-soft); }
  .rnode.gw.off { border-style: dashed; opacity: .65; }
  .rnode.dst { background: transparent; border-style: dashed; }
  .rlink { width: 2px; height: 14px; background: var(--ok); position: relative; }
  .rlink.off { background: var(--line); }
  .rlink span { position: absolute; left: 10px; top: 0; font-size: 11px; color: var(--muted); white-space: nowrap; line-height: 14px; }
  #routes-view > * + * { margin-top: 16px; }
  .routenet b { display: block; font-weight: 500; }
  .routenet small { color: var(--muted); }
  .btn.del { color: var(--bad); }
  .routemsg { min-height: 20px; margin: 12px 0 0; font-size: 13px; }
  .routemsg.bad { color: var(--bad); }
  .routemsg.warn { color: var(--warn); }
  .routemsg.ok { color: var(--ok); }
  .routeform .afield small { font-size: 12px; }
  .vpnswitch { flex: none; }
  .vpnname { flex: 1; min-width: 0; }
  .vpnname b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vpnname small { color: var(--muted); }
  #vpn-view .card, #vpn-view .hint { margin-top: 16px; }
  .radiorow .rtop { display: flex; justify-content: space-between; align-items: baseline; }
  .radiorow .rpct { font-variant-numeric: tabular-nums; font-weight: 500; }
  .radiorow.warn .rpct { color: var(--warn); }
  .radiorow.bad .rpct { color: var(--bad); }
  .radiorow .meter { display: block; margin-top: 4px; }
  .radiorow .meter i.warn { background: var(--warn); }
  .radiorow .meter i.bad { background: var(--bad); }
  .radiorow small { display: block; color: var(--muted); margin-top: 4px; }
  .checktiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 14px 0 4px; }
  .checktile { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; background: var(--neutral-soft); }
  .checktile .ico { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--surface); flex: none; }
  .checktile .ico svg { width: 16px; height: 16px; }
  .checktile.ok .ico { color: var(--ok); }
  .checktile.bad { background: var(--bad-soft); }
  .checktile.bad .ico { color: var(--bad); }
  .checktile.off { opacity: .75; }
  .checktile .who { display: grid; min-width: 0; }
  .checktile small { color: var(--muted); font-size: 12px; }
  .checktile b { font-weight: 500; }
  details.explain { margin-top: 14px; }
  details.explain summary { cursor: pointer; color: var(--muted); font-size: 13px; width: fit-content; }
  details.explain summary:hover { color: var(--text); }
  details.explain .hint { margin: 6px 0 0; }
  .logkinds { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
  button.chip { cursor: pointer; border: 1px solid transparent; }
  button.chip[aria-pressed="true"] { border-color: currentColor; }
  ul.logrows li.mark .pdesc { font-weight: 500; }
  .course { margin-top: 18px; }
  .latrow { margin-top: 14px; }
  .latrow:first-child { margin-top: 0; }
  .lathead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
  .lathead small { color: var(--muted); }
  svg.latstrip { display: block; width: 100%; height: 14px; margin-top: 6px; }
  .lat.ok { fill: var(--ok); background: var(--ok); opacity: .8; }
  .lat.slow { fill: var(--warn); background: var(--warn); }
  .lat.fail { fill: var(--bad); background: var(--bad); }
  .lat.none { fill: var(--line); background: var(--line); }
  i.lat { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .seg.logseg { display: flex; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .seg.logseg button { flex: none; }
  @container app (max-width: 600px) {
    ul.logrows li { grid-template-columns: 1fr; gap: 2px; }
    ul.logrows .pmap { text-align: left; font-size: 12px; }
  }
  ul.logrows { margin-top: 10px; max-height: 420px; overflow: auto; }
  ul.logrows .pmap { white-space: nowrap; }
  .capbtns { display: flex; gap: 6px; flex-wrap: wrap; }
  .subtabs { margin-bottom: 14px; }
  .detectrow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 4px 0 8px; }
  .detectrow small { color: var(--muted); flex: 1 1 260px; }
  .capexisting { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .capsum { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .capsum ul.ports { margin-bottom: 10px; }
  .capstart { background: var(--soft); border-radius: 14px; padding: 14px 16px; margin: 10px 0 6px; }
  .capstart .capform { margin: 0; }
  .detectrow { padding: 0 4px; }
  ul.capfiles { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
  li.capfile { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  li.capfile:hover { background: var(--soft); }
  .capmain { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
  .capmain b { font-size: 14px; font-weight: 500; }
  .capmain code { font-size: 12px; color: var(--muted); }
  .capmeta { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 2px 14px; color: var(--muted); font-size: 12px; }
  ul.ports li.off { opacity: .6; }
  ul.ports .pdesc { font-weight: 500; }
  ul.ports .pmap { color: var(--muted); text-align: right; }
  ul.ports small { grid-column: 1 / -1; color: var(--muted); }
  .dot.on { background: var(--ok); }
  .dot.warn { background: var(--warn); }
  .chip.open { background: var(--warn-soft); color: var(--warn); }
  .chip.part { background: var(--accent-soft); color: var(--accent-hover); }
  .chip.dim { opacity: .55; }
  .chip.proto { background: transparent; border: 1px solid var(--line); color: var(--text); font-family: var(--code-font-family, ui-monospace, monospace); font-size: 11.5px; }
  .pftiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 4px 0 14px; }
  .pftile { background: var(--soft); border-radius: 14px; padding: 10px 14px; }
  .pftile b { display: block; font-size: 22px; font-weight: 500; line-height: 1.25; }
  .pftile.open b { color: var(--warn); }
  .pftile small { color: var(--muted); font-size: 12px; }
  .pffilters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .pffilters .fchip { min-height: 30px; font-size: 13px; }
  .pffilters .fchip em { font-style: normal; color: var(--muted); }
  .pfdev { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .pfdev + .pfdev { margin-top: 12px; }
  .pfhead { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--soft); }
  .pfhead b { font-weight: 500; }
  .pfhead .sp { flex: 1; }
  .pfcols, .pfrule { display: grid; grid-template-columns: 96px minmax(0, 1fr) 64px minmax(190px, auto); gap: 4px 16px; align-items: center; padding: 10px 14px; }
  .pfcols { padding-top: 8px; padding-bottom: 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line); }
  .pfcols .r { text-align: right; }
  .pfrule + .pfrule { border-top: 1px solid var(--line); }
  .pfrule.closed .pfname, .pfrule.closed .pfports { opacity: .55; }
  .pfname { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
  .pfname b { font-weight: 500; }
  .pfports { text-align: right; white-space: nowrap; }
  .pfports .arrow { color: var(--muted); padding: 0 4px; }
  .pfports small { display: block; color: var(--muted); font-size: 11.5px; }
  .pfnote { margin: 14px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 13px; background: var(--soft); color: var(--muted); }
  .pfnote.warn { background: var(--warn-soft); color: var(--warn); margin: 0 0 12px; }
  @container app (max-width: 720px) {
    .pfcols { display: none; }
    .pfrule { grid-template-columns: auto minmax(0, 1fr); }
    .pfrule .pfproto { grid-column: 2; }
    .pfrule .pfports { grid-column: 1 / -1; text-align: left; }
  }
  button.linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--accent-hover); cursor: pointer; text-decoration: underline; }
  .hints { padding: 8px 16px; }
  .hintline { display: flex; align-items: center; gap: 10px; margin: 6px 0; font-size: 14px; }
  .hintline.bad { color: var(--bad); }
  .hintline.warn { color: var(--warn); }
  .hintline.info { color: var(--muted); }
  #internet-view .card.hints + .card, #net-view > #hints > .card.hints { margin-bottom: 16px; }
  .ihead { display: flex; align-items: center; gap: 12px; }
  .ihead .ico { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); flex: none; }
  .ihead .who { flex: 1; min-width: 0; }
  .ihead .who b { display: block; font-size: 18px; font-weight: 500; }
  .ihead .who small { color: var(--muted); }
  .stat.warn { background: var(--warn-soft); color: var(--warn); }
  .gauge { display: grid; grid-template-columns: 76px 1fr auto; gap: 2px 12px; align-items: center; margin-bottom: 12px; }
  .gauge .meter { height: 10px; border-radius: 5px; background: var(--neutral-soft); overflow: hidden; }
  .gauge .meter i { display: block; height: 100%; border-radius: 5px; background: var(--accent); }
  .gauge.upl .meter i { background: var(--up); }
  .gauge .gv { font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; min-width: 9ch; }
  .gauge .gs { grid-column: 2 / 4; color: var(--muted); font-size: 12px; }
  .spark { width: 100%; height: 72px; display: block; margin-top: 8px; }
  .spark line { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .spark path { fill: none; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
  .spark .dn { stroke: var(--accent); }
  .spark .dn-area { stroke: none; fill: color-mix(in srgb, var(--accent) 16%, transparent); }
  .spark .upl { stroke: var(--up); }
  .legend2 { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--muted); margin-top: 4px; }
  .legend2 i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 4px; vertical-align: middle; background: var(--accent); }
  .legend2 i.upl { background: var(--up); }
  .legend2 .grow { margin-left: auto; }
  .addrs { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .addrs li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-top: 1px solid var(--line); }
  .addrs li:first-child { border-top: 0; }
  .addrs code { overflow-wrap: anywhere; }
  .addrs small { color: var(--muted); text-align: right; flex: none; }
  .dnstile { margin-top: 8px; }
  .dnstile .tlabel { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .dnslist { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); grid-template-rows: repeat(2, auto); gap: 2px 24px; font-size: 13px; }
  .dnslist code { overflow-wrap: anywhere; }
  .addrtable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; margin-top: 8px; }
  .addrtable th { text-align: left; font-weight: 400; font-size: 12px; color: var(--muted); padding: 0 8px 8px 0; }
  .addrtable td { padding: 10px 8px 10px 0; border-top: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
  .addrtable .when small { display: block; color: var(--muted); }
  .addrtable .badge { margin-left: 6px; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--accent-soft, var(--soft)); color: var(--accent, inherit); }
  .addrtable tr.now td { background: var(--soft); }
  @media (max-width: 640px) {
    .addrtable thead { display: none; }
    .addrtable, .addrtable tbody, .addrtable tr, .addrtable td { display: block; }
    .addrtable tr { border-top: 1px solid var(--line); padding: 8px 0; }
    .addrtable td { border: 0; padding: 2px 8px; background: none !important; }
    .addrtable td[data-label]::before { content: attr(data-label); display: block; font-size: 11px; color: var(--muted); }
  }
  .events { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .events li { display: flex; gap: 12px; padding: 6px 0; border-top: 1px solid var(--line); }
  .events li:first-child { border-top: 0; }
  .events time { color: var(--muted); width: 12ch; flex: none; }
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 40%); display: none; place-items: center; z-index: 20; padding: 16px; }
  .backdrop.open { display: grid; }
  .dialog { width: min(440px, 100%); background: var(--surface); border-radius: 16px; padding: 24px; box-shadow: 0 6px 24px rgb(0 0 0 / 28%); max-height: 90vh; overflow: auto; }
  .dialog h2 { margin-bottom: 8px; }
  .dialog ul { margin: 8px 0; padding-left: 20px; max-height: 140px; overflow: auto; }
  .dialog .btn-row { justify-content: flex-end; margin-top: 20px; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); opacity: 0; transition: .2s; background: var(--text); color: var(--surface); padding: 10px 18px; border-radius: 12px; max-width: min(560px, calc(100vw - 32px)); z-index: 30; pointer-events: none; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  /* the flat list as a table */
  .tablecard { margin-top: 16px; overflow: hidden; }
  .tablewrap { overflow-x: auto; }
  .devtable { width: 100%; border-collapse: collapse; }
  .devtable th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; padding: 0; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface); }
  .devtable th.num, .devtable td.num { text-align: right; }
  .devtable th > button { font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; width: 100%; padding: 10px 12px; display: inline-flex; align-items: center; gap: 6px; text-align: inherit; }
  .devtable th.num > button { justify-content: flex-end; }
  .devtable th > button:hover, .devtable th[aria-sort="ascending"] > button, .devtable th[aria-sort="descending"] > button { color: var(--accent-hover); }
  .arrow { width: 0; height: 0; border: 4px solid transparent; opacity: 0; }
  .arrow.up { border-bottom-color: currentColor; border-top-width: 0; opacity: 1; }
  .arrow.down { border-top-color: currentColor; border-bottom-width: 0; opacity: 1; }
  .devtable td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; font-size: 13px; }
  .devtable tbody tr { cursor: pointer; }
  .devtable tbody tr:hover td { background: var(--soft); }
  .devtable tbody tr[aria-current="true"] td { background: var(--accent-soft); }
  .devtable tr.off td { color: var(--muted); }
  .who2 { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .who2 .link { color: var(--muted); display: inline-grid; }
  .who2 .who { min-width: 0; }
  .tlink { font-size: 14px; font-weight: 500; text-align: left; color: var(--text); display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .devtable tr.off .tlink { color: var(--muted); }
  .devtable .who small { display: block; color: var(--muted); font-size: 12px; }
  .chips2 { display: inline-flex; gap: 6px; margin-left: 8px; vertical-align: middle; }
  .chips2:empty { display: none; }
  .chip.warn { background: var(--warn-soft); color: var(--warn); }
  .devtable .bars { margin-left: 8px; vertical-align: middle; }
  .hist { width: 112px; }
  svg.spark { width: 96px; height: 26px; display: block; }
  .devtable .spark path { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .devtable .spark .area { fill: var(--accent); opacity: .12; stroke: none; }
  .devtable .spark.off path { stroke: var(--link); }
  .devtable .spark.off .area { fill: var(--link); }
  .tpager { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px 14px; padding: 10px 16px; color: var(--muted); font-size: 13px; }
  .tpager select { margin-left: 8px; min-height: 32px; border: 1px solid var(--input-line); border-radius: 8px; background: var(--surface); padding: 0 8px; }
  .tpager .btn { min-height: 32px; padding: 0 10px; }
  @container app (max-width: 760px) { .devtable .wide { display: none; } }
  @container app (max-width: 520px) { .devtable .hist, .devtable th:nth-child(4) { display: none; } .chips2 { display: none; } }

  .trendhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .trendhead .seg { grid-auto-flow: column; width: auto; }
  .trendhead .seg button { min-height: 32px; text-align: center; border-top: 0; }
  .trends { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px 24px; margin-top: 8px; }
  .topdev { list-style: none; margin: 8px 0 0; padding: 0; }
  .topdev li { display: grid; grid-template-columns: minmax(90px, 200px) 1fr auto; align-items: center; gap: 12px; padding: 6px 0; border-top: 1px solid var(--line); }
  .topdev li:first-child { border-top: 0; }
  .topdev .tlink { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topdev .bar { height: 8px; border-radius: 4px; background: var(--soft); overflow: hidden; }
  .topdev .bar i { display: block; height: 100%; background: var(--accent); }
  .topdev .amount { text-align: right; white-space: nowrap; }
  .topdev small, .vol small { color: var(--muted); font-size: 12px; }
  @media (max-width: 560px) { .topdev li { grid-template-columns: 1fr auto; } .topdev .bar { grid-column: 1 / -1; order: 3; } }
  .volume { margin-top: 18px; }
  .vols { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 8px; }
  .vols .vol { display: flex; flex-direction: column; gap: 4px; background: var(--soft); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .vols b { font-size: 18px; font-weight: 500; line-height: 1.3; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .vols .vbar { height: 6px; border-radius: 3px; background: var(--surface); overflow: hidden; }
  .vols .vbar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
  .vols i.vd { font-style: normal; color: var(--accent); }
  .vols i.vu { font-style: normal; color: var(--up); }
  .vols small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .trend .plot { position: relative; touch-action: pan-y; }
  .trend .plot svg { margin: 6px 0 2px; }
  .trend .cursor { position: absolute; top: 6px; height: 90px; width: 0; border-left: 1px dashed var(--muted); pointer-events: none; }
  .trend .tip { position: absolute; top: 10px; transform: translateX(-50%); padding: 3px 8px; border-radius: 8px; background: var(--text); color: var(--bg, #fff); font-size: 12px; font-weight: 500; white-space: nowrap; pointer-events: none; }
  .trend svg { width: 100%; height: 90px; display: block; margin: 6px 0 2px; background: var(--soft); border-radius: 10px; }
  .trend path { fill: none; stroke: var(--accent); stroke-width: 1.8; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .trend path.area { fill: var(--accent); opacity: .12; stroke: none; }

  /* address page */
  #addresses-view > * + *, #addresses-view .alayout + * { margin-top: 16px; }
  #internet-view .phead, #addresses-view .phead, #diagnose-view .phead { margin-bottom: 16px; }
  #diagnose-view > * + * { margin-top: 16px; }
  #diagnose-view .phead { margin-bottom: 0; }
  .diagrow { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr)); gap: 16px; align-items: start; }
  .diagrow > .card { margin-top: 0; }
  #addresses-view .atiles { margin-top: 0; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  #addresses-view .tile b, #addresses-view .tile small { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
  #addresses-view .tile { box-shadow: var(--shadow); border: 1px solid var(--line); background: var(--surface); }
  #addresses-view .tile b { font-size: 20px; }
  #addresses-view .tile.wide { grid-column: span 2; }
  @media (max-width: 520px) { #addresses-view .tile.wide { grid-column: 1 / -1; } }
  .ameter { height: 8px; border-radius: 4px; background: var(--free); overflow: hidden; margin: 8px 0 4px; display: flex; }
  .ameter i { display: block; height: 100%; }
  .ahints { display: grid; gap: 8px; }
  .ahint { display: flex; align-items: stretch; border-radius: 12px; font-size: 13px; }
  .ahint.bad { background: var(--bad-soft); color: var(--bad); }
  .ahint.warn { background: var(--warn-soft); color: var(--warn); }
  .ahint.info { background: var(--accent-soft); color: var(--accent-hover); }
  .ahint .hbody { flex: 1; display: flex; gap: 10px; padding: 10px 12px; text-align: left; border-radius: 12px 0 0 12px; color: inherit; font: inherit; min-width: 0; }
  .ahint .hbody:disabled { cursor: default; }
  .ahint .hx { padding: 0 12px; font-size: 12px; opacity: .75; border-left: 1px solid rgb(0 0 0 / 8%); border-radius: 0 12px 12px 0; white-space: nowrap; color: inherit; }
  .ahint .hx:hover, .ahint .hbody:not(:disabled):hover { filter: brightness(.95); opacity: 1; }
  .ahint.flat { margin-top: 14px; }
  .ahint.flat .hbody { border-radius: 12px; }
  .muted-row { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .muted-row button { color: var(--accent-hover); font-weight: 500; }
  .alayout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
  @container app (max-width: 900px) { .alayout { grid-template-columns: minmax(0, 1fr); } }
  .amaphead { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .achips { display: flex; flex-wrap: wrap; gap: 8px; }
  .achip { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 12px; border-radius: 15px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; color: var(--text); }
  .achip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
  .achip em { font-style: normal; color: var(--muted); }
  .agrid { display: grid; grid-template-columns: 28px repeat(16, minmax(0, 1fr)); gap: 3px; margin-top: 12px; }
  .rowlab, .collab { font-size: 10px; color: var(--muted); font-family: ui-monospace, Menlo, monospace; }
  .rowlab { display: grid; place-items: center; }
  .collab { text-align: center; }
  .cell { position: relative; aspect-ratio: 1; border-radius: 6px; background: var(--free); font-size: 10px; display: grid; place-items: center; color: var(--muted); font-family: ui-monospace, Menlo, monospace; transition: transform .08s; min-width: 0; padding: 0; cursor: pointer; }
  .cell:hover { transform: scale(1.18); z-index: 3; box-shadow: 0 2px 8px rgb(0 0 0 / 30%); }
  .cell[data-s="dyn"] { background: var(--accent); color: var(--on-accent); }
  .cell[data-s="fix"] { background: var(--fixed); color: #fff; }
  .cell[data-s="off"] { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); color: var(--accent); }
  .cell[data-s="offfix"] { background: transparent; box-shadow: inset 0 0 0 2px var(--fixed); color: var(--fixed); }
  .cell[data-s="box"] { background: var(--ok); color: #fff; }
  .cell[data-s="res"] { background: var(--warn-soft); color: var(--warn); box-shadow: inset 0 0 0 1px var(--warn); }
  .cell[data-s="na"] { background: repeating-linear-gradient(45deg, var(--free), var(--free) 3px, transparent 3px, transparent 6px); opacity: .6; cursor: default; }
  .cell[data-s="hold"] { background: repeating-linear-gradient(45deg, var(--warn-soft) 0 3px, transparent 3px 6px); color: var(--warn); box-shadow: inset 0 0 0 1px var(--warn); }
  .cell[data-s="ext"] { background: transparent; color: var(--muted); box-shadow: inset 0 0 0 2px var(--muted); }
  .cell[data-s="plan"] { background: transparent; color: var(--ok); border: 2px dashed var(--ok); }
  .cell.pool[data-s="free"] { background: var(--accent-soft); }
  .cell.warn::after { content: "!"; position: absolute; top: -5px; right: -3px; width: 14px; height: 14px; border-radius: 50%; background: var(--bad); color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; font-family: system-ui; }
  .cell.note::before { content: ""; position: absolute; left: 3px; top: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .cell.blk { border-bottom: 4px solid var(--bc); }
  .cell.dim { opacity: .18; }
  .cell.sel { outline: 3px solid var(--text); outline-offset: 1px; z-index: 4; }
  .alegend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 14px; font-size: 12px; color: var(--muted); }
  .alg { display: inline-flex; align-items: center; gap: 6px; }
  .alg i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; }
  .adetail { position: sticky; top: 76px; }
  @container app (max-width: 900px) { .adetail { position: static; } }
  .adetail h2 { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 500; margin: 0 0 10px; }
  .adetail .big { font-size: 18px; font-weight: 500; }
  .adetail dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 12px 0 0; }
  .adetail dt { color: var(--muted); }
  .adetail dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .adetail .small { font-size: 12px; margin-top: 10px; }
  .adetail .spaced { display: block; margin-top: 16px; }
  .adetail .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .adetail .soon { font-size: 12px; color: var(--muted); margin: 8px 0 0; }
  .badge { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 12px; font-weight: 500; background: var(--soft); color: var(--muted); }
  .badge.dyn { background: var(--accent-soft); color: var(--accent-hover); }
  .badge.fix { background: var(--fixed-soft); color: var(--fixed); }
  .badge.ok { background: var(--ok-soft); color: var(--ok); }
  .badge.warn { background: var(--warn-soft); color: var(--warn); }
  .badge.bad { background: var(--bad-soft); color: var(--bad); }
  .afield { display: grid; gap: 4px; margin-top: 14px; }
  .afield label { font-size: 12px; color: var(--muted); }
  .afield input, .afield textarea, .afield select { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--input-line); border-radius: 10px; padding: 8px 10px; width: 100%; }
  .afield textarea { min-height: 64px; resize: vertical; }
  .atable { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .atable th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .atable td { padding: 9px 10px; border-top: 1px solid var(--line-2); vertical-align: middle; }
  .atable td small { display: block; color: var(--muted); font-size: 12px; }
  .arow { cursor: pointer; }
  .arow td:first-child { box-shadow: inset 3px 0 0 var(--bc, transparent); white-space: nowrap; }
  .arow .badge.pool { margin-left: 8px; font-size: 10px; padding: 0 6px; background: var(--accent-soft); color: var(--accent-hover); }
  .gchip { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 13px; }
  .gchip i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .lhint { display: block; font-size: 12px; margin-top: 2px; }
  .lhint.bad { color: var(--bad); }
  .lhint.warn { color: var(--warn); }
  .lhint.info { color: var(--muted); }
  .arow:hover td { background: var(--soft); }
  .arow[aria-current="true"] td { background: var(--accent-soft); }
  .azone { display: grid; grid-template-columns: 200px minmax(0, 1fr) auto auto; gap: 4px 16px; align-items: center; }
  .azone { grid-template-columns: 200px minmax(0, 1fr) auto; }
  .azone .name b { display: block; font-weight: 500; }
  .azone .name small { display: block; color: var(--muted); font-size: 12px; }
  .azone .ameter { margin: 0; height: 12px; }
  .azone .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  @container app (max-width: 700px) { .azone { grid-template-columns: 1fr auto; } .azone .ameter { grid-column: 1 / -1; order: 3; } }
  .btn .count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; margin: 0; border-radius: 9px; background: var(--accent-soft); color: var(--accent-hover); font-size: 11px; font-weight: 500; }
  .dialog.groups { width: min(540px, 100%); }
  .groups .ghead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .groups .ghead .hint { margin: 4px 0 0; }
  .groups .x { color: var(--muted); padding: 4px 8px; border-radius: 8px; flex: none; }
  .groups .x:hover { background: var(--bad-soft); color: var(--bad); }
  .groups .ghead .x:hover { background: var(--neutral-soft); color: var(--text); }
  .agroups { list-style: none; margin: 14px 0 4px; padding: 0; max-height: 240px; overflow: auto; }
  .agroup { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .agroup:first-child { border-top: 0; }
  .agroup > i { width: 10px; height: 28px; border-radius: 5px; flex: none; }
  .agroup .gname { flex: 1; min-width: 0; }
  .agroup .gname b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agroup .gname small { display: block; color: var(--muted); font-size: 12px; }
  .agroup .mono { white-space: nowrap; font-size: 13px; }
  .kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 6px 0 14px; }
  .kind { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--input-line); border-radius: 10px; cursor: pointer; background: var(--surface); }
  .kind input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
  .kind:has(input:checked) { border: 2px solid var(--accent); padding: 9px; background: var(--accent-soft); }
  .kind:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  .kind b { display: block; font-weight: 500; font-size: 13px; }
  .kind small { display: block; color: var(--muted); font-size: 12px; }
  .ks { width: 16px; height: 16px; border-radius: 4px; flex: none; margin-top: 2px; }
  .ks.plan { border: 2px dashed var(--ok); }
  .ks.hold { background: repeating-linear-gradient(45deg, var(--warn) 0 3px, transparent 3px 6px); border: 1px solid var(--warn); }
  .ks.ext { border: 2px solid var(--muted); background: radial-gradient(circle, var(--muted) 2px, transparent 2.5px); }
  .entryform { border-top: 0; margin-top: 12px; padding-top: 0; }
  .entryinfo { margin: 12px 0; padding: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); display: grid; gap: 6px; }
  @media (max-width: 520px) { .kinds { grid-template-columns: 1fr; } }
  .gnone { margin: 14px 0 4px; }
  .groupform { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 14px; }
  .groupform h3 { font-size: 15px; font-weight: 500; margin: 0 0 10px; }
  .gfields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .gprev { margin: 6px 0 12px; font-size: 12px; color: var(--muted); min-height: 1.4em; }
  .gprev.ok { color: var(--ok); }
  .swatches { display: flex; gap: 10px; margin-top: 4px; }
  .swatch { position: relative; width: 26px; height: 26px; cursor: pointer; }
  .swatch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
  .swatch i { display: block; width: 100%; height: 100%; border-radius: 50%; }
  .swatch input:checked + i { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
  .swatch input:focus-visible + i { outline: 3px solid var(--focus); outline-offset: 4px; }
  .groupform .btn-row { justify-content: flex-end; margin-top: 12px; }
  @media (max-width: 520px) { .gfields { grid-template-columns: 1fr; } }
  .formmsg { font-size: 12px; min-height: 16px; margin-top: 8px; color: var(--bad); }
  .poolform { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 12px; }
  .poolform .afield { margin-top: 0; width: 90px; }
  .poolform .poolbase { padding-bottom: 10px; color: var(--muted); }
  .pheadrow { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
  .pheadrow h1 { margin: 4px 0 0; }
  .aopts { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 4px 0 12px; }
  .acheck { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
  .abar { display: flex; height: 34px; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); margin: 4px 0 18px; }
  .abar div { display: grid; place-items: center; font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; }
  .abar .z-low, .abar .z-high { background: var(--fixed-soft); color: var(--fixed); }
  .abar .z-pool { background: var(--accent-soft); color: var(--accent-hover); }
  .abar .z-whole { background: var(--free); }
  .azones { display: grid; gap: 14px; }
  /* box, Wi-Fi and switching over */
  .dot.warn { background: var(--warn); }
  .dot.bad { background: var(--bad); }
  #migbanner .banner { margin-bottom: 16px; }
  #box-view > * + *, #wlan-view > * + *, #migrate-view > * + * { margin-top: 16px; }
  #box-view .phead, #wlan-view .phead, #migrate-view .phead { margin-bottom: 0; }
  #box-view .two > .card { margin-top: 0; }
  .bad-ico { color: var(--bad); display: inline-flex; }
  .tile .na { color: var(--muted); font-weight: 400; font-size: 14px; }
  .tiles.counter b { font-variant-numeric: tabular-nums; }
  dl.kv { grid-template-columns: auto minmax(0, 1fr); gap: 8px 14px; font-size: 13px; }
  dl.kv dd { text-align: right; }
  .act { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
  .sec > .label + .act { border-top: 0; padding-top: 0; }
  .act .ico { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--soft); color: var(--muted); }
  .act b { font-weight: 500; display: block; }
  .act small { color: var(--muted); font-size: 12px; display: block; }
  @container app (max-width: 520px) { .act { grid-template-columns: 40px minmax(0, 1fr); } .act .btn { grid-column: 1 / -1; } }
  .progress { display: grid; gap: 10px; padding: 14px; border-radius: 14px; background: var(--accent-soft); color: var(--accent-hover); margin-top: 12px; }
  .progress.ok { background: var(--ok-soft); color: var(--ok); }
  .progress.bad { background: var(--bad-soft); color: var(--bad); }
  .progress small, .progress dl { color: var(--text); }
  .progress ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; }
  .progress li { display: flex; gap: 8px; align-items: center; color: var(--text); }
  .progress li.done .dot { background: var(--ok); }
  .progress li.now .dot { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
  .progress .bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, currentColor 18%, transparent); overflow: hidden; }
  .progress .bar i { display: block; height: 100%; background: currentColor; border-radius: 3px; }
  .switch.busy::after { animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .4; } }
  @media (prefers-reduced-motion: reduce) { .switch.busy::after { animation: none; } }
  .net { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 4px 14px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
  .sec > .label + .net, .sec > .hintline + .net, .net.first { border-top: 0; padding-top: 0; }
  .net .ico { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hover); }
  .net.off .ico { background: var(--soft); color: var(--muted); }
  .net.off .n { opacity: .6; }
  .net .n b { font-weight: 500; display: block; overflow-wrap: anywhere; }
  .net .n b .muted { font-weight: 400; }
  .net .n small { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 2px 10px; }
  .net .end { display: flex; align-items: center; gap: 10px; }
  .net .end .chip { display: none; }
  @container app (min-width: 640px) { .net .end .chip { display: inline-flex; } }
  .guest { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 20px; align-items: start; }
  @container app (max-width: 720px) { .guest { grid-template-columns: minmax(0, 1fr); } }
  .qrbox { border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: grid; justify-items: center; gap: 10px; background: var(--soft); text-align: center; }
  .qr { width: 180px; height: 180px; background: #fff; border-radius: 10px; padding: 8px; box-sizing: border-box; }
  .qr img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  .qrveil { width: 180px; min-height: 180px; box-sizing: border-box; border-radius: 10px; display: grid; place-items: center; gap: 6px; background: repeating-linear-gradient(45deg, var(--neutral-soft) 0 8px, var(--soft) 8px 16px); color: var(--muted); font-size: 13px; padding: 12px; }
  .secret { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .secret .mono { font-size: 15px; letter-spacing: .04em; padding: 4px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); overflow-wrap: anywhere; }
  .iconbtn[aria-pressed="true"] { color: var(--accent-hover); background: var(--accent-soft); }
  .dialog .field { display: grid; gap: 4px; margin-top: 12px; }
  .pw { display: flex; align-items: center; border: 1px solid var(--input-line); border-radius: 10px; background: var(--surface); padding-right: 2px; }
  .pw:focus-within { outline: 3px solid var(--focus); outline-offset: 1px; }
  .pw input { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; padding: 0 10px; outline: none; font: inherit; color: inherit; font-family: var(--code-font-family, ui-monospace, monospace); }
  .rules { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
  .dialog ul.rules { padding-left: 0; max-height: none; }
  .rules li { display: flex; gap: 8px; align-items: center; color: var(--muted); }
  .rules li::before { content: "○"; width: 14px; text-align: center; }
  .rules li.ok { color: var(--ok); }
  .rules li.ok::before { content: "✓"; }
  .rules li.bad { color: var(--bad); }
  .rules li.bad::before { content: "✕"; }
  .dialog .msg { color: var(--bad); font-size: 13px; min-height: 18px; margin: 10px 0 0; }
  .banner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px 14px; align-items: center; padding: 14px 16px; border-radius: var(--radius); background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); }
  .banner.info { background: var(--accent-soft); color: var(--accent-hover); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
  .banner b { display: block; color: var(--text); font-weight: 500; }
  .banner span.t { color: var(--text); font-size: 13px; }
  .banner .btn-row { margin: 0; }
  @container app (max-width: 700px) { .banner { grid-template-columns: auto minmax(0, 1fr); } .banner .btn-row { grid-column: 1 / -1; } }
  .tiles .tile.ok b { color: var(--ok); }
  .tiles .tile.bad b { color: var(--bad); }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 10px; }
  .mtable { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .mtable .grp { padding: 8px 14px; background: var(--soft); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
  .mlist { list-style: none; margin: 0; padding: 0; }
  .mrow { display: grid; grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 150px; gap: 4px 12px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line); }
  .mhead { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); border-top: 0; padding-top: 8px; padding-bottom: 8px; }
  .mrow .ent { min-width: 0; }
  .mrow .ent b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mrow .ent .mono { display: block; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .mrow .ent b.mono { color: var(--text); font-size: 13px; }
  .mrow .arrow { color: var(--muted); text-align: center; }
  .mrow .why { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
  .mrow .why.warn { color: var(--warn); }
  .mrow .why.bad { color: var(--bad); }
  .mrow.dim .ent { opacity: .65; }
  @container app (max-width: 760px) {
    .mhead { display: none; }
    .mrow { grid-template-columns: minmax(0, 1fr); }
    .mrow .arrow { display: none; }
    .mrow .ent b { white-space: normal; overflow-wrap: anywhere; }
  }
`;
