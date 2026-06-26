/**
 * Unit + integration coverage for the `.step` parametric sweep parser and
 * runner (FEATURE_PARITY §4 `.step` / §5 `.step param x list/range`).
 *
 * Every range expectation below is hand-computed; the integration test re-uses
 * the voltage-divider geometry from paramIntegration.test.ts and proves the
 * swept param flows through the real operating-point solver.
 */

import { describe, it, expect } from "vitest";
import {
  parseStepDirective,
  runParamStep,
  stepFromDirectives,
  withStepValue,
  type StepSpec,
} from "./paramStep";
import { runOperatingPoint } from "./operatingPoint";
import { buildParamScope, EMPTY_SCOPE } from "./paramScope";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

describe("parseStepDirective — linear range", () => {
  it("parses `.step param X 1 5 1` into 1..5", () => {
    const spec = parseStepDirective(".step param X 1 5 1");
    expect(spec).toEqual<StepSpec>({ kind: "param", name: "X", values: [1, 2, 3, 4, 5] });
  });

  it("includes a clean endpoint despite float drift (0 → 1 step 0.2)", () => {
    const spec = parseStepDirective(".step param d 0 1 0.2");
    expect(spec?.values.length).toBe(6);
    expect(spec?.values[5]).toBeCloseTo(1, 9);
  });

  it("treats `lin` as the default linear scale", () => {
    const a = parseStepDirective(".step lin param X 0 10 5");
    expect(a?.values).toEqual([0, 5, 10]);
  });

  it("sweeps downward when stop < start", () => {
    const spec = parseStepDirective(".step param X 5 1 1");
    expect(spec?.values).toEqual([5, 4, 3, 2, 1]);
  });

  it("normalizes a negative increment toward stop", () => {
    const spec = parseStepDirective(".step param X 0 4 -2");
    expect(spec?.values).toEqual([0, 2, 4]);
  });

  it("honors SI suffixes in the range", () => {
    const spec = parseStepDirective(".step param R 1k 3k 1k");
    expect(spec?.values).toEqual([1000, 2000, 3000]);
  });
});

describe("parseStepDirective — list form", () => {
  it("parses an explicit param list", () => {
    const spec = parseStepDirective(".step param Rload list 1 2 5 10");
    expect(spec).toEqual<StepSpec>({ kind: "param", name: "Rload", values: [1, 2, 5, 10] });
  });

  it("parses a list with SI suffixes (case-insensitive `LIST`)", () => {
    const spec = parseStepDirective(".step param C LIST 1n 2.2n 10n");
    expect(spec?.values).toHaveLength(3);
    expect(spec?.values[0]).toBeCloseTo(1e-9, 12);
    expect(spec?.values[1]).toBeCloseTo(2.2e-9, 12);
    expect(spec?.values[2]).toBeCloseTo(1e-8, 12);
  });
});

describe("parseStepDirective — log scales", () => {
  it("dec gives N points per decade including the endpoint", () => {
    // 1 → 100 at 1 pt/decade ⇒ 1, 10, 100.
    const spec = parseStepDirective(".step dec param F 1 100 1");
    expect(spec?.values.length).toBe(3);
    expect(spec?.values[0]).toBeCloseTo(1, 9);
    expect(spec?.values[1]).toBeCloseTo(10, 6);
    expect(spec?.values[2]).toBeCloseTo(100, 6);
  });

  it("oct gives N points per octave", () => {
    // 1 → 8 at 1 pt/octave ⇒ 1, 2, 4, 8.
    const spec = parseStepDirective(".step oct param F 1 8 1");
    expect(spec?.values.length).toBe(4);
    expect(spec?.values[3]).toBeCloseTo(8, 6);
  });

  it("rejects a non-positive start for a log sweep", () => {
    expect(parseStepDirective(".step dec param F 0 100 1")).toBeNull();
  });
});

describe("parseStepDirective — source and temp kinds", () => {
  it("reads a bare designator as a source sweep", () => {
    const spec = parseStepDirective(".step V1 0 5 1");
    expect(spec).toEqual<StepSpec>({ kind: "source", name: "V1", values: [0, 1, 2, 3, 4, 5] });
  });

  it("reads `temp` with no name", () => {
    const spec = parseStepDirective(".step temp -40 40 40");
    expect(spec).toEqual<StepSpec>({ kind: "temp", name: undefined, values: [-40, 0, 40] });
  });

  it("supports a source list", () => {
    const spec = parseStepDirective(".step I2 list 1m 2m 3m");
    expect(spec?.kind).toBe("source");
    expect(spec?.values).toEqual([1e-3, 2e-3, 3e-3]);
  });
});

