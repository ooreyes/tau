/**
 * cardLayout.ts - Pure layout model for the TRAN tab's snap-tiling dashboard
 * (plot panes + the measurements/Fourier tables, arranged in a 2-column grid
 * with drag-to-tile). Mirrors plotPanes.ts's shape: a small, framework-free
 * reducer so the reorder/resize/persistence math is unit-testable without
 * mounting React or faking DOM rects.
 */

export type CardWidth = "half" | "full";
export type CardHeight = "S" | "M" | "L";
export type CardKind = "plot" | "table";

/** viewBox height in px for each plot card size - threaded into TranScopePane. */
export const PLOT_HEIGHT_PX: Record<CardHeight, number> = { S: 160, M: 190, L: 260 };

export interface CardSpec {
  /** Stable id - `plot:<traceId>` for plot cards (never the pane's own id,
   *  which regenerates as `auto-p${index}` whenever the signal set changes),
   *  or a fixed id ("measurements" / "fourier") for table cards. */
  id: string;
  kind: CardKind;
  title: string;
}

export interface CardLayoutState {
  /** Display order, front to back. */
  order: string[];
  widths: Record<string, CardWidth>;
  heights: Record<string, CardHeight>;
}

export function emptyCardLayout(): CardLayoutState {
  return { order: [], widths: {}, heights: {} };
}

/** A plot card defaults to half width once there are 2+ plot cards (so they
 *  tile two-up, the whole point of the dashboard); a lone plot or any table
 *  defaults to full width. */
function defaultWidth(kind: CardKind, plotCount: number): CardWidth {
  return kind === "plot" && plotCount >= 2 ? "half" : "full";
}

/**
 * Reconcile persisted/previous layout state against the currently available
 * cards: keeps existing order/width/height for ids still present, appends
 * newly-available ids (in their natural order) at the end, and drops ids that
 * no longer exist. A manual width/height choice is never clobbered by a
 * rerun with the same signals - only genuinely new cards get defaults.
 */
export function reconcileCardLayout(state: CardLayoutState, cards: readonly CardSpec[]): CardLayoutState {
  const known = new Set(cards.map((c) => c.id));
  const plotCount = cards.filter((c) => c.kind === "plot").length;

  const order = state.order.filter((id) => known.has(id));
  const seen = new Set(order);
  for (const card of cards) {
    if (!seen.has(card.id)) {
      order.push(card.id);
      seen.add(card.id);
    }
  }

  const widths: Record<string, CardWidth> = {};
  const heights: Record<string, CardHeight> = {};
  for (const card of cards) {
    widths[card.id] = state.widths[card.id] ?? defaultWidth(card.kind, plotCount);
    if (card.kind === "plot") heights[card.id] = state.heights[card.id] ?? "M";
  }
  return { order, widths, heights };
}

export function toggleCardWidth(state: CardLayoutState, id: string): CardLayoutState {
  const current = state.widths[id] ?? "full";
  return { ...state, widths: { ...state.widths, [id]: current === "half" ? "full" : "half" } };
}

const HEIGHT_ORDER: readonly CardHeight[] = ["S", "M", "L"];

export function cycleCardHeight(state: CardLayoutState, id: string): CardLayoutState {
  const current = state.heights[id] ?? "M";
  const next = HEIGHT_ORDER[(HEIGHT_ORDER.indexOf(current) + 1) % HEIGHT_ORDER.length];
  return { ...state, heights: { ...state.heights, [id]: next } };
}

/**
 * Where a dragged card lands relative to the hovered card. Pairing (side by
 * side) only makes sense next to a card that is already `half` width - a
 * `full` card takes its whole row, so hovering it just reorders (before/
 * after), matching "drop onto a half-slot next to a half card to tile them".
 */
export type DropTarget =
  | { kind: "before"; id: string }
  | { kind: "after"; id: string }
  | { kind: "pair-before"; id: string }
  | { kind: "pair-after"; id: string };

export function dropTargetFor(hovered: { id: string; width: CardWidth }, side: "start" | "end"): DropTarget {
  if (hovered.width === "half") {
    return side === "start" ? { kind: "pair-before", id: hovered.id } : { kind: "pair-after", id: hovered.id };
  }
  return side === "start" ? { kind: "before", id: hovered.id } : { kind: "after", id: hovered.id };
}

/** Move `draggedId` to `target`'s position (immediately before/after it),
 *  pairing widths to `half` when the drop is a same-row pairing. A no-op
 *  when dropping a card onto itself. */
export function applyDrop(state: CardLayoutState, draggedId: string, target: DropTarget): CardLayoutState {
  if (target.id === draggedId) return state;
  const order = state.order.filter((id) => id !== draggedId);
  const idx = order.indexOf(target.id);
  const after = target.kind === "after" || target.kind === "pair-after";
  const insertAt = idx < 0 ? order.length : after ? idx + 1 : idx;
  order.splice(insertAt, 0, draggedId);

  let widths = state.widths;
  if (target.kind === "pair-before" || target.kind === "pair-after") {
    widths = { ...widths, [draggedId]: "half", [target.id]: "half" };
  }
  return { ...state, order, widths };
}

// ── Persistence (best effort, per circuit tab) ──────────────────────────────

const STORAGE_PREFIX = "tau.tranGrid.";

function isCardWidth(value: unknown): value is CardWidth {
  return value === "half" || value === "full";
}

function isCardHeight(value: unknown): value is CardHeight {
  return value === "S" || value === "M" || value === "L";
}

function filterRecord<T>(value: unknown, isValid: (v: unknown) => v is T): Record<string, T> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isValid(v)) out[key] = v;
  }
  return out;
}

export function loadCardLayout(key: string): CardLayoutState {
  if (typeof localStorage === "undefined") return emptyCardLayout();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return emptyCardLayout();
    const parsed = JSON.parse(raw) as Partial<CardLayoutState>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((id): id is string => typeof id === "string") : [],
      widths: filterRecord(parsed.widths, isCardWidth),
      heights: filterRecord(parsed.heights, isCardHeight),
    };
  } catch {
    return emptyCardLayout();
  }
}

export function saveCardLayout(key: string, state: CardLayoutState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
  } catch {
    // Quota exceeded / private mode - the session keeps its in-memory layout.
  }
}
