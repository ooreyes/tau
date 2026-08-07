import { describe, expect, it } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import { getComponentPins } from "../schematic/pins";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import {
  flowDotsForWires,
  nearestSampleIndex,
  opComponentCurrents,
  peakAbsCurrent,
  tranComponentCurrents,
  tranNetVoltages,
  wireFlowCurrent,
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
  const pinIndex = new Map<string, { componentId: string; pinId: string }[]>();
  for (const c of components) {
    for (const p of getComponentPins(c)) {
      const k = `${p.x},${p.y}`;
      const list = pinIndex.get(k) ?? [];
      list.push({ componentId: c.id, pinId: p.id });
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
    const pinIndex = new Map<string, { componentId: string; pinId: string }[]>();
    for (const c of parts) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        pinIndex.set(k, [...(pinIndex.get(k) ?? []), { componentId: c.id, pinId: p.id }]);
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
    const pinIndex = new Map<string, { componentId: string; pinId: string }[]>();
    for (const c of only) {
      for (const p of getComponentPins(c)) {
        const k = `${p.x},${p.y}`;
        pinIndex.set(k, [...(pinIndex.get(k) ?? []), { componentId: c.id, pinId: p.id }]);
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
    expect(onR2Rail.length).toBeGreaterThan(0);
    // Visibly quieter than the main branch, but present.
    expect(Math.min(...onR2Rail.map((d) => d.opacity))).toBeLessThan(0.7);
  });
});
