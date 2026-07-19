// Loop-stability margins from an AC (Bode) response (LTspice parity).
//
// For an open-loop response T(jω) = |T|∠φ swept over frequency:
//
//   • Phase margin  = 180° + φ(f_gc), where f_gc is the *gain crossover* - the
//     frequency where |T| = 0 dB (unity gain). How much extra phase lag the loop
//     can tolerate before it hits −180° and oscillates. Positive = stable.
//   • Gain margin   = −|T(f_pc)| dB, where f_pc is the *phase crossover* - the
//     frequency where φ = −180°. How much more gain the loop can take before the
//     −180° point reaches 0 dB. Positive (dB) = stable.
//
// Both crossovers are found by scanning for the sign change of the relevant
// quantity and **linearly interpolating** the exact crossing (in dB and degrees
// vs. log-frequency, matching how LTspice reads the cursor off the Bode plot),
// so the margin doesn't snap to the nearest swept point. Pure (arrays in,
// numbers out); returns `null` when the response never crosses (no unity-gain
// point, or phase that never reaches −180°) so the caller can show "-".

export interface StabilityMargins {
  /** Phase margin in degrees at the unity-gain (0 dB) crossover, or null. */
  phaseMarginDeg: number | null;
  /** Frequency (Hz) of the gain crossover (|T| = 0 dB), or null. */
  gainCrossoverHz: number | null;
  /** Gain margin in dB at the −180° phase crossover, or null. */
  gainMarginDb: number | null;
  /** Frequency (Hz) of the phase crossover (φ = −180°), or null. */
  phaseCrossoverHz: number | null;
}

/** Fraction t∈[0,1] where a linearly-interpolated `a→b` hits `target`. */
function crossFraction(a: number, b: number, target: number): number {
  const denom = b - a;
  return denom === 0 ? 0 : (target - a) / denom;
}

/**
 * Interpolate the first crossing of `target` in `ys` and return the matching
 * `xs` value, or null if `ys` never straddles `target`. `xs`/`ys` must be the
 * same length. A sample exactly on `target` counts as a crossing.
 */
function firstCrossing(xs: number[], ys: number[], target: number): number | null {
  const n = Math.min(xs.length, ys.length);
  for (let i = 1; i < n; i++) {
    const a = ys[i - 1];
    const b = ys[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const da = a - target;
    const db = b - target;
    if (da === 0) return xs[i - 1];
    if (db === 0) return xs[i];
    if (da < 0 !== db < 0) {
      const t = crossFraction(a, b, target);
      return xs[i - 1] + t * (xs[i] - xs[i - 1]);
    }
  }
  return null;
}

/**
 * Value of `ys` linearly interpolated at the point where `keys` first crosses
 * `target`. Used to read the phase at the gain crossover and the gain at the
 * phase crossover. Returns null when there is no crossing. Interpolation of the
 * frequency axis is done in **log10(f)** so it matches the Bode plot's spacing.
 */
function valueAtCrossing(
  keys: number[],
  ys: number[],
  freqs: number[],
  target: number,
): { value: number; freqHz: number } | null {
  const n = Math.min(keys.length, ys.length, freqs.length);
  for (let i = 1; i < n; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const da = a - target;
    const db = b - target;
    let t: number | null = null;
    if (da === 0) t = 0;
    else if (db === 0) t = 1;
    else if (da < 0 !== db < 0) t = crossFraction(a, b, target);
    if (t === null) continue;
    const value = ys[i - 1] + t * (ys[i] - ys[i - 1]);
    const lf0 = Math.log10(freqs[i - 1]);
    const lf1 = Math.log10(freqs[i]);
    const freqHz = Math.pow(10, lf0 + t * (lf1 - lf0));
    return { value, freqHz };
  }
  return null;
}

/**
 * Compute phase and gain margins from a swept magnitude(dB)/phase(deg) response.
 * `freqs`, `magDb`, `phaseDeg` must be the same length and swept in increasing
 * frequency. Missing crossovers yield null fields.
 */
export function stabilityMargins(
  freqs: number[],
  magDb: number[],
  phaseDeg: number[],
): StabilityMargins {
  const out: StabilityMargins = {
    phaseMarginDeg: null,
    gainCrossoverHz: null,
    gainMarginDb: null,
    phaseCrossoverHz: null,
  };
  const n = Math.min(freqs.length, magDb.length, phaseDeg.length);
  if (n < 2) return out;

  // Gain crossover: |T| = 0 dB → phase margin = 180 + phase there.
  const gc = valueAtCrossing(magDb, phaseDeg, freqs, 0);
  if (gc) {
    out.gainCrossoverHz = gc.freqHz;
    out.phaseMarginDeg = 180 + gc.value;
  }

  // Phase crossover: φ = −180° → gain margin = −gain(dB) there.
  const pc = valueAtCrossing(phaseDeg, magDb, freqs, -180);
  if (pc) {
    out.phaseCrossoverHz = pc.freqHz;
    out.gainMarginDb = -pc.value;
  }

  return out;
}

// Re-export the interpolating crossing finder - handy for other single-target
// Bode readouts (e.g. the −3 dB corner) and independently unit-tested.
export { firstCrossing };
