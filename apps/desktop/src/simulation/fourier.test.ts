import { describe, expect, it } from "vitest";
import { parseFourDirective, computeFourier, runFourier } from "./fourier";
import type { MeasWaveform } from "./measure";

/** Sample `f(t)` at `n+1` uniform points over one period `T = 1/freq` (inclusive). */
function samplePeriod(freq: number, n: number, f: (t: number) => number) {
  const T = 1 / freq;
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n) * T;
    times.push(t);
    values.push(f(t));
  }
  return { times, values };
}

const TWO_PI = 2 * Math.PI;

describe("parseFourDirective", () => {
  it("parses freq + single output with default harmonics", () => {
    expect(parseFourDirective(".four 1k V(out)")).toEqual({
      freq: 1000, harmonics: 10, outputs: ["V(out)"],
    });
  });

  it("reads an explicit harmonic count and multiple outputs", () => {
    expect(parseFourDirective(".four 1MEG 5 V(a) V(b)")).toEqual({
      freq: 1e6, harmonics: 5, outputs: ["V(a)", "V(b)"],
    });
  });

  it("consumes [Nharmonics] [Nperiods] but always uses the last period", () => {
    // 60 Hz, 9 harmonics, 3 periods (periods accepted but unused), output V(out).
    expect(parseFourDirective("!.four 60 9 3 V(out)")).toEqual({
      freq: 60, harmonics: 9, outputs: ["V(out)"],
    });
  });

  it("returns null for non-.four directives and missing parts", () => {
    expect(parseFourDirective(".tran 1m")).toBeNull();
    expect(parseFourDirective(".four")).toBeNull();
    expect(parseFourDirective(".four 1k")).toBeNull(); // no output
    expect(parseFourDirective(".four 0 V(out)")).toBeNull(); // non-positive freq
  });
});

describe("computeFourier", () => {
  it("extracts the DC component of a constant signal", () => {
    const { times, values } = samplePeriod(1000, 100, () => 2.5);
    const r = computeFourier(times, values, 1000);
    expect(r.dc).toBeCloseTo(2.5, 6);
    expect(r.harmonics[0]).toMatchObject({ harmonic: 0, frequency: 0 });
    expect(r.harmonics[0].magnitude).toBeCloseTo(2.5, 6);
    expect(r.harmonics[1].magnitude).toBeCloseTo(0, 4); // ~no fundamental
    expect(r.thd).toBeCloseTo(0, 4);
  });

  it("gives a unit fundamental and 90° phase for a pure sine", () => {
    const f = 1000;
    const { times, values } = samplePeriod(f, 4000, (t) => Math.sin(TWO_PI * f * t));
    const r = computeFourier(times, values, f);
    expect(r.dc).toBeCloseTo(0, 4);
    expect(r.harmonics[1].magnitude).toBeCloseTo(1, 3); // A = 1
    expect(r.harmonics[1].phase).toBeCloseTo(90, 1); // x = sin = mag·cos(θ-90°)
    expect(r.harmonics[2].magnitude).toBeCloseTo(0, 3); // no 2nd harmonic
    expect(r.thd).toBeCloseTo(0, 3);
  });

  it("gives 0° phase for a pure cosine", () => {
    const f = 1000;
    const { times, values } = samplePeriod(f, 4000, (t) => Math.cos(TWO_PI * f * t));
    const r = computeFourier(times, values, f);
    expect(r.harmonics[1].magnitude).toBeCloseTo(1, 3);
    expect(r.harmonics[1].phase).toBeCloseTo(0, 1);
  });

  it("separates a DC offset from the fundamental amplitude", () => {
    const f = 500;
    const { times, values } = samplePeriod(f, 4000, (t) => 2 + 3 * Math.sin(TWO_PI * f * t));
    const r = computeFourier(times, values, f);
    expect(r.dc).toBeCloseTo(2, 3);
    expect(r.harmonics[1].magnitude).toBeCloseTo(3, 2);
  });

  it("computes THD for fundamental + half-amplitude 2nd harmonic", () => {
    // x = sin(ωt) + 0.5·sin(2ωt): fundamental 1, 2nd harmonic 0.5 → THD = 50%.
    const f = 1000;
    const { times, values } = samplePeriod(f, 4000, (t) =>
      Math.sin(TWO_PI * f * t) + 0.5 * Math.sin(2 * TWO_PI * f * t),
    );
    const r = computeFourier(times, values, f);
    expect(r.harmonics[1].magnitude).toBeCloseTo(1, 2);
    expect(r.harmonics[2].magnitude).toBeCloseTo(0.5, 2);
    expect(r.harmonics[2].normalized).toBeCloseTo(0.5, 2);
    expect(r.thd).toBeCloseTo(0.5, 2);
  });

  it("analyzes only the last period when several periods are present", () => {
    // Two periods of a 1 kHz sine; the analyzer should still report A = 1.
    const f = 1000;
    const T = 1 / f;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= 8000; i += 1) {
      const t = (i / 8000) * (2 * T);
      times.push(t);
      values.push(Math.sin(TWO_PI * f * t));
    }
    const r = computeFourier(times, values, f);
    expect(r.harmonics[1].magnitude).toBeCloseTo(1, 3);
  });

  it("throws on mismatched / insufficient input", () => {
    expect(() => computeFourier([0, 1], [0], 1000)).toThrow();
    expect(() => computeFourier([0], [0], 1000)).toThrow();
    expect(() => computeFourier([0, 1], [0, 1], 0)).toThrow();
  });
});

describe("runFourier", () => {
  const f = 1000;
  const { times, values } = samplePeriod(f, 4000, (t) => Math.sin(TWO_PI * f * t));
  const waveform: MeasWaveform = {
    times,
    traces: [{ id: "out", label: "out", values }],
    currents: [{ ref: "R1", label: "I(R1)", values: values.map((v) => v / 1000) }],
  };

  it("resolves V(node) outputs and analyzes each", () => {
    const results = runFourier(waveform, { freq: f, harmonics: 10, outputs: ["V(out)"] });
    expect(results).toHaveLength(1);
    expect(results[0].output).toBe("V(out)");
    expect(results[0].harmonics[1].magnitude).toBeCloseTo(1, 3);
  });

  it("resolves I(ref) currents", () => {
    const results = runFourier(waveform, { freq: f, harmonics: 10, outputs: ["I(R1)"] });
    expect(results[0].harmonics[1].magnitude).toBeCloseTo(0.001, 5);
  });

  it("skips unresolved signals", () => {
    const results = runFourier(waveform, { freq: f, harmonics: 10, outputs: ["V(nope)", "V(out)"] });
    expect(results.map((r) => r.output)).toEqual(["V(out)"]);
  });
});
