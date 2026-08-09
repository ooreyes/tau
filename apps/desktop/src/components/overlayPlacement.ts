/**
 * Generic "avoid the obstacles" placement kernel.
 *
 * `buildLabelPlacements` in `Canvas.geometry.ts` uses this to keep a
 * component's reference-designator/value text from covering the component,
 * its wires, or another label already placed. The canvas-redesign component
 * inspector panel (see REDESIGN.md) needs the exact same decision - candidate
 * positions scored by how much they overlap obstacles, cheapest wins - but at
 * screen-pixel scale next to a ~280x220 panel instead of world-unit scale
 * next to a ~60x20 text label. Only the parts of the original label placer
 * that don't care about that difference live here: a box is just a box, an
 * obstacle is just a box, and a candidate is anything with a `.box`. Nothing
 * about text, world units, viewport edges, or leader lines belongs in this
 * module - those stay with whichever caller actually has that concept.
 */

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Rect grown (or, with a negative `pad`, shrunk) by `pad` on every side. */
export const padRect = (rect: Rect, pad: number): Rect => ({
  minX: rect.minX - pad,
  minY: rect.minY - pad,
  maxX: rect.maxX + pad,
  maxY: rect.maxY + pad,
});

/** Area of the intersection of two axis-aligned rects (0 when disjoint or only touching). */
export const overlapArea = (a: Rect, b: Rect): number => {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
};

/** Anything the kernel can score: it only ever reads `.box`, so a candidate
 *  is free to carry whatever payload the caller needs alongside it (a
 *  label's ref/value anchor points, an inspector's screen offset, ...). */
export interface OverlayCandidate {
  box: Rect;
}

export interface PlaceOverlayOptions<T extends OverlayCandidate> {
  /** Candidate positions in priority order. Order is the tiebreaker: it is
   *  what the caller falls back on when nothing overlaps (first candidate)
   *  and again when multiple candidates tie for least overlap. */
  candidates: readonly T[];
  /** Everything the chosen candidate should try not to cover. */
  obstacles: readonly Rect[];
}

/**
 * Walk `candidates` in order, scoring each by its summed overlap area
 * against every obstacle. Returns the first candidate with zero overlap -
 * short-circuiting, so an earlier clear slot always wins even if a later
 * candidate would score lower on some other measure - otherwise the
 * candidate with the least total overlap, with the first occurrence winning
 * a tie.
 */
export function placeOverlay<T extends OverlayCandidate>({ candidates, obstacles }: PlaceOverlayOptions<T>): T {
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let score = 0;
    for (const obstacle of obstacles) score += overlapArea(candidate.box, obstacle);
    if (score === 0) return candidate;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
