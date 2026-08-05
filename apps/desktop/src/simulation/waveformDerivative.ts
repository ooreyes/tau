// Time derivative / integral of sampled waveforms (LTspice `ddt` / `idt` for
// plot expressions). Pure — no UI/DOM.

export type TimeOp = "ddt" | "idt";

/**
 * Peel whole-expression outer `ddt(…)` / `idt(…)` wrappers (outermost first).
 * Compound forms like `ddt(V(out))+1` are left alone (`ops` empty).
 */
export function peelTimeOps(expr: string): { inner: string; ops: TimeOp[] } {
  let s = expr.trim();
  const ops: TimeOp[] = [];
  for (;;) {
    let op: TimeOp | null = null;
    if (/^ddt\s*\(/i.test(s)) op = "ddt";
    else if (/^idt\s*\(/i.test(s)) op = "idt";
    if (!op || !s.endsWith(")")) break;
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
    if (match !== s.length - 1) break;
    s = s.slice(openIdx + 1, match).trim();
    ops.push(op);
  }
  return { inner: s, ops };
}

/** @deprecated Prefer {@link peelTimeOps}; kept for existing ddt-only call sites. */
export function peelOuterDdt(expr: string): { inner: string; layers: number } {
  const { inner, ops } = peelTimeOps(expr);
  if (ops.length > 0 && ops.every((o) => o === "ddt")) {
    return { inner, layers: ops.length };
  }
  if (ops.length === 0) return { inner, layers: 0 };
  // Mixed / idt-only: do not pretend they are pure ddt peels.
  return { inner: expr.trim(), layers: 0 };
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

/**
 * Trapezoidal running integral of `values` vs `times` (LTspice `idt(x)`, ic=0).
 * `out[0] = 0`; subsequent samples accumulate ∫ v dt.
 */
export function idtSeries(
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
  out[0] = 0;
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const dt = times[i]! - times[i - 1]!;
    const a = values[i - 1]!;
    const b = values[i]!;
    if (dt > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      acc += ((a + b) / 2) * dt;
    }
    out[i] = acc;
  }
  return out;
}
