import type { Spectrum } from "./fft";

/** A finite, non-negative FFT bin represented in instrument-friendly units. */
export interface SpectrumTone {
  /** Index in the source Spectrum arrays. */
  binIndex: number;
  frequencyHz: number;
  /** One-sided peak amplitude in the source signal's unit. */
  amplitude: number;
  /** 20 log10(amplitude), clamped to the configured finite dB floor. */
  amplitudeDb: number;
}

export interface HarmonicPeak extends SpectrumTone {
  /** Harmonic order: 2 is the second harmonic, 3 the third, and so on. */
  order: number;
  /** Amplitude relative to the fundamental, in dBc. */
  dBc: number;
}

export interface DistortionMetric {
  ratio: number;
  percent: number;
  db: number;
}

export interface SpectrumInsights {
  /** Median spacing between adjacent finite, increasing frequency bins. */
  binWidthHz: number | null;
  /** FFT frequency resolution. Equal to binWidthHz for an un-interpolated FFT. */
  frequencyResolutionHz: number | null;
  dc: SpectrumTone | null;
  /** Largest non-DC spectral component. */
  dominant: SpectrumTone | null;
  /** Explicit requested fundamental, or the dominant component by default. */
  fundamental: SpectrumTone | null;
  /** Median per-bin dB level after excluding DC, fundamental, and harmonics. */
  noiseFloorDb: number | null;
  /** Fundamental-to-largest-spur ratio. Harmonics count as spurs. */
  sfdrDb: number | null;
  /** RSS of resolvable harmonic peaks divided by fundamental amplitude. */
  thd: DistortionMetric | null;
  /** Bin-domain RSS of all non-DC energy outside the fundamental guard band. */
  thdPlusNoise: DistortionMetric | null;
  /** Harmonic peaks from the second harmonic upward, capped by maxHarmonics. */
  harmonics: HarmonicPeak[];
}

export interface SpectrumInsightOptions {
  /** Fundamental hint in Hz. The closest finite bin is used. */
  fundamentalHz?: number;
  /** Maximum harmonic rows to return. Defaults to 8; clamped to 0…8. */
  maxHarmonics?: number;
  /**
   * Bins on either side of tones excluded from noise estimates. Defaults to 2,
   * enough to reject the main lobe of common Hann/Blackman-window spectra.
   * Callers using a rectangular, coherent FFT may set this to 0.
   */
  exclusionBins?: number;
  /** Finite display floor used for zero amplitudes and zero distortion. */
  dbFloor?: number;
}

interface Bin extends SpectrumTone {}

const DEFAULT_DB_FLOOR = -300;

