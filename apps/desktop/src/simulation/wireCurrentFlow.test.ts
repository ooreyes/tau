import { describe, expect, it } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import { getComponentPins } from "../schematic/pins";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import {
  flowDotsForWires,
  flowMagnitude,
  nearestSampleIndex,
  opComponentCurrents,
  peakAbsCurrent,
  tranComponentCurrents,
  tranNetVoltages,
  wireFlowCurrent,
  opTerminalCurrents,
  type PinIndex,
  flowSegments,
  segmentFlowCurrents,
} from "./wireCurrentFlow";

const VS: SchematicComponent = { id: "vs-1", kind: "vsource", x: 0, y: 32, rotation: 0, value: "10V", label: "V1" };
const R1: SchematicComponent = { id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" };
const R2: SchematicComponent = { id: "r-2", kind: "resistor", x: 224, y: 0, rotation: 0, value: "1k", label: "R2" };
const GND_VS: SchematicComponent = { id: "g-1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" };
const GND_R2: SchematicComponent = { id: "g-2", kind: "ground", x: 256, y: 0, rotation: 0, value: "", label: "" };
const components = [VS, R1, R2, GND_VS, GND_R2];
const wires: SchematicWire[] = [
  { id: "w-1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
  { id: "w-2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
];

function buildPinIndex() {
  const pinIndex: PinIndex = new Map();
  for (const c of components) {
    for (const p of getComponentPins(c)) {
      const k = `${p.x},${p.y}`;
      const list = pinIndex.get(k) ?? [];
      list.push({ componentId: c.id, pinId: p.id, kind: c.kind });
      pinIndex.set(k, list);
    }
  }
  return pinIndex;
}

describe("wireCurrentFlow (current mode)", () => {
  it("builds real OP currents for the source and both resistors", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    expect(op.ok).toBe(true);
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    expect(currents.get("vs-1")).toBeCloseTo(-0.005, 9);
    expect(currents.get("r-1")).toBeCloseTo(0.005, 9);
    expect(currents.get("r-2")).toBeCloseTo(0.005, 9);
    expect(peakAbsCurrent(currents)).toBeCloseTo(0.005, 9);
  });

  it("attributes series wire flow from the adjacent source/resistor pin", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    const pinIndex = buildPinIndex();
    const flow = wireFlowCurrent(wires[0], pinIndex, currents);
    expect(Math.abs(flow)).toBeCloseTo(0.005, 9);
  });

  it("emits visible flow dots only from real non-zero currents", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const circuit = extractCircuit(components, wires, []);
    const currents = opComponentCurrents(op, circuit);
    const pinIndex = buildPinIndex();
    const phase = new Map<string, number>();
    const dots = flowDotsForWires(wires, pinIndex, currents, phase, 0.05);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y) && d.opacity > 0)).toBe(true);
    expect(flowDotsForWires(wires, pinIndex, new Map(), new Map(), 0.05)).toEqual([]);
  });

  it("nearestSampleIndex clamps and picks the closest time sample", () => {
    const times = [0, 1e-3, 2e-3, 3e-3];
    expect(nearestSampleIndex(times, -1)).toBe(0);
    expect(nearestSampleIndex(times, 1.4e-3)).toBe(1);
    expect(nearestSampleIndex(times, 1.6e-3)).toBe(2);
    expect(nearestSampleIndex(times, 99)).toBe(3);
  });

  it("samples real .tran currents/voltages at the final sample (DC divider settles)", async () => {
    const result = await runTransientAnalysis(
      { components, wires },
      { stopTime: 1e-3, steps: 50 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.times.length - 1;
    const currents = tranComponentCurrents(result, last);
    expect(currents.get("vs-1")).toBeCloseTo(-0.005, 6);
    expect(currents.get("r-1")).toBeCloseTo(0.005, 6);
    expect(currents.get("r-2")).toBeCloseTo(0.005, 6);
    const volts = tranNetVoltages(result, last);
    // Source net ≈ 10 V, midpoint ≈ 5 V (exact net ids come from extract).
    const values = [...volts.values()].sort((a, b) => b - a);
    expect(values[0]).toBeCloseTo(10, 5);
    expect(values[1]).toBeCloseTo(5, 5);
    const pinIndex = buildPinIndex();
    const dots = flowDotsForWires(wires, pinIndex, currents, new Map(), 0.05);
    expect(dots.length).toBeGreaterThan(0);
  });
});

