// LTspice `.meas`/`.measure` directive support for transient results.
//
// Implements the forms actually used in the user's circuits (e.g. deadtime.asc):
//   .meas tran vmax MAX V(vtriangle) FROM=100u TO=200u
//   .meas tran vmin MIN V(vtriangle) FROM=100u TO=200u
//   .meas tran vamp PARAM (vmax-vmin)/2
//   .meas tran tper TRIG V(x) VAL=2.5 RISE=1 TD=100u TARG V(x) VAL=2.5 RISE=2 TD=100u
//   .meas tran freq PARAM 1/tper
//   .meas tran vat  FIND V(out) AT 1m          (also AT=1m)
//   .meas tran t1   WHEN V(out)=2.5            (RISE/FALL/CROSS selectors)
//   .meas tran avg  AVG|RMS|INTEG|PP V(out) FROM=.. TO=..
//
// Measurements chain: a later `PARAM`/aggregate may reference an earlier
// measurement's name (vmax, vmin, tper, …), so they are evaluated in order with
// an accumulating scope seeded by the circuit's `.param` values.

import { evaluateExpression, type FuncDef, type Scope } from "./expr";
import { findCurrentTrace } from "./currents";

/** The minimal transient-result shape `.meas` needs (a subset of AnalysisResult). */
export interface MeasWaveform {
  times: number[];
  traces: ReadonlyArray<{ id: string; label: string; values: number[] }>;
  /** Branch-current waveforms keyed by ref-des, so `I(R1)`/`I(V1)` resolve. */
  /** `terminal` distinguishes the several traces a part with more than one
   *  reports; see `CurrentTrace`. Several entries may share a `ref`. */
  currents?: ReadonlyArray<{ ref: string; label: string; values: ReadonlyArray<number>; terminal?: string }>;
}

export type AggregateKind = "MAX" | "MIN" | "PP" | "AVG" | "RMS" | "INTEG";

/** The analysis domain a `.meas` line targets, or null when the type token is omitted. */
export type MeasAnalysis = "tran" | "ac" | "dc" | "op" | "tf" | "noise" | null;

/** A direction selector for a level crossing. */
export type EdgeKind = "RISE" | "FALL" | "CROSS";

export interface CrossingClause {
  /** Signal/expression whose crossings are searched. */
  expr: string;
  /**
   * Threshold the signal crosses, kept as a raw expression so it can reference
   * earlier measurement names / `.param`s (e.g. `GAIN/sqrt(2)`), evaluated in
   * scope at measurement time rather than eagerly at parse time.
   */
  value: string;
  edge: EdgeKind;
  /** Which crossing to take (1-based); LAST is encoded as Infinity. */
  occurrence: number;
  /** Ignore crossings before this time (LTspice TD=). */
  td: number;
}

export type MeasSpec =
  | { kind: "aggregate"; name: string; analysis: MeasAnalysis; op: AggregateKind; expr: string; from: number | null; to: number | null }
  | { kind: "param"; name: string; analysis: MeasAnalysis; expr: string }
  | { kind: "find"; name: string; analysis: MeasAnalysis; expr: string; at: number }
  | { kind: "when"; name: string; analysis: MeasAnalysis; expr: string | null; cross: CrossingClause }
  | { kind: "trigtarg"; name: string; analysis: MeasAnalysis; trig: CrossingClause; targ: CrossingClause };

export interface MeasResult {
  name: string;
  /** The measured number, or null if it could not be determined. */
  value: number | null;
  /** Time at which the value was found (FIND/WHEN/TRIG-TARG), when applicable. */
  at?: number;
  error?: string;
}

const ANALYSIS_TYPES = new Set(["TRAN", "AC", "DC", "OP", "TF", "NOISE"]);
const AGGREGATES = new Set<AggregateKind>(["MAX", "MIN", "PP", "AVG", "RMS", "INTEG"]);

/** Strip a leading `!` and an optional `.meas`/`.measure` keyword; null if not a meas line. */
function stripMeasKeyword(line: string): string | null {
  const trimmed = line.trim().replace(/^!/, "").trim();
  const m = /^\.?meas(?:ure)?\b\s*(.*)$/i.exec(trimmed);
  return m ? m[1].trim() : null;
}

