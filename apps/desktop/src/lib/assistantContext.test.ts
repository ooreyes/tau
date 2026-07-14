import { describe, expect, it } from "vitest";

import { buildAssistantContext, type AssistantContextInput } from "./assistantContext";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import type { ComponentMeasurement, MeasuredSeries } from "../simulation/measurementModel";
import type { AnalysisResult } from "../simulation/linearTransient";
import { EMPTY_SCOPE } from "../simulation/paramScope";

const component = (
  kind: SchematicComponent["kind"],
  id: string,
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

/** A physical RC topology: V1 -> R1 -> C1 -> ground, mirrors nativeSpice.test.ts's fixture. */
function rcSchematic() {
  return {
    components: [
      component("vsource", "v1", "V1", "5", 0, 32),
      component("resistor", "r1", "R1", "1k", 96, 0),
      component("capacitor", "c1", "C1", "1u", 224, 0),
      component("ground", "g1", "", "", 0, 64),
      component("ground", "g2", "", "", 256, 0),
    ],
    wires: [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ],
  };
}

function series(unit: MeasuredSeries["unit"], final: number): MeasuredSeries {
  return {
    id: `s-${unit}`,
    label: `s-${unit}`,
    unit,
    values: [0, final],
    statistics: { min: 0, max: final, average: final / 2, rms: final / 2, final },
    classification: { kind: "steady" },
  };
}

const successAnalysis = (): Extract<AnalysisResult, { ok: true }> => ({
  ok: true,
  title: "Transient",
  times: [0, 1],
  traces: [],
  currents: [],
  stats: { netCount: 2, componentCount: 3, sampleCount: 240, stopTime: 0.006, stepSize: 0.000025 },
  warnings: [],
  circuit: { nets: [], components: [], groundNetId: "0" } as unknown as Extract<AnalysisResult, { ok: true }>["circuit"],
});

function baseInput(overrides: Partial<AssistantContextInput> = {}): AssistantContextInput {
  const { components, wires } = rcSchematic();
  return {
    components,
    wires,
    netLabels: [],
    directives: [],
    params: EMPTY_SCOPE,
    analysis: null,
    componentRows: [],
    selectedId: null,
    ...overrides,
  };
}

describe("buildAssistantContext", () => {
  it("includes the netlist, component list, and analysis stats for a buildable circuit with a run result", () => {
    const componentRows: ComponentMeasurement[] = [
      { componentId: "r1", ref: "R1", kind: "resistor", voltage: series("V", 5), current: series("A", 0.005) },
    ];
    const { text, truncated } = buildAssistantContext(baseInput({
      analysis: successAnalysis(),
      componentRows,
      measurements: [{ name: "vout_max", value: 4.98 }, { name: "bad_meas", value: null, error: "not found" }],
      selectedId: "r1",
    }));

    expect(truncated).toBe(false);
    expect(text).toContain("SPICE netlist:");
    expect(text).toContain("R1"); // netlist emits the ref
    expect(text).toContain("Components (3):");
    expect(text).toContain("V1 (vsource) = 5");
    expect(text).toContain("R1 (resistor) = 1k"); // V/I telemetry appended
    expect(text).toMatch(/R1 \(resistor\) = 1k V=.*I=/);
    expect(text).toContain("Analysis: transient, 240 samples");
    expect(text).toContain("2 nets, 3 components");
    expect(text).toContain("Measurements (.meas):");
    expect(text).toContain("vout_max = 4.98");
    expect(text).toContain("bad_meas = undetermined (not found)");
    expect(text).toContain("Selection: R1 (resistor).");
    // Ground symbols carry no ref-des and shouldn't clutter the component list.
    expect(text).not.toMatch(/\(ground\)/);
  });

  it("reports no simulation run yet when analysis is null, and no selection when nothing is selected", () => {
    const { text } = buildAssistantContext(baseInput());
    expect(text).toContain("Analysis: no simulation has been run yet.");
    expect(text).toContain("Selection: none.");
  });

  it("surfaces a failed transient run's message instead of stats", () => {
    const { text } = buildAssistantContext(baseInput({
      analysis: { ok: false, title: "Transient", message: "No ground symbol.", warnings: [] },
    }));
    expect(text).toContain("Analysis: last transient run failed — No ground symbol.");
  });

  it("falls back to a clear message when the circuit can't build a netlist (no ground)", () => {
    const { text } = buildAssistantContext(baseInput({
      components: [component("resistor", "r1", "R1", "1k", 0, 0)],
      wires: [],
    }));
    expect(text).toContain("Netlist unavailable:");
    expect(text).toContain("ground");
  });

  it("falls back to a clear message when the circuit is empty", () => {
    const { text } = buildAssistantContext(baseInput({ components: [], wires: [] }));
    expect(text).toContain("Netlist unavailable:");
    expect(text).toContain("Components: none placed.");
  });

  it("truncates the whole context and flags it when the analysis section alone blows the cap", () => {
    // A step sweep or a directive-heavy .meas block can produce hundreds of
    // measurement rows — enough alone (on top of the netlist + component
    // sections) to exceed the ~4000 char budget on a small, valid circuit.
    const measurements = Array.from({ length: 400 }, (_, i) => ({ name: `meas_${i}_of_a_long_name`, value: 1.2345 + i }));
    const { text, truncated } = buildAssistantContext(baseInput({ analysis: successAnalysis(), measurements }));
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(4100); // capped text plus the short trailing note
    expect(text).toContain("context truncated");
  });
});
