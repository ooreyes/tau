import { describe, expect, it } from "vitest";
import { waveformSpectrum, windowMainLobeBins } from "./fft";
import type { Spectrum, WindowFn } from "./fft";
import { spectrumInsights } from "./spectrumInsights";

/** Synthetic bins. Rectangular: these fixtures place components exactly on bin
 *  centres, which is the coherent, leakage-free case a rectangular window
 *  describes - so a neighbouring bin really is an independent component. */
function spectrum(magnitude: number[], binWidthHz = 100): Spectrum {
  return {
    frequencies: magnitude.map((_, index) => index * binWidthHz),
    magnitude,
    magnitudeDb: magnitude.map((value) => value > 0 ? 20 * Math.log10(value) : -300),
    phase: magnitude.map(() => 0),
    window: "rectangular",
  };
}

describe("spectrumInsights", () => {
  it("reports calibrated tone, DC, resolution, harmonics, SFDR, THD, and noise floor", () => {
    const magnitudes = new Array<number>(13).fill(0.001);
    magnitudes[0] = 0.1; // DC = -20 dB
    magnitudes[2] = 1; // fundamental = 0 dB at 200 Hz
    magnitudes[4] = 0.1; // H2 = -20 dBc
    magnitudes[5] = 0.05; // non-harmonic spur = -26.02 dBc
    magnitudes[6] = 0.01; // H3 = -40 dBc

    const insight = spectrumInsights(spectrum(magnitudes), { exclusionBins: 0 });

    expect(insight.binWidthHz).toBe(100);
    expect(insight.frequencyResolutionHz).toBe(100);
    expect(insight.dc?.amplitudeDb).toBeCloseTo(-20, 8);
    expect(insight.dominant?.frequencyHz).toBe(200);
    expect(insight.fundamental?.frequencyHz).toBe(200);
    expect(insight.fundamental?.amplitudeDb).toBe(0);
    expect(insight.noiseFloorDb).toBeCloseTo(-60, 8);
    expect(insight.sfdrDb).toBeCloseTo(20, 8); // H2 is the largest spur
    expect(insight.thd?.ratio).toBeCloseTo(Math.hypot(0.1, 0.01, 0.001, 0.001, 0.001), 8);
    expect(insight.thd?.percent).toBeCloseTo(insight.thd!.ratio * 100, 8);
    expect(insight.thdPlusNoise!.ratio).toBeGreaterThan(insight.thd!.ratio);
    expect(insight.harmonics[0]).toMatchObject({ order: 2, frequencyHz: 400 });
    expect(insight.harmonics[0].dBc).toBeCloseTo(-20, 8);
    expect(insight.harmonics[1]).toMatchObject({ order: 3, frequencyHz: 600 });
    expect(insight.harmonics[1].dBc).toBeCloseTo(-40, 8);
  });

  it("uses an explicit weaker fundamental without changing the dominant tone", () => {
    const input = spectrum([0, 0, 1, 0, 0.1, 2, 0, 0, 0.01]);
    const insight = spectrumInsights(input, { fundamentalHz: 210, exclusionBins: 0 });

    expect(insight.dominant?.frequencyHz).toBe(500);
    expect(insight.fundamental?.frequencyHz).toBe(200);
    expect(insight.fundamental?.amplitude).toBe(1);
    expect(insight.sfdrDb).toBeCloseTo(-20 * Math.log10(2), 8);
  });

  it("caps the harmonic table at eight while using all resolvable harmonics for THD", () => {
    const magnitudes = new Array<number>(24).fill(0);
    magnitudes[1] = 1;
    for (let order = 2; order < magnitudes.length; order++) magnitudes[order] = 0.01;

    const insight = spectrumInsights(spectrum(magnitudes), { exclusionBins: 0, maxHarmonics: 99 });

    expect(insight.harmonics).toHaveLength(8);
    expect(insight.harmonics.map((harmonic) => harmonic.order)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(insight.thd?.ratio).toBeCloseTo(Math.sqrt(22) * 0.01, 10);
  });

  it("uses the median eligible bin level for a spur-resistant noise estimate", () => {
    const input = spectrum([0, 0.001, 1, 0.001, 0.01, 0.001, 0.5, 0.001, 0.01, 0.001, 0.001]);
    const insight = spectrumInsights(input, { fundamentalHz: 200, exclusionBins: 0 });

    // The 600 Hz harmonic and isolated bins do not pull the median away from -60 dB.
    expect(insight.noiseFloorDb).toBeCloseTo(-60, 8);
  });

  it("applies a guard band to keep window leakage out of THD+N and the noise floor", () => {
    const magnitudes = new Array<number>(21).fill(0.001);
    magnitudes[0] = 0.01;
    magnitudes[5] = 0.2;
    magnitudes[6] = 1;
    magnitudes[7] = 0.2;
    magnitudes[12] = 0.1;
    const input = spectrum(magnitudes);
    const unguarded = spectrumInsights(input, { fundamentalHz: 600, exclusionBins: 0 });
    const guarded = spectrumInsights(input, { fundamentalHz: 600, exclusionBins: 1 });

    expect(unguarded.thdPlusNoise!.ratio).toBeGreaterThan(guarded.thdPlusNoise!.ratio);
    expect(guarded.noiseFloorDb).toBeCloseTo(-60, 8);
  });

  it("reports finite floor values for a leakage-free pure tone", () => {
    const insight = spectrumInsights(spectrum([0, 0, 1, 0, 0, 0, 0]), { exclusionBins: 0 });

    expect(insight.sfdrDb).toBe(300);
    expect(insight.noiseFloorDb).toBe(-300);
    expect(insight.thd).toMatchObject({ ratio: 0, percent: 0, db: -300 });
    expect(insight.thdPlusNoise).toMatchObject({ ratio: 0, percent: 0, db: -300 });
  });

  it("returns null unsupported metrics for empty, DC-only, and all-invalid spectra", () => {
    const empty = spectrumInsights({ frequencies: [], magnitude: [], magnitudeDb: [], phase: [], window: "rectangular" });
    expect(empty).toMatchObject({
      binWidthHz: null,
      dc: null,
      dominant: null,
      fundamental: null,
      noiseFloorDb: null,
      sfdrDb: null,
      thd: null,
      thdPlusNoise: null,
      harmonics: [],
    });

    const dcOnly = spectrumInsights(spectrum([2]));
    expect(dcOnly.dc?.amplitude).toBe(2);
    expect(dcOnly.fundamental).toBeNull();
    expect(dcOnly.thd).toBeNull();

    const invalid = spectrumInsights({
      frequencies: [0, Number.NaN, 2, 3],
      magnitude: [Number.NaN, 1, -1, Infinity],
      magnitudeDb: [],
      phase: [],
      window: "rectangular",
    });
    expect(invalid.fundamental).toBeNull();
    expect(invalid.binWidthHz).toBeNull();
  });

  it("ignores unequal and non-finite entries and uses median positive spacing", () => {
    const insight = spectrumInsights({
      frequencies: [0, 10, 25, Number.NaN, 55, 75],
      magnitude: [0.1, 1, 0.1, 10, 0.01], // deliberately shorter than frequencies
      magnitudeDb: [],
      phase: [],
      window: "rectangular",
    }, { fundamentalHz: 10, exclusionBins: 0 });

    expect(insight.fundamental?.frequencyHz).toBe(10);
    expect(insight.binWidthHz).toBe(15); // median of 10, 15, 30
    expect(insight.harmonics[0]).toMatchObject({ order: 2, frequencyHz: 25 });
  });

  it("allows callers to limit harmonic rows and choose a finite dB floor", () => {
    const insight = spectrumInsights(spectrum([0, 1, 0, 0, 0]), {
      maxHarmonics: 1,
      exclusionBins: 0,
      dbFloor: -180,
    });

    expect(insight.harmonics).toHaveLength(1);
    expect(insight.harmonics[0].amplitudeDb).toBe(-180);
    expect(insight.thd?.db).toBe(-180);
  });

  it("reads calibrated metrics from waveformSpectrum output", () => {
    const points = 256;
    const times = Array.from({ length: points + 1 }, (_, index) => index / points);
    const values = times.map((time) =>
      0.25
      + 2 * Math.cos(2 * Math.PI * 8 * time)
      + 0.2 * Math.cos(2 * Math.PI * 16 * time));
    const fft = waveformSpectrum(times, values, {
      window: "rectangular",
      points,
      tStart: 0,
      tEnd: 1,
    });

    const insight = spectrumInsights(fft, { exclusionBins: 0 });

    expect(insight.frequencyResolutionHz).toBeCloseTo(1, 10);
    expect(insight.dc?.amplitude).toBeCloseTo(0.25, 8);
    expect(insight.fundamental?.frequencyHz).toBeCloseTo(8, 10);
    expect(insight.fundamental?.amplitude).toBeCloseTo(2, 8);
    expect(insight.fundamental?.amplitudeDb).toBeCloseTo(20 * Math.log10(2), 8);
    expect(insight.harmonics[0]).toMatchObject({ order: 2, frequencyHz: 16 });
    expect(insight.harmonics[0].amplitude).toBeCloseTo(0.2, 8);
    expect(insight.harmonics[0].dBc).toBeCloseTo(-20, 8);
    expect(insight.thd?.ratio).toBeCloseTo(0.1, 8);
  });

  it("resolves harmonics across a 131k-bin spectrum without quadratic scanning", { timeout: 10_000 }, () => {
    const binCount = 131_073;
    const magnitudes = new Array<number>(binCount).fill(0);
    magnitudes[1] = 1;

    const insight = spectrumInsights(spectrum(magnitudes, 1), { exclusionBins: 0 });

    expect(insight.fundamental?.frequencyHz).toBe(1);
    expect(insight.harmonics).toHaveLength(8);
    expect(insight.harmonics[0]).toMatchObject({ order: 2, frequencyHz: 2 });
    expect(insight.harmonics[7]).toMatchObject({ order: 9, frequencyHz: 9 });
    expect(insight.thd).toMatchObject({ ratio: 0, percent: 0, db: -300 });
  });
});

/**
 * Whether a spectrum contains a tone at all.
 *
 * These fixtures are real waveforms put through the real transform, not
 * hand-written bins, because the defect they cover is produced by the window
 * rather than by the signal: a Hann window puts the *full* DC amplitude into
 * bin 1, so a bit-exact-constant 5 V rail used to be reported as a 200 Hz tone
 * with a THD figure and eight harmonics behind it.
 */
describe("spectrumInsights tone detection", () => {
  // A 5 ms transient at 512 steps - the run that produced the defect report.
  const stopTime = 5e-3;
  const times = Array.from({ length: 513 }, (_, i) => (i * stopTime) / 512);
  const analyse = (values: number[], window: WindowFn = "hann") =>
    spectrumInsights(waveformSpectrum(times, values, { window }));

  it("reports no tone for a DC operating point, and no distortion figures with it", () => {
    const insight = analyse(times.map(() => 5));

    expect(insight.fundamental).toBeNull();
    expect(insight.toneRejection).toBe("dc-skirt");
    expect(insight.thd).toBeNull();
    expect(insight.thdPlusNoise).toBeNull();
    expect(insight.sfdrDb).toBeNull();
    expect(insight.harmonics).toEqual([]);
    // The DC term itself is still measured, and the raw peak search still has
    // an answer - it is simply not allowed to be presented as a frequency.
    expect(insight.dc?.amplitude).toBeCloseTo(5, 9);
    expect(insight.dominant?.frequencyHz).toBe(200);
  });

  it.each([
    ["a settled step", (t: number) => 5 * (1 - Math.exp(-t / (stopTime / 20)))],
    ["a step that is still settling", (t: number) => 5 * (1 - Math.exp(-t / stopTime))],
    ["a ramp", (t: number) => (5 * t) / stopTime],
    ["one sample of solver residue on a DC rail", (t: number) => (t === 0 ? 5.00002 : 5)],
  ])("reports no tone for %s", (_name, shape) => {
    const insight = analyse(times.map(shape));
    expect(insight.fundamental).toBeNull();
    expect(insight.toneRejection).toBe("dc-skirt");
    expect(insight.harmonics).toEqual([]);
  });

  it("reports no tone for a flat field of noise with no peak in it", () => {
    let seed = 12345;
    const insight = analyse(times.map(() => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    }));
    expect(insight.fundamental).toBeNull();
    expect(insight.toneRejection).toBe("no-prominent-peak");
  });

  // The over-correction guard: everything above must not cost us a real tone.
  it("still reports the fundamental and harmonics of a genuine sine", () => {
    const insight = analyse(times.map((t) => Math.sin(2 * Math.PI * 2000 * t)));

    expect(insight.toneRejection).toBeNull();
    expect(insight.fundamental?.frequencyHz).toBe(2000);
    expect(insight.fundamental?.amplitude).toBeCloseTo(1, 2);
    expect(insight.harmonics.map((harmonic) => harmonic.frequencyHz)).toEqual([4000, 6000, 8000, 10_000, 12_000, 14_000, 16_000, 18_000]);
    expect(insight.thd!.percent).toBeLessThan(0.1);
  });

  it("measures the distortion of a clipped sine instead of dismissing it as broadband", () => {
    // Symmetric clipping at 0.7 leaves odd harmonics only; H3 must be the
    // largest of them and THD must be a real, non-trivial number.
    const insight = analyse(times.map((t) => Math.max(-0.7, Math.min(0.7, Math.sin(2 * Math.PI * 2000 * t)))));

    expect(insight.fundamental?.frequencyHz).toBe(2000);
    expect(insight.thd!.percent).toBeGreaterThan(5);
    const h3 = insight.harmonics.find((harmonic) => harmonic.order === 3)!;
    const h2 = insight.harmonics.find((harmonic) => harmonic.order === 2)!;
    expect(h3.dBc).toBeGreaterThan(h2.dBc);
  });

  it.each<[WindowFn, number]>([
    ["rectangular", 0],
    ["hann", 1],
    ["hamming", 1],
    ["blackman", 2],
  ])("separates DC from a sine under a %s window (main lobe %i bins)", (window, lobeBins) => {
    expect(windowMainLobeBins(window)).toBe(lobeBins);
    expect(analyse(times.map(() => 5), window).fundamental).toBeNull();
    // Deliberately half a bin off centre (bin width is 200 Hz): the worst case
    // for window leakage, and the one a criterion tuned on exact-bin fixtures
    // would get wrong. Either straddling bin may legitimately win, so the tone
    // only has to land within one bin of the true frequency.
    const offBin = analyse(times.map((t) => Math.sin(2 * Math.PI * 2100 * t)), window);
    expect(offBin.fundamental, `${window} lost an off-bin tone`).not.toBeNull();
    expect(Math.abs(offBin.fundamental!.frequencyHz - 2100)).toBeLessThanOrEqual(200);
  });

  it("takes an explicit fundamental as an assertion and skips the tone test", () => {
    // A caller naming a frequency has knowledge the spectrum does not carry
    // (an authored .four directive, a source's own setting).
    const insight = spectrumInsights(waveformSpectrum(times, times.map(() => 5), { window: "hann" }), {
      fundamentalHz: 1000,
    });
    expect(insight.toneRejection).toBeNull();
    expect(insight.fundamental?.frequencyHz).toBe(1000);
  });
});
