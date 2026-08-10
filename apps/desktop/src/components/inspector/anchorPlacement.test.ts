import { describe, expect, it } from "vitest";
import { placeInspector } from "./anchorPlacement";

/**
 * The inspector's placement, tested as arithmetic.
 *
 * Worth its own file rather than a rendered assertion: the interesting cases
 * are the ones a screenshot cannot reach on demand - a part hard against the
 * right edge, a part under the toolbar, a viewport too small for the panel at
 * all. Each of those is one call here and a fiddly setup anywhere else.
 */

const VIEWPORT = { minX: 52, minY: 44, maxX: 1440, maxY: 872 };
const PANEL = { width: 300, height: 360 };
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

describe("inspector placement", () => {
  it("sits to the right of the part when there is room", () => {
    const anchor = { minX: 400, minY: 300, maxX: 460, maxY: 340 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: VIEWPORT, obstacles: [] });
    expect(place.side).toBe("right");
    expect(place.x).toBeGreaterThan(anchor.maxX);
    expect(place.leader).toBeNull();
  });

  it("flips to the left when the right edge is too close", () => {
    const anchor = { minX: 1300, minY: 300, maxX: 1360, maxY: 340 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: VIEWPORT, obstacles: [] });
    expect(place.side).toBe("left");
    expect(place.x + PANEL.width).toBeLessThan(anchor.minX);
  });

  it("treats the viewport edge as a refusal, not a penalty", () => {
    // Every side rejected: the panel is taller than the viewport, so nothing
    // anchored can fit whatever the overlap score says. Clamping here would
    // put a panel half off-screen, which reads as a rendering bug.
    const anchor = { minX: 400, minY: 300, maxX: 460, maxY: 340 };
    const shallow = { minX: 52, minY: 44, maxX: 1440, maxY: 300 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: shallow, obstacles: [] });
    expect(place.side).toBe("dock");
    expect(place.x).toBeGreaterThanOrEqual(shallow.minX);
  });

  it("never covers the part it describes, even to avoid chrome", () => {
    // A slab of chrome sits everywhere to the right, so "right" scores badly.
    // It still must not choose a side that overlaps the selection.
    const anchor = { minX: 700, minY: 300, maxX: 760, maxY: 340 };
    const chromeRight = { minX: 780, minY: 44, maxX: 1440, maxY: 872 };
    const place = placeInspector({
      anchor,
      panel: PANEL,
      viewport: VIEWPORT,
      obstacles: [chromeRight],
    });
    const box = { minX: place.x, minY: place.y, maxX: place.x + PANEL.width, maxY: place.y + PANEL.height };
    const coversAnchor = box.minX < anchor.maxX && box.maxX > anchor.minX
      && box.minY < anchor.maxY && box.maxY > anchor.minY;
    expect(coversAnchor).toBe(false);
  });

  it("prefers the clear side over the one buried in chrome", () => {
    const anchor = { minX: 700, minY: 400, maxX: 760, maxY: 440 };
    const chromeRight = { minX: 774, minY: 44, maxX: 1440, maxY: 872 };
    const place = placeInspector({
      anchor,
      panel: PANEL,
      viewport: VIEWPORT,
      obstacles: [chromeRight],
    });
    expect(place.side).not.toBe("right");
  });

  it("docks with a leader line back to the selection when nothing fits", () => {
    const anchor = { minX: 400, minY: 260, maxX: 460, maxY: 290 };
    const shallow = { minX: 52, minY: 44, maxX: 1440, maxY: 300 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: shallow, obstacles: [] });
    expect(place.leader).not.toBeNull();
    // A detached panel with no leader is just a panel that happens to be
    // nearby: the line is what says which part it is describing.
    expect(near(place.leader!.toX, 430)).toBe(true);
    expect(near(place.leader!.toY, 275)).toBe(true);
  });

  it("docks away from the part, so the leader crosses as little drawing as it can", () => {
    const shallow = { minX: 52, minY: 44, maxX: 1440, maxY: 300 };
    const onTheRight = placeInspector({
      anchor: { minX: 1200, minY: 260, maxX: 1260, maxY: 290 },
      panel: PANEL,
      viewport: shallow,
      obstacles: [],
    });
    const onTheLeft = placeInspector({
      anchor: { minX: 100, minY: 260, maxX: 160, maxY: 290 },
      panel: PANEL,
      viewport: shallow,
      obstacles: [],
    });
    expect(onTheRight.x).toBeLessThan(onTheLeft.x);
  });

  it("keeps the panel inside the viewport when the part is at the very top", () => {
    const anchor = { minX: 400, minY: 46, maxX: 460, maxY: 80 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: VIEWPORT, obstacles: [] });
    expect(place.y).toBeGreaterThanOrEqual(VIEWPORT.minY);
    expect(place.y + PANEL.height).toBeLessThanOrEqual(VIEWPORT.maxY);
  });

  it("keeps the panel inside the viewport when the part is at the very bottom", () => {
    const anchor = { minX: 400, minY: 840, maxX: 460, maxY: 868 };
    const place = placeInspector({ anchor, panel: PANEL, viewport: VIEWPORT, obstacles: [] });
    expect(place.y).toBeGreaterThanOrEqual(VIEWPORT.minY);
    expect(place.y + PANEL.height).toBeLessThanOrEqual(VIEWPORT.maxY);
  });
});
