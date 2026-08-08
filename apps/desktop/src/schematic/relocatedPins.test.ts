import { describe, expect, it } from "vitest";
import { FORMER_PIN_POSITIONS, strandedTerminalNotices, strandedTerminals } from "./relocatedPins";
import { getComponentPins, transformPoint } from "./pins";
import type { ComponentKind, Rotation, SchematicComponent, SchematicWire } from "./types";

/**
 * Item 5 moved pin *coordinates* on ten digital kinds and item 9 made the
 * gate's input count configurable. Both changed where a terminal sits without
 * changing its id, so a document saved beforehand has wires ending in the old
 * place and terminals sitting bare in the new one.
 *
 * The rule these tests hold to: a schematic that was already correct is
 * untouched and silent, and one that is now disconnected says so by name.
 */

const part = (
  kind: ComponentKind,
  overrides: Partial<SchematicComponent> = {},
): SchematicComponent => ({
  id: "u1",
  kind,
  x: 0,
  y: 0,
  rotation: 0,
  value: "",
  label: "U1",
  ...overrides,
});

const wireTo = (x: number, y: number, id = "w1"): SchematicWire => ({
  id,
  points: [{ x: x - 64, y }, { x, y }],
});

const pinAt = (component: SchematicComponent, id: string) =>
  getComponentPins(component).find((pin) => pin.id === id)!;

const formerWorld = (component: SchematicComponent, id: string) => {
  const pin = FORMER_PIN_POSITIONS.get(component.kind)!.find((entry) => entry.id === id)!;
  const offset = transformPoint(pin, component.rotation, component.mirrored ?? false);
  return { x: component.x + offset.x, y: component.y + offset.y };
};

