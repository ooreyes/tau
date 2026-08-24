import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SchematicComponent, SchematicPortDirection } from "./types";
import {
  SUBCIRCUIT_BODY_HALF_WIDTH,
  SUBCIRCUIT_BODY_MAX_HALF_WIDTH,
  buildSubcircuitPinOverride,
  localSubcircuitPins,
  middleEllipsisCaption,
  nativeSubcircuitBody,
  subcircuitBankSides,
  subcircuitCaptionBudget,
  subcircuitCaptionWidth,
  subcircuitPortSlots,
} from "./subcircuitGeometry";
import { buildProjectHierarchyDeck, type ProjectHierarchySheet } from "./projectHierarchy";

const component = (rotation: 0 | 90 | 180 | 270 = 0, mirrored = false): SchematicComponent => ({
  id: "x1", kind: "subckt", x: 96, y: 192, rotation, mirrored,
  value: "driver", label: "X1",
});

describe("native subcircuit geometry", () => {
  it("creates a grid-aligned five-terminal left/right block in SpiceOrder", () => {
    const pins = buildSubcircuitPinOverride(component(), ["vcc", "vee", "pwm", "gp", "gn"]);
    expect(pins).toEqual([
      { id: "p1", label: "vcc", x: 48, y: 160 },
      { id: "p2", label: "vee", x: 48, y: 192 },
      { id: "p3", label: "pwm", x: 48, y: 224 },
      { id: "p4", label: "gp", x: 144, y: 176 },
      { id: "p5", label: "gn", x: 144, y: 208 },
    ]);
    expect(pins.every((pin) => pin.x % 16 === 0 && pin.y % 16 === 0)).toBe(true);
  });

  it("preserves authored local terminal roles through orientation", () => {
    const base = component(90, true);
    const withPins = { ...base, pinOverride: buildSubcircuitPinOverride(base, ["in", "out"]) };
    expect(localSubcircuitPins(withPins).map(({ id, label, x, y }) => ({ id, label, x, y }))).toEqual([
      { id: "p1", label: "in", x: -48, y: 0 },
      { id: "p2", label: "out", x: 48, y: 0 },
    ]);
  });

  it("grows the body to cover long terminal banks", () => {
    const base = component();
    const withPins = { ...base, pinOverride: buildSubcircuitPinOverride(base, Array.from({ length: 9 }, (_, i) => `p${i}`)) };
    // 64 (outermost pin) + 18. The reserve is 18 rather than 12 because the
    // model caption's baseline sits at minY + 8 and its glyph box hangs below
    // that; see the next test, which is what pins the number.
    expect(nativeSubcircuitBody(withPins)).toEqual({ minX: -28, minY: -82, maxX: 28, maxY: 82 });
  });

  /**
   * The model caption must clear the TOPMOST PIN CAPTION, not merely the
   * topmost pin.
   *
   * Canvas draws the model name with its baseline at `minY + 8`, and a 7px
   * glyph box hangs about 1.5 units below its own baseline. With the previous
   * `maxPinY + 12` reserve, a 3-port block whose outer pins sat at y = +/-16
   * drew its model name straight through the first pin caption: measured in the
   * browser, "Rectifier" occupied y -26.5..-18.5 and "SEC1" -19.5..-11.5, a 1px
   * overlap across a 10px span.
   *
   * Asserted as the geometric relationship rather than as a magic number, so it
   * keeps holding if the caption metrics change.
   */
  it("reserves room for the model caption above the first pin caption", () => {
    const base = component();
    const threePort = {
      ...base,
      pinOverride: [
        { id: "p1", label: "SEC1", x: base.x - 48, y: base.y - 16 },
        { id: "p2", label: "SEC2", x: base.x - 48, y: base.y + 16 },
        { id: "p3", label: "VBUS", x: base.x + 48, y: base.y },
      ],
    } as SchematicComponent;
    const body = nativeSubcircuitBody(threePort);

    const MODEL_BASELINE = body.minY + 8;   // where Canvas draws it
    const GLYPH_DESCENT = 1.5;              // 7px mono box below its baseline
    const CAPTION_HALF_HEIGHT = 4;          // pin caption box is ~8 units tall
    const topPinCaptionTop = -16 - CAPTION_HALF_HEIGHT;

    expect(MODEL_BASELINE + GLYPH_DESCENT).toBeLessThan(topPinCaptionTop);
    // A two-port bank keeps its historic 20-unit half-height: no block that
    // renders correctly today changes size.
    const twoPort = { ...base, pinOverride: buildSubcircuitPinOverride(base, ["VIN", "VOUT"]) };
    expect(nativeSubcircuitBody(twoPort).maxY).toBe(20);
  });
});

