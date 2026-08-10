import { padRect, placeOverlay, type Rect } from "../overlayPlacement";

/**
 * Where to put a panel next to the thing it describes.
 *
 * Screen pixels, not world units. `buildLabelPlacements` solves the same
 * shape of problem for a ~60x20 text label in schematic coordinates, and its
 * scoring core is shared (`overlayPlacement.ts`) - but its candidate offsets
 * are +/-10 and +/-20 world units, which are meaningless next to a 300x360
 * panel, and its notion of "off the edge" is a score rather than a refusal.
 * Those two differences are the whole reason this module exists.
 *
 * The rules, in the order they bind:
 *
 * 1. **The viewport edge is a hard reject, not a penalty.** A label pushed
 *    past the edge of the drawing is untidy; a panel pushed past the edge of
 *    the window is unreachable. A candidate that does not fit is not scored,
 *    it is discarded.
 * 2. **Chrome counts as an obstacle, the part itself counts double.** Covering
 *    the toolbar is bad. Covering the component you just selected defeats the
 *    point, so the anchor is weighted heavier than everything else.
 * 3. **When nothing fits, dock rather than clamp.** A panel jammed into a
 *    corner with its edge off-screen reads as a rendering bug. A deliberate
 *    corner dock with a leader line back to the selection reads as a decision,
 *    which is what it is.
 */

export interface PlacementInput {
  /** The selection's bounding box in client coordinates. */
  anchor: Rect;
  /** Panel size in CSS pixels. */
  panel: { width: number; height: number };
  /** The area the panel is allowed to occupy: the shell body, less its chrome. */
  viewport: Rect;
  /** Chrome and other surfaces the panel should avoid covering. */
  obstacles: readonly Rect[];
}

export interface Placement {
  /** Client coordinates for the panel's top-left corner. */
  x: number;
  y: number;
  /** Which side of the anchor it landed on, or `dock` when nothing fit. */
  side: "right" | "left" | "below" | "above" | "dock";
  /**
   * Where to draw a leader line from, when docked. Null for an anchored
   * placement, where adjacency already says what the panel belongs to.
   */
  leader: { fromX: number; fromY: number; toX: number; toY: number } | null;
}

/** Breathing room between the panel and the part it describes. */
const GAP = 14;

const rectOf = (x: number, y: number, width: number, height: number): Rect => ({
  minX: x,
  minY: y,
  maxX: x + width,
  maxY: y + height,
});

const fitsInside = (box: Rect, viewport: Rect): boolean =>
  box.minX >= viewport.minX && box.maxX <= viewport.maxX
  && box.minY >= viewport.minY && box.maxY <= viewport.maxY;

const centre = (rect: Rect) => ({
  x: (rect.minX + rect.maxX) / 2,
  y: (rect.minY + rect.maxY) / 2,
});

/** Clamp a coordinate so a panel placed at it stays inside `viewport`. */
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

export function placeInspector({ anchor, panel, viewport, obstacles }: PlacementInput): Placement {
  const { width, height } = panel;

  // Aligned with the anchor's top where there is room, and slid along the
  // cross axis to stay in view. Sliding is fine on the cross axis - the panel
  // is still visibly beside the part - and is not the same thing as clamping
  // it onto the main axis, which would put it on top of the selection.
  const alignY = clamp(anchor.minY, viewport.minY, Math.max(viewport.minY, viewport.maxY - height));
  const alignX = clamp(centre(anchor).x - width / 2, viewport.minX, Math.max(viewport.minX, viewport.maxX - width));

  const sides = [
    { side: "right" as const, box: rectOf(anchor.maxX + GAP, alignY, width, height) },
    { side: "left" as const, box: rectOf(anchor.minX - GAP - width, alignY, width, height) },
    { side: "below" as const, box: rectOf(alignX, anchor.maxY + GAP, width, height) },
    { side: "above" as const, box: rectOf(alignX, anchor.minY - GAP - height, width, height) },
  ];

  const viable = sides.filter((candidate) => fitsInside(candidate.box, viewport));

  if (viable.length > 0) {
    // The selected part is weighted by listing it three times: overlapping it
    // has to lose to overlapping a strip of toolbar, because a panel over the
    // toolbar is merely in the way and a panel over the part is the failure.
    const weighted = [...obstacles, padRect(anchor, 4), padRect(anchor, 4), padRect(anchor, 4)];
    const chosen = placeOverlay({ candidates: viable, obstacles: weighted });
    return { x: chosen.box.minX, y: chosen.box.minY, side: chosen.side, leader: null };
  }

  // Nothing fit. Dock to whichever bottom corner is further from the anchor,
  // so the leader line crosses as little of the drawing as it can.
  const anchorCentre = centre(anchor);
  const dockLeft = anchorCentre.x > (viewport.minX + viewport.maxX) / 2;
  const x = dockLeft ? viewport.minX + GAP : viewport.maxX - width - GAP;
  const y = Math.max(viewport.minY, viewport.maxY - height - GAP);
  const box = rectOf(x, y, width, height);
  return {
    x,
    y,
    side: "dock",
    leader: {
      fromX: dockLeft ? box.maxX : box.minX,
      fromY: box.minY + 18,
      toX: anchorCentre.x,
      toY: anchorCentre.y,
    },
  };
}
