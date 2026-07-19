import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AxisScale } from "../simulation/axisTicks";
import { zoomViewport, panByPixels, fitViewport, clampFraction, type Viewport } from "../simulation/plotViewport";

/**
 * Desmos-style zoom/pan for one scope `<svg>` pane . Plain wheel
 * does nothing here - no `preventDefault`, no zoom - so the event bubbles and
 * the surrounding analysis panel scrolls normally; a plot sitting under the
 * cursor must never trap the page scroll. Zoom is gated on `e.ctrlKey` (also
 * what browsers report for trackpad pinch) or `e.metaKey` (⌘+wheel on
 * macOS), matching the schematic canvas's own wheel convention (Canvas.tsx).
 * While zooming: both axes by default; Shift+wheel = x-only; Alt/Option+wheel
 * = y-only. Drag pans. Double-click, or the returned `fit()` (wired to a ⌂
 * button), resets to the full data domain.
 *
 * Wheel events are coalesced into one state update per animation frame (a
 * trackpad can fire far more wheel events than the display refresh rate) so
 * rapid zooming stays smooth instead of re-rendering the plot per tick.
 *
 * The viewport resets to `domain` whenever `resetKey` changes - callers pass
 * the identity of the current analysis run (e.g. the `AnalysisResult`
 * reference) so a fresh run always opens at full-fit, while changes that
 * don't re-run the simulation (adding a trace to the same pane, resizing the
 * window) leave an in-progress zoom/pan alone.
 */
export interface UsePlotViewportOptions {
  domain: Viewport;
  xScale?: AxisScale;
  yScale?: AxisScale;
  /** Identity of the "current run" - changing this snaps back to `domain`. */
  resetKey?: unknown;
  /** viewBox geometry, shared by every scope svg (see PLOT_WIDTH/HEIGHT/PAD). */
  width: number;
  height: number;
  pad: number;
  /** Optional shared horizontal window for aligned multi-pane plots. */
  sharedX?: { xMin: number; xMax: number };
  /**
   * Publishes horizontal zoom/pan so sibling panes can follow it. Called
   * ONLY from user-gesture code paths (wheel, drag, `zoomBy`, `fit`/dbl-click)
   * - never from mount, the `resetKey` reset, or `sharedX` adoption. A pane
   * with no data (caller passes `undefined` here) never publishes, so its
   * placeholder domain can't leak into the shared window.
   */
  onXViewportChange?: (x: { xMin: number; xMax: number }) => void;
}

export interface PlotViewportHandle {
  viewport: Viewport;
  /**
   * Callback ref - attach directly to the `<svg>` (or merge with another ref,
   * see `useMeasuredSize`'s companion usage). A callback ref (not a plain
   * `RefObject`) is required here: several scope panes (e.g. the FFT view)
   * render their `<svg>` behind a disclosure toggle, so the element can mount
   * well after this hook's first render. A `useEffect` keyed on stable deps
   * would only ever see the pre-mount `null` and never retry; a callback ref
   * fires exactly when the DOM node appears (or disappears), so the wheel
   * listener attaches/detaches at the right time regardless of when the
   * element actually mounts.
   */
  attachSvg: (el: SVGSVGElement | null) => void;
  isPanning: boolean;
  /** Reset to the full data domain (⌂ button / double-click). */
  fit: () => void;
  /** Frame an explicit engineering-interest window and publish its X range. */
  fitTo: (domain: Viewport) => void;
  /** Fit Y to a caller-computed signal domain while preserving the visible X window. */
  fitY: (domain: { min: number; max: number }) => void;
  /** Zoom both axes about the plot's current center by `factor` (+/− buttons). */
  zoomBy: (factor: number) => void;
  /** Spread onto the `<svg>` for drag-to-pan + double-click-to-fit. Wheel is
   *  wired separately (native listener) so `preventDefault` actually works. */
  dragHandlers: {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onDoubleClick: () => void;
  };
}

const WHEEL_SPEED = 0.01;

