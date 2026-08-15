import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Draggable side-panel widths. One small authority for the
 * clamp + localStorage-persistence math (pure, unit-testable) and a hook +
 * handle component the explorer tree and the properties rail both reuse.
 */

export interface PanelWidthConfig {
  /** localStorage key the width persists under. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Which edge of the panel carries the drag handle: the properties rail
   *  (docked right) resizes from its "left" edge, the explorer (docked left)
   *  from its "right" edge. Determines the drag direction that widens.
   *  "top"/"bottom" repurpose the same clamp/pointer/persistence machinery
   *  for a *height* instead (e.g. the simulator's telemetry dock, anchored to
   *  the bottom of its column, drags from its "top" edge) - the field names
   *  stay width-flavored since the math is dimension-agnostic. */
  edge: "left" | "right" | "top" | "bottom";
}

export const clampPanelWidth = (width: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(width)));

/** Stored width, clamped to the config's current min/max; the default when
 *  missing, unparsable, or storage is unavailable (SSR/tests/private mode). */
export function loadPanelWidth(config: PanelWidthConfig): number {
  if (typeof localStorage === "undefined") return config.defaultWidth;
  try {
    const raw = localStorage.getItem(config.storageKey);
    if (raw === null || raw.trim() === "") return config.defaultWidth;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return config.defaultWidth;
    return clampPanelWidth(parsed, config.minWidth, config.maxWidth);
  } catch {
    return config.defaultWidth;
  }
}

/**
 * Has the user ever chosen a size for this panel?
 *
 * `loadPanelWidth` cannot answer that - it folds "nothing stored" into the
 * default. A caller whose resting size is NOT a number it owns needs the
 * difference: the results drawer's resting height is a percentage its
 * stylesheet owns (`height: 46%`), so an absent key means "leave the class
 * alone", not "use 240px".
 */
export function hasStoredPanelWidth(storageKey: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw !== null && raw.trim() !== "" && Number.isFinite(Number(raw));
  } catch {
    return false;
  }
}

/** Forget a stored size, for a caller that can hand the axis back to something
 *  else (the drawer's peek/half/full button) and must not have a stale drag
 *  reappear on the next reload. */
export function clearPanelWidth(storageKey: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Same tolerance as the setter: storage is a convenience here.
  }
}

export function savePanelWidth(storageKey: string, width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Quota exceeded / private mode - the session keeps its in-memory width.
  }
}

/** Keyboard step for the separator (WAI-ARIA window-splitter pattern). */
const KEY_STEP = 16;

/** The one dimension a drag changes, per the edge that carries the handle. */
type DragAxis = "width" | "height";

/** An inline declaration a drag repaints itself, without going through React. */
interface LiveSizeWrite {
  style: CSSStyleDeclaration;
  property: string;
}

/**
 * The inline declarations that are painting `size` for the panel this handle
 * belongs to, or nothing if they cannot be identified with certainty.
 *
 * Why this exists: the drag used to call `setState` on every `pointermove`, so
 * every pixel of a resize re-rendered the panel and everything downstream of it
 * - which on the schematic tab includes the canvas subtree. At a 1000 Hz mouse
 * that is render work the frame budget cannot absorb, and the panel edge, plus
 * the zoom cluster anchored to it, visibly trail the pointer. The cure is for
 * the gesture to write the pixels itself and commit React state once, on
 * release.
 *
 * Which pixels, though? A hook is handed a *separator*, not a panel, and each
 * caller applies the size its own way (an inline `width`, a custom property its
 * stylesheet consumes, a clamp of its own on top). So the target is identified
 * by AGREEMENT rather than by guessing: the handle's parent qualifies only if
 * the size it is painting right now is exactly the size this hook believes it
 * has. Two consequences are the point of doing it that way:
 *
 * - The analysis-pane divider is a *sibling* of the panes it splits, not a child
 *   of one, and its parent (the stage) carries no inline width. Nothing is
 *   adopted, so that gesture keeps the old per-sample commit instead of
 *   resizing the stage.
 * - A rail rendered narrower than this hook remembers - a responsive ceiling is
 *   biting - also fails to agree, and likewise keeps the old path. A live write
 *   can therefore never bypass a clamp the caller applies on the way out.
 *
 * Ancestors are then scanned for inline CUSTOM PROPERTIES holding that same
 * size, because a caller can publish its width as well as apply it: App
 * publishes the parts rail as `--stage-rail-inset` on the stage, and the
 * floating zoom cluster is positioned from that. Keeping it in step for the
 * length of the drag is the difference between the cluster tracking the rail's
 * edge and the cluster jumping when the pointer is finally released.
 */
