import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontal, X } from "lucide-react";
import { placeInspector, type Placement } from "./anchorPlacement";
import type { Rect } from "../overlayPlacement";

/**
 * The inspector, at the selection.
 *
 * It used to be half of a docked right-hand column, behind a segmented control
 * it shared with the parts library - two unrelated things crammed into one
 * column to justify the column. Selecting a resistor meant reading its value
 * 900 pixels away from the resistor, with the whole schematic between them.
 *
 * Now it appears beside the part, and it is the only thing in this redesign
 * that has to get focus exactly right. Four rules, each of which is a bug
 * rather than a preference:
 *
 * 1. **Not modal, and never `aria-hidden`s the document.** A Radix Dialog
 *    would take the canvas out of the accessibility tree for as long as
 *    anything is selected, which is the entire time you are working.
 * 2. **Selecting a part must NOT move focus.** Clicking a resistor and then
 *    pressing `r` has to rotate it. If the inspector grabbed focus on
 *    selection, `r` would type the letter r into a value field.
 * 3. **The keyboard command MUST move focus,** to the first field. Otherwise
 *    the inspector is unreachable without a pointer, and rule 2 is the reason
 *    tabbing to it is not enough.
 * 4. **Escape closes it and keeps the selection.** Dismissing a readout is not
 *    the same gesture as deselecting a part, and conflating them means you
 *    cannot get the panel out of the way without losing your place.
 *
 * Placement is `anchorPlacement.ts`. Recomputation is debounced by a settle
 * delay so a pan or a zoom does not make the panel chase the cursor across the
 * screen; between recomputes it translates with the anchor, so it stays
 * visually attached to the part while the drawing moves under it.
 */

/** How long the view has to stop moving before the panel re-places itself. */
const SETTLE_MS = 120;

export interface SelectionInspectorProps {
  /** The selection's bounding box in client coordinates, or null for none. */
  anchor: Rect | null;
  /** The area the panel may occupy, in client coordinates. */
  viewport: Rect;
  /** Chrome the panel should avoid covering, in client coordinates. */
  obstacles?: readonly Rect[];
  /** Accessible name, e.g. `R1 properties`. */
  title: string;
  /** Stable selection identity; unlike the title, it changes for same-named parts. */
  selectionKey: string | null;
  /**
   * The selected component is being moved on the canvas. The caller owns that
   * gesture state; hiding here keeps the surface from fighting the pointer
   * while preserving placement for the instant the move ends.
   */
  suspended?: boolean;
  /** Bumping this focuses the first field: the explicit keyboard command. */
  focusSignal?: number;
  /** Escape, or the close button. The selection itself is not cleared. */
  onDismiss: () => void;
  children: React.ReactNode;
}

const DEFAULT_SIZE = { width: 300, height: 340 };

interface PanelPosition {
  x: number;
  y: number;
}

/** Keep a user-placed panel reachable when the shell or drawer resizes. */
function clampPanelPosition(
  position: PanelPosition,
  size: { width: number; height: number },
  viewport: Rect,
): PanelPosition {
  const maxX = Math.max(viewport.minX, viewport.maxX - size.width);
  const maxY = Math.max(viewport.minY, viewport.maxY - size.height);
  return {
    x: Math.max(viewport.minX, Math.min(maxX, position.x)),
    y: Math.max(viewport.minY, Math.min(maxY, position.y)),
  };
}

