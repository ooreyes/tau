/**
 * OP / transient schematic annotations: positioned voltage/current labels from
 * a real operating-point or `.tran` run over a voltage divider.
 *
 * Divider (documented pin geometry, GRID = 16):
 *   VS at (0, 32):    p=(0,0),   n=(0,64)   - 10 V
 *   R1 at (96, 0):    a=(64,0),  b=(128,0)  - 1k
 *   R2 at (224, 0):   a=(192,0), b=(256,0)  - 1k, b wired to ground
 *   Wires: (0,0)→(64,0) and (128,0)→(192,0); R2.b→(256,64)→ground at (256,64).
 *   V(out) = mid node = 5 V; I(V1) (MNA convention) = −5 mA.
 */
import { describe, it, expect } from "vitest";
import { runOperatingPoint } from "./operatingPoint";
import { extractCircuit } from "../schematic/netlist";
import { opAnnotations, tranAnnotations } from "./opAnnotations";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { runTransientAnalysis, type AnalysisResult } from "./linearTransient";

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

function annotated() {
  const op = runOperatingPoint({ components, wires }, { returnBranches: true });
  const circuit = extractCircuit(components, wires, []);
  return opAnnotations(op, circuit);
}

describe("opAnnotations", () => {
  it("labels each non-ground net with its voltage at the net's topmost-leftmost point", () => {
    const anns = annotated();
    const volts = anns.filter((a) => a.kind === "voltage");
    expect(volts).toHaveLength(2); // source net + divider midpoint; grounds skipped
    // Source net spans (0,0)..(64,0): anchor (0,0), 10 V.
    const src = volts.find((a) => a.x === 0 && a.y === 0);
    expect(src?.text).toBe("V 10 V");
    // Mid net spans (128,0)..(192,0): anchor (128,0), 5 V.
    const mid = volts.find((a) => a.x === 128 && a.y === 0);
    expect(mid?.text).toBe("V 5 V");
  });

  it("labels the voltage source with its branch current at the component position", () => {
    const anns = annotated();
    const amps = anns.filter((a) => a.kind === "current");
    // V1 MNA branch + R1 + R2 derived currents (EveryCircuit-style branch set).
    expect(amps).toHaveLength(3);
    const v1 = amps.find((a) => a.key === "i:vs-1");
    expect(v1).toMatchObject({ x: 0, y: 32, key: "i:vs-1" });
    // MNA branch current for a sourcing battery is negative: −10V/2k = −5 mA.
    expect(v1?.text).toBe("I -5 mA");
    expect(amps.find((a) => a.key === "i:r-1")?.text).toBe("I 5 mA");
    expect(amps.find((a) => a.key === "i:r-2")?.text).toBe("I 5 mA");
  });

  it("returns [] for a null, failed, or geometry-less input", () => {
    const circuit = extractCircuit(components, wires, []);
    expect(opAnnotations(null, circuit)).toEqual([]);
    expect(opAnnotations({ ok: false, message: "x", warnings: [] }, circuit)).toEqual([]);
    const op = runOperatingPoint({ components, wires });
    expect(opAnnotations(op, null)).toEqual([]);
  });

  it("skips nets and branches that no longer exist in the circuit (stale result)", () => {
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    const emptyCircuit = extractCircuit([GND_VS], [], []);
    expect(opAnnotations(op, emptyCircuit)).toEqual([]);
  });

  it("still derives resistor currents when the OP run did not return MNA branches", () => {
    const op = runOperatingPoint({ components, wires });
    const circuit = extractCircuit(components, wires, []);
    const anns = opAnnotations(op, circuit);
    expect(anns.some((a) => a.kind === "voltage")).toBe(true);
    // No V-source MNA branch without returnBranches, but R currents still come
    // from node voltages (EveryCircuit-style current mode).
    expect(anns.find((a) => a.key === "i:vs-1")).toBeUndefined();
    expect(anns.find((a) => a.key === "i:r-1")?.text).toBe("I 5 mA");
  });

  it("draws one current label per part when a branch list carries per-terminal entries", () => {
    // A native `.op` on a BJT reports the part's own current plus one entry per
    // terminal, all under the SAME component id - so all three would anchor to
    // the same coordinates under the same render key. Only the part's own
    // current belongs on the canvas; the terminals are in the table.
    const op = runOperatingPoint({ components, wires }, { returnBranches: true });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const withTerminals = {
      ...op,
      branches: [
        ...(op.branches ?? []),
        { id: "vs-1", label: "Ib(V1)", current: 0.25, terminal: "b" },
        { id: "vs-1", label: "Ie(V1)", current: -0.75, terminal: "e" },
      ],
    };
    const circuit = extractCircuit(components, wires, []);
    const amps = opAnnotations(withTerminals, circuit).filter((a) => a.kind === "current");

    // Primary V1 + R1 + R2; terminal Ib/Ie entries must not multiply V1's label.
    expect(amps.filter((a) => a.key === "i:vs-1")).toHaveLength(1);
    expect(amps.find((a) => a.key === "i:vs-1")?.text).toBe("I -5 mA");
    // Every render key is distinct, which is what the collision would break.
    expect(new Set(amps.map((a) => a.key)).size).toBe(amps.length);
  });
});

