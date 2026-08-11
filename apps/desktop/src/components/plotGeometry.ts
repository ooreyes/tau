import type { MeasuredSize } from "./useMeasuredSize";

/**
 * The scope face's shared geometry: the numbers that decide where a plot's
 * frame, its gutters and its trace endpoints land.
 *
 * These lived privately in `SimulationPanel.tsx` and were then copied verbatim
 * into `LiveScopePane.tsx`, with a comment saying so, because the live scope
 * and the bounded plotter render one above the other in the same drawer and
 * their gutters, tick bands and edge insets have to agree to the pixel. Two
 * copies of a geometry constant is a picture that goes subtly crooked the day
 * one of them is tuned: nothing fails, the two plots just stop lining up. One
 * definition, imported twice, is the only version of that agreement a future
 * edit cannot break.
 */

/**
 * The scope's coordinate system is 1:1 with rendered CSS pixels.
 *
 * It was not. Every scope `<svg>` declared `viewBox="0 0 340 <h>"` and was then
 * stretched to whatever width the panel gave it, so the browser applied one
 * uniform scale to the whole drawing. In the 1052px-wide plotter that is 3.1x:
 * an 11px tick label rendered at 34px, the 46-unit axis gutter ate 143px a
 * side, and a 1.5-unit trace drew as a 4.7px slab. The plot's own text was the
 * largest type in the product, sitting inside a window whose chrome is 11px.
 *
 * The fix is not to shrink the type, it is to stop scaling it: each pane
 * measures its own `<svg>` (they all already did, for tick-count thinning) and
 * uses that width as the viewBox width, so one user unit is one device pixel.
 * {@link PLOT_PAD}, the font sizes in `App.css`, and `PlotAxes`'s "7.2px per
 * glyph" label-collision estimate then all mean what they say. That estimate is
 * the tell that 1:1 was the original intent and the stretch was the accident.
 *
 * `PLOT_WIDTH_FALLBACK` covers the case where there is no measurement: jsdom
 * has no layout, so `ResizeObserver` and `getBoundingClientRect` both report
 * zero there, and a viewBox of width 0 is a degenerate plot that still renders
 * rather than throwing. Falling back to the historical 340 keeps that case
 * behaving exactly as it did before, which is what the existing tests pin.
 */
export const PLOT_WIDTH_FALLBACK = 340;

/**
 * Labels and axis titles need separate visual bands; the shared plot box stays
 * at 46px so the waveform retains useful vertical range. `PlotAxes` places the
 * vertical title and the Y tick anchors at opposite sides of this gutter.
 */
export const PLOT_PAD = 46;

/**
 * Keep round line caps visibly inside the instrument frame. Mapping endpoints
 * exactly onto the clip boundary shaved half the stroke and made periodic
 * traces look cut off at both ends even though their samples were complete.
 */
export const TRACE_EDGE_GUTTER = 2.5;

/** viewBox width for a pane, in CSS pixels once its `<svg>` has been measured. */
export function scopeWidth(size: MeasuredSize): number {
  return size.width > 0 ? Math.round(size.width) : PLOT_WIDTH_FALLBACK;
}