export function SelectionInspector({
  anchor,
  viewport,
  obstacles = [],
  title,
  selectionKey,
  suspended = false,
  focusSignal = 0,
  onDismiss,
  children,
}: SelectionInspectorProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [dragPosition, setDragPosition] = useState<PanelPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: PanelPosition;
  } | null>(null);
  // The anchor the current placement was computed against. Between recomputes
  // the panel translates by the difference, so it rides along with the part
  // instead of hanging in space while the canvas pans under it.
  const [settled, setSettled] = useState<{ anchor: Rect; placement: Placement } | null>(null);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setSize((prev) => (prev.width === rect.width && prev.height === rect.height
      ? prev
      : { width: rect.width, height: rect.height }));
  }, [title, children]);

  /**
   * Keyed by value, not by identity.
   *
   * `viewport` and `obstacles` are computed by the caller and are therefore
   * fresh objects on every render. Depending on them by reference makes this
   * callback change every render, which makes the placement effect below fire
   * every render, which sets state, which renders again: an infinite loop. It
   * did not present as one either - the settle timer throttled it into a
   * silent busy-loop that merely made the test run hang.
   */
  const geometryKey = JSON.stringify([size, viewport, obstacles]);
  const geometryRef = useRef({ size, viewport, obstacles });
  geometryRef.current = { size, viewport, obstacles };
  const compute = useCallback(
    (from: Rect) => {
      const current = geometryRef.current;
      return placeInspector({
        anchor: from,
        panel: current.size,
        viewport: current.viewport,
        obstacles: current.obstacles,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey],
  );

  /**
   * When to re-place, and when to wait.
   *
   * The settle delay exists for one case: the anchor moving, because a pan or
   * a zoom moves it continuously and a panel that re-places on every frame
   * chases the cursor across the screen. Everything else re-places at once.
   *
   * That distinction is load-bearing, not a nicety. The panel's own measured
   * height arrives one commit after it first renders, so debouncing a
   * size-only change means the first placement is computed against the
   * fallback height - and at the 900x600 floor that put a 420px panel at a
   * top of 190 in a viewport that ends at 530, i.e. clipped off the bottom of
   * the window. It looked fine at 1440, where there was slack to absorb it.
   */
  const anchorKey = anchor ? `${anchor.minX},${anchor.minY},${anchor.maxX},${anchor.maxY}` : null;
  const placedAnchorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor) {
      setSettled(null);
      placedAnchorRef.current = null;
      setDragPosition(null);
      setDragging(false);
      dragRef.current = null;
      return;
    }
    const place = () => {
      placedAnchorRef.current = anchorKey;
      setSettled({ anchor, placement: compute(anchor) });
    };
    // New selection, or the panel resized under an unchanged one: now.
    if (placedAnchorRef.current === null || placedAnchorRef.current === anchorKey) {
      place();
      return;
    }
    const timer = setTimeout(place, SETTLE_MS);
    return () => clearTimeout(timer);
    // `settled` is deliberately absent: including it would restart the timer
    // on its own result and the panel would never stop re-placing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, compute]);

  // A different inspection gets a fresh placement. This is deliberately keyed
  // by the caller's stable selection identity, not the accessible title: two
  // components can share a title while still needing independent panel state.
  // Closing and reopening the same inspection also starts from the computed
  // side of the selected part, while a resize clamps an existing drag below
  // without losing it.
  useEffect(() => {
    setDragPosition(null);
  }, [selectionKey]);

  // Rule 3. Keyed on the signal, not on the selection, which is rule 2.
  useEffect(() => {
    if (focusSignal === 0) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not(.selection-inspector-close), [tabindex]:not([tabindex='-1']):not(.selection-inspector-move)",
    );
    first?.focus();
  }, [focusSignal]);

  // Rule 4. Scoped to focus inside the panel, so canvas Escape keeps meaning
  // "cancel the current tool" - the same precedence the results drawer uses.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const el = panelRef.current;
      if (!el || !el.contains(document.activeElement)) return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  const offset = useMemo(() => {
    if (!anchor || !settled) return { x: 0, y: 0 };
    return {
      x: (anchor.minX + anchor.maxX) / 2 - (settled.anchor.minX + settled.anchor.maxX) / 2,
      y: (anchor.minY + anchor.maxY) / 2 - (settled.anchor.minY + settled.anchor.maxY) / 2,
    };
  }, [anchor, settled]);

  if (suspended || !anchor || !settled) return null;
  const { placement } = settled;
  const leader = placement.leader;
  const automaticPosition = {
    x: placement.x + offset.x,
    y: placement.y + offset.y,
  };
  const position = clampPanelPosition(
    dragPosition ?? automaticPosition,
    size,
    viewport,
  );
  const dragDelta = {
    x: position.x - automaticPosition.x,
    y: position.y - automaticPosition.y,
  };

  const moveBy = (dx: number, dy: number) => {
    const next = clampPanelPosition(
      { x: position.x + dx, y: position.y + dy },
      size,
      viewport,
    );
    setDragPosition(next);
  };

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest("button, input, select, textarea, [data-radix-collection-item]")) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDragPosition(clampPanelPosition(
      {
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
      },
      size,
      viewport,
    ));
  };

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const onMoveHandleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = event.shiftKey ? 64 : 16;
    switch (event.key) {
      case "ArrowLeft":
        moveBy(-step, 0);
        break;
      case "ArrowRight":
        moveBy(step, 0);
        break;
      case "ArrowUp":
        moveBy(0, -step);
        break;
      case "ArrowDown":
        moveBy(0, step);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      {leader && (
        // A detached panel with no leader is just a panel that happens to be
        // nearby. One hairline, --accent-line, no arrowhead: it identifies,
        // it does not decorate.
        <svg className="selection-inspector-leader" aria-hidden="true">
          <line
            x1={leader.fromX + offset.x + dragDelta.x}
            y1={leader.fromY + offset.y + dragDelta.y}
            x2={leader.toX + offset.x}
            y2={leader.toY + offset.y}
          />
          <circle cx={leader.toX + offset.x} cy={leader.toY + offset.y} r="2.5" />
        </svg>
      )}
      <div
        ref={panelRef}
        className={`selection-inspector selection-inspector--${placement.side}`}
        /*
         * maxHeight is measured from where the panel actually landed, not
         * from the viewport's total height, and that is the difference
         * between "usually fine" and "cannot overflow".
         *
         * The placement is computed against a height that arrives a commit
         * late, so it can put the top lower than a full-height panel would
         * fit under. Capping by the viewport's height still let the panel run
         * off the bottom of the window at 900x600 - visible in the first
         * u6-inspector capture. Capping by the distance from `top` to the
         * viewport's own bottom edge is a statement the geometry cannot
         * contradict: whatever the placement decided, the panel ends where
         * the drawer begins.
         *
         * Not a `70vh` in the stylesheet, for the same reason: CSS cannot
         * know how much of the window the results drawer is covering.
         */
        style={{
          left: position.x,
          top: position.y,
          maxHeight: Math.max(160, viewport.maxY - position.y),
        }}
        // `dialog` without `aria-modal`: it names a surface a screen reader can
        // jump to, without the "everything else is inert" claim that would be
        // false and, worse, acted on.
        role="dialog"
        aria-label={title}
      >
        <div
          className="selection-inspector-head"
          data-dragging={dragging || undefined}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          style={{ touchAction: "none", userSelect: "none", cursor: dragging ? "grabbing" : "grab" }}
        >
          <span className="selection-inspector-title">{title}</span>
          <span
            className="selection-inspector-move"
            role="button"
            tabIndex={0}
            aria-label={`Move ${title}`}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            title="Drag to move; use arrow keys to reposition"
            onKeyDown={onMoveHandleKeyDown}
          >
            <GripHorizontal size={12} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <button
            type="button"
            className="selection-inspector-close"
            aria-label={`Close ${title}`}
            // Wrapped, not passed directly: `onDismiss` takes nothing, and
            // handing it a click event invites someone to start reading one.
            onClick={() => onDismiss()}
          >
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="selection-inspector-body">{children}</div>
      </div>
    </>
  );
}

export default SelectionInspector;