/**
 * Reported symptoms: dead gaps in the middle of a wire run, and whole branches
 * with no dots at all. Both were real, and both are geometry/scale problems
 * rather than solver problems — the currents were right, the mapping onto wires
 * was not.
 */
describe("flow segments (reported dot gaps)", () => {
  // V ── R1 tapped off mid-rail ── R2, with the rails split so one piece runs
  // junction-to-junction and another is a single polyline crossing a tap.
  const V: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 96, rotation: 0, value: "10V", label: "V1" };
  const RA: SchematicComponent = { id: "ra", kind: "resistor", x: 192, y: 96, rotation: 90, value: "1k", label: "R1" };
  const RB: SchematicComponent = { id: "rb", kind: "resistor", x: 384, y: 96, rotation: 90, value: "2k", label: "R2" };
  const G: SchematicComponent = { id: "g", kind: "ground", x: 0, y: 192, rotation: 0, value: "", label: "" };
  const parts = [V, RA, RB, G];
  const rails: SchematicWire[] = [
    // One polyline from the source across to R1, passing the R2 tap mid-span.
    { id: "top-left", points: [{ x: 0, y: 64 }, { x: 0, y: 32 }, { x: 192, y: 32 }, { x: 192, y: 64 }] },
    { id: "top-right", points: [{ x: 192, y: 32 }, { x: 384, y: 32 }, { x: 384, y: 64 }] },
    { id: "bot-left", points: [{ x: 0, y: 128 }, { x: 0, y: 192 }, { x: 192, y: 192 }, { x: 192, y: 128 }] },
    { id: "bot-right", points: [{ x: 192, y: 192 }, { x: 384, y: 192 }, { x: 384, y: 128 }] },
  ];

  const rig = () => {
    const pinIndex: PinIndex = new Map();
    for (const c of parts) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        pinIndex.set(k, [...(pinIndex.get(k) ?? []), { componentId: c.id, pinId: p.id, kind: c.kind }]);
      }
    }
    const op = runOperatingPoint({ components: parts, wires: rails }, { returnBranches: true });
    const circuit = extractCircuit(parts, rails, []);
    return { pinIndex, currents: opComponentCurrents(op, circuit) };
  };

  it("splits a rail where a branch taps off it", () => {
    const { pinIndex } = rig();
    const segs = flowSegments(rails, pinIndex);
    // The source rail carries the full current up to the tap and less after,
    // so it cannot be animated as one piece.
    expect(segs.filter((s) => s.wireId === "top-left")).toHaveLength(2);
  });

  it("solves the split so the branch currents add up", () => {
    const { pinIndex, currents } = rig();
    const segs = flowSegments(rails, pinIndex);
    const solved = segmentFlowCurrents(segs, pinIndex, currents);
    const at = (id: string) => Math.abs(solved.get(id) ?? 0);

    // 10 V across 1k ∥ 2k: 10 mA and 5 mA, 15 mA total from the source.
    expect(at("top-left#0")).toBeCloseTo(0.015, 9); // source → tap
    expect(at("top-left#1")).toBeCloseTo(0.010, 9); // tap → R1
    expect(at("top-right#0")).toBeCloseTo(0.005, 9); // tap → R2
    // KCL at the tap, which is the property that actually matters.
    expect(at("top-left#1") + at("top-right#0")).toBeCloseTo(at("top-left#0"), 9);
  });

  it("gives a junction-to-junction segment the current it really carries", () => {
    // The middle piece of a rail touches no component pin at either end. The
    // old endpoint lookup returned 0 for it, leaving a dead gap on screen
    // between two animating neighbours.
    const midRails: SchematicWire[] = [
      { id: "a", points: [{ x: 0, y: 64 }, { x: 0, y: 32 }, { x: 160, y: 32 }] },
      { id: "mid", points: [{ x: 160, y: 32 }, { x: 288, y: 32 }] },
      { id: "b", points: [{ x: 288, y: 32 }, { x: 384, y: 32 }, { x: 384, y: 64 }] },
      { id: "bot", points: [{ x: 0, y: 128 }, { x: 0, y: 192 }, { x: 384, y: 192 }, { x: 384, y: 128 }] },
    ];
    const only = [V, RB, G];
    const pinIndex: PinIndex = new Map();
    for (const c of only) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        pinIndex.set(k, [...(pinIndex.get(k) ?? []), { componentId: c.id, pinId: p.id, kind: c.kind }]);
      }
    }
    const op = runOperatingPoint({ components: only, wires: midRails }, { returnBranches: true });
    const currents = opComponentCurrents(op, extractCircuit(only, midRails, []));
    const segs = flowSegments(midRails, pinIndex);
    const solved = segmentFlowCurrents(segs, pinIndex, currents);

    const mid = segs.find((s) => s.wireId === "mid")!;
    expect(Math.abs(solved.get(mid.id) ?? 0)).toBeCloseTo(0.005, 9);
    // Series loop: every segment carries the same magnitude, no dead pieces.
    for (const s of segs) expect(Math.abs(solved.get(s.id) ?? 0)).toBeCloseTo(0.005, 9);
  });

  it("still animates a branch carrying orders of magnitude less current", () => {
    // Reported with a 100 F cap beside a 1k resistor: the resistor's branch sat
    // at ~1e-9 of peak and stopped animating entirely, which reads as broken.
    const { pinIndex } = rig();
    const lopsided = new Map<string, number>([
      ["v", -1000],
      ["ra", 1000],      // dominant branch
      ["rb", 1e-4],      // seven decades down
    ]);
    const dots = flowDotsForWires(rails, pinIndex, lopsided, new Map(), 0.05);
    const onR2Rail = dots.filter((d) => d.x > 200);
    const onMainRail = dots.filter((d) => d.x <= 200);
    expect(onR2Rail.length).toBeGreaterThan(0);
    expect(onMainRail.length).toBeGreaterThan(0);
    // Present, and visibly quieter than the dominant branch. Comparing the two
    // is the real property; an absolute threshold just encodes today's scale.
    expect(Math.min(...onR2Rail.map((d) => d.opacity)))
      .toBeLessThan(Math.max(...onMainRail.map((d) => d.opacity)));
  });
});

