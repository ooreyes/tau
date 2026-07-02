import { describe, it, expect } from "vitest";
import {
  nextPow2,
  fftRadix2,
  windowValue,
  waveformSpectrum,
  dominantFrequency,
  spectrumThd,
  runWaveformFft,
} from "./fft";
import type { MeasWaveform } from "./measure";

describe("nextPow2", () => {
  it("rounds up to the next power of two", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(1000)).toBe(1024);
  });
  it("clamps non-positive input to 1", () => {
    expect(nextPow2(0)).toBe(1);
    expect(nextPow2(-4)).toBe(1);
  });
});

describe("fftRadix2", () => {
  it("transforms a DC signal to all energy in bin 0", () => {
    const re = [1, 1, 1, 1];
    const im = [0, 0, 0, 0];
    fftRadix2(re, im);
    // X[0] = sum = 4; every other bin cancels.
    expect(re[0]).toBeCloseTo(4, 10);
    expect(im[0]).toBeCloseTo(0, 10);
    for (let k = 1; k < 4; k++) {
      expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 10);
    }
  });

  it("matches a hand-computed 4-point DFT of [1,2,3,4]", () => {
    // X[0]=10, X[1]=-2+2i, X[2]=-2, X[3]=-2-2i.
    const re = [1, 2, 3, 4];
    const im = [0, 0, 0, 0];
    fftRadix2(re, im);
    expect(re[0]).toBeCloseTo(10, 10);
    expect(im[0]).toBeCloseTo(0, 10);
    expect(re[1]).toBeCloseTo(-2, 10);
    expect(im[1]).toBeCloseTo(2, 10);
    expect(re[2]).toBeCloseTo(-2, 10);
    expect(im[2]).toBeCloseTo(0, 10);
    expect(re[3]).toBeCloseTo(-2, 10);
    expect(im[3]).toBeCloseTo(-2, 10);
  });

  it("places a single cosine cycle in bins 1 and N-1", () => {
    const n = 8;
    const re: number[] = [];
    const im: number[] = [];
    for (let i = 0; i < n; i++) {
      re.push(Math.cos((2 * Math.PI * i) / n));
      im.push(0);
    }
    fftRadix2(re, im);
    // cos = (e^+ + e^-)/2 → N/2 in bin 1 and bin N-1, zero elsewhere.
    expect(re[1]).toBeCloseTo(n / 2, 8);
    expect(re[n - 1]).toBeCloseTo(n / 2, 8);
    for (const k of [0, 2, 3, 4, 5, 6]) expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 8);
  });

  it("rejects non-power-of-two lengths", () => {
    expect(() => fftRadix2([1, 2, 3], [0, 0, 0])).toThrow(/power of two/);
  });
});

describe("windowValue", () => {
  it("rectangular is unity everywhere", () => {
    expect(windowValue("rectangular", 0, 8)).toBe(1);
    expect(windowValue("rectangular", 4, 8)).toBe(1);
  });
  it("hann is zero at the ends and one in the middle", () => {
    expect(windowValue("hann", 0, 9)).toBeCloseTo(0, 10);
    expect(windowValue("hann", 8, 9)).toBeCloseTo(0, 10);
    expect(windowValue("hann", 4, 9)).toBeCloseTo(1, 10); // exact center of 9 points
  });
  it("hamming has the textbook 0.08 pedestal at the ends", () => {
    expect(windowValue("hamming", 0, 16)).toBeCloseTo(0.08, 10);
  });
});

describe("waveformSpectrum", () => {
  // Build a uniformly-sampled sine of amplitude A at frequency f over an integer
  // number of cycles, so the tone lands on an exact FFT bin (no leakage).
  function sineWave(amp: number, freq: number, cycles: number, n: number) {
    const period = 1 / freq;
    const duration = cycles * period;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(amp * Math.sin(2 * Math.PI * freq * t));
    }
    // Append the endpoint so tEnd lines up with the full window.
    times.push(duration);
    values.push(0);
    return { times, values, duration };
  }

  it("reads a single sinusoid's true amplitude at its bin (rectangular window)", () => {
    const amp = 2.5;
    const freq = 1000;
    const cycles = 8;
    const n = 256;
    const { times, values, duration } = sineWave(amp, freq, cycles, n);
    const s = waveformSpectrum(times, values, {
      window: "rectangular",
      points: n,
      tStart: 0,
      tEnd: duration,
    });
    // Bin spacing = 1/duration = freq/cycles, so the tone is exactly bin `cycles`.
    const k = cycles;
    expect(s.frequencies[k]).toBeCloseTo(freq, 6);
    expect(s.magnitude[k]).toBeCloseTo(amp, 4);
    // Neighboring bins are essentially empty (no leakage on an exact bin).
    expect(s.magnitude[k - 1]).toBeLessThan(amp * 1e-3);
    expect(s.magnitude[k + 1]).toBeLessThan(amp * 1e-3);
  });

  it("puts a DC offset entirely in bin 0 at its true level", () => {
    const n = 128;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      times.push(i / n);
      values.push(3); // constant 3 V
    }
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: 1 });
    expect(s.frequencies[0]).toBe(0);
    expect(s.magnitude[0]).toBeCloseTo(3, 8);
    for (let k = 1; k < s.magnitude.length; k++) expect(s.magnitude[k]).toBeCloseTo(0, 8);
  });

  it("returns a one-sided spectrum of length N/2 + 1", () => {
    const n = 64;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      times.push(i / n);
      values.push(Math.sin(2 * Math.PI * 4 * (i / n)));
    }
    const s = waveformSpectrum(times, values, { points: n, tStart: 0, tEnd: 1 });
    expect(s.frequencies.length).toBe(n / 2 + 1);
    expect(s.magnitude.length).toBe(n / 2 + 1);
    expect(s.magnitudeDb.length).toBe(n / 2 + 1);
    expect(s.phase.length).toBe(n / 2 + 1);
  });

  it("converts magnitude to dB (a unit tone is ~0 dB)", () => {
    const n = 256;
    const cycles = 10;
    const period = 1 / 1000;
    const duration = cycles * period;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(Math.cos(2 * Math.PI * 1000 * t));
    }
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: duration });
    expect(s.magnitudeDb[cycles]).toBeCloseTo(0, 2); // 20·log10(1) = 0 dB
  });

  it("throws on a non-positive time window", () => {
    expect(() => waveformSpectrum([0, 1], [0, 1], { tStart: 1, tEnd: 1 })).toThrow(/positive/);
  });
});

