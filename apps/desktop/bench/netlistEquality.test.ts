/**
 * TEMPORARY harness. Lives outside `src/` on purpose: the suite's include glob
 * is `src/**\/*.test.ts`, so nothing here runs in `pnpm test`. Delete with the
 * `bench/` directory once the netlist optimisation is verified.
 *
 * Proves the optimised `extractCircuit` returns exactly what the pre-change one
 * did, over a corpus that exercises every ordering-sensitive path, and times
 * both on the same harness.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractCircuit as after } from "../src/schematic/netlist";
import { extractCircuit as before } from "./netlistBefore";
import type { NetLabel, SchematicComponent, SchematicWire } from "../src/schematic/types";

interface Circuit {
  name: string;
  components: SchematicComponent[];
  wires: SchematicWire[];
  labels: NetLabel[];
}

const R = (id: string, x: number, y: number, rotation = 0, value = "1k"): SchematicComponent =>
  ({ id, kind: "resistor", label: id, value, x, y, rotation }) as SchematicComponent;
const GND = (id: string, x: number, y: number): SchematicComponent =>
  ({ id, kind: "ground", label: "", value: "", x, y, rotation: 0 }) as SchematicComponent;
const V = (id: string, x: number, y: number): SchematicComponent =>
  ({ id, kind: "vsource", label: id, value: "5", x, y, rotation: 0 }) as SchematicComponent;
const W = (id: string, pts: Array<[number, number]>, value?: string): SchematicWire =>
  ({ id, points: pts.map(([x, y]) => ({ x, y })), ...(value ? { value } : {}) }) as SchematicWire;
const L = (id: string, text: string, x: number, y: number): NetLabel =>
  ({ id, text, x, y }) as NetLabel;

/** Resistors on a grid: the shape the CPU profile was taken on. */
function grid(n: number, withLabels = false): Circuit {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const components: SchematicComponent[] = [];
  const wires: SchematicWire[] = [];
  const labels: NetLabel[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = (i % cols) * 160;
    const y = Math.floor(i / cols) * 96;
    components.push(R(`R${i}`, x, y));
    wires.push(W(`w${i}`, [[x + 32, y], [x + 128, y]]));
    if (withLabels && i % 7 === 0) labels.push(L(`l${i}`, `n${i}`, x + 32, y));
  }
  components.push(GND("gnd", -32, 0));
  return { name: `grid${n}${withLabels ? "+labels" : ""}`, components, wires, labels };
}

/** A long horizontal bus with many taps - the many-points-per-segment case
 *  `uniquePoints` and `segmentIndexesAt` are worst at. */
function bus(taps: number): Circuit {
  const components: SchematicComponent[] = [GND("gnd", -64, 0)];
  const wires: SchematicWire[] = [W("bus", [[0, 0], [taps * 64, 0]])];
  for (let i = 0; i < taps; i += 1) {
    components.push(R(`R${i}`, i * 64, 0, 90));
    wires.push(W(`t${i}`, [[i * 64, 0], [i * 64, 64]]));
  }
  return { name: `bus${taps}`, components, wires, labels: [] };
}

const CORPUS: Circuit[] = [
  grid(10), grid(50), grid(200), grid(600),
  grid(50, true), grid(200, true),
  bus(40), bus(200),
  { name: "empty", components: [], wires: [], labels: [] },
  { name: "lone-ground", components: [GND("g", 0, 0)], wires: [], labels: [] },
  {
    name: "crossings",
    components: [R("R1", 0, 0), R("R2", 128, 0), GND("g", 0, 256)],
    wires: [
      W("h1", [[0, 0], [256, 0]]),
      W("v1", [[128, -64], [128, 64]]),
      W("v2", [[64, 0], [64, 128]]),
      W("multi", [[0, 128], [128, 128], [128, 256], [256, 256]]),
    ],
    labels: [L("a", "out", 128, 0), L("b", "out", 64, 128), L("g0", "GND", 0, 256)],
  },
  {
    name: "resistive-wires",
    components: [V("V1", 0, 0), R("R1", 192, 0), GND("g", 0, 96)],
    wires: [
      W("rw", [[0, 0], [192, 0]], "50"),
      W("rw0", [[0, 32], [192, 32]], "0"),
      W("ideal", [[0, 64], [192, 64]]),
    ],
    labels: [],
  },
  {
    name: "duplicate-and-greek-labels",
    components: [R("R1", 0, 0), R("R2", 0, 128), GND("g", 0, 256)],
    wires: [W("w1", [[0, 0], [128, 0]]), W("w2", [[0, 128], [128, 128]])],
    labels: [L("a", "uα", 0, 0), L("b", "uα", 0, 128), L("c", "Uα", 128, 0), L("d", "vβ", 128, 128)],
  },
  {
    name: "degenerate-zero-length-and-negative-zero",
    components: [R("R1", -0, -0), GND("g", 0, 0)],
    wires: [W("zero", [[0, 0], [0, 0]]), W("neg", [[-0, -0], [-64, 0]])],
    labels: [L("z", "zero", -0, -0)],
  },
  {
    name: "single-pin-warnings",
    components: [R("R1", 0, 0), R("R2", 512, 512), V("V1", 0, 256), GND("g", 0, 384)],
    wires: [W("w", [[0, 0], [64, 0]])],
    labels: [],
  },
];

describe("extractCircuit optimisation - output equality", () => {
  for (const circuit of CORPUS) {
    it(`is byte-identical on ${circuit.name}`, () => {
      const a = before(circuit.components, circuit.wires, circuit.labels);
      const b = after(circuit.components, circuit.wires, circuit.labels);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });
  }

  // JSON renders -0 as 0, so equality above cannot see a sign-bit drift in a
  // coordinate. Compare the sign bits of every number the nets expose.
  it("preserves the sign bit of every coordinate", () => {
    const signs = (r: ReturnType<typeof before>) =>
      r.nets.flatMap((net) => net.points.flatMap((p) => [Object.is(p.x, -0), Object.is(p.y, -0)])).join(",");
    for (const circuit of CORPUS) {
      const a = before(circuit.components, circuit.wires, circuit.labels);
      const b = after(circuit.components, circuit.wires, circuit.labels);
      expect(signs(b), circuit.name).toBe(signs(a));
    }
  });
});

describe("extractCircuit optimisation - timing", () => {
  it("reports before/after", () => {
    const time = (fn: typeof before, c: Circuit, reps: number) => {
      for (let i = 0; i < 60; i += 1) fn(c.components, c.wires, c.labels);
      let best = Infinity;
      for (let t = 0; t < 9; t += 1) {
        const t0 = performance.now();
        for (let i = 0; i < reps; i += 1) fn(c.components, c.wires, c.labels);
        best = Math.min(best, (performance.now() - t0) / reps);
      }
      return best;
    };
    const rows: string[] = [];
    for (const c of [grid(10), grid(50), grid(200), grid(600), bus(200)]) {
      const reps = c.components.length > 200 ? 30 : 200;
      // Interleaved so any drift in machine load hits both sides.
      const b1 = time(before, c, reps);
      const a1 = time(after, c, reps);
      const b2 = time(before, c, reps);
      const a2 = time(after, c, reps);
      const b = Math.min(b1, b2);
      const a = Math.min(a1, a2);
      rows.push(`${c.name.padEnd(10)} before ${b.toFixed(3)}ms  after ${a.toFixed(3)}ms  ${(b / a).toFixed(2)}x`);
    }
    writeFileSync(process.env.BENCH_OUT ?? "/tmp/netbench.txt", rows.join("\n") + "\n");
  }, 600_000);
});