/** Parse `FROM=1u`, `TO 2m`, `AT=60`, `VAL=2.5`, `TD=100u`, `RISE=2` style options. */
function parseNumericSuffix(raw: string): number {
  // Reuse the expression engine's SI-suffix literal handling.
  return evaluateExpression(raw, {}, {});
}

/**
 * Parse a single `.meas` directive line into a structured spec.
 * Returns null for lines that are not `.meas` directives or are unsupported.
 */
export function parseMeasDirective(line: string): MeasSpec | null {
  const body = stripMeasKeyword(line);
  if (body === null) return null;

  // Tokenize on whitespace; key=value pairs stay glued (no spaces around `=`
  // is the LTspice norm). We also support the space-separated `AT 60` form by
  // peeking ahead during interpretation.
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let i = 0;
  // Optional analysis type (TRAN/AC/DC/…); remembered so the right domain runner
  // picks the directive up (transient vs AC). Omitted ⇒ null (defaults to tran).
  let analysis: MeasAnalysis = null;
  if (tokens[i] && ANALYSIS_TYPES.has(tokens[i].toUpperCase())) {
    analysis = tokens[i].toLowerCase() as MeasAnalysis;
    i++;
  }

  const name = tokens[i++];
  if (!name) return null;

  const opToken = tokens[i]?.toUpperCase();
  if (!opToken) return null;

  // --- TRIG ... TARG ... (timing between two crossings) ----------------------
  if (opToken === "TRIG") {
    const targIndex = tokens.findIndex((t, idx) => idx > i && t.toUpperCase() === "TARG");
    if (targIndex < 0) return null;
    const trig = parseCrossingClause(tokens.slice(i + 1, targIndex));
    const targ = parseCrossingClause(tokens.slice(targIndex + 1));
    if (!trig || !targ) return null;
    return { kind: "trigtarg", name, analysis, trig, targ };
  }

  // --- WHEN <cond> (the measured value is the crossing time) -----------------
  if (opToken === "WHEN") {
    const cross = parseWhenClause(tokens.slice(i + 1));
    if (!cross) return null;
    return { kind: "when", name, analysis, expr: null, cross };
  }

  // --- PARAM <expr> ----------------------------------------------------------
  if (opToken === "PARAM") {
    const expr = tokens.slice(i + 1).join(" ");
    if (!expr) return null;
    return { kind: "param", name, analysis, expr };
  }

  // --- aggregate / FIND <expr> [FROM/TO] [AT] [WHEN] -------------------------
  if (AGGREGATES.has(opToken as AggregateKind) || opToken === "FIND") {
    i++; // consume op
    // The expression is the next token; FROM/TO/AT/WHEN follow.
    const exprTokens: string[] = [];
    while (i < tokens.length && !isKeyword(tokens[i])) {
      exprTokens.push(tokens[i++]);
    }
    const expr = exprTokens.join(" ");
    if (!expr) return null;

    let from: number | null = null;
    let to: number | null = null;
    let at: number | null = null;
    let when: string[] | null = null;

    while (i < tokens.length) {
      const tok = tokens[i];
      const [key, inlineVal] = splitKeyVal(tok);
      const upper = key.toUpperCase();
      if (upper === "FROM") {
        from = parseNumericSuffix(inlineVal ?? tokens[++i]);
        i++;
      } else if (upper === "TO") {
        to = parseNumericSuffix(inlineVal ?? tokens[++i]);
        i++;
      } else if (upper === "AT") {
        at = parseNumericSuffix(inlineVal ?? tokens[++i]);
        i++;
      } else if (upper === "WHEN") {
        when = tokens.slice(i + 1);
        break;
      } else {
        i++; // tolerate unknown modifiers
      }
    }

    if (opToken === "FIND") {
      if (when) {
        const cross = parseWhenClause(when);
        if (!cross) return null;
        return { kind: "when", name, analysis, expr, cross };
      }
      if (at === null) return null;
      return { kind: "find", name, analysis, expr, at };
    }

    return { kind: "aggregate", name, analysis, op: opToken as AggregateKind, expr, from, to };
  }

  return null;
}