/**
 * A2/A4-class guards. These protect the electrical contract: the whole
 * direction-aware side rule is only admissible because it cannot change the
 * emitted `X` card, and the only way to keep that true under future edits is
 * to assert the ids and labels are identical across both call shapes.
 */
describe("direction-aware side rule", () => {
  const bank = (directions?: readonly SchematicPortDirection[]) =>
    buildSubcircuitPinOverride(component(), ["vcc", "vee", "pwm", "gp", "gn"], directions);

  it("keeps ids and labels identical whichever side direction sends a pin (A2)", () => {
    const legacy = bank();
    const directed = bank(["In", "Out", "BiDir", "In", "Out"]);
    expect(directed.map((pin) => pin.id)).toEqual(legacy.map((pin) => pin.id));
    expect(directed.map((pin) => pin.label)).toEqual(legacy.map((pin) => pin.label));
    // ...and it really did relayout, or the assertion above proves nothing.
    expect(directed.map((pin) => `${pin.x},${pin.y}`))
      .not.toEqual(legacy.map((pin) => `${pin.x},${pin.y}`));
    expect(directed.every((pin) => pin.x % 16 === 0 && pin.y % 16 === 0)).toBe(true);
  });

  it("puts In left, Out right, and lands a tie-breaking BiDir on the left", () => {
    // Derived, not restated: read the sides back off the bank the builder made.
    const base = component();
    const comp = {
      ...base,
      pinOverride: buildSubcircuitPinOverride(base, ["IN", "OUT", "GND"], ["In", "Out", "BiDir"]),
    } as SchematicComponent;
    expect(subcircuitBankSides(comp)).toEqual(["left", "right", "left"]);
    // The BiDir GND is the LOWEST pin in the left column - how an EE draws it.
    const local = localSubcircuitPins(comp);
    expect(local[2].y).toBeGreaterThan(local[0].y);
  });

  it("sends a BiDir to whichever column is shorter", () => {
    // Two Ins already fill the left column, so the BiDir must go right.
    expect(subcircuitPortSlots(["a", "b", "c"], ["In", "In", "BiDir"]).map((s) => s.side))
      .toEqual(["left", "left", "right"]);
  });

  it("reproduces the historical half-split when no directions are given", () => {
    for (const count of [0, 1, 2, 3, 4, 5, 8, 9]) {
      const ports = Array.from({ length: count }, (_, i) => `n${i}`);
      const leftCount = count <= 1 ? count : Math.ceil(count / 2);
      expect(subcircuitPortSlots(ports).map((slot) => slot.side)).toEqual(
        ports.map((_, index) => (index < leftCount ? "left" : "right")),
      );
    }
  });

  it("reports null for a hand-authored terminal that sits on the centre line", () => {
    const comp = {
      ...component(),
      pinOverride: [{ id: "p1", label: "com", x: 96, y: 192 }],
    } as SchematicComponent;
    expect(subcircuitBankSides(comp)).toEqual([null]);
  });
});

