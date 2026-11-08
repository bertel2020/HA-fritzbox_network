/**
 * Reading the charts of the panel: the value under the pointer or the keys, the tip and the cursor.
 *
 * Methods of the panel element, kept apart from the rest of the class: they are added to its
 * prototype by `mixin()` and run with `this` as the panel.
 */
import { escapeHtml, formatDuration, plotKeyTarget, plotText } from "./shared.js";
import { fill } from "./texts.js";

export class ChartMethods {
  /** The value under the pointer on a chart of the trend: a cursor line and the time with the value. */
  _onPlot(event) {
    if (event.type === "pointermove") this._pointer = { x: event.clientX, y: event.clientY };
    const vbar = event.target?.closest?.(".vbar");
    if (vbar) return this._onVbar(vbar, event);
    this._hideVbars();
    const plot = event.target?.closest?.(".plot");
    if (!plot) return this._hidePlots();
    const pts = this._chartData(plot, "pts");
    const box = plot.getBoundingClientRect();
    if (pts.length < 2 || !box.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    // a chart drawn by time (the load of the line) is read by time, the others by the number of the point
    let i = Math.round(ratio * (pts.length - 1));
    if (plot.dataset.mode === "time") {
      const first = pts[0][0];
      const wanted = first + ratio * Math.max(pts[pts.length - 1][0] - first, 1);
      i = pts.reduce((best, p, k) => (Math.abs(p[0] - wanted) < Math.abs(pts[best][0] - wanted) ? k : best), 0);
    } else if (plot.dataset.mode === "bars") {
      i = Math.min(pts.length - 1, Math.floor(ratio * pts.length));
    }
    this._showPlotPoint(plot, pts, i, box.width);
  }

  /** The cursor and the tip at point i of a chart; a slider also says it to a screen reader. */
  _showPlotPoint(plot, pts, i, width) {
    let x = (i / (pts.length - 1)) * width;
    if (plot.dataset.mode === "time") {
      const first = pts[0][0];
      x = ((pts[i][0] - first) / Math.max(pts[pts.length - 1][0] - first, 1)) * width;
    } else if (plot.dataset.mode === "bars") {
      x = ((i + 0.5) / pts.length) * width;
    }
    const text = plotText(pts[i], plot.dataset, this._hass?.language);
    const cursor = plot.querySelector(".cursor");
    const tip = plot.querySelector(".tip");
    tip.textContent = text;
    cursor.style.left = `${x}px`;
    cursor.hidden = tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), width - tip.offsetWidth / 2)}px`;
    if (plot.getAttribute?.("role") === "slider") {
      plot.setAttribute("aria-valuemin", "0");
      plot.setAttribute("aria-valuemax", String(pts.length - 1));
      plot.setAttribute("aria-valuenow", String(i));
      plot.setAttribute("aria-valuetext", text);
    }
    plot.dataset.at = String(i);
  }

  /** A chart read with the keyboard: arrows, Home, End and the pages move along its points. */
  _onPlotKey(plot, event) {
    const pts = this._chartData(plot, "pts");
    const width = plot.getBoundingClientRect().width;
    if (event.key === "Escape") {
      this._hidePlots();
      return true;
    }
    if (pts.length < 2 || !width) return false;
    const from = plot.dataset.at === undefined ? pts.length - 1 : Number(plot.dataset.at);
    const to = plotKeyTarget(pts.length, from, event.key);
    if (to === null) return false;
    event.preventDefault();
    this._showPlotPoint(plot, pts, to, width);
    return true;
  }

  /** A chart that gets the focus from the keyboard shows its latest point. */
  _onPlotFocus(event) {
    const plot = event.target;
    if (!plot?.classList?.contains("plot") || plot.matches?.(":focus-visible") === false) return;
    const pts = this._chartData(plot, "pts");
    const width = plot.getBoundingClientRect().width;
    if (pts.length < 2 || !width) return;
    this._showPlotPoint(plot, pts, plot.dataset.at === undefined ? pts.length - 1 : Number(plot.dataset.at), width);
  }

  /** What a tunnel did where the pointer is: its state there and, for a connection, when and how long. */
  _onVbar(bar, event) {
    const box = bar.getBoundingClientRect();
    if (!box.width) return;
    const from = Number(bar.dataset.from);
    const to = Number(bar.dataset.to);
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const moment = from + ratio * (to - from);
    const segment = this._chartData(bar, "segs").find(([a, b]) => moment >= a && moment <= b);
    if (!segment) return;
    const t = this._t.vpnPage;
    const language = this._hass?.language;
    const at = (sec) => new Date(sec * 1000).toLocaleString(language || "en", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const [a, b, state] = segment;
    const lines = [t.tip[state]];
    if (state === "up") lines.push(`${at(a)} – ${b >= to - 60 ? t.now : at(b)}`, fill(t.tip.duration, { time: formatDuration(b - a, this._t.inet.units) }));
    else lines.push(at(moment));
    const tip = bar.querySelector(".tip");
    const cursor = bar.querySelector(".cursor");
    tip.innerHTML = lines.map((line, i) => (i ? escapeHtml(line) : `<b>${escapeHtml(line)}</b>`)).join("<br>");
    const x = ratio * box.width;
    cursor.style.left = `${x}px`;
    cursor.hidden = tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), box.width - tip.offsetWidth / 2)}px`;
  }

  _hideVbars() {
    for (const el of this.shadowRoot.querySelectorAll(".vbar .cursor, .vbar .tip")) el.hidden = true;
  }

  _hidePlots() {
    this._pointer = null;
    this._hideVbars();
    for (const el of this.shadowRoot.querySelectorAll(".plot .cursor, .plot .tip")) el.hidden = true;
  }
}
