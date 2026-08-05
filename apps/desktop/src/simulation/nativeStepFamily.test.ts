import { describe, expect, it } from "vitest";
import {
  assembleNativeStepFamily,
  canUseNativeStepPath,
  nativeStepMemberLabels,
  nativeStepMemberValues,
  nativeStepPathRefusal,
  orderNativeStepPlots,
  unsupportedNativeParamBraceReason,
} from "./nativeStepFamily";
import { parseStepDirective } from "./paramStep";
import type { StepFamilyMember } from "./stepFamily";
import type { SchematicComponent } from "../schematic/types";

const sourceSpec = (line: string) => {
  const spec = parseStepDirective(line);
  if (!spec) throw new Error(`failed to parse ${line}`);
  return spec;
};

const stubMember = (plotName: string, label: string, value: number): StepFamilyMember => ({
  label,
  value,
  result: {
    ok: false,
    title: plotName,
    message: "fixture",
    warnings: [],
  },
});

const resistor = (value: string): SchematicComponent => ({
  id: "r1",
  kind: "resistor",
  label: "R1",
  value,
  x: 0,
  y: 0,
  rotation: 0,
});

describe("canUseNativeStepPath", () => {
  it("accepts source-kind sweeps within the plot budget", () => {
    expect(canUseNativeStepPath([sourceSpec(".step V1 list 1 2 3")])).toBe(true);
    expect(nativeStepPathRefusal([sourceSpec(".step V1 1 3 1")])).toBeNull();
  });

  it("accepts param sweeps when braces are simple R/C/L/V values", () => {
    const specs = [sourceSpec(".step param Rload list 1k 2k")];
    expect(canUseNativeStepPath(specs, { components: [resistor("{Rload}")] })).toBe(true);
    expect(nativeStepPathRefusal(specs, { components: [resistor("{Rload}")] })).toBeNull();
  });

  it("accepts a mixed param×source product", () => {
    expect(canUseNativeStepPath([
      sourceSpec(".step param X list 1 2"),
      sourceSpec(".step V1 list 5 10"),
    ], { components: [resistor("{X}")] })).toBe(true);
  });

  it("refuses temp sweeps (inline tc= is TS-only today)", () => {
    expect(canUseNativeStepPath([sourceSpec(".step temp 0 50 25")])).toBe(false);
    expect(nativeStepPathRefusal([sourceSpec(".step temp 0 50 25")])).toMatch(/temperature/i);
  });

  it("refuses param braces inside waveform source functions", () => {
    const specs = [sourceSpec(".step param Vhi list 1 5")];
    const pulse: SchematicComponent = {
      id: "v1",
      kind: "vsource",
      label: "V1",
      value: "PULSE(0 {Vhi} 0 1n 1n 1u 2u)",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(canUseNativeStepPath(specs, { components: [pulse] })).toBe(false);
    expect(nativeStepPathRefusal(specs, { components: [pulse] })).toMatch(/SINE\/PULSE/i);
  });

  it("refuses param braces in AC stimuli", () => {
    const specs = [sourceSpec(".step param amp list 1 2")];
    const vac: SchematicComponent = {
      id: "v1",
      kind: "vsource",
      label: "V1",
      value: "5 AC {amp}",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(canUseNativeStepPath(specs, { components: [vac] })).toBe(false);
    expect(unsupportedNativeParamBraceReason([vac], new Set(["amp"]))).toMatch(/AC stimuli/i);
  });
});

describe("nativeStepMemberLabels / values", () => {
  it("labels a single source list in order", () => {
    const specs = [sourceSpec(".step V1 list 1 2 5")];
    expect(nativeStepMemberLabels(specs)).toEqual(["V1=1", "V1=2", "V1=5"]);
    expect(nativeStepMemberValues(specs)).toEqual([1, 2, 5]);
  });

  it("labels a param list with the param name", () => {
    const specs = [sourceSpec(".step param Rload list 1k 2k")];
    expect(nativeStepMemberLabels(specs)).toEqual(["Rload=1000", "Rload=2000"]);
    expect(nativeStepMemberValues(specs)).toEqual([1000, 2000]);
  });

  it("builds the outer×inner Cartesian product like nestedStepContexts", () => {
    const specs = [
      sourceSpec(".step V1 list 1 2"),
      sourceSpec(".step V2 list 10 20"),
    ];
    expect(nativeStepMemberLabels(specs)).toEqual([
      "V1=1, V2=10",
      "V1=1, V2=20",
      "V1=2, V2=10",
      "V1=2, V2=20",
    ]);
    expect(nativeStepMemberValues(specs)).toEqual([10, 20, 10, 20]);
  });
});

describe("orderNativeStepPlots + assembleNativeStepFamily", () => {
  it("orders extras then current (oldest → newest)", () => {
    const ordered = orderNativeStepPlots(
      { name: "tran3", vectors: [] },
      [
        { name: "tran1", vectors: [] },
        { name: "tran2", vectors: [] },
      ],
    );
    expect(ordered.map((p) => p.name)).toEqual(["tran1", "tran2", "tran3"]);
  });

  it("assembles one member per plot with matching labels", () => {
    const specs = [sourceSpec(".step V1 list 1 2")];
    const plots = orderNativeStepPlots(
      { name: "tran2", vectors: [{ name: "time", real: [0, 1], imaginary: null }] },
      [{ name: "tran1", vectors: [{ name: "time", real: [0, 1], imaginary: null }] }],
    );
    const family = assembleNativeStepFamily(plots, specs, (plot, label, value) =>
      stubMember(plot.name, label, value),
    );
    // ok is false because stubs are ok:false — still proves zip/order.
    expect(family.members.map((m) => m.label)).toEqual(["V1=1", "V1=2"]);
    expect(family.members.map((m) => m.value)).toEqual([1, 2]);
    expect(family.members.map((m) => m.result.title)).toEqual(["tran1", "tran2"]);
  });

  it("assembles a param family the same way", () => {
    const specs = [sourceSpec(".step param X list 1 2")];
    const plots = [
      { name: "tran1", vectors: [] },
      { name: "tran2", vectors: [] },
    ];
    const family = assembleNativeStepFamily(plots, specs, (plot, label, value) =>
      stubMember(plot.name, label, value),
    );
    expect(family.members.map((m) => m.label)).toEqual(["X=1", "X=2"]);
  });

  it("refuses rather than inventing members when plot count mismatches", () => {
    const specs = [sourceSpec(".step V1 list 1 2 3")];
    const family = assembleNativeStepFamily(
      [{ name: "tran1", vectors: [] }],
      specs,
      () => {
        throw new Error("must not invent a member");
      },
    );
    expect(family.ok).toBe(false);
    expect(family.message).toMatch(/returned 1 step plot.*asks for 3/i);
    expect(family.members).toEqual([]);
  });
});
