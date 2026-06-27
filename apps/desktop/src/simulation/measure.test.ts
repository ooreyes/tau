import { describe, expect, it } from "vitest";
import {
  parseMeasDirective,
  evaluateMeasurement,
  runMeasurements,
  type MeasWaveform,
} from "./measure";

/** A single trace named `id` with given samples. */
function wf(times: number[], traces: Record<string, number[]>): MeasWaveform {
  return {
    times,
    traces: Object.entries(traces).map(([id, values]) => ({ id, label: `V(${id})`, values })),
  };
}

/** A symmetric triangle on [0, peak], period `period`, sampled `n` pts/period over `cycles`. */
function triangle(peak: number, period: number, cycles: number, n: number): MeasWaveform {
  const times: number[] = [];
  const values: number[] = [];
  const dt = period / n;
  const total = Math.round(cycles * n);
  for (let k = 0; k <= total; k++) {
    const t = k * dt;
    const phase = (t % period) / period; // 0..1
    const v = phase < 0.5 ? peak * (phase / 0.5) : peak * (1 - (phase - 0.5) / 0.5);
    times.push(t);
    values.push(v);
  }
  return wf(times, { vtri: values });
}

describe("parseMeasDirective", () => {
  it("parses an aggregate with FROM/TO", () => {
    const spec = parseMeasDirective(".meas tran vmax MAX V(vtri) FROM=100u TO=200u");
    expect(spec).toMatchObject({ kind: "aggregate", name: "vmax", op: "MAX", expr: "V(vtri)" });
    const agg = spec as Extract<typeof spec, { kind: "aggregate" }>;
    expect(agg.from).toBeCloseTo(1e-4, 12);
    expect(agg.to).toBeCloseTo(2e-4, 12);
  });

  it("parses a PARAM measurement", () => {
    const spec = parseMeasDirective(".meas tran vamp PARAM (vmax-vmin)/2");
    expect(spec).toEqual({ kind: "param", name: "vamp", analysis: "tran", expr: "(vmax-vmin)/2" });
  });

  it("parses FIND ... AT (space form)", () => {
    const spec = parseMeasDirective(".meas tran vat FIND V(vout) AT 60u");
    expect(spec).toMatchObject({ kind: "find", name: "vat", expr: "V(vout)" });
    expect((spec as Extract<typeof spec, { kind: "find" }>).at).toBeCloseTo(60e-6, 12);
  });

  it("parses FIND ... AT= (equals form)", () => {
    const spec = parseMeasDirective(".meas tran vat FIND V(vout) AT=1m");
    expect(spec).toMatchObject({ kind: "find", at: 1e-3 });
  });

  it("parses WHEN with a crossing condition", () => {
    const spec = parseMeasDirective(".meas tran t1 WHEN V(out)=2.5 RISE=1");
    expect(spec).toEqual({
      kind: "when",
      name: "t1",
      analysis: "tran",
      expr: null,
      cross: { expr: "V(out)", value: "2.5", edge: "RISE", occurrence: 1, td: 0 },
    });
  });

  it("parses a TRIG/TARG period measurement", () => {
    const spec = parseMeasDirective(
      ".meas tran tper TRIG V(vtri) VAL=2.5 RISE=1 TD=100u TARG V(vtri) VAL=2.5 RISE=2 TD=100u",
    );
    expect(spec).toMatchObject({
      kind: "trigtarg",
      name: "tper",
      trig: { expr: "V(vtri)", value: "2.5", edge: "RISE", occurrence: 1 },
      targ: { expr: "V(vtri)", value: "2.5", edge: "RISE", occurrence: 2 },
    });
    const tt = spec as Extract<typeof spec, { kind: "trigtarg" }>;
    expect(tt.trig.td).toBeCloseTo(1e-4, 12);
    expect(tt.targ.td).toBeCloseTo(1e-4, 12);
  });

  it("ignores non-meas lines", () => {
    expect(parseMeasDirective(".tran 0 1m")).toBeNull();
    expect(parseMeasDirective(".param x=1")).toBeNull();
  });

  it("strips a leading ! and supports .measure", () => {
    expect(parseMeasDirective("!.measure tran y MIN V(a)")).toMatchObject({ kind: "aggregate", op: "MIN", name: "y" });
  });
});