export function usePlotViewport({
  domain,
  xScale = "linear",
  yScale = "linear",
  resetKey,
  width,
  height,
  pad,
  sharedX,
  onXViewportChange,
}: UsePlotViewportOptions): PlotViewportHandle {
  const [viewport, setViewport] = useState<Viewport>(domain);
  const [isPanning, setIsPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scalesRef = useRef({ xScale, yScale });
  scalesRef.current = { xScale, yScale };
  const domainRef = useRef(domain);
  domainRef.current = domain;
  const geometryRef = useRef({ width, height, pad });
  geometryRef.current = { width, height, pad };
  // Ref indirection so the gesture handlers below (whose identities must stay
  // stable - they're wired to native listeners / spread onto the svg) don't
  // need `onXViewportChange` in their dep arrays.
  const onXViewportChangeRef = useRef(onXViewportChange);
  onXViewportChangeRef.current = onXViewportChange;

  // New run → snap back to full-fit. Trace/pane composition changes alone
  // (same `resetKey`) leave an in-progress zoom/pan untouched. X comes from
  // `sharedX` when the caller provides one, so a pane that resets (e.g. a
  // new trace bumps its `runKey`) re-fits its own Y range but keeps whatever
  // X window the sibling panes already share, instead of snapping the whole
  // multi-pane scope back to just this pane's own domain.
  useEffect(() => {
    setViewport(
      sharedX ? { xMin: sharedX.xMin, xMax: sharedX.xMax, yMin: domain.yMin, yMax: domain.yMax } : domain,
    );
    // Only `resetKey` should trigger this - `domain`/`sharedX` are
    // intentionally excluded so autorange recomputation (new trace, pane
    // resize) or a sibling's pan/zoom alone don't re-trigger a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!sharedX) return;
    setViewport((current) => current.xMin === sharedX.xMin && current.xMax === sharedX.xMax
      ? current
      : { ...current, xMin: sharedX.xMin, xMax: sharedX.xMax });
  }, [sharedX?.xMin, sharedX?.xMax]);

  // Gesture-only X publish. `viewport` also changes on mount, on `resetKey`
  // reset, and on `sharedX` adoption above - none of those are user gestures,
  // and publishing them was the bug (a pane's transient/placeholder viewport
  // would broadcast into `sharedX` and every sibling would adopt it). Gesture
  // handlers set `publishXPendingRef` immediately before the `setViewport`
  // call that should be shared; this effect fires after the resulting commit
  // and only then calls the callback, clearing the flag either way.
  const publishXPendingRef = useRef(false);
  useEffect(() => {
    if (!publishXPendingRef.current) return;
    publishXPendingRef.current = false;
    onXViewportChangeRef.current?.({ xMin: viewport.xMin, xMax: viewport.xMax });
  }, [viewport.xMin, viewport.xMax]);

  const fitTo = useCallback((nextDomain: Viewport) => {
    if (![nextDomain.xMin, nextDomain.xMax, nextDomain.yMin, nextDomain.yMax].every(Number.isFinite)
      || nextDomain.xMax <= nextDomain.xMin
      || nextDomain.yMax <= nextDomain.yMin) return;
    const fitted = fitViewport(nextDomain);
    setViewport((current) => {
      // A Y-only refit does not trigger the X-keyed publish effect. Clear the
      // flag here so a later shared-X adoption cannot emit a stale gesture.
      publishXPendingRef.current = current.xMin !== fitted.xMin || current.xMax !== fitted.xMax;
      return fitted;
    });
  }, []);

  const fit = useCallback(() => fitTo(domainRef.current), [fitTo]);

  const fitY = useCallback((nextDomain: { min: number; max: number }) => {
    if (!Number.isFinite(nextDomain.min) || !Number.isFinite(nextDomain.max) || nextDomain.max <= nextDomain.min) return;
    setViewport((current) => ({ ...current, yMin: nextDomain.min, yMax: nextDomain.max }));
  }, []);

  const zoomBy = useCallback((factor: number) => {
    publishXPendingRef.current = true;
    setViewport((vp) => zoomViewport(vp, { xFrac: 0.5, yFrac: 0.5 }, { x: factor, y: factor }, scalesRef.current));
  }, []);

  // Pixel position within the SVG's viewBox coordinate space, converted from
  // a raw client (screen) position via the element's actual rendered CSS box.
  const clientToViewBox = useCallback((el: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const { width: w, height: h } = geometryRef.current;
    return { x: ((clientX - rect.left) / rect.width) * w, y: ((clientY - rect.top) / rect.height) * h };
  }, []);

  // --- wheel: native listener (React's synthetic onWheel is passive, so
  // preventDefault silently no-ops there - this is the same pattern Canvas.tsx
  // uses for its own wheel zoom). Coalesced into one update per rAF. Attached
  // via the `attachSvg` callback ref (see PlotViewportHandle doc) rather than
  // a useEffect, so it works for svgs that mount late (behind a toggle).
  // A plain wheel is deliberately NOT handled at all (no listener-level early
  // return with preventDefault) - see onWheel below, which no-ops and lets
  // the event bubble so the analysis panel scrolls under the cursor.
  const detachWheelRef = useRef<(() => void) | null>(null);

  const attachSvg = useCallback(
    (el: SVGSVGElement | null) => {
      detachWheelRef.current?.();
      detachWheelRef.current = null;
      svgRef.current = el;
      if (!el) return;

      let pendingFactor = { x: 1, y: 1 };
      let pendingFocal: { xFrac: number; yFrac: number } | null = null;
      let rafId: number | null = null;

      const flush = () => {
        rafId = null;
        const focal = pendingFocal;
        const factor = pendingFactor;
        pendingFactor = { x: 1, y: 1 };
        pendingFocal = null;
        if (!focal || (factor.x === 1 && factor.y === 1)) return;
        publishXPendingRef.current = true;
        setViewport((vp) => zoomViewport(vp, focal, factor, scalesRef.current));
      };

      const onWheel = (e: WheelEvent) => {
        // Plain wheel (no ctrl/meta) is plot-agnostic scrolling, not zoom -
        // don't preventDefault, don't touch the viewport, just let it bubble
        // to the panel. Only ctrl (browsers report trackpad pinch as
        // ctrlKey) or meta (⌘+wheel on macOS) zooms, matching Canvas.tsx.
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const point = clientToViewBox(el, e.clientX, e.clientY);
        if (!point) return;
        const { width: w, height: h, pad: p } = geometryRef.current;
        const innerW = w - p * 2;
        const innerH = h - p * 2;
        const xFrac = clampFraction((point.x - p) / innerW);
        const yFrac = clampFraction(1 - (point.y - p) / innerH);

        // Axis locks while zooming: Shift = x-only, Alt/Option = y-only. The
        // old "horizontal wheel gesture = x zoom" heuristic is gone - a
        // horizontal swipe with no modifier is now plain scrolling.
        const xOnly = e.shiftKey;
        const yOnly = e.altKey;
        const magnitude = xOnly ? e.deltaX || e.deltaY : e.deltaY;
        const factor = Math.exp(magnitude * WHEEL_SPEED);

        pendingFocal = { xFrac, yFrac };
        pendingFactor = {
          x: yOnly ? 1 : pendingFactor.x * factor,
          y: xOnly ? 1 : pendingFactor.y * factor,
        };
        if (rafId === null) rafId = requestAnimationFrame(flush);
      };

      el.addEventListener("wheel", onWheel, { passive: false });
      detachWheelRef.current = () => {
        el.removeEventListener("wheel", onWheel);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    },
    [clientToViewBox],
  );

  // Detach on unmount (attachSvg's own `el === null` path handles a normal
  // conditional-unmount, but this covers the component-unmount case too).
  useEffect(() => () => detachWheelRef.current?.(), []);

  // --- drag-to-pan (pointer events; React's synthetic handlers are fine here
  // since there's nothing to preventDefault for a plain drag).
  const dragState = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // stop a drag from also native-selecting tick <text> labels
    dragState.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dxPx = e.clientX - drag.x;
    const dyPx = e.clientY - drag.y;
    dragState.current = { id: drag.id, x: e.clientX, y: e.clientY };
    const el = svgRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const { width: w, height: h, pad: p } = geometryRef.current;
    // Convert the CSS-pixel drag delta into viewBox-unit pixels so panning
    // speed matches the cursor 1:1 regardless of the rendered scope size.
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    const innerW = w - p * 2;
    const innerH = h - p * 2;
    publishXPendingRef.current = true;
    setViewport((vp) => panByPixels(vp, dxPx * scaleX, dyPx * scaleY, innerW, innerH, scalesRef.current));
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragState.current?.id === e.pointerId) dragState.current = null;
    setIsPanning(false);
  }, []);

  return {
    viewport,
    attachSvg,
    isPanning,
    fit,
    fitTo,
    fitY,
    zoomBy,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onDoubleClick: fit,
    },
  };
}