const CLAUSE_KEYWORDS = new Set(["FROM", "TO", "AT", "WHEN", "VAL", "TD", "RISE", "FALL", "CROSS", "TARG", "TRIG"]);

function isKeyword(token: string): boolean {
  return CLAUSE_KEYWORDS.has(splitKeyVal(token)[0].toUpperCase());
}

/** Split `FROM=1u` → ["FROM","1u"]; `FROM` → ["FROM", undefined]. */
function splitKeyVal(token: string): [string, string | undefined] {
  const eq = token.indexOf("=");
  if (eq < 0) return [token, undefined];
  return [token.slice(0, eq), token.slice(eq + 1)];
}

/** Parse a TRIG/TARG clause: `<expr> VAL=<v> RISE=<n>|FALL=<n>|CROSS=<n> [TD=<t>]`. */
function parseCrossingClause(tokens: string[]): CrossingClause | null {
  if (tokens.length === 0) return null;
  const exprTokens: string[] = [];
  let i = 0;
  while (i < tokens.length && !isClauseKeyword(tokens[i])) {
    exprTokens.push(tokens[i++]);
  }
  const expr = exprTokens.join(" ");
  if (!expr) return null;

  let value: string | null = null;
  let edge: EdgeKind = "CROSS";
  let occurrence = 1;
  let td = 0;

  while (i < tokens.length) {
    const [key, inlineVal] = splitKeyVal(tokens[i]);
    const upper = key.toUpperCase();
    if (upper === "VAL") {
      value = inlineVal ?? tokens[++i];
      i++;
    } else if (upper === "TD") {
      td = parseNumericSuffix(inlineVal ?? tokens[++i]);
      i++;
    } else if (upper === "RISE" || upper === "FALL" || upper === "CROSS") {
      edge = upper as EdgeKind;
      occurrence = parseOccurrence(inlineVal ?? tokens[++i]);
      i++;
    } else {
      i++;
    }
  }

  if (value === null) {
    // Allow inline `V(x)=2.5` style threshold inside the expression.
    const eq = expr.indexOf("=");
    if (eq > 0) {
      return { expr: expr.slice(0, eq), value: expr.slice(eq + 1), edge, occurrence, td };
    }
    return null;
  }
  return { expr, value, edge, occurrence, td };
}

/** Parse a WHEN clause: `<lhs>=<rhs>` (with optional RISE/FALL/CROSS / TD). */
function parseWhenClause(tokens: string[]): CrossingClause | null {
  if (tokens.length === 0) return null;
  let edge: EdgeKind = "CROSS";
  let occurrence = 1;
  let td = 0;

  const condTokens: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const [key, inlineVal] = splitKeyVal(tokens[i]);
    const upper = key.toUpperCase();
    if (upper === "RISE" || upper === "FALL" || upper === "CROSS") {
      edge = upper as EdgeKind;
      occurrence = parseOccurrence(inlineVal ?? tokens[++i]);
      i++;
    } else if (upper === "TD") {
      td = parseNumericSuffix(inlineVal ?? tokens[++i]);
      i++;
    } else {
      condTokens.push(tokens[i++]);
    }
  }

  const cond = condTokens.join(" ");
  const eq = findTopLevelEquals(cond);
  if (eq < 0) return null;
  const expr = cond.slice(0, eq).trim();
  const value = cond.slice(eq + 1).trim();
  if (!expr || !value) return null;
  return { expr, value, edge, occurrence, td };
}

/** Find a `=` that is a comparison (not part of `<=`, `>=`, `==`, `!=`). */
function findTopLevelEquals(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "=") continue;
    const prev = s[i - 1];
    const next = s[i + 1];
    if (prev === "<" || prev === ">" || prev === "!" || prev === "=") continue;
    if (next === "=") continue;
    return i;
  }
  return -1;
}