describe("aggregate measurements", () => {
  const w = wf([0, 1, 2, 3, 4], { a: [1, 3, 2, 5, 0] });

  it("MAX finds the peak and its time", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MAX V(a)")!, w, {});
    expect(r.value).toBe(5);
    expect(r.at).toBe(3);
  });

  it("MIN finds the trough", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MIN V(a)")!, w, {});
    expect(r.value).toBe(0);
    expect(r.at).toBe(4);
  });

  it("PP is max minus min", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m PP V(a)")!, w, {});
    expect(r.value).toBe(5);
  });

  it("respects FROM/TO window", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MAX V(a) FROM=0 TO=2")!, w, {});
    expect(r.value).toBe(3);
  });

  it("INTEG is the trapezoidal integral", () => {
    // constant 2 over [0,4] => area 8
    const c = wf([0, 1, 2, 3, 4], { a: [2, 2, 2, 2, 2] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m INTEG V(a)")!, c, {});
    expect(r.value).toBeCloseTo(8, 9);
  });

  it("AVG of a constant is the constant", () => {
    const c = wf([0, 1, 2, 3, 4], { a: [2, 2, 2, 2, 2] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m AVG V(a)")!, c, {});
    expect(r.value).toBeCloseTo(2, 9);
  });

  it("RMS of a constant is its magnitude", () => {
    const c = wf([0, 1, 2, 3, 4], { a: [3, 3, 3, 3, 3] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m RMS V(a)")!, c, {});
    expect(r.value).toBeCloseTo(3, 9);
  });

  it("evaluates a differential expression V(a)-V(b)", () => {
    const d = wf([0, 1, 2], { a: [5, 5, 5], b: [1, 2, 3] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MAX V(a)-V(b)")!, d, {});
    expect(r.value).toBe(4); // 5-1 at t=0
  });
});

describe("FIND ... AT with interpolation", () => {
  it("interpolates between samples", () => {
    const w = wf([0, 1, 2], { a: [0, 10, 20] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m FIND V(a) AT=0.5")!, w, {});
    expect(r.value).toBeCloseTo(5, 9);
  });
});

describe("WHEN crossing time", () => {
  it("finds the rising crossing time by interpolation", () => {
    const w = wf([0, 1, 2], { a: [0, 10, 20] });
    // crosses 5 halfway between t=0 and t=1
    const r = evaluateMeasurement(parseMeasDirective(".meas tran t WHEN V(a)=5 RISE=1")!, w, {});
    expect(r.value).toBeCloseTo(0.5, 9);
  });

  it("FIND ... WHEN returns the target value at the crossing", () => {
    const w: MeasWaveform = {
      times: [0, 1, 2],
      traces: [
        { id: "a", label: "V(a)", values: [0, 10, 20] },
        { id: "b", label: "V(b)", values: [100, 200, 300] },
      ],
    };
    // V(a)=5 at t=0.5 → V(b) interpolated = 150
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m FIND V(b) WHEN V(a)=5")!, w, {});
    expect(r.value).toBeCloseTo(150, 9);
  });
});

describe("TRIG/TARG timing on a triangle", () => {
  it("measures one period between successive rising crossings", () => {
    const period = 10e-6;
    const w = triangle(5, period, 4, 400); // 5V peak, 10us period
    const spec = parseMeasDirective(
      ".meas tran tper TRIG V(vtri) VAL=2.5 RISE=1 TARG V(vtri) VAL=2.5 RISE=2",
    )!;
    const r = evaluateMeasurement(spec, w, {});
    expect(r.value).toBeCloseTo(period, 8);
  });
});

describe("runMeasurements chaining (deadtime.asc scenario)", () => {
  it("chains MAX/MIN → PARAM amplitude and TRIG/TARG → frequency", () => {
    const period = 10e-6;
    const w = triangle(5, period, 6, 600);
    const directives = [
      ".meas tran vmax MAX V(vtri) FROM=20u TO=40u",
      ".meas tran vmin MIN V(vtri) FROM=20u TO=40u",
      ".meas tran vamp PARAM (vmax-vmin)/2",
      ".meas tran tper TRIG V(vtri) VAL=2.5 RISE=1 TD=20u TARG V(vtri) VAL=2.5 RISE=2 TD=20u",
      ".meas tran freq PARAM 1/tper",
    ];
    const results = runMeasurements(directives, w, {});
    const byName = Object.fromEntries(results.map((r) => [r.name, r.value]));

    expect(byName.vmax).toBeCloseTo(5, 6);
    expect(byName.vmin).toBeCloseTo(0, 6);
    expect(byName.vamp).toBeCloseTo(2.5, 6);
    expect(byName.tper).toBeCloseTo(period, 8);
    expect(byName.freq).toBeCloseTo(1 / period, 2);
  });

  it("seeds the scope with circuit params and computes percentage error", () => {
    const w = triangle(5, 10e-6, 4, 400);
    const directives = [
      ".meas tran vmax MAX V(vtri) FROM=10u TO=30u",
      ".meas tran vmin MIN V(vtri) FROM=10u TO=30u",
      ".meas tran vamp PARAM (vmax-vmin)/2",
      ".meas tran amp_err PARAM 100*abs(vamp-vamp_exp)/vamp_exp",
    ];
    const results = runMeasurements(directives, w, { vamp_exp: 2.5 });
    const errResult = results.find((r) => r.name === "amp_err")!;
    expect(errResult.value).toBeCloseTo(0, 4);
  });
});

describe("edge cases", () => {
  it("returns null for an empty window", () => {
    const w = wf([0, 1, 2], { a: [1, 2, 3] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MAX V(a) FROM=10 TO=20")!, w, {});
    expect(r.value).toBeNull();
  });

  it("returns null when a WHEN condition never occurs", () => {
    const w = wf([0, 1, 2], { a: [0, 1, 2] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran t WHEN V(a)=99")!, w, {});
    expect(r.value).toBeNull();
  });

  it("yields null for an unknown node", () => {
    const w = wf([0, 1, 2], { a: [0, 1, 2] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m MAX V(nope)")!, w, {});
    expect(r.value).toBeNull();
  });
});

describe("branch-current signals I(ref)", () => {
  // out node = 2 V across a 4 Ω load; I(R1) = 0.5 A. Source delivers it: I(V1) = -0.5 A.
  const w: MeasWaveform = {
    times: [0, 1, 2, 3],
    traces: [{ id: "out", label: "V(out)", values: [2, 2, 2, 2] }],
    currents: [
      { ref: "R1", label: "I(R1)", values: [0.5, 0.5, 0.5, 0.5] },
      { ref: "V1", label: "I(V1)", values: [-0.5, -0.5, -0.5, -0.5] },
    ],
  };

  it("resolves I(R1) in an AVG measurement", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran ir AVG I(R1)")!, w, {});
    expect(r.value).toBeCloseTo(0.5, 9);
  });

  it("computes load power V(out)*I(R1)", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran pl AVG V(out)*I(R1)")!, w, {});
    expect(r.value).toBeCloseTo(1.0, 9); // 2 V × 0.5 A
  });

  it("handles the deadtime.asc supplied-power form -(k*I(V1))", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran ps AVG -(10*I(V1))")!, w, {});
    expect(r.value).toBeCloseTo(5.0, 9); // -(10 × -0.5)
  });

  it("an unknown ref yields a null/NaN measurement, not a throw", () => {
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m AVG I(R9)")!, w, {});
    expect(r.value === null || Number.isNaN(r.value)).toBe(true);
  });

  it("a waveform with no currents leaves I(...) unresolved (no throw)", () => {
    const noCur = wf([0, 1], { out: [1, 1] });
    const r = evaluateMeasurement(parseMeasDirective(".meas tran m AVG I(R1)")!, noCur, {});
    expect(r.value === null || Number.isNaN(r.value)).toBe(true);
  });
});