describe("parseStepDirective — rejects malformed input", () => {
  it("returns null for non-step directives", () => {
    expect(parseStepDirective(".tran 1m")).toBeNull();
    expect(parseStepDirective(".param X=1")).toBeNull();
  });

  it("returns null when the range is incomplete", () => {
    expect(parseStepDirective(".step param X 1 5")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(parseStepDirective(".step param X list")).toBeNull();
  });

  it("returns null for a zero increment", () => {
    expect(parseStepDirective(".step param X 1 5 0")).toBeNull();
  });

  it("tolerates a leading `!` (canvas directive) and tabs", () => {
    const spec = parseStepDirective("!step\tparam\tX\t1\t3\t1");
    expect(spec?.values).toEqual([1, 2, 3]);
  });
});

describe("withStepValue", () => {
  it("binds both the exact and lowercased key without mutating the base", () => {
    const base = buildParamScope([".param A=2"]);
    const next = withStepValue(base, "Rload", 4700);
    expect(next.scope.Rload).toBe(4700);
    expect(next.scope.rload).toBe(4700);
    expect(next.scope.A).toBe(2); // base param preserved
    expect(base.scope.Rload).toBeUndefined(); // base untouched
  });
});

describe("runParamStep", () => {
  it("invokes the analysis once per swept value with the injected scope", () => {
    const spec = parseStepDirective(".step param k 1 3 1")!;
    const runs = runParamStep(spec, EMPTY_SCOPE, (params) => params.scope.k * 10);
    expect(runs.map((r) => r.value)).toEqual([1, 2, 3]);
    expect(runs.map((r) => r.result)).toEqual([10, 20, 30]);
    expect(runs.map((r) => r.label)).toEqual(["k=1", "k=2", "k=3"]);
  });

  it("throws for a non-param spec", () => {
    const spec = parseStepDirective(".step V1 0 5 1")!;
    expect(() => runParamStep(spec, EMPTY_SCOPE, () => 0)).toThrow(/only handles param/);
  });
});

describe("stepFromDirectives", () => {
  it("returns the first parseable .step, skipping noise", () => {
    const spec = stepFromDirectives([".tran 1m", "; a comment", ".step param X 1 2 1", ".step param Y 0 9 3"]);
    expect(spec?.name).toBe("X");
  });

  it("returns null when no .step is present", () => {
    expect(stepFromDirectives([".tran 1m", ".ac dec 10 1 1k"])).toBeNull();
  });
});

// ── Integration: sweep a divider resistor through the real OP solver ──────────
let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const vsource = (x: number, y: number, value: string, label = "V1"): SchematicComponent => ({ id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label });
const resistor = (x: number, y: number, value: string, label = "R1"): SchematicComponent => ({ id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label });
const ground = (x: number, y: number): SchematicComponent => ({ id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" });
const wire = (points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

describe("runParamStep — divider integration", () => {
  it("steps Rtop and the midpoint voltage tracks the divider ratio", () => {
    // Vsrc=12, Rbot=1k fixed; sweep Rtop ∈ {1k, 3k}. mid = 12 * 1k/(Rtop+1k).
    const components = [
      vsource(0, 32, "12", "V1"),
      resistor(96, 0, "{Rtop}", "R1"),
      resistor(192, 0, "1k", "R2"),
      ground(0, 64),
      ground(224, 0),
    ];
    const wires = [
      wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];

    const spec = parseStepDirective(".step param Rtop list 1k 3k")!;
    const runs = runParamStep(spec, EMPTY_SCOPE, (params) => {
      const result = runOperatingPoint({ components, wires, params });
      if (!result.ok) throw new Error(result.message);
      // Midpoint = the non-ground net that is neither the 12 V source node.
      const mid = result.nets.find((n) => n.id !== "0" && n.voltage > 0.1 && n.voltage < 11.9);
      return mid?.voltage ?? NaN;
    });

    expect(runs).toHaveLength(2);
    // Rtop=1k → 12 * 1/(1+1) = 6 V
    expect(runs[0].result).toBeCloseTo(6, 3);
    // Rtop=3k → 12 * 1/(3+1) = 3 V
    expect(runs[1].result).toBeCloseTo(3, 3);
  });
});
