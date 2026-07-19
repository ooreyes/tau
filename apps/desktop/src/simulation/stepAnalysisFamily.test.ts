/**
 * Coverage for AC/DC-domain `.step` families (LTspice parity).
 *
 * The transient family is assembled in `App`; this proves the same nested-context
 * expansion drives the frequency- and DC-domain TS solvers. The generic core is
 * exercised with a fake runner (empty/absent/nested paths), then the AC and DC
 * wrappers are checked end-to-end against hand-computed RC-corner / divider-ratio
 * values so a `.step` really produces a distinct curve per swept value.
 */

import { describe, it, expect } from "vitest";
import {
  runStepFamily,
  runAcStepFamily,
  runDcStepFamily,
  acFamilyOverlaySeries,
  dcFamilyOverlaySeries,
  type AnalysisFamily,
} from "./stepAnalysisFamily";
import type { AcResult } from "./acSweep";
import type { DcSweepResult } from "./dcSweep";
import { parseStepDirective } from "./paramStep";
import { EMPTY_SCOPE, buildParamScope } from "./paramScope";
import type { SchematicComponent } from "../schematic/types";

// A trivial result type for the generic-core tests.
interface Fake {
  ok: boolean;
  warnings: string[];
}
const okFake = (): Fake => ({ ok: true, warnings: ["w"] });