function parseOccurrence(raw: string | undefined): number {
  if (!raw) return 1;
  if (raw.toUpperCase() === "LAST") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function isClauseKeyword(token: string): boolean {
  const upper = splitKeyVal(token)[0].toUpperCase();
  return upper === "VAL" || upper === "TD" || upper === "RISE" || upper === "FALL" || upper === "CROSS";
}

// --- signal-expression evaluation -------------------------------------------

// The terminal suffix is a closed set, not `[a-z]?`: `if(cond,a,b)` is a real
// expression function (see expr.ts), and a wildcard letter would read every one
// of them as a current on a part called `cond` and measure NaN.
const SIGNAL_RE = /\b(V|I[bce]?)\s*\(\s*([^)]*?)\s*\)/gi;

/** Resolve a node name to its trace's per-sample values. */
function findTrace(wf: MeasWaveform, name: string): ReadonlyArray<number> | null {
  const lower = name.toLowerCase();
  const byId = wf.traces.find((t) => t.id.toLowerCase() === lower);
  if (byId) return byId.values;
  const byLabel = wf.traces.find((t) => t.label.toLowerCase() === `v(${lower})`);
  if (byLabel) return byLabel.values;
  const byInner = wf.traces.find((t) => stripVLabel(t.label).toLowerCase() === lower);
  return byInner ? byInner.values : null;
}

function stripVLabel(label: string): string {
  const m = /^v\(\s*(.*?)\s*\)$/i.exec(label.trim());
  return m ? m[1] : label;
}

export interface CompiledExpr {
  /** Evaluate the expression at sample index `i`. */
  at(i: number): number;
  /** True if the expression references no signals (a pure scalar). */
  pure: boolean;
}

/** Wrap `evaluateExpression` so a malformed expression yields NaN rather than throwing. */
export function safeEvalScalar(expr: string, scope: Scope, funcs: Record<string, FuncDef>): number {
  return safeEval(expr, scope, funcs);
}

/**
 * Compile a measurement expression that may mix signals (`V(out)`, `V(a,b)`)
 * with scalars from `scope` (earlier measurements + circuit params).
 * `I(ref)` signals resolve against the waveform's branch-current traces; an
 * unknown reference yields NaN.
 */
export function compileExpr(expr: string, wf: MeasWaveform, scope: Scope, funcs: Record<string, FuncDef>): CompiledExpr {
  const getters: Array<(i: number) => number> = [];
  let idx = 0;
  const rewritten = expr.replace(SIGNAL_RE, (_m, kind: string, arg: string) => {
    const varName = `__sig${idx++}`;
    getters.push(makeGetter(kind, arg, wf));
    return varName;
  });

  // LTspice exposes the independent variable `time` to transient measurements.
  const usesTime = /\btime\b/i.test(rewritten);

  if (getters.length === 0 && !usesTime) {
    const value = safeEval(rewritten, scope, funcs);
    return { at: () => value, pure: true };
  }

  return {
    pure: false,
    at(i: number) {
      const localScope: Scope = { ...scope };
      if (usesTime) localScope.time = wf.times[i];
      for (let s = 0; s < getters.length; s++) localScope[`__sig${s}`] = getters[s](i);
      return safeEval(rewritten, localScope, funcs);
    },
  };
}

function makeGetter(kind: string, arg: string, wf: MeasWaveform): (i: number) => number {
  if (kind[0].toUpperCase() === "I") {
    // Branch current by ref-des, e.g. I(R1)/I(V1), or one device terminal,
    // e.g. Ie(Q1). Resolved against the waveform's current traces (both the TS
    // solver and native ngspice supply these); an unknown ref or a terminal the
    // part does not report reads NaN so the measurement reports cleanly.
    const cur = findCurrentTrace(wf.currents, arg, kind.length > 1 ? kind.slice(1) : undefined);
    if (!cur) return () => NaN;
    return (i) => cur.values[i] ?? NaN;
  }
  const parts = arg.split(",").map((p) => p.trim());
  if (parts.length === 2) {
    const a = findTrace(wf, parts[0]);
    const b = findTrace(wf, parts[1]);
    if (!a || !b) return () => NaN;
    return (i) => a[i] - b[i];
  }
  const t = findTrace(wf, parts[0]);
  if (!t) return () => NaN;
  return (i) => t[i];
}

