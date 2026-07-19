import { describe, expect, it } from "vitest";
import { evaluateAcMeasurement, runAcMeasurements, type AcMeasData } from "./measureAc";

/**
 * Build an AC dataset from a complex transfer function H(f). Stores each sample
 * as magnitude (dB) and phase (deg), exactly as the AC solver / AcTrace does.
 */
function acData(freqs: number[], traces: Record<string, (f: number) => { re: number; im: number }>): AcMeasData {
  return {
    freqs,
    traces: Object.entries(traces).map(([id, h]) => ({
      id,
      label: `V(${id})`,
      magDb: freqs.map((f) => {
        const { re, im } = h(f);
        return 20 * Math.log10(Math.hypot(re, im));
      }),
      phaseDeg: freqs.map((f) => {
        const { re, im } = h(f);
        return (Math.atan2(im, re) * 180) / Math.PI;
      }),
    })),
  };
}

/** First-order low-pass H(f) = 1 / (1 + j f/fc). */
function lowpass(fc: number) {
  return (f: number) => {
    const x = f / fc;
    const denom = 1 + x * x;
    return { re: 1 / denom, im: -x / denom };
  };
}

/** A log-spaced frequency axis from f0 to f1 with `n` points per decade. */
function logFreqs(f0: number, f1: number, perDecade: number): number[] {
  const out: number[] = [];
  const decades = Math.log10(f1 / f0);
  const total = Math.round(decades * perDecade);
  for (let i = 0; i <= total; i++) out.push(f0 * Math.pow(10, (i / perDecade)));
  return out;
}

