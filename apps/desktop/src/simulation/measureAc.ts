// LTspice `.meas ac` directive support for AC (frequency-domain) results.
//
// AC measurements share the parser and the axis-generic evaluator from
// `measure.ts`; only the independent axis (frequency, not time) and the signal
// semantics differ. In the AC domain a node voltage is complex, so signals are
// usually wrapped in a magnitude/phase function:
//   .meas ac gain   FIND db(V(out)) AT=1k
//   .meas ac fc     WHEN mag(V(out))=0.707            ; -3 dB corner
//   .meas ac unity  WHEN db(V(out))=0                 ; 0 dB crossing
//   .meas ac pm     FIND vp(V(out)) WHEN db(V(out))=0 ; phase margin source
//   .meas ac bw     TRIG db(V(out))=-3 RISE=1 TARG db(V(out))=-3 FALL=1
// A bare `V(node)` defaults to magnitude (linear), matching LTspice.
//
// Supported wrappers: db, mag (= |·|, also the bare default), ph/phase (degrees),
// re, im. Two-node forms `V(a,b)` subtract the complex phasors before deriving.

import { type FuncDef, type Scope } from "./expr";
import {
  parseMeasDirective,
  evaluateOnAxis,
  safeEvalScalar,
  type CompiledExpr,
  type MeasResult,
} from "./measure";

/** One AC trace: magnitude in dB and phase in degrees across the swept frequencies. */
export interface AcMeasTrace {
  id: string;
  label: string;
  magDb: number[];
  phaseDeg: number[];
}

/** The minimal AC-result shape `.meas ac` needs (a subset of AcResult). */
export interface AcMeasData {
  freqs: number[];
  traces: ReadonlyArray<AcMeasTrace>;
}

interface Complex {
  re: number;
  im: number;
}

/** Reconstruct the complex phasor of an AC trace at sample `i` from its dB/phase. */
function complexAt(trace: AcMeasTrace, i: number): Complex {
  const magLin = Math.pow(10, trace.magDb[i] / 20);
  const ph = (trace.phaseDeg[i] * Math.PI) / 180;
  return { re: magLin * Math.cos(ph), im: magLin * Math.sin(ph) };
}

/** Apply a magnitude/phase wrapper (db/mag/ph/re/im, "" ⇒ magnitude) to a phasor. */
function deriveScalar(func: string, c: Complex): number {
  const mag = Math.hypot(c.re, c.im);
  switch (func) {
    case "db":
      return 20 * Math.log10(mag);
    case "ph":
    case "phase":
      return (Math.atan2(c.im, c.re) * 180) / Math.PI;
    case "re":
      return c.re;
    case "im":
      return c.im;
    case "mag":
    case "":
    default:
      return mag;
  }
}

/** Resolve a node name to its AC trace (by id, then `v(name)` label, then inner). */
function findAcTrace(data: AcMeasData, name: string): AcMeasTrace | null {
  const lower = name.toLowerCase();
  const byId = data.traces.find((t) => t.id.toLowerCase() === lower);
  if (byId) return byId;
  const byLabel = data.traces.find((t) => t.label.toLowerCase() === `v(${lower})`);
  if (byLabel) return byLabel;
  const byInner = data.traces.find((t) => stripVLabel(t.label).toLowerCase() === lower);
  return byInner ?? null;
}

function findAcCurrentTrace(data: AcMeasData, name: string): AcMeasTrace | null {
  const lower = name.trim().toLowerCase();
  return data.traces.find((trace) => trace.label.trim().toLowerCase() === `i(${lower})`)
    ?? data.traces.find((trace) => trace.id.trim().toLowerCase() === `current:${lower}`)
    ?? null;
}

function stripVLabel(label: string): string {
  const m = /^v\(\s*(.*?)\s*\)$/i.exec(label.trim());
  return m ? m[1] : label;
}

// Matches an optionally-wrapped signal: `db(V(out))`, `mag(V(a,b))`, or bare
// `V(out)`. Alt 1 captures [func, kind, arg]; alt 2 (bare) captures [kind, arg].
const AC_SIGNAL_RE =
  /\b(db|mag|ph|phase|re|im)\s*\(\s*([VI])\s*\(\s*([^)]*?)\s*\)\s*\)|\b([VI])\s*\(\s*([^)]*?)\s*\)/gi;

