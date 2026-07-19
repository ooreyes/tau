/**
 * Coverage for `.step` family-context expansion (LTspice parity).
 *
 * `stepContexts` turns a parsed StepSpec into concrete per-value run contexts.
 * The divider integration proves a source-kind sweep flows through the real
 * operating-point solver and tracks the hand-computed divider ratio - the same
 * path the UI's STEP tab drives.
 */

import { describe, it, expect } from "vitest";
import {
  stepContexts,
  nestedStepContexts,
  runnableStepsFromDirectives,
  formatStepValue,
  isRunnableStep,
  MAX_FAMILY_MEMBERS,
} from "./stepFamily";
import { parseStepDirective } from "./paramStep";
import { runOperatingPoint } from "./operatingPoint";
import { EMPTY_SCOPE, buildParamScope } from "./paramScope";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const vsource = (x: number, y: number, value: string, label = "V1"): SchematicComponent => ({ id: uid("vs"), kind: "vsource", x, y, rotation: 0, value, label });
const resistor = (x: number, y: number, value: string, label = "R1"): SchematicComponent => ({ id: uid("r"), kind: "resistor", x, y, rotation: 0, value, label });
const ground = (x: number, y: number): SchematicComponent => ({ id: uid("gnd"), kind: "ground", x, y, rotation: 0, value: "", label: "" });
const wire = (points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

describe("formatStepValue", () => {
  it("keeps integers plain and trims float noise", () => {
    expect(formatStepValue(4700)).toBe("4700");
    expect(formatStepValue(0.001)).toBe("0.001");
    expect(formatStepValue(1 / 3)).toBe("0.333333");
  });
});

describe("isRunnableStep", () => {
  it("accepts param, source, and temp; rejects null", () => {
    expect(isRunnableStep(parseStepDirective(".step param X 1 2 1"))).toBe(true);
    expect(isRunnableStep(parseStepDirective(".step V1 0 5 1"))).toBe(true);
    expect(isRunnableStep(parseStepDirective(".step temp 0 50 25"))).toBe(true);
    expect(isRunnableStep(null)).toBe(false);
  });
});

describe("stepContexts - param kind", () => {
  it("injects each swept value into a fresh scope without mutating the base", () => {
    const base = buildParamScope([".param A=2"]);
    const spec = parseStepDirective(".step param Rload list 1k 2k")!;
    const ctxs = stepContexts(spec, base, []);
    expect(ctxs.map((c) => c.label)).toEqual(["Rload=1000", "Rload=2000"]);
    expect(ctxs[0].params.scope.Rload).toBe(1000);
    expect(ctxs[0].params.scope.rload).toBe(1000);
    expect(ctxs[1].params.scope.Rload).toBe(2000);
    // Base param preserved, base scope untouched.
    expect(ctxs[0].params.scope.A).toBe(2);
    expect(base.scope.Rload).toBeUndefined();
  });

  it("leaves the component list referentially unchanged for param sweeps", () => {
    const comps = [resistor(0, 0, "{Rload}", "R1")];
    const spec = parseStepDirective(".step param Rload 1k 3k 1k")!;
    const ctxs = stepContexts(spec, EMPTY_SCOPE, comps);
    expect(ctxs).toHaveLength(3);
    expect(ctxs[0].components).toBe(comps);
  });
});

describe("stepContexts - source kind", () => {
  it("overrides the matched component's value and leaves others alone", () => {
    const comps = [vsource(0, 0, "1", "V1"), resistor(0, 0, "1k", "R1")];
    const spec = parseStepDirective(".step V1 list 2 5")!;
    const ctxs = stepContexts(spec, EMPTY_SCOPE, comps);
    expect(ctxs[0].components.find((c) => c.label === "V1")!.value).toBe("2");
    expect(ctxs[1].components.find((c) => c.label === "V1")!.value).toBe("5");
    // R1 untouched; original list not mutated.
    expect(ctxs[0].components.find((c) => c.label === "R1")!.value).toBe("1k");
    expect(comps.find((c) => c.label === "V1")!.value).toBe("1");
  });

  it("matches the ref-des case-insensitively", () => {
    const comps = [vsource(0, 0, "1", "V1")];
    const spec = parseStepDirective(".step v1 list 3")!;
    expect(stepContexts(spec, EMPTY_SCOPE, comps)[0].components[0].value).toBe("3");
  });

  it("throws when the named source is absent", () => {
    const spec = parseStepDirective(".step V9 0 5 1")!;
    expect(() => stepContexts(spec, EMPTY_SCOPE, [resistor(0, 0, "1k")])).toThrow(/no component named/);
  });
});

describe("stepContexts - guards", () => {
  it("builds a temp family: rescales tc resistors and carries the temperature", () => {
    const comps = [resistor(0, 0, "1k tc=0.01", "R1"), resistor(0, 0, "2k", "R2")];
    const spec = parseStepDirective(".step temp 27 127 50")!; // 27, 77, 127 °C
    const ctxs = stepContexts(spec, EMPTY_SCOPE, comps);
    expect(ctxs.map((c) => c.label)).toEqual(["temp=27", "temp=77", "temp=127"]);
    expect(ctxs.map((c) => c.temperature)).toEqual([27, 77, 127]);
    // R1 with tc=0.01/°C: R(27)=1000, R(77)=1000·(1+0.01·50)=1500, R(127)=2000.
    expect(Number(ctxs[0].components.find((c) => c.label === "R1")!.value)).toBeCloseTo(1000, 6);
    expect(Number(ctxs[1].components.find((c) => c.label === "R1")!.value)).toBeCloseTo(1500, 6);
    expect(Number(ctxs[2].components.find((c) => c.label === "R1")!.value)).toBeCloseTo(2000, 6);
    // R2 has no tc - passed through untouched; base list not mutated.
    expect(ctxs[1].components.find((c) => c.label === "R2")!.value).toBe("2k");
    expect(comps[0].value).toBe("1k tc=0.01");
  });

  it("caps the family at MAX_FAMILY_MEMBERS", () => {
    const spec = parseStepDirective(".step param X 1 1000 1")!; // 1000 values
    const ctxs = stepContexts(spec, EMPTY_SCOPE, []);
    expect(ctxs).toHaveLength(MAX_FAMILY_MEMBERS);
  });
});

describe("stepContexts - source sweep through the OP solver", () => {
  it("sweeps the supply and the midpoint tracks half the supply (1:1 divider)", () => {
    // R1 = R2 = 1k → mid = Vsupply / 2. Sweep V1 ∈ {4, 8, 12}.
    const components = [
      vsource(0, 32, "1", "V1"),
      resistor(96, 0, "1k", "R1"),
      resistor(192, 0, "1k", "R2"),
      ground(0, 64),
      ground(224, 0),
    ];
    const wires = [
      wire([{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire([{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    const spec = parseStepDirective(".step V1 list 4 8 12")!;
    const ctxs = stepContexts(spec, EMPTY_SCOPE, components);

    const mids = ctxs.map((ctx) => {
      const result = runOperatingPoint({ components: ctx.components, wires, params: ctx.params });
      if (!result.ok) throw new Error(result.message);
      const mid = result.nets.find((n) => n.id !== "0" && n.voltage > 0.1 && n.voltage < ctx.value - 0.1);
      return mid?.voltage ?? NaN;
    });

    expect(mids[0]).toBeCloseTo(2, 3); // 4 / 2
    expect(mids[1]).toBeCloseTo(4, 3); // 8 / 2
    expect(mids[2]).toBeCloseTo(6, 3); // 12 / 2
  });
});

describe("runnableStepsFromDirectives", () => {
  it("collects every runnable .step in document (outermost-first) order", () => {
    const specs = runnableStepsFromDirectives([
      ".param A=1",
      ".step param X 1 2 1",
      ".tran 1m",
      ".step V1 list 3 5",
      ".step temp 0 50 25",
    ]);
    expect(specs.map((s) => s.kind)).toEqual(["param", "source", "temp"]);
    expect(specs[0].name).toBe("X");
  });
  it("returns [] when no .step is present", () => {
    expect(runnableStepsFromDirectives([".tran 1m", ".param A=2"])).toEqual([]);
  });
});

describe("nestedStepContexts", () => {
  it("matches stepContexts for a single spec", () => {
    const spec = parseStepDirective(".step param X list 1 2 3")!;
    const nested = nestedStepContexts([spec], EMPTY_SCOPE, []);
    const single = stepContexts(spec, EMPTY_SCOPE, []);
    expect(nested.map((c) => c.label)).toEqual(single.map((c) => c.label));
  });

  it("builds the Cartesian product of two param axes (outer×inner)", () => {
    const outer = parseStepDirective(".step param A list 1 2")!;
    const inner = parseStepDirective(".step param B list 10 20")!;
    const ctxs = nestedStepContexts([outer, inner], EMPTY_SCOPE, []);
    expect(ctxs.map((c) => c.label)).toEqual([
      "A=1, B=10", "A=1, B=20", "A=2, B=10", "A=2, B=20",
    ]);
    // Both axes are injected into each member's scope.
    expect(ctxs[3].params.scope.A).toBe(2);
    expect(ctxs[3].params.scope.B).toBe(20);
    // Inner axis drives member.value (what the overlay colour-ramps).
    expect(ctxs.map((c) => c.value)).toEqual([10, 20, 10, 20]);
  });

  it("composes a source override with a temp axis and carries the temperature", () => {
    const comps = [vsource(0, 0, "1", "V1"), resistor(0, 0, "1k tc=0.01", "R1")];
    const src = parseStepDirective(".step V1 list 4 8")!;
    const temp = parseStepDirective(".step temp 27 77 50")!;
    const ctxs = nestedStepContexts([src, temp], EMPTY_SCOPE, comps);
    expect(ctxs.map((c) => c.label)).toEqual([
      "V1=4, temp=27", "V1=4, temp=77", "V1=8, temp=27", "V1=8, temp=77",
    ]);
    // Source override + temp rescale both applied in the 2nd member.
    expect(ctxs[1].components.find((c) => c.label === "V1")!.value).toBe("4");
    expect(Number(ctxs[1].components.find((c) => c.label === "R1")!.value)).toBeCloseTo(1500, 6);
    expect(ctxs[1].temperature).toBe(77);
  });

  it("caps the product at MAX_FAMILY_MEMBERS", () => {
    const a = parseStepDirective(".step param A 1 100 1")!; // 100 values
    const b = parseStepDirective(".step param B 1 100 1")!;
    const ctxs = nestedStepContexts([a, b], EMPTY_SCOPE, []);
    expect(ctxs).toHaveLength(MAX_FAMILY_MEMBERS);
  });

  it("validates a source axis up front (throws on an absent component)", () => {
    const a = parseStepDirective(".step param A list 1 2")!;
    const bad = parseStepDirective(".step V9 list 1 2")!;
    expect(() => nestedStepContexts([a, bad], EMPTY_SCOPE, [])).toThrow(/no component named/);
  });

  it("returns [] for no specs", () => {
    expect(nestedStepContexts([], EMPTY_SCOPE, [])).toEqual([]);
  });
});