function safeEval(expr: string, scope: Scope, funcs: Record<string, FuncDef>): number {
  try {
    return evaluateExpression(expr, scope, funcs);
  } catch {
    return NaN;
  }
}

// --- measurement evaluation -------------------------------------------------

/** Indices of samples whose time lies within [from, to] (inclusive). */
function windowIndices(times: number[], from: number | null, to: number | null): number[] {
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= lo && times[i] <= hi) out.push(i);
  }
  return out;
}

/** Linear interpolation of a compiled expression at an arbitrary axis position. */
function interpAt(axis: number[], expr: CompiledExpr, x: number): number {
  if (axis.length === 0) return NaN;
  if (x <= axis[0]) return expr.at(0);
  if (x >= axis[axis.length - 1]) return expr.at(axis.length - 1);
  // Binary search for the bracketing interval (axis is ascending).
  let lo = 0;
  let hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t0 = axis[lo];
  const t1 = axis[hi];
  const v0 = expr.at(lo);
  const v1 = expr.at(hi);
  if (t1 === t0) return v0;
  return v0 + ((v1 - v0) * (x - t0)) / (t1 - t0);
}

/**
 * Find the axis position (time or frequency) of the `occurrence`-th crossing of
 * `expr` through `value` in the requested direction, ignoring crossings before
 * `td`. Returns null if no such crossing exists; position is interpolated.
 */
function findCrossing(axis: number[], expr: CompiledExpr, clause: CrossingClause, threshold: number): number | null {
  if (!Number.isFinite(threshold)) return null;
  let count = 0;
  let last: number | null = null;
  for (let i = 1; i < axis.length; i++) {
    if (axis[i] < clause.td) continue;
    const prev = expr.at(i - 1) - threshold;
    const curr = expr.at(i) - threshold;
    const rising = prev < 0 && curr >= 0;
    const falling = prev > 0 && curr <= 0;
    const matches =
      (clause.edge === "RISE" && rising) ||
      (clause.edge === "FALL" && falling) ||
      (clause.edge === "CROSS" && (rising || falling));
    if (!matches) continue;
    const t0 = axis[i - 1];
    const t1 = axis[i];
    const denom = curr - prev;
    const xcross = denom === 0 ? t1 : t0 + ((t1 - t0) * (0 - prev)) / denom;
    count++;
    last = xcross;
    if (count === clause.occurrence) return xcross;
  }
  return clause.occurrence === Infinity ? last : null;
}

function evalAggregateOnAxis(
  axis: number[],
  expr: CompiledExpr,
  spec: Extract<MeasSpec, { kind: "aggregate" }>,
): MeasResult {
  const indices = windowIndices(axis, spec.from, spec.to);
  if (indices.length === 0) return { name: spec.name, value: null, error: "Empty measurement window." };

  if (spec.op === "MAX" || spec.op === "MIN" || spec.op === "PP") {
    let max = -Infinity;
    let min = Infinity;
    let atMax = axis[indices[0]];
    let atMin = axis[indices[0]];
    for (const i of indices) {
      const v = expr.at(i);
      if (!Number.isFinite(v)) continue;
      if (v > max) { max = v; atMax = axis[i]; }
      if (v < min) { min = v; atMin = axis[i]; }
    }
    if (!Number.isFinite(max)) return { name: spec.name, value: null, error: "No finite samples." };
    if (spec.op === "MAX") return { name: spec.name, value: max, at: atMax };
    if (spec.op === "MIN") return { name: spec.name, value: min, at: atMin };
    return { name: spec.name, value: max - min };
  }

  // Trapezoidal integrals over the axis for AVG / RMS / INTEG.
  let integral = 0;
  let sqIntegral = 0;
  for (let k = 1; k < indices.length; k++) {
    const i0 = indices[k - 1];
    const i1 = indices[k];
    const dt = axis[i1] - axis[i0];
    if (dt <= 0) continue;
    const v0 = expr.at(i0);
    const v1 = expr.at(i1);
    integral += ((v0 + v1) / 2) * dt;
    sqIntegral += ((v0 * v0 + v1 * v1) / 2) * dt;
  }
  const duration = axis[indices[indices.length - 1]] - axis[indices[0]];
  if (spec.op === "INTEG") return { name: spec.name, value: integral };
  if (duration <= 0) return { name: spec.name, value: null, error: "Zero-duration window." };
  if (spec.op === "AVG") return { name: spec.name, value: integral / duration };
  return { name: spec.name, value: Math.sqrt(sqIntegral / duration) }; // RMS
}