describe("terminals stranded by a redraw", () => {
  it("names the part and the terminal when a wire ends where a pin used to be", () => {
    const dflop = part("dflop", { label: "U3" });
    const was = formerWorld(dflop, "clr");
    const notices = strandedTerminalNotices([dflop], [wireTo(was.x, was.y)]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("U3");
    expect(notices[0]).toContain("CLR");
    expect(notices[0]).toMatch(/reattach them in schematic/i);
  });

  it("says nothing about a document that was already correct", () => {
    // The same flip-flop wired to where CLR sits today.
    const dflop = part("dflop");
    const now = pinAt(dflop, "clr");
    expect(strandedTerminals([dflop], [wireTo(now.x, now.y)])).toEqual([]);
    // …and one with no wires at all, where an unconnected COM is normal.
    expect(strandedTerminals([dflop], [])).toEqual([]);
    // …and a part of a kind that was never redrawn.
    const resistor = part("resistor", { value: "1k" });
    expect(strandedTerminals([resistor], [wireTo(-32, 0)])).toEqual([]);
  });

  it("stays quiet once the wire has been reattached", () => {
    // Both conditions are required: a conductor at the old spot AND nothing at
    // the new one. A reader who fixes it must not keep being told.
    const dflop = part("dflop");
    const was = formerWorld(dflop, "clr");
    const now = pinAt(dflop, "clr");
    expect(strandedTerminals([dflop], [wireTo(was.x, was.y)])).toHaveLength(1);
    expect(strandedTerminals([dflop], [
      wireTo(was.x, was.y, "old"),
      wireTo(now.x, now.y, "new"),
    ])).toEqual([]);
  });

  it("counts a terminal landing mid-wire as connected", () => {
    // A pin sitting on the interior of a segment is on that net exactly like an
    // endpoint, so it is not stranded.
    const dflop = part("dflop");
    const was = formerWorld(dflop, "clr");
    const now = pinAt(dflop, "clr");
    const through: SchematicWire = {
      id: "through",
      points: [{ x: now.x - 64, y: now.y }, { x: now.x + 64, y: now.y }],
    };
    expect(strandedTerminals([dflop], [wireTo(was.x, was.y, "old"), through])).toEqual([]);
  });

  it("follows the part through rotation and mirroring", () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const mirrored of [false, true]) {
        const dac = part("dac", { rotation, mirrored, label: `D${rotation}` });
        const was = formerWorld(dac, "vref");
        const found = strandedTerminals([dac], [wireTo(was.x, was.y)]);
        expect(found.map((entry) => entry.moved), `${rotation}/${mirrored}`).toEqual([["VREF"]]);
        const now = pinAt(dac, "vref");
        expect(strandedTerminals([dac], [wireTo(now.x, now.y)]), `${rotation}/${mirrored}`).toEqual([]);
      }
    }
  });

  it("reports a dropped gate input separately, because the fix is different", () => {
    // Before the input count was configurable a gate exposed all five rows. A
    // gate whose value names no count now has two, and in3..in5 are absent from
    // the part rather than moved, so "reattach the wire" is not the answer.
    const gate = part("digitalGate", { value: "and", label: "A1" });
    const rows = ["in3", "in4", "in5"].map((id) => formerWorld(gate, id));
    const found = strandedTerminals([gate], rows.map((p, i) => wireTo(p.x, p.y, `w${i}`)));
    expect(found).toHaveLength(1);
    expect(found[0].missing).toEqual(["3", "4", "5"]);
    expect(found[0].moved).toEqual([]);
    const notice = strandedTerminalNotices([gate], rows.map((p, i) => wireTo(p.x, p.y, `w${i}`)))[0];
    expect(notice).toContain("A1");
    expect(notice).toMatch(/raise its input count/i);

    // The same wiring on a gate that already declares five inputs is correct
    // and must be silent - those rows are exactly where they always were.
    const wide = part("digitalGate", { value: "and Inputs=5", label: "A1" });
    expect(strandedTerminals([wide], rows.map((p, i) => wireTo(p.x, p.y, `w${i}`)))).toEqual([]);
  });

  it("catches the gate output moving onto the centreline, which is the wire most gates have", () => {
    // The single-output redraw put Q at (32, 0). Every saved gate has a wire on
    // its output at (32, -16), and without this row that wire would quietly
    // stop being connected and the circuit would solve differently.
    const gate = part("digitalGate", { value: "and", label: "A1" });
    const was = formerWorld(gate, "q");
    expect(was).toEqual({ x: 32, y: -16 });
    expect(pinAt(gate, "q")).toMatchObject({ x: 32, y: 0 });
    const notice = strandedTerminalNotices([gate], [wireTo(was.x + 64, was.y)])[0];
    expect(notice).toContain("A1");
    expect(notice).toContain("Q");
    expect(notice).toMatch(/reattach them in schematic/i);
    // …and a gate already wired on the new row is silent.
    expect(strandedTerminals([gate], [wireTo(96, 0)])).toEqual([]);
  });

  it("tells a wire on the retired Q̅ / COM what to do instead of raising a count", () => {
    // Those two are gone from a placed gate for good - they were LTspice's
    // A-device pin contract, not the function's terminals - so the input-count
    // sentence would be advice the reader cannot follow.
    const gate = part("digitalGate", { value: "and", label: "A1" });
    const qbar = strandedTerminals([gate], [wireTo(96, 16)]);
    expect(qbar[0].retired).toEqual([{ labels: ["Q̅"], fix: expect.stringContaining("AND↔NAND") }]);
    expect(qbar[0].missing).toEqual([]);
    expect(strandedTerminalNotices([gate], [wireTo(96, 16)])[0]).not.toMatch(/input count/i);

    // COM sat in three places before it was retired; each is caught, and the
    // part is named once however many of them a wire happens to reach.
    for (const [x, y] of [[0, 48], [-16, 32], [32, 32]] as const) {
      const found = strandedTerminals([gate], [wireTo(x + 64, y)]);
      expect(found, `com (${x}, ${y})`).toHaveLength(1);
      expect(found[0].retired.flatMap((group) => group.labels), `com (${x}, ${y})`).toEqual(["COM"]);
    }
    const both = strandedTerminals([gate], [wireTo(64, 48, "a"), wireTo(48, 32, "b")]);
    expect(both[0].retired.flatMap((group) => group.labels)).toEqual(["COM"]);
  });

  it("leaves an imported part alone, whose pins never moved with Tau's artwork", () => {
    const imported = part("dflop", {
      pinOverride: [
        { id: "clr", label: "CLR", x: 0, y: 48 },
        { id: "com", label: "COM", x: -32, y: 48 },
      ],
    });
    expect(strandedTerminals([imported], [wireTo(0, 48)])).toEqual([]);
  });

  it("never edits the drawing", () => {
    // The whole decision: relocating an endpoint would route the DAC's VREF
    // straight through the body (it crossed sides) and put a bend in every
    // smaller move. The detector is read-only and the caller has nothing to
    // apply, so this is checked by construction as well as here.
    const dac = part("dac");
    const was = formerWorld(dac, "vref");
    const wires = [wireTo(was.x, was.y)];
    const before = structuredClone(wires);
    const components = [dac];
    const componentsBefore = structuredClone(components);
    expect(strandedTerminalNotices(components, wires)).toHaveLength(1);
    expect(wires).toEqual(before);
    expect(components).toEqual(componentsBefore);
  });
});

describe("the former-position table covers what actually moved", () => {
  it("lists every terminal whose coordinates changed on a redrawn kind", () => {
    // Guards the registry itself: a row that no longer describes a move is dead
    // weight, and a kind redrawn without a row is the silent case this file
    // exists to prevent. Checked against the live pin bank.
    for (const [kind, pins] of FORMER_PIN_POSITIONS) {
      const component = part(kind, kind === "digitalGate" ? { value: "and" } : {});
      const current = new Map(getComponentPins(component).map((pin) => [pin.id, pin]));
      for (const pin of pins) {
        const now = current.get(pin.id);
        // Either the terminal is gone from this instance (gate inputs 3..5), or
        // it is still there and really did move.
        if (!now) continue;
        expect(
          now.x === pin.x && now.y === pin.y,
          `${kind}.${pin.id} is listed as moved but sits at its old (${pin.x}, ${pin.y})`,
        ).toBe(false);
      }
    }
  });

  it("does not claim a move on a kind that was left alone", () => {
    // timer555 was relabelled (CONT to CTRL) without any pin moving, so it must
    // not be in the table: it would report parts that are perfectly connected.
    expect(FORMER_PIN_POSITIONS.has("timer555")).toBe(false);
    expect(FORMER_PIN_POSITIONS.has("resistor")).toBe(false);
    expect(FORMER_PIN_POSITIONS.has("opamp")).toBe(false);
  });
});
