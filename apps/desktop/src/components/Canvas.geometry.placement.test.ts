/**
 * The regression net `Canvas.geometry.test.ts` turned out not to be.
 *
 * `overlayPlacement.ts` was extracted from `buildLabelPlacements` as a shared
 * kernel, on the stated assumption that the existing 71-case geometry suite
 * would catch any behaviour change. It does not. Breaking the kernel three
 * separate ways (inverting the tie-break, taking the last zero-overlap
 * candidate instead of the first, and ignoring obstacles entirely) leaves all
 * 71 of those cases green, because every placement assertion over there checks
 * a loose property - labels do not overlap each other, the bounding box widens
 * - against fixtures whose parts sit far enough apart that most candidates
 * already score zero. Any valid candidate satisfies them, so *which* one wins
 * is unconstrained.
 *
 * That gap predates the extraction; it was equally true of the inline code.
 * But the redesign is about to put a component inspector on this same kernel
 * (REDESIGN.md stage 6), where choosing the wrong candidate means a panel
 * sitting on top of the part it describes. So the choice needs pinning before
 * anything else is built on it.
 *
 * This file does that, with fixtures deliberately crowded enough that the
 * candidates genuinely compete.
 */
import { describe, expect, it } from "vitest";
import { buildLabelPlacements } from "./Canvas.geometry";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

/** Two resistors close enough that their label candidates contend. */
const CROWDED: SchematicComponent[] = [
  { id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
  { id: "r-2", kind: "resistor", x: 96, y: 48, rotation: 0, value: "2k", label: "R2" },
  { id: "r-3", kind: "resistor", x: 96, y: 96, rotation: 0, value: "3k", label: "R3" },
];

const THROUGH_WIRES: SchematicWire[] = [
  { id: "w-1", points: [{ x: 0, y: 24 }, { x: 256, y: 24 }] },
  { id: "w-2", points: [{ x: 0, y: 72 }, { x: 256, y: 72 }] },
];

describe("label placement is deterministic, not merely valid", () => {
  it("chooses the same box for the same input every time", () => {
    const first = buildLabelPlacements(CROWDED, THROUGH_WIRES);
    const second = buildLabelPlacements(CROWDED, THROUGH_WIRES);
    for (const [id, placement] of first) {
      expect(second.get(id)?.box, `${id} moved between identical runs`).toEqual(placement.box);
    }
  });

  /**
   * The assertion the loose suite was missing. It pins the exact chosen box,
   * so any change to candidate ordering, tie-breaking or the zero-overlap
   * short-circuit shows up here as a diff rather than passing silently.
   *
   * If a deliberate placement change makes this fail, read the new numbers off
   * the failure and update them in the same commit as the change. That is the
   * point: the choice becomes something a reviewer has to approve.
   */
  it("pins the chosen box for a crowded row", () => {
    const placements = buildLabelPlacements(CROWDED, THROUGH_WIRES);
    const boxes = Object.fromEntries(
      [...placements].map(([id, placement]) => [id, placement.box]),
    );
    expect(boxes).toMatchInlineSnapshot(`
      {
        "r-1": {
          "maxX": 159.6,
          "maxY": 13.5,
          "minX": 136,
          "minY": -14,
        },
        "r-2": {
          "maxX": 159.6,
          "maxY": 61.5,
          "minX": 136,
          "minY": 34,
        },
        "r-3": {
          "maxX": 159.6,
          "maxY": 109.5,
          "minX": 136,
          "minY": 82,
        },
      }
    `);
  });

  it("keeps every label clear of every other label", () => {
    const placements = [...buildLabelPlacements(CROWDED, THROUGH_WIRES).values()];
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i].box;
        const b = placements[j].box;
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlaps, `labels ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  /*
   * There was a fourth test here asserting that reversing the component order
   * changes who yields. It failed: in this fixture every part gets its first
   * choice, so order genuinely does not matter, and the honest response was to
   * delete the assertion rather than contort the fixture until it passed. The
   * snapshot above is what actually pins the kernel's behaviour.
   */
});
