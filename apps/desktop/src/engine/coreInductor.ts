/**
 * LTspice nonlinear (Chan) magnetic-core inductors → a linear ngspice inductor.
 *
 * LTspice sizes a saturable inductor from core geometry and a B–H curve, e.g.
 *   SYMATTR Value     Hc=16. Bs=.44 Br=.10     (coercive force / saturation / remanence)
 *   SYMATTR Value2    A=0.0000251 Lm=0.0198    (core area m² / magnetic path length m)
 *   SYMATTR SpiceLine Lg=0.0006858 N=1000      (air-gap length m / turns)
 * ngspice (≤46) has no equivalent saturable-core primitive, so the hysteretic
 * waveform can't be reproduced. We instead emit the *unsaturated* small-signal
 * inductance from the magnetic circuit's reluctance — exact in the linear region
 * (the operating point and small-signal AC of most transformer demos) — so the
 * deck builds and runs instead of throwing.
 *
 *   reluctance R = Lg/(µ0·A) + Lm/(µ0·µi·A),  initial permeability µi = Br/(µ0·Hc)
 *   inductance  L = N² / R = N²·µ0·A / (Lg + Lm/µi)
 *
 * A gapped core is gap-dominated (the µi term is negligible); an ungapped core
 * (Lg=0) reduces to L = µ0·µi·N²·A / Lm.
 */
const MU0 = 4 * Math.PI * 1e-7; // 1.25663706…e-6 H/m

/** Parse `key=value` tokens (case-insensitive keys) into a numeric map. */
function parseTokens(spec: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of spec.matchAll(/([A-Za-z]+)\s*=\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g)) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) out.set(m[1].toLowerCase(), v);
  }
  return out;
}

/** True when a value string carries Chan-core parameters rather than a plain `H`. */
export function isCoreInductor(value: string): boolean {
  return /\b(hc|bs|br|lm|lg)\s*=/i.test(value);
}

/**
 * Compute the unsaturated linear inductance (Henries) of an LTspice Chan-core
 * inductor spec, or `null` when the spec lacks the geometry needed to size it
 * (it then falls back to the caller's normal parse).
 */
export function coreInductance(value: string): number | null {
  if (!isCoreInductor(value)) return null;
  const t = parseTokens(value);
  const N = t.get("n");
  const A = t.get("a");
  if (!N || !A || N <= 0 || A <= 0) return null;

  const Lg = t.get("lg") ?? 0;
  const Lm = t.get("lm");
  const Hc = t.get("hc");
  const Br = t.get("br");

  let reluctance = Lg / (MU0 * A);
  // Core path reluctance needs an initial permeability µi = Br/(µ0·Hc).
  if (Lm && Lm > 0 && Hc && Hc > 0 && Br && Br > 0) {
    const mu_i = Br / (MU0 * Hc);
    reluctance += Lm / (MU0 * mu_i * A);
  }
  if (!(reluctance > 0)) return null;
  return (N * N) / reluctance;
}