function makeAcGetter(func: string, kind: string, arg: string, data: AcMeasData): (i: number) => number {
  if (kind.toUpperCase() === "I") {
    const current = findAcCurrentTrace(data, arg);
    return current ? (i) => deriveScalar(func, complexAt(current, i)) : () => NaN;
  }
  const parts = arg.split(",").map((p) => p.trim());
  if (parts.length === 2) {
    const a = findAcTrace(data, parts[0]);
    const b = findAcTrace(data, parts[1]);
    if (!a || !b) return () => NaN;
    return (i) => {
      const ca = complexAt(a, i);
      const cb = complexAt(b, i);
      return deriveScalar(func, { re: ca.re - cb.re, im: ca.im - cb.im });
    };
  }
  const t = findAcTrace(data, parts[0]);
  if (!t) return () => NaN;
  return (i) => deriveScalar(func, complexAt(t, i));
}

/**
 * Compile an AC measurement expression mixing wrapped signals (`db(V(out))`,
 * `mag(V(a,b))`, bare `V(out)`) with scalars from `scope` (earlier measurements
 * + circuit params), into a per-frequency-index evaluator.
 */
export function compileAcExpr(expr: string, data: AcMeasData, scope: Scope, funcs: Record<string, FuncDef>): CompiledExpr {
  const getters: Array<(i: number) => number> = [];
  let idx = 0;
  const rewritten = expr.replace(
    AC_SIGNAL_RE,
    (_m: string, fn: string, k1: string, a1: string, k2: string, a2: string) => {
      const func = (fn ?? "").toLowerCase();
      const kind = k1 ?? k2;
      const arg = a1 ?? a2;
      const varName = `__sig${idx++}`;
      getters.push(makeAcGetter(func, kind, arg, data));
      return varName;
    },
  );

  // LTspice exposes the independent variable `freq`/`frequency` to AC
  // measurements (e.g. `.meas ac bw FIND freq WHEN mag(V(out))=0.707`).
  const usesFreq = /\b(freq|frequency)\b/i.test(rewritten);

  if (getters.length === 0 && !usesFreq) {
    const value = safeEvalScalar(rewritten, scope, funcs);
    return { at: () => value, pure: true };
  }

  return {
    pure: false,
    at(i: number) {
      const localScope: Scope = { ...scope };
      if (usesFreq) {
        localScope.freq = data.freqs[i];
        localScope.frequency = data.freqs[i];
      }
      for (let s = 0; s < getters.length; s++) localScope[`__sig${s}`] = getters[s](i);
      return safeEvalScalar(rewritten, localScope, funcs);
    },
  };
}

/** Evaluate one AC-domain measurement against a frequency-swept result. */
export function evaluateAcMeasurement(
  line: string,
  data: AcMeasData,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): MeasResult | null {
  const spec = parseMeasDirective(line);
  if (!spec) return null;
  return evaluateOnAxis(spec, data.freqs, (expr) => compileAcExpr(expr, data, scope, funcs), scope, funcs);
}

/**
 * Run every `.meas ac` directive against an AC result, in order, so later
 * measurements can reference earlier ones by name. Only directives explicitly
 * typed `ac` are evaluated here (untyped/`tran` ones belong to runMeasurements).
 */
export function runAcMeasurements(
  directives: ReadonlyArray<string>,
  data: AcMeasData,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): MeasResult[] {
  const running: Scope = { ...scope };
  const results: MeasResult[] = [];
  for (const line of directives) {
    const spec = parseMeasDirective(line);
    if (!spec || spec.analysis !== "ac") continue;
    const result = evaluateOnAxis(spec, data.freqs, (expr) => compileAcExpr(expr, data, running, funcs), running, funcs);
    results.push(result);
    if (result.value !== null && Number.isFinite(result.value)) {
      running[spec.name.toLowerCase()] = result.value;
    }
  }
  return results;
}
