import { windowMainLobeBins, type Spectrum } from "./fft";

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

/**
 * Why the spectrum was judged to contain no tone. See {@link spectrumInsights}
 * for the test each one comes from.
 */
export type ToneRejection =
  /** Nothing above DC carries any amplitude at all. */
  | "no-energy"
  /** The strongest resolvable bin cannot be told apart from DC and its skirt. */
  | "dc-skirt"
  /** No bin stands out from the general level of the band. */
  | "no-prominent-peak";

export interface SpectrumInsights {
  /** Median spacing between adjacent finite, increasing frequency bins. */
  binWidthHz: number | null;
  /** FFT frequency resolution. Equal to binWidthHz for an un-interpolated FFT. */
  frequencyResolutionHz: number | null;
  dc: SpectrumTone | null;
  /**
   * Largest non-DC bin. A raw peak search that always returns something for a
   * non-empty spectrum - it is the *measurement*, not the *judgement*. Use
   * {@link SpectrumInsights.fundamental} for anything the user reads as a
   * frequency.
   */
  dominant: SpectrumTone | null;
  /**
   * The component every distortion figure below is referred to: an explicitly
   * requested fundamental, or the dominant bin once it has passed the tone
   * test. Null when the spectrum carries no tone, in which case
   * {@link SpectrumInsights.toneRejection} says why and every distortion
   * figure is null with it.
   */
  fundamental: SpectrumTone | null;
  /** Why no fundamental was identified. Null when one was. */
  toneRejection: ToneRejection | null;
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

/** Closest frequency in an ascending bin array, found in O(log n). */
function closestBin(bins: Bin[], targetHz: number): Bin | null {
  if (bins.length === 0) return null;
  let low = 0;
  let high = bins.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (bins[middle].frequencyHz < targetHz) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return bins[0];
  if (low === bins.length) return bins[bins.length - 1];
  const before = bins[low - 1];
  const after = bins[low];
  return targetHz - before.frequencyHz <= after.frequencyHz - targetHz ? before : after;
}

function strongest(bins: Bin[]): Bin | null {
  let best: Bin | null = null;
  for (const bin of bins) {
    if (!best || bin.amplitude > best.amplitude) best = bin;
  }
  return best;
}

/**
 * A candidate must clear the surrounding continuum by this much (in amplitude)
 * to count as a tone: an order of magnitude, i.e. 20 dB.
 *
 * The bar is not tuned against a corpus, it is what the number it guards has to
 * mean. THD, THD+N and SFDR are all *ratios to the fundamental*; if the
 * fundamental is only a couple of dB above the typical bin, those ratios are
 * measuring the background against itself and the answer is noise dressed as a
 * measurement. A factor of ten is the point past which the peak, and not the
 * band it sits in, dominates the ratio. It is deliberately loose - it exists to
 * reject "the tallest blade of grass in a flat field", not to grade real tones,
 * which clear it by 20-90 dB across the fixtures in the "tone detection" tests.
 */
const TONE_PROMINENCE_RATIO = 10;

interface ToneAssessment {
  fundamental: Bin | null;
  rejection: ToneRejection | null;
}

/**
 * Decide whether a spectrum contains a tone at all, and if so which bin it is.
 *
 * The transform of a *step* - which is what a settled DC circuit's transient
 * looks like - has energy in every bin, so a plain "largest bin above DC" peak
 * search always names a frequency, and for a DC circuit that frequency is a
 * fiction. What separates a step from a periodic signal in the spectrum is
 * shape, not level:
 *
 *   - A sinusoid is *localised*. All of its energy is inside its own main lobe,
 *     whose width is a property of the window, not of the signal. Away from
 *     that lobe the spectrum collapses to the window's leakage floor.
 *   - A step, a ramp, an RC settle - anything aperiodic - is a *skirt*: a
 *     smooth continuum that decays away from DC and never comes back up. Its
 *     largest bin is therefore always the first one next to DC, and it is
 *     always smaller than DC itself, because a skirt is what is left over from
 *     the DC term rather than a thing in its own right.
 *
 * So a bin is only a tone when it is separable from DC and prominent above the
 * continuum:
 *
 *   Rule 0 - it must carry amplitude at all.
 *   Rule A - it must be *resolvable from DC*. Bins within the window's main
 *            lobe of bin 0 hold DC's own energy and can never be an independent
 *            component (a Hann window puts the full DC amplitude into bin 1 -
 *            that is where the phantom "200 Hz tone" on a DC circuit came
 *            from). Beyond that lobe, a candidate is separable only if a gap of
 *            at least one clear bin exists between DC's lobe and its own;
 *            otherwise the two overlap and the only remaining evidence is
 *            level - a real component adjacent to DC has to be *larger* than
 *            DC, because window leakage is never larger than what it leaks
 *            from.
 *   Rule B - it must stand {@link TONE_PROMINENCE_RATIO} above the median bin
 *            of the resolvable band, so a flat field of numerical noise does
 *            not get a fundamental picked out of it.
 *
 * Limits, stated plainly: under a rectangular window a non-coherent tone's
 * skirt decays at the same 6 dB/octave a step's does, so Rule A carries that
 * case alone. A tone with fewer than roughly `2·mainLobe + 2` cycles in the
 * record is judged by level against DC (Rule A's fallback), which is the right
 * call - at that point the FFT genuinely cannot separate it from a drift.
 */
function assessTone(nonDc: Bin[], dc: Bin | null, mainLobeBins: number): ToneAssessment {
  // A tone need not land on a bin centre, so its own lobe is one bin wider
  // than the DC term's, which always does.
  const toneLobeBins = mainLobeBins + 1;
  const resolvable = nonDc.filter((bin) => bin.binIndex > mainLobeBins);
  const candidate = strongest(resolvable);
  if (!candidate || !(candidate.amplitude > 0)) return { fundamental: null, rejection: "no-energy" };

  const clearOfDcLobe = resolvable.some(
    (bin) => bin.binIndex <= candidate.binIndex - toneLobeBins,
  );
  if (!clearOfDcLobe && candidate.amplitude <= (dc?.amplitude ?? 0)) {
    return { fundamental: null, rejection: "dc-skirt" };
  }

  const background = median(resolvable.map((bin) => bin.amplitude)) ?? 0;
  if (background > 0 && candidate.amplitude < background * TONE_PROMINENCE_RATIO) {
    return { fundamental: null, rejection: "no-prominent-peak" };
  }
  return { fundamental: candidate, rejection: null };
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
 * - The fundamental is the largest non-DC bin *if that bin passes the tone test
 *   in {@link assessTone}*; a spectrum with no tone in it (a settled DC
 *   operating point, a step, an RC settle) reports `fundamental: null`, a
 *   `toneRejection` reason, and no distortion figures at all, rather than
 *   naming the loudest bin of its own window leakage. A supplied
 *   `fundamentalHz` hint is the caller asserting the fundamental and skips the
 *   test; it is snapped to the closest finite non-DC bin.
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
  // Malformed spectra may arrive out of order. Keep source indices for guards,
  // but sort a separate view so repeated harmonic lookup remains logarithmic.
  const frequencyBins = [...nonDc].sort(
    (a, b) => a.frequencyHz - b.frequencyHz || a.binIndex - b.binIndex,
  );
  const dominant = strongest(nonDc);
  const hintedFundamental = Number.isFinite(options.fundamentalHz) && options.fundamentalHz! > 0
    ? closestBin(frequencyBins, options.fundamentalHz!)
    : null;
  const assessed = hintedFundamental
    ? { fundamental: hintedFundamental, rejection: null }
    : assessTone(nonDc, dc, windowMainLobeBins(spectrum.window));
  const fundamental = assessed.fundamental;

  const empty: SpectrumInsights = {
    binWidthHz,
    frequencyResolutionHz: binWidthHz,
    dc,
    dominant,
    fundamental,
    toneRejection: assessed.rejection,
    // A band-level noise estimate does not need a fundamental to mean
    // something, so it survives a toneless spectrum. Every *ratio to the
    // fundamental* below does not, and stays null.
    noiseFloorDb: median(nonDc.map((bin) => bin.amplitudeDb)),
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
    const bin = closestBin(frequencyBins, order * fundamental.frequencyHz);
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