/**
 * The reported failure: an NMOS common-source stage animated only its ground
 * rail. Drain, source and gate wires were dead, because `nmos` pins are
 * `d,g,s,b` and none of them matched the old two-terminal id rule.
 */
describe("multi-terminal devices and ground", () => {
  const pinsOf = (cs: SchematicComponent[]) => {
    const idx = new Map<string, { componentId: string; pinId: string; kind: typeof cs[number]["kind"] }[]>();
    for (const c of cs) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        idx.set(k, [...(idx.get(k) ?? []), { componentId: c.id, pinId: p.id, kind: c.kind }]);
      }
    }
    return idx;
  };

  it("animates a wire that runs to a ground symbol", () => {
    // The most basic circuit there is. Both ground legs used to read 0 A
    // because a ground pin injected nothing, so the solve concluded no current
    // entered ground.
    const V: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 96, rotation: 0, value: "10V", label: "V1" };
    const R: SchematicComponent = { id: "r", kind: "resistor", x: 384, y: 96, rotation: 90, value: "1k", label: "R1" };
    const G: SchematicComponent = { id: "g", kind: "ground", x: 0, y: 192, rotation: 0, value: "", label: "" };
    const parts = [V, R, G];
    const rails: SchematicWire[] = [
      { id: "top", points: [{ x: 0, y: 64 }, { x: 0, y: 32 }, { x: 384, y: 32 }, { x: 384, y: 64 }] },
      { id: "ret", points: [{ x: 384, y: 128 }, { x: 384, y: 192 }, { x: 0, y: 192 }] },
      { id: "gl", points: [{ x: 0, y: 128 }, { x: 0, y: 192 }] },
    ];
    const pins = pinsOf(parts);
    const op = runOperatingPoint({ components: parts, wires: rails }, { returnBranches: true });
    expect(op.ok).toBe(true);
    const currents = opComponentCurrents(op, extractCircuit(parts, rails, []));
    const segs = flowSegments(rails, pins);
    const solved = segmentFlowCurrents(segs, pins, currents, opTerminalCurrents(op));

    for (const s of segs) {
      expect(Math.abs(solved.get(s.id) ?? 0), `${s.id} is dead`).toBeCloseTo(0.01, 9);
    }
  });

  it("does not depend on which direction the wire was drawn", () => {
    const V: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 96, rotation: 0, value: "10V", label: "V1" };
    const R: SchematicComponent = { id: "r", kind: "resistor", x: 384, y: 96, rotation: 90, value: "1k", label: "R1" };
    const G: SchematicComponent = { id: "g", kind: "ground", x: 0, y: 192, rotation: 0, value: "", label: "" };
    const parts = [V, R, G];
    const forward: SchematicWire[] = [
      { id: "top", points: [{ x: 0, y: 64 }, { x: 0, y: 32 }, { x: 384, y: 32 }, { x: 384, y: 64 }] },
      { id: "ret", points: [{ x: 384, y: 128 }, { x: 384, y: 192 }, { x: 0, y: 192 }] },
      { id: "gl", points: [{ x: 0, y: 128 }, { x: 0, y: 192 }] },
    ];
    // Same circuit, ground leg drawn the other way round.
    const reversed = forward.map((w) =>
      w.id === "gl" ? { ...w, points: [...w.points].reverse() } : w);

    const pins = pinsOf(parts);
    const op = runOperatingPoint({ components: parts, wires: forward }, { returnBranches: true });
    const currents = opComponentCurrents(op, extractCircuit(parts, forward, []));
    const term = opTerminalCurrents(op);

    const a = segmentFlowCurrents(flowSegments(forward, pins), pins, currents, term);
    const b = segmentFlowCurrents(flowSegments(reversed, pins), pins, currents, term);
    const glA = [...a.entries()].find(([k]) => k.startsWith("gl"))![1];
    const glB = [...b.entries()].find(([k]) => k.startsWith("gl"))![1];
    // Same magnitude; the sign follows points[0]→last, so reversing flips it.
    expect(Math.abs(glA)).toBeCloseTo(Math.abs(glB), 12);
    expect(Math.abs(glA)).toBeCloseTo(0.01, 9);
  });

  it("puts a transistor's base current on the base wire, not its collector current", () => {
    // Truth: base wire carries ib. The old model injected the part's PRIMARY
    // current there, which for a BJT is ic — 110x too large and reversed.
    // A complete base net: the bias resistor feeds the wire, the base drains
    // it. Balanced, so the solve runs rather than being refused by the KCL gate.
    const pins: PinIndex = new Map([
      ["0,0", [{ componentId: "rb", pinId: "b", kind: "resistor" as const }]],
      ["64,0", [{ componentId: "q1", pinId: "b", kind: "npn" as const }]],
    ]);
    const wires: SchematicWire[] = [{ id: "base", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
    const ic = 1.469e-3;
    const ib = 13.37e-6;
    const currents = new Map([["rb", ib], ["q1", ic]]);
    const terminals = new Map([["q1", new Map([["b", ib], ["e", -(ic + ib)]])]]);

    const segs = flowSegments(wires, pins);
    const solved = segmentFlowCurrents(segs, pins, currents, terminals);
    const flow = solved.get(segs[0]!.id) ?? 0;

    expect(Math.abs(flow)).toBeCloseTo(ib, 9);
    expect(Math.abs(flow)).toBeLessThan(ic / 10);
  });

  it("refuses a net whose known currents do not balance", () => {
    // A mapping mistake or an engine-convention mismatch shows up as a KCL
    // residual. Drawing nothing is right; drawing a fabricated split is not.
    const pins: PinIndex = new Map([
      ["0,0", [{ componentId: "r1", pinId: "a", kind: "resistor" as const }]],
      ["64,0", [{ componentId: "r2", pinId: "a", kind: "resistor" as const }]],
    ]);
    const wires: SchematicWire[] = [{ id: "w", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
    // Both ends drain the wire: 5 mA in, 3 mA in, nothing out. Impossible.
    const currents = new Map([["r1", 5e-3], ["r2", 3e-3]]);
    const segs = flowSegments(wires, pins);
    expect(segmentFlowCurrents(segs, pins, currents).get(segs[0]!.id)).toBe(0);
  });

  it("survives a zero-length wire without killing its net", () => {
    // A self-loop segment used to break the edge-count guard and reject the
    // whole net, leaving a dead gap mid-rail.
    const V: SchematicComponent = { id: "v", kind: "vsource", x: 0, y: 96, rotation: 0, value: "10V", label: "V1" };
    const R: SchematicComponent = { id: "r", kind: "resistor", x: 384, y: 96, rotation: 90, value: "1k", label: "R1" };
    const G: SchematicComponent = { id: "g", kind: "ground", x: 0, y: 192, rotation: 0, value: "", label: "" };
    const parts = [V, R, G];
    const rails: SchematicWire[] = [
      { id: "top", points: [{ x: 0, y: 64 }, { x: 0, y: 32 }, { x: 384, y: 32 }, { x: 384, y: 64 }] },
      { id: "ret", points: [{ x: 384, y: 128 }, { x: 384, y: 192 }, { x: 0, y: 192 }] },
      { id: "gl", points: [{ x: 0, y: 128 }, { x: 0, y: 192 }] },
      { id: "degenerate", points: [{ x: 0, y: 32 }, { x: 0, y: 32 }] },
    ];
    const pins = pinsOf(parts);
    const op = runOperatingPoint({ components: parts, wires: rails }, { returnBranches: true });
    const currents = opComponentCurrents(op, extractCircuit(parts, rails, []));
    const segs = flowSegments(rails, pins);
    const solved = segmentFlowCurrents(segs, pins, currents, opTerminalCurrents(op));
    const top = segs.find((s) => s.wireId === "top")!;
    expect(Math.abs(solved.get(top.id) ?? 0)).toBeCloseTo(0.01, 9);
  });
});

/**
 * The exact reported circuit: NMOS common source. V4 → drain, source → R2 →
 * ground, V3 → gate. Before the terminal-role work only the ground rail
 * animated; the drain, source and gate wires were all dead.
 *
 * Currents are shaped the way native ngspice reports them: a primary drain
 * current plus `ig`/`is` terminal vectors, each the current INTO the terminal.
 */
describe("NMOS common source (reported failure)", () => {
  const id = 4.0e-3;      // drain current
  const ig = 0;           // gate draws nothing at DC
  const is = -id;         // source returns it

  const pins: PinIndex = new Map([
    // V4's + faces the drain (its − goes to the top ground).
    ["400,128", [{ componentId: "v4", pinId: "p", kind: "vsource" as const }]],
    ["400,160", [{ componentId: "m1", pinId: "d", kind: "nmos" as const }]],
    // Source down to R2.
    ["400,208", [{ componentId: "m1", pinId: "s", kind: "nmos" as const }]],
    ["400,240", [{ componentId: "r2", pinId: "a", kind: "resistor" as const }]],
    // R2 to ground.
    ["400,320", [{ componentId: "r2", pinId: "b", kind: "resistor" as const }]],
    ["400,352", [{ componentId: "g2", pinId: "g", kind: "ground" as const }]],
    // Gate drive.
    ["176,160", [{ componentId: "v3", pinId: "p", kind: "vsource" as const }]],
    ["176,128", [{ componentId: "m1", pinId: "g", kind: "nmos" as const }]],
  ]);

  const wires: SchematicWire[] = [
    { id: "drain", points: [{ x: 400, y: 128 }, { x: 400, y: 160 }] },
    { id: "source", points: [{ x: 400, y: 208 }, { x: 400, y: 240 }] },
    { id: "toGnd", points: [{ x: 400, y: 320 }, { x: 400, y: 352 }] },
    { id: "gate", points: [{ x: 176, y: 160 }, { x: 176, y: 128 }] },
  ];

  // ngspice: a delivering voltage source reports a negative branch current.
  const currents = new Map([["v4", -id], ["m1", id], ["r2", id], ["v3", 0]]);
  const terminals = new Map([["m1", new Map([["g", ig], ["s", is]])]]);

  const solve = () => {
    const segs = flowSegments(wires, pins);
    const solved = segmentFlowCurrents(segs, pins, currents, terminals);
    const by = (wireId: string) =>
      Math.abs(solved.get(segs.find((s) => s.wireId === wireId)!.id) ?? 0);
    return by;
  };

  it("animates the drain wire at the drain current", () => {
    expect(solve()("drain")).toBeCloseTo(id, 9);
  });

  it("animates the source wire at the drain current", () => {
    // Series with the drain through the channel: same current.
    expect(solve()("source")).toBeCloseTo(id, 9);
  });

  it("animates the return wire into ground", () => {
    expect(solve()("toGnd")).toBeCloseTo(id, 9);
  });

  it("leaves the gate wire still, because a MOS gate draws no DC current", () => {
    // Not "dead because unsupported" — dead because zero is the right answer.
    expect(solve()("gate")).toBeCloseTo(0, 12);
  });

  it("never animates the gate at the drain current", () => {
    // The specific old failure: the primary current injected at the wrong pin.
    expect(solve()("gate")).toBeLessThan(id / 100);
  });
});

/**
 * Magnitude must mean amps. It used to be normalised to the circuit's own peak
 * every frame, so a single-branch loop always animated at exactly one speed —
 * a 100 ohm and a 1 Mohm circuit were pixel-identical across four decades.
 */
describe("magnitude is absolute", () => {
  it("separates four decades of current", () => {
    const mags = [1e-1, 1e-2, 1e-3, 1e-4].map(flowMagnitude);
    for (let i = 1; i < mags.length; i += 1) {
      expect(mags[i], `${mags[i]} should be below ${mags[i - 1]}`).toBeLessThan(mags[i - 1]!);
    }
    // And the spread is usable, not a rounding difference.
    expect(mags[0]! - mags[3]!).toBeGreaterThan(0.4);
  });

  it("does not depend on what else is in the circuit", () => {
    // The same 1 mA reads the same whether or not a 100 A branch sits beside it.
    expect(flowMagnitude(1e-3)).toBeCloseTo(flowMagnitude(1e-3), 12);
    expect(flowMagnitude(1e-3)).toBeLessThan(flowMagnitude(1));
  });

  it("treats solver noise as no current", () => {
    expect(flowMagnitude(0)).toBe(0);
    expect(flowMagnitude(1e-15)).toBe(0);
  });

  it("keeps a very small current moving rather than freezing it", () => {
    expect(flowMagnitude(1e-9)).toBeGreaterThan(0);
  });

  it("saturates instead of running away on a large current", () => {
    expect(flowMagnitude(1)).toBe(1);
    expect(flowMagnitude(1000)).toBe(1);
  });
});

describe("net labels as boundaries", () => {
  it("animates a wire that ends at a net label", () => {
    // A label ties this net to another elsewhere on the sheet, so current
    // leaves here. Without treating it as a boundary the net looks unbalanced
    // and the solver refuses it, leaving the wire dead.
    const pins: PinIndex = new Map([
      ["0,0", [{ componentId: "r1", pinId: "a", kind: "resistor" as const }]],
    ]);
    const wires: SchematicWire[] = [{ id: "w", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
    const currents = new Map([["r1", 5e-3]]);

    const segs = flowSegments(wires, pins);
    // No label: unbalanced net, correctly refused.
    expect(segmentFlowCurrents(segs, pins, currents).get(segs[0]!.id)).toBe(0);
    // With the label declared, the net resolves to the resistor's current.
    const withLabel = segmentFlowCurrents(segs, pins, currents, new Map(), [{ x: 64, y: 0 }]);
    expect(Math.abs(withLabel.get(segs[0]!.id) ?? 0)).toBeCloseTo(5e-3, 9);
  });

  it("refuses when a net has both a label and a ground", () => {
    // Two unquantified exits: the split between them is genuinely ambiguous.
    const pins: PinIndex = new Map([
      ["0,0", [{ componentId: "r1", pinId: "a", kind: "resistor" as const }]],
      ["64,0", [{ componentId: "g", pinId: "g", kind: "ground" as const }]],
    ]);
    const wires: SchematicWire[] = [{ id: "w", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
    const currents = new Map([["r1", 5e-3]]);
    const segs = flowSegments(wires, pins);
    const solved = segmentFlowCurrents(segs, pins, currents, new Map(), [{ x: 0, y: 0 }]);
    expect(solved.get(segs[0]!.id)).toBe(0);
  });
});