describe("dominantFrequency", () => {
  it("finds the tone of a noisy-looking signal, ignoring DC offset", () => {
    const n = 256;
    const freq = 500;
    const cycles = 16;
    const duration = cycles / freq;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(5 + 2 * Math.sin(2 * Math.PI * freq * t)); // big DC + smaller tone
    }
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: duration });
    expect(dominantFrequency(s)).toBeCloseTo(freq, 0);
  });
});

describe("spectrumThd", () => {
  // Fundamental at freq with a half-amplitude 2nd harmonic, sampled on exact bins
  // (rectangular window → no leakage), so THD = 0.5 / 1 = 0.5 exactly.
  function distorted(n: number, cycles: number, duration: number) {
    const times: number[] = [];
    const values: number[] = [];
    const f = cycles / duration;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(Math.cos(2 * Math.PI * f * t) + 0.5 * Math.cos(2 * Math.PI * 2 * f * t));
    }
    return { times, values };
  }

  it("computes THD = 50% for a fundamental + half-amplitude 2nd harmonic", () => {
    const n = 256;
    const duration = 1;
    const { times, values } = distorted(n, 8, duration);
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: duration });
    const thd = spectrumThd(s);
    expect(thd.fundamentalHz).toBeCloseTo(8, 6);
    expect(thd.fundamental).toBeCloseTo(1, 4);
    expect(thd.thd).toBeCloseTo(0.5, 3);
    expect(thd.harmonics).toBeGreaterThanOrEqual(1);
  });

  it("reports zero THD for a pure tone", () => {
    const n = 256;
    const duration = 1;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(Math.cos(2 * Math.PI * 10 * t));
    }
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: duration });
    expect(spectrumThd(s).thd).toBeCloseTo(0, 4);
  });

  it("honors an explicit fundamental frequency", () => {
    const n = 256;
    const duration = 1;
    const { times, values } = distorted(n, 8, duration);
    const s = waveformSpectrum(times, values, { window: "rectangular", points: n, tStart: 0, tEnd: duration });
    const thd = spectrumThd(s, 8);
    expect(thd.fundamentalHz).toBeCloseTo(8, 6);
    expect(thd.thd).toBeCloseTo(0.5, 3);
  });
});

describe("runWaveformFft", () => {
  const waveform: MeasWaveform = {
    times: Array.from({ length: 129 }, (_, i) => i / 128),
    traces: [
      {
        id: "out",
        label: "V(out)",
        values: Array.from({ length: 129 }, (_, i) => Math.sin(2 * Math.PI * 4 * (i / 128))),
      },
    ],
    currents: [
      {
        ref: "r1",
        label: "I(R1)",
        values: Array.from({ length: 129 }, (_, i) => 0.5 * Math.cos(2 * Math.PI * 4 * (i / 128))),
      },
    ],
  };

  it("resolves a V(node) signal", () => {
    const s = runWaveformFft(waveform, "V(out)", { window: "rectangular", points: 128, tStart: 0, tEnd: 1 });
    expect(s).not.toBeNull();
    expect(s!.magnitude[4]).toBeCloseTo(1, 3);
  });

  it("resolves a bare node name", () => {
    const s = runWaveformFft(waveform, "out", { window: "rectangular", points: 128, tStart: 0, tEnd: 1 });
    expect(s).not.toBeNull();
    expect(s!.magnitude[4]).toBeCloseTo(1, 3);
  });

  it("resolves an I(ref) current", () => {
    const s = runWaveformFft(waveform, "I(R1)", { window: "rectangular", points: 128, tStart: 0, tEnd: 1 });
    expect(s).not.toBeNull();
    expect(s!.magnitude[4]).toBeCloseTo(0.5, 3);
  });

  it("returns null for an unknown signal", () => {
    expect(runWaveformFft(waveform, "V(nope)")).toBeNull();
  });

  it("resolves a display label whose inner name is not the net id (V(R1·C1) vs id n1)", () => {
    // The scope's signal pickers feed trace *labels* back — nodeName-derived
    // labels like V(R1·C1) never equal the internal net id (regression: the FFT
    // pane showed "No spectrum" for every named net).
    const named: MeasWaveform = {
      ...waveform,
      traces: [{ ...waveform.traces[0], id: "n1", label: "V(R1·C1)" }],
    };
    const s = runWaveformFft(named, "V(R1·C1)", { window: "rectangular", points: 128, tStart: 0, tEnd: 1 });
    expect(s).not.toBeNull();
    expect(s!.magnitude[4]).toBeCloseTo(1, 3);
  });
});