function amplitudeDb(amplitude: number, floor: number): number {
  return amplitude > 0 ? Math.max(floor, 20 * Math.log10(amplitude)) : floor;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function distortion(ratio: number, floor: number): DistortionMetric {
  return {
    ratio,
    percent: ratio * 100,
    db: ratio > 0 ? Math.max(floor, 20 * Math.log10(ratio)) : floor,
  };
}

function closestBin(bins: Bin[], targetHz: number): Bin | null {
  let closest: Bin | null = null;
  let distance = Infinity;
  for (const bin of bins) {
    const nextDistance = Math.abs(bin.frequencyHz - targetHz);
    if (nextDistance < distance) {
      closest = bin;
      distance = nextDistance;
    }
  }
  return closest;
}

function strongest(bins: Bin[]): Bin | null {
  let best: Bin | null = null;
  for (const bin of bins) {
    if (!best || bin.amplitude > best.amplitude) best = bin;
  }
  return best;
}

function markGuard(excluded: Set<number>, binIndex: number, radius: number, length: number): void {
  for (let offset = -radius; offset <= radius; offset++) {
    const index = binIndex + offset;
    if (index >= 0 && index < length) excluded.add(index);
  }
}

/**
 * Derive instrument-grade summary values from an FFT amplitude spectrum.
 *
 * Definitions and limits:
 * - The fundamental defaults to the largest non-DC bin. A supplied hint is
 *   snapped to the closest finite non-DC bin.
 * - Harmonics are the closest available bins to integer multiples of the
 *   snapped fundamental. THD is their root-sum-square amplitude / fundamental.
 * - SFDR includes harmonic distortion as spurious energy, but excludes DC and
 *   the configurable fundamental guard band.
 * - Noise floor is the median (robust against isolated spurs) per-bin dB level
 *   after excluding DC, the fundamental, and every resolvable harmonic through
 *   Nyquist, including each tone's guard band.
 * - THD+N is a bin-domain estimate: RSS of all non-DC bins outside the
 *   fundamental guard band / fundamental. It is exact for coherent rectangular
 *   spectra and otherwise depends on the caller choosing a guard band suitable
 *   for the FFT window. Spectrum does not carry window ENBW, so this function
 *   deliberately does not claim a calibrated broadband noise-density result.
 *
 * Malformed, unequal, empty, negative-magnitude, and non-finite entries are
 * ignored. Metrics that cannot be supported by the remaining bins are null.
 */
export function spectrumInsights(
  spectrum: Spectrum,
  options: SpectrumInsightOptions = {},
): SpectrumInsights {
  const floor = Number.isFinite(options.dbFloor) ? options.dbFloor! : DEFAULT_DB_FLOOR;
  const exclusionBins = Number.isFinite(options.exclusionBins)
    ? Math.max(0, Math.floor(options.exclusionBins!))
    : 2;
  const maxHarmonics = Number.isFinite(options.maxHarmonics)
    ? Math.min(8, Math.max(0, Math.floor(options.maxHarmonics!)))
    : 8;
  const length = Math.min(spectrum.frequencies.length, spectrum.magnitude.length);
  const bins: Bin[] = [];
  for (let index = 0; index < length; index++) {
    const frequencyHz = spectrum.frequencies[index];
    const amplitude = spectrum.magnitude[index];
    if (!Number.isFinite(frequencyHz) || frequencyHz < 0) continue;
    if (!Number.isFinite(amplitude) || amplitude < 0) continue;
    bins.push({
      binIndex: index,
      frequencyHz,
      amplitude,
      amplitudeDb: amplitudeDb(amplitude, floor),
    });
  }

  const spacings: number[] = [];
  for (let index = 1; index < bins.length; index++) {
    const spacing = bins[index].frequencyHz - bins[index - 1].frequencyHz;
    if (Number.isFinite(spacing) && spacing > 0) spacings.push(spacing);
  }
  const binWidthHz = median(spacings);
  const dc = bins.find((bin) => bin.frequencyHz === 0) ?? null;
  const nonDc = bins.filter((bin) => bin.frequencyHz > 0);
  const dominant = strongest(nonDc);
  const hintedFundamental = Number.isFinite(options.fundamentalHz) && options.fundamentalHz! > 0
    ? closestBin(nonDc, options.fundamentalHz!)
    : null;
  const fundamental = hintedFundamental ?? dominant;

  const empty: SpectrumInsights = {
    binWidthHz,
    frequencyResolutionHz: binWidthHz,
    dc,
    dominant,
    fundamental,
    noiseFloorDb: null,
    sfdrDb: null,
    thd: null,
    thdPlusNoise: null,
    harmonics: [],
  };
  if (!fundamental || !(fundamental.frequencyHz > 0) || !(fundamental.amplitude > 0)) return empty;

  const nyquistHz = bins.reduce((maximum, bin) => Math.max(maximum, bin.frequencyHz), 0);
  const harmonicBins: Array<{ order: number; bin: Bin }> = [];
  const usedHarmonicIndices = new Set<number>();
  for (let order = 2; order * fundamental.frequencyHz <= nyquistHz; order++) {
    const bin = closestBin(nonDc, order * fundamental.frequencyHz);
    if (!bin || bin.binIndex === fundamental.binIndex || usedHarmonicIndices.has(bin.binIndex)) continue;
    usedHarmonicIndices.add(bin.binIndex);
    harmonicBins.push({ order, bin });
  }

  const harmonics = harmonicBins.slice(0, maxHarmonics).map(({ order, bin }) => ({
    ...bin,
    order,
    dBc: bin.amplitudeDb - fundamental.amplitudeDb,
  }));

  const fundamentalGuard = new Set<number>();
  if (dc) markGuard(fundamentalGuard, dc.binIndex, 0, length);
  markGuard(fundamentalGuard, fundamental.binIndex, exclusionBins, length);

  const spur = strongest(bins.filter((bin) => !fundamentalGuard.has(bin.binIndex)));
  const sfdrDb = spur ? fundamental.amplitudeDb - spur.amplitudeDb : null;

  const harmonicSumSq = harmonicBins.reduce((sum, { bin }) => sum + bin.amplitude * bin.amplitude, 0);
  const thd = harmonicBins.length > 0
    ? distortion(Math.sqrt(harmonicSumSq) / fundamental.amplitude, floor)
    : null;

  const residualBins = bins.filter((bin) => !fundamentalGuard.has(bin.binIndex));
  const residualSumSq = residualBins.reduce((sum, bin) => sum + bin.amplitude * bin.amplitude, 0);
  const thdPlusNoise = residualBins.length > 0
    ? distortion(Math.sqrt(residualSumSq) / fundamental.amplitude, floor)
    : null;

  const noiseExclusions = new Set(fundamentalGuard);
  for (const { bin } of harmonicBins) markGuard(noiseExclusions, bin.binIndex, exclusionBins, length);
  const noiseLevels = bins
    .filter((bin) => !noiseExclusions.has(bin.binIndex))
    .map((bin) => bin.amplitudeDb);

  return {
    ...empty,
    noiseFloorDb: median(noiseLevels),
    sfdrDb,
    thd,
    thdPlusNoise,
    harmonics,
  };
}