/**
 * Evaluate one measurement against any independent axis (transient time or AC
 * frequency). `compile` turns a signal expression into a per-index evaluator;
 * the transient and AC domains differ only in that compiler and their axis.
 */
export function evaluateOnAxis(
  spec: MeasSpec,
  axis: number[],
  compile: (expr: string) => CompiledExpr,
  scope: Scope,
  funcs: Record<string, FuncDef> = {},
): MeasResult {
  switch (spec.kind) {
    case "param": {
      const value = safeEval(spec.expr, scope, funcs);
      return { name: spec.name, value: Number.isFinite(value) ? value : null };
    }
    case "aggregate":
      return evalAggregateOnAxis(axis, compile(spec.expr), spec);
    case "find": {
      const value = interpAt(axis, compile(spec.expr), spec.at);
      return { name: spec.name, value: Number.isFinite(value) ? value : null, at: spec.at };
    }
    case "when": {
      const threshold = safeEval(spec.cross.value, scope, funcs);
      const x = findCrossing(axis, compile(spec.cross.expr), spec.cross, threshold);
      if (x === null) return { name: spec.name, value: null, error: "Condition never met." };
      if (spec.expr === null) return { name: spec.name, value: x, at: x };
      const value = interpAt(axis, compile(spec.expr), x);
      return { name: spec.name, value: Number.isFinite(value) ? value : null, at: x };
    }
    case "trigtarg": {
      const xTrig = findCrossing(axis, compile(spec.trig.expr), spec.trig, safeEval(spec.trig.value, scope, funcs));
      const xTarg = findCrossing(axis, compile(spec.targ.expr), spec.targ, safeEval(spec.targ.value, scope, funcs));
      if (xTrig === null || xTarg === null) return { name: spec.name, value: null, error: "TRIG/TARG crossing not found." };
      return { name: spec.name, value: xTarg - xTrig, at: xTarg };
    }
  }
}

/**
 * Evaluate one measurement against a transient result, using and extending the
 * running scope (earlier measurement names + circuit params).
 */
export function evaluateMeasurement(
  spec: MeasSpec,
  wf: MeasWaveform,
  scope: Scope,
  funcs: Record<string, FuncDef> = {},
): MeasResult {
  return evaluateOnAxis(spec, wf.times, (expr) => compileExpr(expr, wf, scope, funcs), scope, funcs);
}

/**
 * Run every `.meas` directive against a transient result, in order, so later
 * measurements can reference earlier ones by name. `scope` seeds the run with
 * circuit `.param` values; each successful measurement is added to the scope.
 */
export function runMeasurements(
  directives: ReadonlyArray<string>,
  wf: MeasWaveform,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): MeasResult[] {
  const running: Scope = { ...scope };
  const results: MeasResult[] = [];
  for (const line of directives) {
    const spec = parseMeasDirective(line);
    if (!spec) continue;
    // Only transient-domain directives belong here; `.meas ac …` is resolved by
    // runAcMeasurements against the AC result and `.meas dc …` by
    // runDcMeasurements against the DC-sweep result (each over its own axis).
    if (spec.analysis !== null && spec.analysis !== "tran") continue;
    const result = evaluateMeasurement(spec, wf, running, funcs);
    results.push(result);
    if (result.value !== null && Number.isFinite(result.value)) {
      running[spec.name.toLowerCase()] = result.value;
    }
  }
  return results;
}
