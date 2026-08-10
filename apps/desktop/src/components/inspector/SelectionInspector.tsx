import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
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
  /** Bumping this focuses the first field: the explicit keyboard command. */
  focusSignal?: number;
  /** Escape, or the close button. The selection itself is not cleared. */
  onDismiss: () => void;
  children: React.ReactNode;
}

const DEFAULT_SIZE = { width: 300, height: 340 };

export function SelectionInspector({
  anchor,
  viewport,
  obstacles = [],
  title,
  focusSignal = 0,
  onDismiss,
  children,
}: SelectionInspectorProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
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

  const compute = useCallback(
    (from: Rect) => placeInspector({ anchor: from, panel: size, viewport, obstacles }),
    [size, viewport, obstacles],
  );

  // First placement is immediate - waiting 120ms to show a panel someone just
  // asked for reads as lag. Only *re*-placement settles.
  const anchorKey = anchor ? `${anchor.minX},${anchor.minY},${anchor.maxX},${anchor.maxY}` : null;
  useEffect(() => {
    if (!anchor) {
      setSettled(null);
      return;
    }
    if (!settled) {
      setSettled({ anchor, placement: compute(anchor) });
      return;
    }
    const timer = setTimeout(() => setSettled({ anchor, placement: compute(anchor) }), SETTLE_MS);
    return () => clearTimeout(timer);
    // `settled` is deliberately absent: including it would restart the timer
    // on its own result and the panel would never stop re-placing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, compute]);

  // Rule 3. Keyed on the signal, not on the selection, which is rule 2.
  useEffect(() => {
    if (focusSignal === 0) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not(.selection-inspector-close), [tabindex]:not([tabindex='-1'])",
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

  if (!anchor || !settled) return null;
  const { placement } = settled;
  const leader = placement.leader;

  return (
    <>
      {leader && (
        // A detached panel with no leader is just a panel that happens to be
        // nearby. One hairline, --accent-line, no arrowhead: it identifies,
        // it does not decorate.
        <svg className="selection-inspector-leader" aria-hidden="true">
          <line
            x1={leader.fromX + offset.x}
            y1={leader.fromY + offset.y}
            x2={leader.toX + offset.x}
            y2={leader.toY + offset.y}
          />
          <circle cx={leader.toX + offset.x} cy={leader.toY + offset.y} r="2.5" />
        </svg>
      )}
      <div
        ref={panelRef}
        className={`selection-inspector selection-inspector--${placement.side}`}
        style={{ left: placement.x + offset.x, top: placement.y + offset.y }}
        // `dialog` without `aria-modal`: it names a surface a screen reader can
        // jump to, without the "everything else is inert" claim that would be
        // false and, worse, acted on.
        role="dialog"
        aria-label={title}
      >
        <div className="selection-inspector-head">
          <span className="selection-inspector-title">{title}</span>
          <button
            type="button"
            className="selection-inspector-close"
            aria-label={`Close ${title}`}
            onClick={onDismiss}
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