describe("tranAnnotations (transient current mode)", () => {
  it("labels V/I from a real .tran final sample on the DC divider", async () => {
    const result = await runTransientAnalysis(
      { components, wires },
      { stopTime: 1e-3, steps: 50 },
    );
    expect(result.ok).toBe(true);
    const circuit = extractCircuit(components, wires, []);
    const anns = tranAnnotations(result, circuit);
    expect(anns.find((a) => a.x === 0 && a.y === 0 && a.kind === "voltage")?.text).toBe("V 10 V");
    expect(anns.find((a) => a.x === 128 && a.y === 0 && a.kind === "voltage")?.text).toBe("V 5 V");
    expect(anns.find((a) => a.key === "i:vs-1")?.text).toBe("I -5 mA");
    expect(anns.find((a) => a.key === "i:r-1")?.text).toBe("I 5 mA");
    expect(anns.find((a) => a.key === "i:r-2")?.text).toBe("I 5 mA");
  });

  it("labels static settlement voltage and current ranges for dynamic waveforms", () => {
    const circuit = extractCircuit(components, wires, []);
    const nonGndNet = circuit.nets.find((n) => !n.isGround);
    expect(nonGndNet).toBeDefined();

    const result: Extract<AnalysisResult, { ok: true }> = {
      ok: true,
      title: "Dynamic AC test",
      times: [0, 0.5, 1],
      traces: [
        { id: nonGndNet!.id, label: `V(${nonGndNet!.id})`, unit: "V", color: "#000", values: [-0.488, 0.00546, 0.488] },
      ],
      currents: [
        { ref: "R1", label: "I(R1)", values: [-0.000494, 0, 0.000494] },
      ],
      circuit,
      stats: { sampleCount: 3, netCount: 2, componentCount: 2, stopTime: 1e-3, stepSize: 1e-5 },
      warnings: [],
    };

    const anns = tranAnnotations(result, circuit);
    const vAnn = anns.find((a) => a.kind === "voltage");
    const iAnn = anns.find((a) => a.kind === "current");
    // A symmetric swing reads as "±A", and the quantity is spelled out rather
    // than left to colour alone.
    // Three samples is too short a run to claim the waveform has settled, so
    // the reading is marked rather than presented as a steady operating value.
    expect(vAnn?.text).toBe("V ±488 mV ~settling");
    expect(iAnn?.text).toBe("I ±494 µA ~settling");
  });

  it("reports the settled swing, not the turn-on excursion", () => {
    // The reported failure: a 1 V/1 kHz source into R 1k + C 1µ showed
    // "-157 mV … 254 mV" on the capacitor node. The +254 mV is a one-time
    // first-cycle overshoot while the cap charges from zero; the node actually
    // settles to a symmetric ±157 mV. Whole-run min/max presented that
    // excursion as the operating value.
    const circuit = extractCircuit(components, wires, []);
    const nonGndNet = circuit.nets.find((n) => !n.isGround);

    // First half: a big one-time excursion. Second half: settled ±100 mV.
    const startup = [0, 0.254, -0.05, 0.2, -0.09, 0.16];
    const settled = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1];
    const values = [...startup, ...settled];

    const result: Extract<AnalysisResult, { ok: true }> = {
      ok: true,
      title: "RC turn-on",
      times: values.map((_, i) => i * 1e-4),
      traces: [
        { id: nonGndNet!.id, label: `V(${nonGndNet!.id})`, unit: "V", color: "#000", values },
      ],
      currents: [],
      circuit,
      stats: { sampleCount: values.length, netCount: 2, componentCount: 2, stopTime: 1e-3, stepSize: 1e-4 },
      warnings: [],
    };

    const vAnn = tranAnnotations(result, circuit).find((a) => a.kind === "voltage");
    expect(vAnn?.text).toBe("V ±100 mV");
    expect(vAnn?.text).not.toContain("254");
  });

  it("marks a waveform that has not settled instead of quoting it as steady", () => {
    const circuit = extractCircuit(components, wires, []);
    const nonGndNet = circuit.nets.find((n) => !n.isGround);
    // A monotonic ramp never settles: the tail keeps moving.
    const values = Array.from({ length: 16 }, (_, i) => i * 0.5);

    const result: Extract<AnalysisResult, { ok: true }> = {
      ok: true,
      title: "Ramp",
      times: values.map((_, i) => i * 1e-4),
      traces: [
        { id: nonGndNet!.id, label: `V(${nonGndNet!.id})`, unit: "V", color: "#000", values },
      ],
      currents: [],
      circuit,
      stats: { sampleCount: values.length, netCount: 2, componentCount: 2, stopTime: 1e-3, stepSize: 1e-4 },
      warnings: [],
    };

    const vAnn = tranAnnotations(result, circuit).find((a) => a.kind === "voltage");
    expect(vAnn?.text).toContain("~settling");
  });

  it("writes a biased swing as offset ± amplitude", () => {
    const circuit = extractCircuit(components, wires, []);
    const nonGndNet = circuit.nets.find((n) => !n.isGround);
    // Settled oscillation riding on a 2.5 V rail.
    const values = Array.from({ length: 16 }, (_, i) => 2.5 + (i % 2 === 0 ? 0.1 : -0.1));

    const result: Extract<AnalysisResult, { ok: true }> = {
      ok: true,
      title: "Biased ripple",
      times: values.map((_, i) => i * 1e-4),
      traces: [
        { id: nonGndNet!.id, label: `V(${nonGndNet!.id})`, unit: "V", color: "#000", values },
      ],
      currents: [],
      circuit,
      stats: { sampleCount: values.length, netCount: 2, componentCount: 2, stopTime: 1e-3, stepSize: 1e-4 },
      warnings: [],
    };

    const vAnn = tranAnnotations(result, circuit).find((a) => a.kind === "voltage");
    expect(vAnn?.text).toBe("V 2.5 V ±100 mV");
  });

  it("returns [] for failed/null transient input", () => {
    const circuit = extractCircuit(components, wires, []);
    expect(tranAnnotations(null, circuit)).toEqual([]);
    expect(tranAnnotations({ ok: false, title: "t", message: "x", warnings: [] }, circuit)).toEqual([]);
  });
});