describe("runStepFamily - generic core", () => {
  it("returns a clear message with no specs", () => {
    const fam = runStepFamily<Fake>([], EMPTY_SCOPE, [], okFake, (r) => r.ok, (r) => r.warnings);
    expect(fam.ok).toBe(false);
    expect(fam.members).toEqual([]);
    expect(fam.message).toMatch(/\.step/);
  });

  it("runs the closure once per swept value and labels each member", () => {
    const spec = parseStepDirective(".step param G list 1 2 3")!;
    let calls = 0;
    const fam = runStepFamily<Fake>(
      [spec],
      EMPTY_SCOPE,
      [],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (_ctx) => {
        calls += 1;
        return okFake();
      },
      (r) => r.ok,
      (r) => r.warnings,
    );
    expect(calls).toBe(3);
    expect(fam.ok).toBe(true);
    expect(fam.members.map((m) => m.label)).toEqual(["G=1", "G=2", "G=3"]);
    expect(fam.members.map((m) => m.value)).toEqual([1, 2, 3]);
    expect(fam.spec).toBe(spec);
    expect(fam.warnings).toEqual(["w"]); // from the first ok member
  });

  it("surfaces a source-sweep expansion error as ok:false", () => {
    const spec = parseStepDirective(".step Vmissing 0 5 1")!;
    const fam = runStepFamily<Fake>([spec], EMPTY_SCOPE, [], okFake, (r) => r.ok, (r) => r.warnings);
    expect(fam.ok).toBe(false);
    expect(fam.message).toMatch(/Vmissing/);
    expect(fam.members).toEqual([]);
  });

  it("expands two specs into the nested Cartesian product", () => {
    const outer = parseStepDirective(".step param A list 1 2")!;
    const inner = parseStepDirective(".step param B list 10 20")!;
    const fam = runStepFamily<Fake>([outer, inner], EMPTY_SCOPE, [], okFake, (r) => r.ok, (r) => r.warnings);
    expect(fam.members.map((m) => m.label)).toEqual([
      "A=1, B=10",
      "A=1, B=20",
      "A=2, B=10",
      "A=2, B=20",
    ]);
  });

  it("reports ok:false when every member fails but still returns the members", () => {
    const spec = parseStepDirective(".step param G list 1 2")!;
    const fam = runStepFamily<Fake>(
      [spec],
      EMPTY_SCOPE,
      [],
      () => ({ ok: false, warnings: [] }),
      (r) => r.ok,
      (r) => r.warnings,
    );
    expect(fam.ok).toBe(false);
    expect(fam.members).toHaveLength(2);
    expect(fam.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC family - RC low-pass whose R is stepped, shifting the -3 dB corner.
//
//   V1(AC 1) --R{Rval}-- mid --C-- gnd.   H(f) = 1/(1 + j·2πf·R·C).
//   At a fixed high frequency, |H| ≈ 1/(ωRC): a larger R attenuates more.
//   With C = 159.155 nF, R=1k → fc≈1000 Hz; R=2k → fc≈500 Hz.
// ---------------------------------------------------------------------------

function rcLowpass(): SchematicComponent[] {
  return [
    { id: "v1", label: "V1", kind: "vac", x: 0, y: 0, rotation: 0, value: "1",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "{Rval}",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "c1", label: "C1", kind: "capacitor", x: 0, y: 0, rotation: 0, value: "159.155n",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
}

/** Lowest magnitude across all traces at the final frequency = the rolled-off
 *  output node (most attenuated), used to compare corner shifts across members. */
function minFinalMagDb(result: AcResult): number {
  if (!result.ok) throw new Error(result.message);
  const last = result.freqs.length - 1;
  return Math.min(...result.traces.map((t) => t.magDb[last]));
}

describe("runAcStepFamily", () => {
  const acOptions = { startHz: 10, stopHz: 100_000, pointsPerDecade: 20 };

  it("re-runs the Bode sweep per step value, shifting the corner with R", () => {
    const spec = parseStepDirective(".step param Rval list 1k 2k")!;
    const fam = runAcStepFamily([spec], EMPTY_SCOPE, { components: rcLowpass(), wires: [] }, acOptions);

    expect(fam.ok).toBe(true);
    expect(fam.members.map((m) => m.label)).toEqual(["Rval=1000", "Rval=2000"]);
    expect(fam.members.every((m) => m.result.ok)).toBe(true);

    // A larger R lowers the corner → more attenuation at the top of the sweep.
    const [m1, m2] = fam.members;
    expect(minFinalMagDb(m2.result)).toBeLessThan(minFinalMagDb(m1.result));
    // ~6 dB more attenuation for 2× the R at f well above both corners.
    expect(minFinalMagDb(m1.result) - minFinalMagDb(m2.result)).toBeGreaterThan(4);
  });

  it("carries a no-.step message through", () => {
    const fam = runAcStepFamily([], EMPTY_SCOPE, { components: rcLowpass(), wires: [] }, acOptions);
    expect(fam.ok).toBe(false);
    expect(fam.message).toMatch(/\.step/);
  });
});

// ---------------------------------------------------------------------------
// DC family - resistive divider whose top resistor is stepped.
//
//   V1 --R1{Rt}-- mid --R2(1k)-- gnd.  V(mid) = Vsweep · R2/(R1+R2).
//   Rt=1k → ratio 0.5; Rt=3k → ratio 0.25.  Swept 0..10 V.
// ---------------------------------------------------------------------------

function steppedDivider(): SchematicComponent[] {
  return [
    { id: "v1", label: "V1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "5",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ] },
    { id: "r1", label: "R1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "{Rt}",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ] },
    { id: "r2", label: "R2", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ] },
    { id: "g", label: "", kind: "ground", x: 0, y: 100, rotation: 0, value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }] },
  ];
}

/** The divider midpoint net's series for a given ratio (Vsweep · ratio). */
function midSeries(result: DcSweepResult, ratio: number): number[] | undefined {
  if (!result.ok) throw new Error(result.message);
  return result.nets.find(
    (n) => !n.ground && n.voltages.every((v, k) => Math.abs(v - result.sweep[k] * ratio) < 1e-9),
  )?.voltages;
}

describe("runDcStepFamily", () => {
  const dcSpec = { source: "V1", start: 0, stop: 10, step: 2 };

  it("re-runs the DC source sweep per step value, tracking the divider ratio", () => {
    const spec = parseStepDirective(".step param Rt list 1k 3k")!;
    const fam = runDcStepFamily([spec], EMPTY_SCOPE, { components: steppedDivider(), wires: [] }, dcSpec);

    expect(fam.ok).toBe(true);
    expect(fam.members.map((m) => m.label)).toEqual(["Rt=1000", "Rt=3000"]);

    // Rt=1k → ratio 0.5; Rt=3k → ratio 0.25. Sweep is [0,2,4,6,8,10].
    expect(midSeries(fam.members[0].result, 0.5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(midSeries(fam.members[1].result, 0.25)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it("respects a base param scope shared across members", () => {
    const base = buildParamScope([".param Rt=2k"]); // overridden by the step
    const spec = parseStepDirective(".step param Rt list 1k 3k")!;
    const fam = runDcStepFamily([spec], base, { components: steppedDivider(), wires: [] }, dcSpec);
    expect(fam.ok).toBe(true);
    expect(midSeries(fam.members[0].result, 0.5)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Overlay selectors - reduce a family to the one signal the UI draws per step.
// Hand-built members pin the selection rules exactly; one end-to-end case each
// proves the selectors compose with the real wrappers.
// ---------------------------------------------------------------------------

const acMember = (label: string, magDb: number[]) => ({
  label,
  value: 0,
  result: {
    ok: true as const,
    freqs: [10, 100, 1000],
    traces: [{ id: "n1", label: "V(out)", magDb, phaseDeg: [0, -45, -90] }],
    warnings: [],
  },
});

const acFamily = (members: AnalysisFamily<AcResult>["members"]): AnalysisFamily<AcResult> => ({
  ok: members.some((m) => m.result.ok),
  members,
  warnings: [],
});

describe("acFamilyOverlaySeries", () => {
  it("returns null for missing or failed families", () => {
    expect(acFamilyOverlaySeries(null)).toBeNull();
    expect(acFamilyOverlaySeries(undefined)).toBeNull();
    expect(acFamilyOverlaySeries({ ok: false, members: [], warnings: [] })).toBeNull();
  });

  it("picks the first ok member's first trace and follows it by id", () => {
    const fam = acFamily([
      { label: "R=1k", value: 1000, result: { ok: false, message: "x", warnings: [] } },
      acMember("R=2k", [0, -3, -20]),
      acMember("R=4k", [0, -6, -26]),
    ]);
    const overlay = acFamilyOverlaySeries(fam);
    expect(overlay).not.toBeNull();
    expect(overlay!.signal).toBe("V(out)");
    expect(overlay!.series.map((s) => s.label)).toEqual(["R=2k", "R=4k"]);
    expect(overlay!.series[0].magDb).toEqual([0, -3, -20]);
    expect(overlay!.series[1].magDb).toEqual([0, -6, -26]);
    expect(overlay!.series[0].freqs).toEqual([10, 100, 1000]);
    expect(overlay!.series[0].phaseDeg).toEqual([0, -45, -90]);
  });

  it("prefers the first trace that responds to the step over a flat source node", () => {
    const withInput = (label: string, outDb: number[]) => ({
      label,
      value: 0,
      result: {
        ok: true as const,
        freqs: [10, 100, 1000],
        traces: [
          // The AC source node: 0 dB in every member - a useless family.
          { id: "in", label: "V(in)", magDb: [0, 0, 0], phaseDeg: [0, 0, 0] },
          { id: "out", label: "V(out)", magDb: outDb, phaseDeg: [0, -45, -90] },
        ],
        warnings: [],
      },
    });
    const overlay = acFamilyOverlaySeries(
      acFamily([withInput("R=1k", [0, -3, -20]), withInput("R=2k", [0, -7, -26])]),
    );
    expect(overlay!.signal).toBe("V(out)");
    expect(overlay!.series.map((s) => s.magDb)).toEqual([[0, -3, -20], [0, -7, -26]]);
  });

  it("falls back to the first trace when every signal is flat across members", () => {
    const overlay = acFamilyOverlaySeries(acFamily([acMember("A=1", [0, -3, -20]), acMember("A=2", [0, -3, -20])]));
    expect(overlay!.signal).toBe("V(out)");
    expect(overlay!.series).toHaveLength(2);
  });

  it("skips a member that lost the chosen signal instead of failing", () => {
    const fam = acFamily([
      acMember("A=1", [0, -1, -2]),
      {
        label: "A=2",
        value: 2,
        result: {
          ok: true,
          freqs: [10, 100, 1000],
          traces: [{ id: "other", label: "V(x)", magDb: [1, 1, 1], phaseDeg: [0, 0, 0] }],
          warnings: [],
        },
      },
    ]);
    const overlay = acFamilyOverlaySeries(fam);
    expect(overlay!.series.map((s) => s.label)).toEqual(["A=1"]);
  });

  it("returns null when a member is ok but has no traces at all", () => {
    const fam = acFamily([
      { label: "A=1", value: 1, result: { ok: true, freqs: [10], traces: [], warnings: [] } },
    ]);
    expect(acFamilyOverlaySeries(fam)).toBeNull();
  });

  it("composes with runAcStepFamily: one curve per step, more R = more rolloff", () => {
    const spec = parseStepDirective(".step param Rval list 1k 2k")!;
    const fam = runAcStepFamily(
      [spec],
      EMPTY_SCOPE,
      { components: rcLowpass(), wires: [] },
      { startHz: 10, stopHz: 100_000, pointsPerDecade: 20 },
    );
    const overlay = acFamilyOverlaySeries(fam);
    expect(overlay).not.toBeNull();
    expect(overlay!.series.map((s) => s.label)).toEqual(["Rval=1000", "Rval=2000"]);
    // The same signal is followed across members; the two curves must differ
    // somewhere in the band (the corner moved), sharing one frequency grid.
    const [a, b] = overlay!.series;
    expect(a.freqs).toEqual(b.freqs);
    expect(a.magDb.some((db, i) => Math.abs(db - b.magDb[i]) > 1)).toBe(true);
  });
});

const dcMember = (label: string, ratio: number) => ({
  label,
  value: ratio,
  result: {
    ok: true as const,
    source: "V1",
    sweep: [0, 5, 10],
    nets: [
      { id: "gnd", label: "GND", voltages: [0, 0, 0], ground: true },
      { id: "mid", label: "V(mid)", voltages: [0, 5 * ratio, 10 * ratio], ground: false },
    ],
    warnings: [],
  },
});

describe("dcFamilyOverlaySeries", () => {
  it("returns null for missing or failed families", () => {
    expect(dcFamilyOverlaySeries(null)).toBeNull();
    expect(dcFamilyOverlaySeries(undefined)).toBeNull();
    expect(dcFamilyOverlaySeries({ ok: false, members: [], warnings: [] })).toBeNull();
  });

  it("picks the first non-ground net and follows it across members", () => {
    const fam: AnalysisFamily<DcSweepResult> = {
      ok: true,
      members: [dcMember("Rt=1k", 0.5), dcMember("Rt=3k", 0.25)],
      warnings: [],
    };
    const overlay = dcFamilyOverlaySeries(fam);
    expect(overlay).not.toBeNull();
    expect(overlay!.signal).toBe("V(mid)");
    expect(overlay!.series.map((s) => s.label)).toEqual(["Rt=1k", "Rt=3k"]);
    expect(overlay!.series[0].voltages).toEqual([0, 2.5, 5]);
    expect(overlay!.series[1].voltages).toEqual([0, 1.25, 2.5]);
    expect(overlay!.series[0].sweep).toEqual([0, 5, 10]);
  });

  it("returns null when the only nets are ground", () => {
    const fam: AnalysisFamily<DcSweepResult> = {
      ok: true,
      members: [
        {
          label: "A=1",
          value: 1,
          result: {
            ok: true,
            source: "V1",
            sweep: [0, 1],
            nets: [{ id: "gnd", label: "GND", voltages: [0, 0], ground: true }],
            warnings: [],
          },
        },
      ],
      warnings: [],
    };
    expect(dcFamilyOverlaySeries(fam)).toBeNull();
  });

  it("composes with runDcStepFamily: one transfer curve per step value", () => {
    const spec = parseStepDirective(".step param Rt list 1k 3k")!;
    const fam = runDcStepFamily(
      [spec],
      EMPTY_SCOPE,
      { components: steppedDivider(), wires: [] },
      { source: "V1", start: 0, stop: 10, step: 2 },
    );
    const overlay = dcFamilyOverlaySeries(fam);
    expect(overlay).not.toBeNull();
    expect(overlay!.series).toHaveLength(2);
    // The selector must follow the divider midpoint (the net that responds to
    // the step), not the swept source's own node: ratio 0.5 then 0.25.
    const [a, b] = overlay!.series;
    expect(a.sweep).toEqual([0, 2, 4, 6, 8, 10]);
    a.voltages.forEach((v, k) => expect(v).toBeCloseTo(a.sweep[k] * 0.5, 9));
    b.voltages.forEach((v, k) => expect(v).toBeCloseTo(b.sweep[k] * 0.25, 9));
  });
});
