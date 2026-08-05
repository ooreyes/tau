import { describe, expect, it } from "vitest";
import {
  assembleNativeStepFamily,
  canUseNativeStepPath,
  nativeStepMemberLabels,
  nativeStepMemberValues,
  nativeStepPathRefusal,
  orderNativeStepPlots,
} from "./nativeStepFamily";
import { parseStepDirective } from "./paramStep";
import type { StepFamilyMember } from "./stepFamily";

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

describe("canUseNativeStepPath", () => {
  it("accepts source-kind sweeps within the plot budget", () => {
    expect(canUseNativeStepPath([sourceSpec(".step V1 list 1 2 3")])).toBe(true);
    expect(nativeStepPathRefusal([sourceSpec(".step V1 1 3 1")])).toBeNull();
  });

  it("refuses param sweeps (braces are baked before the deck)", () => {
    const refusal = nativeStepPathRefusal([sourceSpec(".step param Rload list 1k 2k")]);
    expect(canUseNativeStepPath([sourceSpec(".step param Rload list 1k 2k")])).toBe(false);
    expect(refusal).toMatch(/param sweeps/i);
  });

  it("refuses temp sweeps (inline tc= is TS-only today)", () => {
    expect(canUseNativeStepPath([sourceSpec(".step temp 0 50 25")])).toBe(false);
    expect(nativeStepPathRefusal([sourceSpec(".step temp 0 50 25")])).toMatch(/temperature/i);
  });

  it("refuses a mixed param×source product", () => {
    expect(canUseNativeStepPath([
      sourceSpec(".step param X list 1 2"),
      sourceSpec(".step V1 list 5 10"),
    ])).toBe(false);
  });
});

describe("nativeStepMemberLabels / values", () => {
  it("labels a single source list in order", () => {
    const specs = [sourceSpec(".step V1 list 1 2 5")];
    expect(nativeStepMemberLabels(specs)).toEqual(["V1=1", "V1=2", "V1=5"]);
    expect(nativeStepMemberValues(specs)).toEqual([1, 2, 5]);
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
