// Group delay of an AC response (LTspice parity).
//
// Group delay is τ(ω) = −dφ/dω, the negative slope of the phase response with
// respect to angular frequency - the time a narrow-band signal centred at ω is
// delayed by the network. LTspice plots it in seconds. Two subtleties make a
// naive `diff(phase)` wrong, so we handle both here and unit-test them:
//
//   1. Phase comes back wrapped to (−180°, 180°]. A real response that sweeps
//      past ±180° shows a ±360° cliff; differentiating across it yields a giant
//      spurious spike. We first *unwrap* the phase into a continuous curve.
//   2. φ is in degrees and the axis is ordinary frequency f (Hz), not ω. With
//      ω = 2πf and φ_rad = φ_deg·π/180:
//          τ = −dφ_rad/dω = −(π/180)dφ_deg / (2π df) = −dφ_deg / (360·df).
//
// We use a central difference in the interior and one-sided differences at the
// ends, so τ has exactly one value per frequency point. Pure (arrays in, array
// out) and independent of the solver, so it's trivially testable.

/**
 * Unwrap a phase array given in **degrees** so that successive samples never
 * jump more than 180°: whenever the raw step exceeds +180° or −180° a multiple
 * of 360° is added to keep the curve continuous. Returns a new array; the input
 * is not mutated. An empty array yields an empty array.
 */
export function unwrapPhaseDeg(phaseDeg: number[]): number[] {
  if (phaseDeg.length === 0) return [];
  const out = [phaseDeg[0]];
  let offset = 0;
  for (let i = 1; i < phaseDeg.length; i++) {
    let delta = phaseDeg[i] - phaseDeg[i - 1];
    // Fold the raw step into (−180, 180], then accumulate the removed turns.
    while (delta > 180) {
      delta -= 360;
      offset -= 360;
    }
    while (delta < -180) {
      delta += 360;
      offset += 360;
    }
    out.push(phaseDeg[i] + offset);
  }
  return out;
}

/**
 * Group delay in **seconds** at each frequency point, computed as
 * τ = −dφ/dω from the (wrapped) phase-in-degrees and frequency-in-Hz arrays.
 * The phase is unwrapped first. Uses a central difference in the interior and a
 * forward/backward difference at the first/last point. Returns an array the same
 * length as `freqs`. Points where the local frequency step is zero (duplicate
 * frequencies) yield `0` rather than a division blow-up.
 *
 * `freqs` and `phaseDeg` must be the same length; a length < 2 or a mismatch
 * yields an all-zero array of `freqs.length`.
 */
export function groupDelay(freqs: number[], phaseDeg: number[]): number[] {
  const n = freqs.length;
  if (n !== phaseDeg.length || n < 2) return new Array(Math.max(n, 0)).fill(0);
  const phi = unwrapPhaseDeg(phaseDeg);
  const tau = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? 0 : i - 1;
    const hi = i === n - 1 ? n : i + 1;
    const df = freqs[Math.min(hi, n - 1)] - freqs[lo];
    const dphi = phi[Math.min(hi, n - 1)] - phi[lo];
    // `+ 0` normalizes a `-0` result (flat phase) to a plain `0`.
    tau[i] = df === 0 ? 0 : -dphi / (360 * df) + 0;
  }
  return tau;
}

/**
 * Autorange a group-delay series for the Bode lower pane (seconds).
 * Returns null when no finite samples exist.
 */
export function groupDelayYDomain(
  tauSeries: ReadonlyArray<ReadonlyArray<number>>,
): { yMin: number; yMax: number } | null {
  let found = false;
  let rawMin = 0;
  let rawMax = 0;
  for (const series of tauSeries) {
    for (const tau of series) {
      if (!Number.isFinite(tau)) continue;
      if (!found) {
        rawMin = tau;
        rawMax = tau;
        found = true;
      } else {
        rawMin = Math.min(rawMin, tau);
        rawMax = Math.max(rawMax, tau);
      }
    }
  }
  if (!found) return null;
  if (rawMin === rawMax) {
    const pad = Math.max(Math.abs(rawMin) * 0.1, 1e-12);
    return { yMin: rawMin - pad, yMax: rawMax + pad };
  }
  const span = rawMax - rawMin;
  const pad = span * 0.05;
  return { yMin: rawMin - pad, yMax: rawMax + pad };
}
