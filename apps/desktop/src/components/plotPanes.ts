/**
 * plotPanes.ts - Pure pane-model helpers for the multi-pane waveform viewer.
 *
 * A "pane" is an ordered slot in the transient scope. Each pane owns a set of
 * trace ids (node ids from AnalysisResult.traces / CurrentTrace.ref, or
 * expression-trace labels). Panes share the time axis; each autoranges its own Y.
 *
 * Invariants enforced by all mutators:
 *   1. There is always at least one pane.
 *   2. No trace id appears in more than one pane.
 *   3. No trace id is orphaned (if a pane is removed, its traces are
 *      reassigned to pane 0 - the "catch-all" pane).
 */

export interface PlotPane {
  /** Stable id - nanoid-style, generated once at creation. */
  id: string;
  /** Ordered set of trace ids owned by this pane. */
  traceIds: string[];
}

/** The full pane layout: an ordered list of panes. */
export type PaneLayout = PlotPane[];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create the default single-pane layout that matches the legacy single-plot
 *  behavior. Pass an empty array to start with no traces (still one pane). */
export function defaultLayout(traceIds: string[] = []): PaneLayout {
  return [{ id: "p0", traceIds: [...traceIds] }];
}

/**
 * Build the dashboard's automatic layout: one signal per plot card. This is
 * the glanceable default after a run or probe-set change; users can still
 * combine signals with the pane selectors afterward.
 */
export function automaticLayout(traceIds: string[]): PaneLayout {
  if (traceIds.length === 0) return defaultLayout();
  return traceIds.map((traceId, index) => ({ id: `auto-p${index}`, traceIds: [traceId] }));
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Return all trace ids across all panes (preserving pane order then insertion
 *  order within each pane). */
export function allTraceIds(layout: PaneLayout): string[] {
  return layout.flatMap((p) => p.traceIds);
}

/** Find which pane index owns a given trace id, or -1 if not found. */
export function paneIndexOf(layout: PaneLayout, traceId: string): number {
  return layout.findIndex((p) => p.traceIds.includes(traceId));
}

// ---------------------------------------------------------------------------
// Mutators (all pure - return a new PaneLayout, never mutate in place)
// ---------------------------------------------------------------------------

/** Add a new, empty pane at the end of the layout. */
export function addPane(layout: PaneLayout): PaneLayout {
  const id = `p${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return [...layout, { id, traceIds: [] }];
}

/**
 * Remove pane at `index`. Its traces are reassigned to pane 0.
 * Removing the last pane is a no-op (returns the layout unchanged).
 */
export function removePane(layout: PaneLayout, index: number): PaneLayout {
  if (layout.length <= 1) return layout;
  const orphans = layout[index]?.traceIds ?? [];
  const next = layout
    .filter((_, i) => i !== index)
    .map((pane, i) => (i === 0 ? { ...pane, traceIds: [...pane.traceIds, ...orphans] } : pane));
  return next;
}

/**
 * Move `traceId` to `targetPaneIndex`.  If the trace is not currently in any
 * pane, it is simply added to the target pane.  Moving to the current pane is
 * a no-op.
 */
export function moveTrace(layout: PaneLayout, traceId: string, targetPaneIndex: number): PaneLayout {
  if (targetPaneIndex < 0 || targetPaneIndex >= layout.length) return layout;
  const srcIdx = paneIndexOf(layout, traceId);
  if (srcIdx === targetPaneIndex) return layout;
  return layout.map((pane, i) => {
    if (i === srcIdx) {
      // Remove from source pane
      return { ...pane, traceIds: pane.traceIds.filter((id) => id !== traceId) };
    }
    if (i === targetPaneIndex) {
      // Add to target pane
      return { ...pane, traceIds: [...pane.traceIds, traceId] };
    }
    return pane;
  });
}

/**
 * Add `traceId` to pane 0 if it is not already tracked in any pane.
 * This is called when a new trace (probe or expression) becomes available.
 */
export function registerTrace(layout: PaneLayout, traceId: string): PaneLayout {
  if (paneIndexOf(layout, traceId) !== -1) return layout;
  const [first, ...rest] = layout;
  return [{ ...first, traceIds: [...first.traceIds, traceId] }, ...rest];
}

/**
 * Remove `traceId` from whichever pane owns it.  If the trace is not found,
 * the layout is returned unchanged.
 */
export function unregisterTrace(layout: PaneLayout, traceId: string): PaneLayout {
  const idx = paneIndexOf(layout, traceId);
  if (idx === -1) return layout;
  return layout.map((pane, i) =>
    i === idx ? { ...pane, traceIds: pane.traceIds.filter((id) => id !== traceId) } : pane,
  );
}

/**
 * Reconcile the layout against a fresh set of available trace ids.
 *
 * - Traces in `available` that are not yet tracked are added to pane 0.
 * - Traces that are tracked but no longer in `available` are removed.
 * - Pane order and per-pane trace order are otherwise preserved.
 *
 * After reconciliation, at least one pane is always present.
 */
export function reconcileLayout(layout: PaneLayout, available: string[]): PaneLayout {
  const availSet = new Set(available);
  const tracked = new Set(allTraceIds(layout));

  // Remove obsolete traces from their panes.
  let next: PaneLayout = layout.map((pane) => ({
    ...pane,
    traceIds: pane.traceIds.filter((id) => availSet.has(id)),
  }));

  // Add newly-available traces to pane 0.
  const newIds = available.filter((id) => !tracked.has(id));
  if (newIds.length > 0) {
    next = [{ ...next[0], traceIds: [...next[0].traceIds, ...newIds] }, ...next.slice(1)];
  }

  // Guard: at least one pane must exist.
  if (next.length === 0) return [{ id: "p0", traceIds: available.slice() }];
  return next;
}

// ---------------------------------------------------------------------------
// Validation helper (used in tests and assertions)
// ---------------------------------------------------------------------------

/** Return true if the layout satisfies all invariants. */
export function isValidLayout(layout: PaneLayout): boolean {
  if (layout.length === 0) return false;
  const seen = new Set<string>();
  for (const pane of layout) {
    for (const id of pane.traceIds) {
      if (seen.has(id)) return false;
      seen.add(id);
    }
  }
  return true;
}