describe("body width from the interface", () => {
  const captionFontSizes = () => {
    // Derived from the stylesheet rather than restated: the width rule is only
    // theme-independent if no theme block re-declares the caption's font.
    const css = readFileSync(new URL("../App.css", import.meta.url), "utf8");
    return [...css.matchAll(/\.subckt-pin-label\s*\{([^}]*)\}/g)]
      .flatMap((match) => [...match[1].matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g)])
      .map((match) => match[1]);
  };

  it("declares one caption font size, so the width rule holds in both themes", () => {
    expect(captionFontSizes()).toEqual(["7"]);
  });

  it("grows for long captions, stays clamped, and keeps every caption inside", () => {
    const ports = ["VIN_SENSE_AA", "VOUT_MON_BBB"]; // 12 chars each
    const base = component();
    const comp = {
      ...base,
      pinOverride: buildSubcircuitPinOverride(base, ports, ["In", "Out"]),
    } as SchematicComponent;
    const body = nativeSubcircuitBody(comp);
    expect(body.maxX).toBeGreaterThan(SUBCIRCUIT_BODY_HALF_WIDTH);
    expect(body.maxX).toBeLessThanOrEqual(SUBCIRCUIT_BODY_MAX_HALF_WIDTH);
    expect(body.maxX % 4).toBe(0);
    // Every rendered caption fits between the body walls, gutter included.
    const budget = subcircuitCaptionBudget(body.maxX);
    for (const port of ports) {
      const drawn = middleEllipsisCaption(port, budget);
      expect(subcircuitCaptionWidth(drawn)).toBeLessThanOrEqual(body.maxX - 4);
    }
    // Both captions plus the centre gutter fit across the full width.
    const drawnWidth = ports
      .map((p) => subcircuitCaptionWidth(middleEllipsisCaption(p, budget)))
      .reduce((a, b) => a + b, 0);
    expect(drawnWidth + 8 + 8).toBeLessThanOrEqual(body.maxX - body.minX);
  });

  it("middle-ellipsises rather than truncating, and never exceeds the budget", () => {
    expect(middleEllipsisCaption("VOUT", 8)).toBe("VOUT");
    const shortened = middleEllipsisCaption("VOUT_SENSE_A", 6);
    expect(shortened.length).toBe(6);
    expect(shortened.startsWith("VOU")).toBe(true);
    expect(shortened.endsWith("E_A")).toBe(false);
    expect(shortened).toContain("…");
  });
});

/**
 * THE ELECTRICAL PROOF, BUILT RATHER THAN ARGUED.
 *
 * `subcircuitPortSlots`' comment claims side is electrically free because
 * `exactLinkForComponent` reads only `id` and `label`. A comment is not a
 * proof, and this is the single assumption the whole drawing-first design rests
 * on: if it were wrong, choosing a direction on the child would silently
 * change which parent net becomes which node - the exact failure the
 * fail-closed compiler exists to prevent.
 *
 * So build the deck BOTH ways and read the emitted cards. The two instances
 * differ ONLY in the `directions` argument, which puts p1/p2/p3 on opposite
 * columns; the parent's net labels ride each instance's own terminals (as
 * `relocateAttachedEndpoints` makes them do in the store). The `.subckt`
 * header and the `X` card must come out byte-identical.
 */
