import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { extractCircuit } from "./netlist";
import type { NetLabel, SchematicComponent, SchematicWire } from "./types";

const OUT = process.env.BENCH_OUT ?? "/tmp/bench.json";
const TAG = process.env.BENCH_TAG ?? "run";

interface Circuit {
  components: SchematicComponent[];
  wires: SchematicWire[];
  labels: NetLabel[];
}

/** Resistors on a grid, one wire per component, one ground. */
function gridCircuit(n: number): Circuit {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const components: SchematicComponent[] = [];
  const wires: SchematicWire[] = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * 160;
    const y = row * 96;
    components.push({ id: `R${i}`, kind: "resistor", label: `R${i}`, value: "1k", x, y, rotation: 0 });
    wires.push({ id: `w${i}`, points: [{ x: x + 32, y }, { x: x + 128, y }] });
  }
  components.push({ id: "gnd", kind: "ground", label: "", value: "", x: -32, y: 0, rotation: 0 });
  return { components, wires, labels: [] };
}

// A deterministic LCG so the "messy" fixtures are identical across runs.
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Grid plus net labels, resistive wires, multi-segment wires and crossings. */
function messyCircuit(n: number, seed: number): Circuit {
  const base = gridCircuit(n);
  const random = makeRandom(seed);
  const labels: NetLabel[] = [];
  const kinds = ["resistor", "capacitor", "inductor", "vsource", "diode", "npn", "nmos"] as const;
  base.components.forEach((component, index) => {
    if (component.kind === "ground") return;
    component.kind = kinds[Math.floor(random() * kinds.length)];
    if (random() < 0.2) {
      labels.push({ id: `l${index}`, x: component.x - 32, y: component.y, text: random() < 0.3 ? "VCC" : `n${index % 7}` });
    }
    if (random() < 0.1) labels.push({ id: `g${index}`, x: component.x + 32, y: component.y, text: "0" });
  });
  base.wires.forEach((w, index) => {
    if (random() < 0.15) w.resistance = "10m";
    if (random() < 0.3) {
      const last = w.points[w.points.length - 1];
      w.points.push({ x: last.x, y: last.y + 48 }, { x: last.x - 64, y: last.y + 48 });
    }
    if (random() < 0.2) {
      base.wires.push({ id: `x${index}`, points: [{ x: w.points[0].x, y: w.points[0].y - 48 }, { x: w.points[0].x, y: w.points[0].y + 48 }] });
    }
  });
  return { ...base, labels };
}

const SIZES = [10, 50, 200, 600];

describe("netlist bench", () => {
  it("times and fingerprints extractCircuit", () => {
    const report: Record<string, unknown> = { tag: TAG };
    const fingerprints: Record<string, unknown> = {};

    for (const n of SIZES) {
      const { components, wires, labels } = gridCircuit(n);
      for (let i = 0; i < 300; i += 1) extractCircuit(components, wires, labels);
      const iterations = n >= 200 ? 200 : 1000;
      let best = Infinity;
      for (let repeat = 0; repeat < 9; repeat += 1) {
        const started = performance.now();
        for (let i = 0; i < iterations; i += 1) extractCircuit(components, wires, labels);
        best = Math.min(best, (performance.now() - started) / iterations);
      }
      report[`grid${n}`] = Number(best.toFixed(4));
      fingerprints[`grid${n}`] = extractCircuit(components, wires, labels);
    }

    for (const n of SIZES) {
      for (const seed of [1, 2, 3]) {
        const { components, wires, labels } = messyCircuit(n, seed);
        fingerprints[`messy${n}s${seed}`] = extractCircuit(components, wires, labels);
      }
    }

    // Degenerate / edge shapes that stress the DSU linking rule and ordering.
    fingerprints.empty = extractCircuit([], []);
    fingerprints.negZero = extractCircuit(
      [{ id: "R", kind: "resistor", label: "R", value: "1k", x: -0, y: -0, rotation: 0 }],
      [{ id: "w", points: [{ x: 32, y: -0 }, { x: 96, y: 0 }] }],
    );
    fingerprints.chain = extractCircuit(
      [],
      Array.from({ length: 400 }, (_, i) => ({ id: `w${i}`, points: [{ x: i * 16, y: 0 }, { x: (i + 1) * 16, y: 0 }] })),
    );

    writeFileSync(OUT, JSON.stringify({ report, fingerprints }, null, 1));
    // eslint-disable-next-line no-console
    console.log("BENCH", JSON.stringify(report));
  });
});
