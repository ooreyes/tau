import { describe, it, expect } from "vitest";
import { runNoiseMeasurements, noiseResultToWaveform } from "./measureNoise";
import type { NoiseResult } from "./noise";
import type { NoiseSpec } from "./noise";

// A synthetic noise result: a flat output noise floor of 4 nV/√Hz with a
// one-pole rise, swept over a few decades. Hand-chosen so the measurements are
// obvious. inoise = onoise / gain (gain = 10 here).
function flatNoise(): Extract<NoiseResult, { ok: true }> {
  const freqs = [1, 10, 100, 1_000, 10_000];
  const onoise = [4e-9, 4e-9, 5e-9, 8e-9, 8e-9];
  return {
    ok: true,
    spec: { output: "out", source: "V1", sweep: { kind: "dec", points: 1, start: 1, stop: 1e4 } } as unknown as NoiseSpec,
    freqs,
    onoise,
    inoise: onoise.map((v) => v / 10),
    inoiseUnit: "V/√Hz",
    totalOutputNoise: 1e-6,
    totalInputNoise: 1e-7,
    warnings: [],
  };
}

describe("noiseResultToWaveform", () => {
  it("maps frequency to the axis and exposes onoise/inoise traces", () => {
    const wf = noiseResultToWaveform(flatNoise());
    expect(wf.times).toEqual([1, 10, 100, 1_000, 10_000]);
    expect(wf.traces.map((t) => t.label)).toEqual(["onoise", "inoise"]);
    expect(wf.traces[0].values[0]).toBe(4e-9);
    expect(wf.traces[1].values[0]).toBeCloseTo(4e-10, 18);
  });
});

describe("runNoiseMeasurements", () => {
  it("MAX/MIN over the output noise spectrum", () => {
    const res = runNoiseMeasurements(
      [".meas noise nmax MAX V(onoise)", ".meas noise nmin MIN V(onoise)"],
      flatNoise(),
    );
    expect(res.map((r) => [r.name, r.value])).toEqual([
      ["nmax", 8e-9],
      ["nmin", 4e-9],
    ]);
  });

  it("FIND V(onoise) AT=<freq> interpolates on the frequency axis", () => {
    const [r] = runNoiseMeasurements([".meas noise n100 FIND V(onoise) AT=100"], flatNoise());
    expect(r.value).toBeCloseTo(5e-9, 18);
    expect(r.at).toBe(100);
  });

  it("WHEN V(onoise)=<level> returns the frequency at the crossing", () => {
    // onoise rises 5n→8n between 100 Hz and 1 kHz; crosses 6.5n midway.
    const [r] = runNoiseMeasurements([".meas noise corner WHEN V(onoise)=6.5n"], flatNoise());
    expect(r.value).toBeGreaterThan(100);
    expect(r.value).toBeLessThan(1_000);
  });

  it("resolves V(inoise) as well", () => {
    const [r] = runNoiseMeasurements([".meas noise imax MAX V(inoise)"], flatNoise());
    expect(r.value).toBeCloseTo(8e-10, 18);
  });

  it("ignores non-noise domain lines", () => {
    const res = runNoiseMeasurements(
      [".meas tran t MAX V(onoise)", ".meas ac g MAX V(onoise)", ".meas noise n MAX V(onoise)"],
      flatNoise(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("n");
  });

  it("returns no measurements for a failed analysis", () => {
    const failed: NoiseResult = { ok: false, message: "boom", warnings: [] };
    expect(runNoiseMeasurements([".meas noise n MAX V(onoise)"], failed)).toEqual([]);
  });
});