describe("subcircuitPortSlots - side is electrically free, proven against the compiler", () => {
  const CHILD = "power/buck-cell.sim";
  const PORTS = ["VIN", "VOUT", "GND"];

  const childSheet = (): ProjectHierarchySheet => ({
    path: CHILD,
    document: {
      components: [
        { id: "l1", kind: "inductor", x: 32, y: 0, rotation: 0 as const, value: "1m", label: "L1" },
        { id: "c1", kind: "capacitor", x: 96, y: 0, rotation: 0 as const, value: "1u", label: "C1" },
      ],
      wires: [],
      netLabels: [
        { id: "vin", x: 0, y: 0, text: "VIN", port: "In" as const },
        { id: "vout", x: 64, y: 0, text: "VOUT", port: "Out" as const },
        { id: "gnd", x: 128, y: 0, text: "GND", port: "BiDir" as const },
      ],
      projectPorts: [
        { name: "VIN", labelId: "vin", direction: "In" as const },
        { name: "VOUT", labelId: "vout", direction: "Out" as const },
        { name: "GND", labelId: "gnd", direction: "BiDir" as const },
      ],
      directives: [],
    },
  });

  /** A root sheet whose labels sit on wherever this bank actually put them. */
  const deckFor = (directions?: readonly SchematicPortDirection[]) => {
    const base: SchematicComponent = {
      id: "x1", kind: "subckt", x: 400, y: 0, rotation: 0, mirrored: false,
      value: "TauBuck", label: "X1",
    };
    const pinOverride = buildSubcircuitPinOverride(base, PORTS, directions);
    const instance: SchematicComponent = {
      ...base,
      pinOverride,
      projectSubcircuit: { sheetPath: CHILD, model: "TauBuck", ports: PORTS },
    };
    const at = (id: string) => pinOverride.find((pin) => pin.id === id)!;
    return buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root: {
        components: [
          { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "10", label: "V1" },
          instance,
          { id: "rload", kind: "resistor", x: 240, y: 0, rotation: 0, value: "10", label: "Rload" },
        ],
        wires: [],
        netLabels: [
          { id: "vin-source", x: 0, y: -32, text: "VIN" },
          { id: "gnd-source", x: 0, y: 32, text: "GND" },
          { id: "vout-load", x: 208, y: 0, text: "VOUT" },
          { id: "gnd-load", x: 272, y: 0, text: "GND" },
          { id: "l-p1", x: at("p1").x, y: at("p1").y, text: "VIN" },
          { id: "l-p2", x: at("p2").x, y: at("p2").y, text: "VOUT" },
          { id: "l-p3", x: at("p3").x, y: at("p3").y, text: "GND" },
        ],
        directives: [],
      },
      sheets: [childSheet()],
      analysis: { kind: "op" },
    });
  };

  const xCard = (netlist: string) => netlist.split("\n").find((line) => line.startsWith("X1"))!;
  const header = (netlist: string) => netlist.split("\n").find((line) => line.startsWith(".subckt"))!;

  it("puts the terminals on genuinely different sides", () => {
    // Guard against a vacuous comparison: if the two banks were identical the
    // equality below would prove nothing at all.
    const base = { id: "x1", kind: "subckt", x: 400, y: 0, rotation: 0 as const, mirrored: false } as SchematicComponent;
    const half = buildSubcircuitPinOverride(base, PORTS);
    const byDir = buildSubcircuitPinOverride(base, PORTS, ["In", "Out", "BiDir"]);
    expect(half.map((p) => p.x)).not.toEqual(byDir.map((p) => p.x));
    // p2 is the case that actually flips: right in the half-split, right again
    // for Out - so use p3/GND, which the tie rule pulls to the LEFT column.
    // Pins are WORLD coordinates, so compare against the instance origin.
    expect(half[2]!.x).toBeGreaterThan(400);
    expect(byDir[2]!.x).toBeLessThan(400);
  });

  it("emits a byte-identical .subckt header and X card whichever side each pin landed on", () => {
    const half = deckFor().deck.netlist;
    const byDir = deckFor(["In", "Out", "BiDir"]).deck.netlist;
    expect(header(byDir)).toBe(header(half));
    expect(xCard(byDir)).toBe(xCard(half));
    // And it is the real card, not an empty string that happens to match.
    expect(header(half)).toBe(".subckt TauBuck VIN VOUT GND");
    expect(xCard(half)).toMatch(/^X1 \S+ \S+ \S+ TauBuck$/);
  });

  it("still refuses a bank whose ORDER disagrees with the contract", () => {
    // Order is the thing that is NOT free, and it must stay refused.
    const base: SchematicComponent = {
      id: "x1", kind: "subckt", x: 400, y: 0, rotation: 0, mirrored: false, value: "TauBuck", label: "X1",
    };
    const scrambled = buildSubcircuitPinOverride(base, ["VOUT", "VIN", "GND"], ["In", "Out", "BiDir"]);
    const instance: SchematicComponent = {
      ...base,
      pinOverride: scrambled,
      projectSubcircuit: { sheetPath: CHILD, model: "TauBuck", ports: PORTS },
    };
    expect(() => buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root: { components: [instance], wires: [], netLabels: [], directives: [] },
      sheets: [childSheet()],
      analysis: { kind: "op" },
    })).toThrow();
  });
});
