// Time derivative of a sampled waveform (LTspice `ddt(x)` for plot expressions).
// Central difference interior; one-sided at the ends. Pure — no UI/DOM.

/**
 * If `expr` is wholly wrapped in one or more `ddt(…)` calls, peel them and
 * return the inner expression plus peel count. Compound forms like
 * `ddt(V(out))+1` are left alone (`layers === 0`).
 */
export function peelOuterDdt(expr: string): { inner: string; layers: number } {
  let s = expr.trim();
  let layers = 0;
  for (;;) {
    if (!/^ddt\s*\(/i.test(s) || !s.endsWith(")")) break;
    const openIdx = s.indexOf("(");
    let depth = 0;
    let match = -1;
    for (let i = openIdx; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          match = i;
          break;
        }
      }
    }
    // Only peel when the matching `)` is the last character (whole-expr wrap).
    if (match !== s.length - 1) break;
    s = s.slice(openIdx + 1, match).trim();
    layers++;
  }
  return { inner: s, layers };
}

/**
 * Numerical d/dt of `values` vs `times`. Lengths must match; non-finite
 * samples propagate as NaN. Degenerate `dt === 0` → NaN.
 */
export function ddtSeries(
  times: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  if (n === 0) return out;
  if (times.length !== n) {
    out.fill(Number.NaN);
    return out;
  }
  if (n === 1) {
    out[0] = 0;
    return out;
  }
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      out[i] = Number.NaN;
      continue;
    }
    if (i === 0) {
      const dt = times[1]! - times[0]!;
      const v1 = values[1]!;
      out[i] = dt !== 0 && Number.isFinite(v1) ? (v1 - v) / dt : Number.NaN;
    } else if (i === n - 1) {
      const dt = times[n - 1]! - times[n - 2]!;
      const v0 = values[n - 2]!;
      out[i] = dt !== 0 && Number.isFinite(v0) ? (v - v0) / dt : Number.NaN;
    } else {
      const dt = times[i + 1]! - times[i - 1]!;
      const vPrev = values[i - 1]!;
      const vNext = values[i + 1]!;
      out[i] =
        dt !== 0 && Number.isFinite(vPrev) && Number.isFinite(vNext)
          ? (vNext - vPrev) / dt
          : Number.NaN;
    }
  }
  return out;
}
