/**
 * Desmos-style scope zoom/pan viewport math . Pure
 * and DOM-free - no `getBoundingClientRect`, no event objects - so the
 * zoom-about-point / pan / fit math is fully unit-testable. The interaction
 * hook (`components/usePlotViewport.ts`) converts real pointer/wheel events
 * into the fractional inputs these functions take.
 */
import type { AxisScale } from "./axisTicks";

/** A plot's visible data-space window - what {@link PlotAxes} and the trace
 *  path functions read to know what to draw. Independent per pane/svg. */
export interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface ViewportScales {
  xScale: AxisScale;
  yScale: AxisScale;
}

/** Zoom-in/out never shrinks a span past this fraction of the ORIGINAL data
 *  domain span - guards against an inverted or zero-width axis after many
 *  rapid zoom-in ticks (a span of exactly 0 breaks every downstream ratio). */
const MIN_SPAN_FRACTION = 1e-9;

function isPositiveDomain(min: number, max: number): boolean {
  return min > 0 && max > 0 && max > min;
}

/** Zoom one axis about a focal fraction (`0` = axis min, `1` = axis max) by
 *  `factor` (`<1` zooms in / shrinks the span, `>1` zooms out). Log-scale
 *  axes zoom in log space so equal wheel travel means equal decades, matching
 *  how the axis is drawn. Returns the axis unchanged if `scale` is "log" and
 *  the current span isn't strictly positive (can't log a non-positive value). */
function zoomAxis(min: number, max: number, focalFrac: number, factor: number, scale: AxisScale, minSpan: number): [number, number] {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (scale === "log") {
    if (!isPositiveDomain(min, max)) return [min, max];
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    const focal = l0 + focalFrac * (l1 - l0);
    const newSpan = Math.max((l1 - l0) * safeFactor, minSpan);
    const newL0 = focal - focalFrac * newSpan;
    const newL1 = newL0 + newSpan;
    return [10 ** newL0, 10 ** newL1];
  }
  const focal = min + focalFrac * (max - min);
  const newSpan = Math.max((max - min) * safeFactor, minSpan);
  const newMin = focal - focalFrac * newSpan;
  return [newMin, newMin + newSpan];
}

/**
 * Zoom a viewport about a focal point (fractions `[0,1]` within the plot
 * box) by independent per-axis factors - `{x:1,y:1}` for "y-only" zoom
 * (Alt/Option+wheel), `{x:f,y:1}` for "x-only" (Shift+wheel / horizontal
 * wheel), `{x:f,y:f}` for the default both-axes zoom.
 */
/** A span floor tied to the axis VALUES' own magnitude (not the current span
 *  itself) - using the shrinking span as its own floor's basis would let the
 *  floor shrink right along with it, never actually stopping the zoom. */
function axisMinSpan(min: number, max: number, scale: AxisScale): number {
  if (scale === "log" && isPositiveDomain(min, max)) {
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    return Math.max(Math.abs(l0), Math.abs(l1), 1) * MIN_SPAN_FRACTION;
  }
  return Math.max(Math.abs(min), Math.abs(max), 1) * MIN_SPAN_FRACTION;
}

export function zoomViewport(
  vp: Viewport,
  focal: { xFrac: number; yFrac: number },
  factor: { x: number; y: number },
  scales: ViewportScales,
): Viewport {
  const minXSpan = axisMinSpan(vp.xMin, vp.xMax, scales.xScale);
  const minYSpan = axisMinSpan(vp.yMin, vp.yMax, scales.yScale);
  const [xMin, xMax] = zoomAxis(vp.xMin, vp.xMax, focal.xFrac, factor.x, scales.xScale, minXSpan);
  const [yMin, yMax] = zoomAxis(vp.yMin, vp.yMax, focal.yFrac, factor.y, scales.yScale, minYSpan);
  return { xMin, xMax, yMin, yMax };
}

/** Shift one axis by `deltaFrac` of its own current span (log axes shift in
 *  log space, so panning feels uniform in decades, not raw value). */
function panAxis(min: number, max: number, deltaFrac: number, scale: AxisScale): [number, number] {
  if (scale === "log") {
    if (!isPositiveDomain(min, max)) return [min, max];
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    const shift = deltaFrac * (l1 - l0);
    return [10 ** (l0 + shift), 10 ** (l1 + shift)];
  }
  const shift = deltaFrac * (max - min);
  return [min + shift, max + shift];
}

/** Pan a viewport by a fraction of its own visible span along each axis
 *  (positive `xFrac` moves the window toward higher x values, etc). */
export function panViewport(vp: Viewport, delta: { xFrac: number; yFrac: number }, scales: ViewportScales): Viewport {
  const [xMin, xMax] = panAxis(vp.xMin, vp.xMax, delta.xFrac, scales.xScale);
  const [yMin, yMax] = panAxis(vp.yMin, vp.yMax, delta.yFrac, scales.yScale);
  return { xMin, xMax, yMin, yMax };
}

/**
 * Convert a drag's pixel movement into the fractional pan {@link panViewport}
 * expects. Dragging is "grab the content and move it": dragging right
 * (`dxPx>0`) reveals content to the left, so the visible x-window shifts
 * LEFT; dragging down (`dyPx>0`, pixel-Y increases downward) reveals content
 * that was above, so the visible y-window shifts UP (y-window values
 * increase, since data-Y increases upward while pixel-Y increases downward).
 */
export function panByPixels(
  vp: Viewport,
  dxPx: number,
  dyPx: number,
  innerWidthPx: number,
  innerHeightPx: number,
  scales: ViewportScales,
): Viewport {
  const xFrac = innerWidthPx > 0 ? -dxPx / innerWidthPx : 0;
  const yFrac = innerHeightPx > 0 ? dyPx / innerHeightPx : 0;
  return panViewport(vp, { xFrac, yFrac }, scales);
}

/** Auto-fit: reset the viewport to exactly the given data domain (Desmos'
 *  "center on the data" / the scope's ⌂ button). */
export function fitViewport(domain: Viewport): Viewport {
  return { xMin: domain.xMin, xMax: domain.xMax, yMin: domain.yMin, yMax: domain.yMax };
}

/** Clamp a fraction into `[0,1]` - used to keep a pointer position that
 *  strayed outside the plot box (e.g. a drag that continues past the SVG's
 *  edge) from producing a nonsensical focal point. */
export function clampFraction(frac: number): number {
  if (!Number.isFinite(frac)) return 0.5;
  return Math.min(1, Math.max(0, frac));
}