function collectLiveSizeWrites(handle: HTMLElement, axis: DragAxis, size: number): LiveSizeWrite[] {
  const panel = handle.parentElement;
  const px = `${size}px`;
  if (!panel || panel.style.getPropertyValue(axis).trim() !== px) return [];
  const writes: LiveSizeWrite[] = [{ style: panel.style, property: axis }];
  const root = panel.ownerDocument.documentElement;
  for (let node = panel.parentElement; node && node !== root; node = node.parentElement) {
    const { style } = node;
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      if (property.startsWith("--") && style.getPropertyValue(property).trim() === px) {
        writes.push({ style, property });
      }
    }
  }
  return writes;
}

/**
 * The stop the LAYOUT is enforcing, which is not always the config's.
 *
 * `PanelWidthConfig` carries static bounds; several callers hand the separator a
 * tighter, responsive maximum (`componentsRailMaxWidth`, `resolveAnalysisPane`,
 * the drawer's measured host height) and re-clamp the size they render with.
 * That number is already published on the separator for screen readers, so the
 * live write reads it from there and the dragged edge stops where the panel is
 * actually going to stop - instead of following the pointer past the wall and
 * snapping back on release. Deliberately bounds the PAINT only: what the hook
 * stores and persists stays exactly what it was before, because the callers
 * above correct that themselves and their tests pin it.
 */
function livePaintBounds(handle: HTMLElement, config: PanelWidthConfig): { min: number; max: number } {
  const published = (attribute: string, fallback: number): number => {
    const value = Number(handle.getAttribute(attribute));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    min: Math.max(config.minWidth, published("aria-valuemin", config.minWidth)),
    max: Math.min(config.maxWidth, published("aria-valuemax", config.maxWidth)),
  };
}

