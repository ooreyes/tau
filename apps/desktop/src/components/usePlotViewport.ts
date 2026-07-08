import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AxisScale } from "../simulation/axisTicks";
import { zoomViewport, panByPixels, fitViewport, clampFraction, type Viewport } from "../simulation/plotViewport";

/**
 * Desmos-style zoom/pan for one scope `<svg>` pane (§UX Unit B). Wheel zooms
 * about the cursor (both axes by default; Shift+wheel or a horizontal wheel
 * gesture = x-only; Alt/Option+wheel = y-only — the common
 * scope/Desmos convention). Drag pans. Double-click, or the returned `fit()`
 * (wired to a ⌂ button), resets to the full data domain.
 *
 * Wheel events are coalesced into one state update per animation frame (a
 * trackpad can fire far more wheel events than the display refresh rate) so
 * rapid zooming stays smooth instead of re-rendering the plot per tick.
 *
 * The viewport resets to `domain` whenever `resetKey` changes — callers pass
 * the identity of the current analysis run (e.g. the `AnalysisResult`
 * reference) so a fresh run always opens at full-fit, while changes that
 * don't re-run the simulation (adding a trace to the same pane, resizing the
 * window) leave an in-progress zoom/pan alone.
 */
export interface UsePlotViewportOptions {
  domain: Viewport;
  xScale?: AxisScale;
  yScale?: AxisScale;
  /** Identity of the "current run" — changing this snaps back to `domain`. */
  resetKey?: unknown;
  /** viewBox geometry, shared by every scope svg (see PLOT_WIDTH/HEIGHT/PAD). */
  width: number;
  height: number;
  pad: number;
}

export interface PlotViewportHandle {
  viewport: Viewport;
  /**
   * Callback ref — attach directly to the `<svg>` (or merge with another ref,
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

  // New run → snap back to full-fit. Trace/pane composition changes alone
  // (same `resetKey`) leave an in-progress zoom/pan untouched.
  useEffect(() => {
    setViewport(domain);
    // Only `resetKey` should trigger this — `domain` is intentionally
    // excluded so autorange recomputation (new trace, pane resize) doesn't
    // fight the user's zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const fit = useCallback(() => setViewport(fitViewport(domainRef.current)), []);

  const zoomBy = useCallback((factor: number) => {
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
  // preventDefault silently no-ops there — this is the same pattern Canvas.tsx
  // uses for its own wheel zoom). Coalesced into one update per rAF. Attached
  // via the `attachSvg` callback ref (see PlotViewportHandle doc) rather than
  // a useEffect, so it works for svgs that mount late (behind a toggle).
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
        setViewport((vp) => zoomViewport(vp, focal, factor, scalesRef.current));
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const point = clientToViewBox(el, e.clientX, e.clientY);
        if (!point) return;
        const { width: w, height: h, pad: p } = geometryRef.current;
        const innerW = w - p * 2;
        const innerH = h - p * 2;
        const xFrac = clampFraction((point.x - p) / innerW);
        const yFrac = clampFraction(1 - (point.y - p) / innerH);

        // Horizontal wheel gesture (trackpad shift-scroll or a horizontal
        // swipe) reports through deltaX; treat it like an explicit Shift+wheel.
        const xOnly = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
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
    zoomBy,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onDoubleClick: fit,
    },
  };
}