describe("AC FIND ... AT", () => {
  const fc = 1000;
  const data = acData(logFreqs(10, 1e6, 50), { out: lowpass(fc) });

  it("db(V(out)) at the corner is ≈ -3.01 dB", () => {
    const r = evaluateAcMeasurement(".meas ac g FIND db(V(out)) AT=1k", data)!;
    expect(r.value).not.toBeNull();
    expect(r.value!).toBeCloseTo(-3.0103, 1);
  });

  it("mag(V(out)) at the corner is ≈ 0.707", () => {
    const r = evaluateAcMeasurement(".meas ac g FIND mag(V(out)) AT=1k", data)!;
    expect(r.value!).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("phase at the corner is ≈ -45°", () => {
    const r = evaluateAcMeasurement(".meas ac p FIND ph(V(out)) AT=1k", data)!;
    expect(r.value!).toBeCloseTo(-45, 0);
  });

  it("a bare V(out) defaults to magnitude (linear)", () => {
    const r = evaluateAcMeasurement(".meas ac g FIND V(out) AT=1k", data)!;
    expect(r.value!).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("low-frequency magnitude approaches 0 dB", () => {
    const r = evaluateAcMeasurement(".meas ac g FIND db(V(out)) AT=10", data)!;
    expect(r.value!).toBeCloseTo(0, 1);
  });
});

describe("AC WHEN crossing (corner / bandwidth detection)", () => {
  const fc = 1000;
  const data = acData(logFreqs(10, 1e6, 100), { out: lowpass(fc) });

  it("WHEN db(V(out))=-3 finds the corner frequency", () => {
    const r = evaluateAcMeasurement(".meas ac fc WHEN db(V(out))=-3.0103 FALL=1", data)!;
    expect(r.value).not.toBeNull();
    // The -3 dB corner of a 1-pole low-pass is fc.
    expect(r.value! / fc).toBeCloseTo(1, 1);
  });

  it("WHEN mag(V(out))=0.707 finds the corner too", () => {
    const r = evaluateAcMeasurement(".meas ac fc WHEN mag(V(out))=0.7071 FALL=1", data)!;
    expect(r.value! / fc).toBeCloseTo(1, 1);
  });

  it("reports null when the level is never reached", () => {
    const r = evaluateAcMeasurement(".meas ac fc WHEN db(V(out))=20", data)!;
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe("AC aggregates", () => {
  const data = acData(logFreqs(10, 1e6, 50), { out: lowpass(1000) });

  it("MAX db(V(out)) over the sweep is ≈ 0 dB (DC gain)", () => {
    const r = evaluateAcMeasurement(".meas ac peak MAX db(V(out))", data)!;
    expect(r.value!).toBeCloseTo(0, 1);
  });

  it("MIN db(V(out)) is the high-frequency rolloff (large negative)", () => {
    const r = evaluateAcMeasurement(".meas ac low MIN db(V(out))", data)!;
    expect(r.value!).toBeLessThan(-40);
  });

  it("PP over a window is max-minus-min", () => {
    const r = evaluateAcMeasurement(".meas ac pp PP db(V(out)) FROM=10 TO=1e6", data)!;
    expect(r.value!).toBeGreaterThan(40);
  });
});

describe("AC differential and chaining", () => {
  // out = lowpass, ref = flat unity reference. db(V(out)) - db(V(ref)) = db(out).
  const data = acData(logFreqs(10, 1e6, 50), {
    out: lowpass(1000),
    ref: () => ({ re: 1, im: 0 }),
  });

  it("PARAM lines reference earlier AC measurements by name", () => {
    const results = runAcMeasurements(
      [".meas ac g0 FIND db(V(out)) AT=10", ".meas ac gc FIND db(V(out)) AT=1k", ".meas ac drop PARAM g0-gc"],
      data,
    );
    expect(results).toHaveLength(3);
    const drop = results.find((r) => r.name === "drop")!;
    // g0 ≈ 0 dB, gc ≈ -3 dB, so the drop ≈ 3 dB.
    expect(drop.value!).toBeCloseTo(3.0103, 1);
  });

  it("two-node V(a,b) subtracts phasors before deriving db", () => {
    const r = evaluateAcMeasurement(".meas ac d FIND db(V(out,ref)) AT=1k", data)!;
    // V(out)-V(ref) at fc: out=(0.5,-0.5), ref=(1,0) ⇒ (-0.5,-0.5), |·|=0.7071 ⇒ -3.01 dB.
    expect(r.value!).toBeCloseTo(-3.0103, 1);
  });
});

describe("AC real-circuit forms (scope thresholds + freq variable)", () => {
  const fc = 1000;
  const data = acData(logFreqs(10, 1e6, 100), { vout: lowpass(fc) });

  it("FIND freq WHEN mag(V(vout))=(vout_3db) - bandwidth chain (AD4080 form)", () => {
    // Reproduces: .meas AC vout_max MAX MAG(V(vout))
    //             .meas AC vout_3db param vout_max/sqrt(2)
    //             .meas AC bw_3db FIND freq WHEN mag(V(vout))=(vout_3db)
    const results = runAcMeasurements(
      [
        ".meas AC vout_max MAX MAG(V(vout))",
        ".meas AC vout_3db param vout_max/sqrt(2)",
        ".meas AC bw_3db FIND freq WHEN mag(V(vout))=(vout_3db)",
      ],
      data,
    );
    const bw = results.find((r) => r.name === "bw_3db")!;
    expect(bw.value).not.toBeNull();
    expect(bw.value! / fc).toBeCloseTo(1, 1);
  });

  it("WHEN mag(V(out)) = GAIN/sqrt(2) - threshold references an earlier .meas (spaces around =)", () => {
    const results = runAcMeasurements(
      [
        ".meas AC GAIN FIND mag(V(vout)) AT 10",
        ".meas AC BW WHEN mag(V(vout)) = GAIN/sqrt(2)",
      ],
      data,
    );
    const bw = results.find((r) => r.name === "BW".toLowerCase() || r.name === "BW")!;
    expect(bw.value).not.toBeNull();
    expect(bw.value! / fc).toBeCloseTo(1, 1);
  });

  it("FIND v(vout) AT 60 (bare V → magnitude, space form)", () => {
    const r = evaluateAcMeasurement(".meas AC result1 FIND v(vout) AT 60", data)!;
    // |H(60Hz)| for fc=1k ≈ 1/sqrt(1+0.06^2) ≈ 0.9982
    expect(r.value!).toBeCloseTo(0.9982, 2);
  });

  it("WHEN db(v(vout)) = -3 (spaces around =, db wrapper)", () => {
    const r = evaluateAcMeasurement(".meas AC result2 WHEN db(v(vout)) = -3", data)!;
    expect(r.value! / fc).toBeCloseTo(1, 0);
  });
});

describe("AC domain routing", () => {
  const data = acData([10, 100, 1000], { out: lowpass(1000) });

  it("runAcMeasurements ignores transient-typed directives", () => {
    const results = runAcMeasurements(
      [".meas tran vmax MAX V(out)", ".meas ac g FIND db(V(out)) AT=100"],
      data,
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("g");
  });

  it("an untyped .meas line is not run as AC", () => {
    const results = runAcMeasurements([".meas g FIND db(V(out)) AT=100"], data);
    expect(results).toHaveLength(0);
  });
});
