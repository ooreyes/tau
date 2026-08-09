import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { pickTickCount } from "../simulation/axisTicks";

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's rendered CSS pixel size via `ResizeObserver` - used to
 * shrink the scope's tick count as a plot pane gets smaller (multi-pane
 * layouts, the app's 900×600 minimum window) so tick labels never collide,
 * and to give each scope `<svg>` a viewBox that is 1:1 with its rendered box
 * (see the geometry note at the top of SimulationPanel.tsx).
 * SSR/test-safe: falls back to `{0,0}` when `ResizeObserver` isn't available
 * (older jsdom in component tests), which callers treat as "use the default
 * tick count" - see {@link tickCountsFromSize}.
 */
export function useMeasuredSize<T extends Element>(): [RefObject<T | null>, MeasuredSize] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<MeasuredSize>({ width: 0, height: 0 });

  // Measure once, synchronously, before the browser paints. `ResizeObserver`
  // alone is not enough for a consumer that feeds the measurement back into
  // its own geometry: its first callback lands after the initial paint, so the
  // scope would show one frame drawn at the fallback width and then snap to
  // the real one. A layout effect closes that gap; the observer below still
  // owns every subsequent change. jsdom reports zero here, which is the
  // documented "unmeasured" case and leaves the fallback in place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width <= 0 && height <= 0) return;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/** Derive `{targetXTicks, targetYTicks}` from a measured plot size, falling
 *  back to the roomy defaults before the first ResizeObserver callback fires
 *  (or in environments without one). X ticks need more horizontal room per
 *  label ("2ms" etc.) than Y ticks need vertical room. */
export function tickCountsFromSize(size: MeasuredSize): { targetXTicks: number; targetYTicks: number } {
  return {
    targetXTicks: size.width > 0 ? pickTickCount(size.width, 55, 2, 7) : 5,
    targetYTicks: size.height > 0 ? pickTickCount(size.height, 30, 2, 5) : 5,
  };
}