export function usePanelWidth(config: PanelWidthConfig) {
  const [committedWidth, setCommittedWidth] = useState(() => loadPanelWidth(config));
  const [dragging, setDragging] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  // True only while a drag owns the size, i.e. while it is painting the DOM
  // itself and React state is deliberately being left behind.
  const livePaintRef = useRef(false);
  // The size on screen. Normally that is the committed state; during a live
  // drag this ref is ahead of it, and a render caused by anything ELSE mid-drag
  // (a running simulation, a streaming answer) must read the size the panel is
  // actually wearing rather than stamp the stale committed value back over it.
  const widthRef = useRef(committedWidth);
  if (!livePaintRef.current) widthRef.current = committedWidth;
  const width = widthRef.current;
  // Pointer moves/up events are listened for on `window`, rather than the
  // narrow separator, so a fast drag remains responsive after leaving the
  // handle. Keep their disposer in a ref because a panel can disappear while
  // that gesture is still in flight (closing a rail, changing workspaces, or
  // unmounting a lazy panel). Without this, the three window listeners retain
  // this hook and can update an unmounted component until a later pointer-up.
  const stopDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    stopDragRef.current?.();
    stopDragRef.current = null;
  }, []);

  const applyWidth = useCallback((next: number) => {
    const cfg = configRef.current;
    const clamped = clampPanelWidth(next, cfg.minWidth, cfg.maxWidth);
    widthRef.current = clamped;
    setCommittedWidth(clamped);
    return clamped;
  }, []);

  // Responsive hosts may tighten a panel's maximum after a window resize.
  // Clamp the live value immediately instead of leaving a persisted desktop
  // width to push a minimum-size window behind `overflow: hidden`.
  useEffect(() => {
    applyWidth(widthRef.current);
  }, [applyWidth, config.minWidth, config.maxWidth]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Pointer capture normally makes a second pointerdown impossible, but
      // clean up defensively for browsers that lose capture during a panel
      // transition before delivering pointercancel.
      stopDragRef.current?.();
      const cfg = configRef.current;
      const vertical = cfg.edge === "top" || cfg.edge === "bottom";
      const target = event.currentTarget;
      const startPos = vertical ? event.clientY : event.clientX;
      const startWidth = widthRef.current;
      const live = collectLiveSizeWrites(target, vertical ? "height" : "width", startWidth);
      const bounds = livePaintBounds(target, cfg);
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / older engines without pointer capture - window listeners
        // below still receive the moves.
      }
      livePaintRef.current = live.length > 0;
      setDragging(true);
      /**
       * Paint the live size, at most once per distinct pixel.
       *
       * Deliberately NOT deferred to `requestAnimationFrame`. What made the drag
       * expensive was the React render per pointer sample, and that is gone; what
       * is left is a handful of `setProperty` calls that only INVALIDATE layout -
       * nothing in this handler reads geometry back, so the browser already
       * coalesces the whole burst into one reflow before the next paint. Gating
       * them behind a frame would buy microseconds of style work and cost every
       * frame's first sample up to a frame of latency, which is the lag this unit
       * exists to remove. Skipping a repeat pixel is the part that is actually
       * worth doing: a 1000 Hz pointer moving slowly reports the same rounded
       * size many times over.
       */
      let painted = startWidth;
      const paint = (size: number) => {
        const next = clampPanelWidth(size, bounds.min, bounds.max);
        if (next === painted) return;
        painted = next;
        const px = `${next}px`;
        for (const write of live) write.style.setProperty(write.property, px);
      };
      const onMove = (e: PointerEvent) => {
        const pos = vertical ? e.clientY : e.clientX;
        // Same "toward the panel narrows, away widens" convention as the
        // horizontal case, generalized to whichever edge carries the handle.
        const delta = (cfg.edge === "left" || cfg.edge === "top") ? startPos - pos : pos - startPos;
        if (!livePaintRef.current) {
          // No live channel on this surface: keep the original per-sample
          // commit, which is correct, just as expensive as it always was.
          applyWidth(startWidth + delta);
          return;
        }
        widthRef.current = clampPanelWidth(startWidth + delta, cfg.minWidth, cfg.maxWidth);
        paint(widthRef.current);
      };
      const onUp = () => {
        stopDrag();
        setDragging(false);
        // The gesture's ONE React commit. `widthRef` already holds the size on
        // screen (a live drag never touched state), and `applyWidth` re-clamps
        // and stores it; on the fallback path it is the number state already
        // has, so React bails out of the render and it costs nothing.
        savePanelWidth(cfg.storageKey, applyWidth(widthRef.current));
      };
      const stopDrag = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        livePaintRef.current = false;
        if (stopDragRef.current === stopDrag) stopDragRef.current = null;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      stopDragRef.current = stopDrag;
    },
    [applyWidth],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const cfg = configRef.current;
      const vertical = cfg.edge === "top" || cfg.edge === "bottom";
      const startKey = vertical ? "ArrowUp" : "ArrowLeft";
      const endKey = vertical ? "ArrowDown" : "ArrowRight";
      if (event.key !== startKey && event.key !== endKey) return;
      event.preventDefault();
      // Arrow keys move the BORDER, matching the pointer: moving it toward the
      // panel narrows, away widens - regardless of which side the panel docks.
      const towardStart = event.key === startKey;
      const startEdge = cfg.edge === "left" || cfg.edge === "top";
      const delta = startEdge === towardStart ? KEY_STEP : -KEY_STEP;
      savePanelWidth(cfg.storageKey, applyWidth(widthRef.current + delta));
    },
    [applyWidth],
  );

  // Exposes the same clamped setter the drag/keyboard handlers use - for a
  // caller that lifts this hook (App.tsx's Assistant column) and needs to
  // shrink the panel programmatically as the window narrows, the way the
  // scope column's own width state already does. Intentionally does NOT
  // persist to storage (a resize-driven shrink isn't a user's own choice of
  // width, same rationale as the scope column's clamp effect).
  return { width, dragging, onPointerDown, onKeyDown, setWidth: applyWidth };
}

export function PanelResizeHandle({
  edge,
  label,
  width,
  minWidth,
  maxWidth,
  dragging,
  onPointerDown,
  onKeyDown,
}: {
  edge: "left" | "right" | "top" | "bottom";
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const vertical = edge === "top" || edge === "bottom";
  return (
    <div
      data-slot="resizable-handle"
      className={`panel-resize-handle panel-resize-handle--${edge}${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
