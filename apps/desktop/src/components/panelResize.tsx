import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Draggable side-panel widths (§11 Unit B). One small authority for the
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
   *  the bottom of its column, drags from its "top" edge) — the field names
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

export function savePanelWidth(storageKey: string, width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Quota exceeded / private mode — the session keeps its in-memory width.
  }
}

/** Keyboard step for the separator (WAI-ARIA window-splitter pattern). */
const KEY_STEP = 16;

export function usePanelWidth(config: PanelWidthConfig) {
  const [width, setWidth] = useState(() => loadPanelWidth(config));
  const [dragging, setDragging] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  const widthRef = useRef(width);
  widthRef.current = width;

  const applyWidth = useCallback((next: number) => {
    const cfg = configRef.current;
    const clamped = clampPanelWidth(next, cfg.minWidth, cfg.maxWidth);
    widthRef.current = clamped;
    setWidth(clamped);
    return clamped;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const cfg = configRef.current;
      const vertical = cfg.edge === "top" || cfg.edge === "bottom";
      const target = event.currentTarget;
      const startPos = vertical ? event.clientY : event.clientX;
      const startWidth = widthRef.current;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / older engines without pointer capture — window listeners
        // below still receive the moves.
      }
      setDragging(true);
      const onMove = (e: PointerEvent) => {
        const pos = vertical ? e.clientY : e.clientX;
        // Same "toward the panel narrows, away widens" convention as the
        // horizontal case, generalized to whichever edge carries the handle.
        const delta = (cfg.edge === "left" || cfg.edge === "top") ? startPos - pos : pos - startPos;
        applyWidth(startWidth + delta);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDragging(false);
        savePanelWidth(cfg.storageKey, widthRef.current);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
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
      // panel narrows, away widens — regardless of which side the panel docks.
      const towardStart = event.key === startKey;
      const startEdge = cfg.edge === "left" || cfg.edge === "top";
      const delta = startEdge === towardStart ? KEY_STEP : -KEY_STEP;
      savePanelWidth(cfg.storageKey, applyWidth(widthRef.current + delta));
    },
    [applyWidth],
  );

  return { width, dragging, onPointerDown, onKeyDown };
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
