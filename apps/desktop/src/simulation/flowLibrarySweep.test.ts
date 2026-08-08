import { describe, expect, it } from "vitest";
import { COMPONENT_KINDS } from "../schematic/types";
import type { ComponentKind, SchematicWire } from "../schematic/types";
import { getLocalPins } from "../schematic/pins";
import { TERMINAL_ROLES, terminalRole } from "./terminalRoles";
import { flowSegments, segmentFlowCurrents, type PinIndex } from "./wireCurrentFlow";

/**
 * Every component in the library, driven through the flow solver.
 *
 * The contract this file defends is narrow and absolute: for any component, on
 * any net, the visualizer either draws the RIGHT current or draws NOTHING. It
 * must never draw a confident wrong arrow. A student who sees no dots learns
 * nothing; a student who sees dots pouring out of a transistor's base learns
 * something false, and that is the failure this whole layer exists to prevent.
 *
 * The sweep is generated from `COMPONENT_KINDS`, so a new part cannot be added
 * without appearing here.
 */

const PROBE = 1.234e-3;

/** Two pins on one wire, `left` and `right`, so we can drive any pin pairing. */
function twoPinRig(
  left: { kind: ComponentKind; pinId: string; id: string },
  right: { kind: ComponentKind; pinId: string; id: string },
) {
  const pins: PinIndex = new Map([
    ["0,0", [{ componentId: left.id, pinId: left.pinId, kind: left.kind }]],
    ["64,0", [{ componentId: right.id, pinId: right.pinId, kind: right.kind }]],
  ]);
  const wires: SchematicWire[] = [{ id: "w", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
  return { pins, wires };
}

function solveOne(
  pins: PinIndex,
  wires: SchematicWire[],
  currents: Map<string, number>,
  terminals?: Map<string, Map<string, number>>,
) {
  const segs = flowSegments(wires, pins);
  const solved = segmentFlowCurrents(segs, pins, currents, terminals ?? new Map());
  return solved.get(segs[0]!.id) ?? 0;
}

describe("flow visualizer: every component in the library", () => {
  it("declares a role for every pin of every kind", () => {
    for (const kind of COMPONENT_KINDS) {
      for (const pin of getLocalPins(kind)) {
        const role = terminalRole(kind, pin.id);
        expect(
          ["series", "terminal", "none", "unknown"],
          `${kind}.${pin.id} has no usable role`,
        ).toContain(role.role);
      }
    }
  });

  /**
   * The core safety property. Pair each pin against a plain resistor carrying a
   * known current and check the wire never reports a number that contradicts
   * the pin's declared role:
   *  - `none`     → the net is unbalanced, so it must be refused (0)
   *  - `unknown`  → single boundary, so the resistor's current resolves it
   *  - `series`   → must agree with the resistor in magnitude
   *  - `terminal` → uses its own vector, never the part's primary
   */
  /** Synthetic terminal vectors, one per terminal name the table can name. */
  const TERMINAL_VECTORS = new Map([["b", PROBE], ["e", -PROBE], ["g", 0], ["s", -PROBE]]);

  /** What this pin injects into the wire, given the synthetic data above. */
  function expectedInjection(kind: ComponentKind, pinId: string): number | null {
    const role = terminalRole(kind, pinId);
    if (role.role === "series") return role.sign * PROBE;
    // Engines report current INTO a terminal, so the wire sees the negative.
    if (role.role === "terminal") return -(TERMINAL_VECTORS.get(role.terminal) ?? 0);
    if (role.role === "none") return 0;
    return null; // boundary
  }

  for (const kind of COMPONENT_KINDS) {
    for (const pin of getLocalPins(kind)) {
      const role = terminalRole(kind, pin.id);

      it(`${kind}.${pin.id} (${role.role}) behaves as declared`, () => {
        const injected = expectedInjection(kind, pin.id);
        // Pair against whichever resistor leg balances this pin, so the net is
        // solvable and we are testing the pin rather than the fixture.
        // resistor.a drains (-PROBE), resistor.b feeds (+PROBE).
        const loadPin = (injected ?? PROBE) > 0 ? "a" : "b";
        const { pins, wires } = twoPinRig(
          { kind: "resistor", pinId: loadPin, id: "rload" },
          { kind, pinId: pin.id, id: "dut" },
        );
        const currents = new Map<string, number>([["rload", PROBE], ["dut", PROBE]]);
        const terminals = new Map([["dut", new Map(TERMINAL_VECTORS)]]);
        const flow = Math.abs(solveOne(pins, wires, currents, terminals));

        if (injected === null) {
          // One boundary: the load's own current resolves the wire exactly.
          expect(flow).toBeCloseTo(PROBE, 9);
          return;
        }
        if (injected === 0) {
          // Nothing enters here, so the net cannot balance. Refusing is right;
          // inventing a split is not.
          expect(flow).toBe(0);
          return;
        }
        // A real injection, balanced by the load: the wire carries it.
        expect(flow).toBeCloseTo(Math.abs(injected), 9);
      });
    }
  }

  it("never lets a `none` pin carry the part's primary current", () => {
    // The bug class that shipped: a MOSFET's bulk and a display's segments read
    // as a two-terminal leg and animated at the device's drain current.
    const offenders: string[] = [];
    for (const kind of COMPONENT_KINDS) {
      for (const pin of getLocalPins(kind)) {
        if (terminalRole(kind, pin.id).role !== "none") continue;
        const { pins, wires } = twoPinRig(
          { kind: "resistor", pinId: "b", id: "rload" },
          { kind, pinId: pin.id, id: "dut" },
        );
        const flow = solveOne(pins, wires, new Map([["rload", PROBE], ["dut", PROBE]]));
        if (Math.abs(flow) > 1e-15) offenders.push(`${kind}.${pin.id} → ${flow}`);
      }
    }
    expect(offenders, "these pins fabricated a current").toEqual([]);
  });

  it("keeps every two-terminal part's pins opposite in sign", () => {
    // A part whose two legs both drained (or both fed) the wire would violate
    // KCL at every node it touches.
    for (const kind of COMPONENT_KINDS) {
      const roles = getLocalPins(kind)
        .map((p) => terminalRole(kind, p.id))
        .filter((r): r is { role: "series"; sign: 1 | -1 } => r.role === "series");
      if (roles.length !== 2) continue;
      expect(roles[0]!.sign + roles[1]!.sign, `${kind} has two same-sign legs`).toBe(0);
    }
  });

  it("resolves a whole net when exactly one pin is a boundary", () => {
    // An op-amp output driving a load: the output current is unknown, the
    // load's is not, so the wire is solvable from the load side.
    const { pins, wires } = twoPinRig(
      { kind: "opamp", pinId: "out", id: "u1" },
      { kind: "resistor", pinId: "a", id: "rl" },
    );
    expect(Math.abs(solveOne(pins, wires, new Map([["rl", PROBE]])))).toBeCloseTo(PROBE, 9);
  });

  it("refuses a net with two boundaries rather than guessing the split", () => {
    const { pins, wires } = twoPinRig(
      { kind: "opamp", pinId: "out", id: "u1" },
      { kind: "digitalGate", pinId: "q", id: "g1" },
    );
    expect(solveOne(pins, wires, new Map())).toBe(0);
  });

  it("gives every kind at least one pin that can carry current", () => {
    // A part whose every pin is `none` can never animate anything, which for
    // most kinds would be a modelling mistake rather than physics.
    const inert = COMPONENT_KINDS.filter((kind) =>
      getLocalPins(kind).every((p) => terminalRole(kind, p.id).role === "none"));
    // No kind may be inert now that the test point marker is gone.
    expect(inert).toEqual([]);
  });
});

describe("flow visualizer: corner cases", () => {
  const rig = () => twoPinRig(
    { kind: "resistor", pinId: "b", id: "r1" },
    { kind: "resistor", pinId: "a", id: "r2" },
  );

  it("handles a very large current without overflowing", () => {
    const { pins, wires } = rig();
    const flow = solveOne(pins, wires, new Map([["r1", 1e4], ["r2", 1e4]]));
    expect(Number.isFinite(flow)).toBe(true);
    expect(Math.abs(flow)).toBeCloseTo(1e4, 6);
  });

  it("handles a picoamp without collapsing to zero", () => {
    const { pins, wires } = rig();
    expect(Math.abs(solveOne(pins, wires, new Map([["r1", 1e-12], ["r2", 1e-12]]))))
      .toBeCloseTo(1e-12, 18);
  });

  it("reports exactly zero for a genuinely dead net", () => {
    const { pins, wires } = rig();
    expect(solveOne(pins, wires, new Map([["r1", 0], ["r2", 0]]))).toBe(0);
  });

  it("refuses rather than propagating a non-finite current", () => {
    const { pins, wires } = rig();
    const flow = solveOne(pins, wires, new Map([["r1", NaN], ["r2", NaN]]));
    expect(Number.isFinite(flow) || flow === 0).toBe(true);
  });

  it("survives a component with no current data at all", () => {
    const { pins, wires } = rig();
    expect(solveOne(pins, wires, new Map())).toBe(0);
  });

  it("covers every kind in the library", () => {
    // Guards the sweep itself: if a kind is added and the table is not, the
    // exhaustive Record above stops compiling — this catches the reverse, a
    // kind silently dropped from COMPONENT_KINDS.
    expect(Object.keys(TERMINAL_ROLES).sort()).toEqual([...COMPONENT_KINDS].sort());
  });
});
