/**
 * Parametric sweep (`.step`) - re-run an analysis while varying one parameter,
 * source value, or temperature across a list/range of values, producing a
 * family of result curves (LTspice parity).
 *
 * `.step` is used 34× across the user's circuits and is essential for real work
 * (gain vs. component value, Bode family, tolerance studies). LTspice forms:
 *
 *   .step [lin] <param|source> <start> <stop> <increment>   ; linear by increment
 *   .step dec   <param|source> <start> <stop> <pts/decade>  ; log, N points/decade
 *   .step oct   <param|source> <start> <stop> <pts/octave>  ; log, N points/octave
 *   .step <param|source> list <v1> <v2> …                   ; explicit value list
 *   .step temp  <start> <stop> <increment>                  ; temperature sweep
 *
 * where `<param|source>` is either `param <name>`, `temp`, or a bare source
 * designator (`V1`, `I2`). The keyword `param` is optional in LTspice when the
 * name is unambiguous, but we require it so a bare name is read as a source.
 *
 * The parser is pure and enumerates the swept values up front. {@link runParamStep}
 * is a generic runner: for the `param` case it injects the swept value into a
 * copy of the base {@link ParamScope} and invokes a caller-supplied analysis
 * closure, so it reuses whatever solver (`.op`/`.tran`/`.ac`) the caller passes.
 */

import { parseQuantity } from "./quantity";
import { EMPTY_SCOPE, type ParamScope } from "./paramScope";

/** What a `.step` varies. `param` injects into the scope; `source`/`temp` are
 * handled by the caller (override a component value / the analysis temp). */
export type StepKind = "param" | "source" | "temp";

/** Scale keywords are recognized so a source/param name is never mistaken for one. */
const SCALE_KEYWORDS = new Set(["lin", "dec", "oct"]);

/** Guard against a pathological step count (tiny increment over a huge span). */
const MAX_POINTS = 100_001;

export interface StepSpec {
  kind: StepKind;
  /** Parameter or source name. Absent for `temp`. */
  name?: string;
  /** The enumerated swept values, in order. */
  values: number[];
}

/** Parse a token as an SI quantity, returning null instead of throwing. */
function quantityOrNull(token: string): number | null {
  try {
    const v = parseQuantity(token, "");
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Linear enumeration: start → stop stepping by |increment| toward stop. */
function linearValues(start: number, stop: number, increment: number): number[] {
  if (increment === 0) return [];
  const dir = stop >= start ? 1 : -1;
  const inc = Math.abs(increment) * dir;
  // +1e-9 fudge so a clean endpoint (0→10 step 1) includes the final point.
  const count = Math.floor((stop - start) / inc + 1e-9) + 1;
  if (count <= 0 || count > MAX_POINTS) return [];
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) out.push(start + k * inc);
  return out;
}

/** Logarithmic enumeration: `pointsPer` samples per decade (base 10) or octave (base 2). */
function logValues(start: number, stop: number, pointsPer: number, base: 10 | 2): number[] {
  if (!(start > 0) || !(stop > start) || !(pointsPer > 0)) return [];
  const ratio = Math.pow(base, 1 / pointsPer);
  const out: number[] = [];
  let v = start;
  // *(1+eps) so the endpoint isn't dropped to floating-point round-off.
  while (v <= stop * (1 + 1e-9)) {
    out.push(v);
    v *= ratio;
    if (out.length > MAX_POINTS) return [];
  }
  return out;
}

/**
 * Parse a `.step` directive line into a {@link StepSpec} with its values already
 * enumerated, or `null` when the line is not a usable step directive.
 */
export function parseStepDirective(line: string): StepSpec | null {
  const cleaned = line.trim().replace(/^[.!]/, "").trim();
  const tokens = cleaned.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "step") return null;

  let i = 1;
  // Optional leading scale keyword (lin|dec|oct); default is linear.
  let scale = "lin";
  if (i < tokens.length && SCALE_KEYWORDS.has(tokens[i].toLowerCase())) {
    scale = tokens[i].toLowerCase();
    i += 1;
  }
  if (i >= tokens.length) return null;

  // Determine what is being stepped.
  let kind: StepKind;
  let name: string | undefined;
  const head = tokens[i].toLowerCase();
  if (head === "param") {
    kind = "param";
    i += 1;
    if (i >= tokens.length) return null;
    name = tokens[i];
    i += 1;
  } else if (head === "temp") {
    kind = "temp";
    i += 1;
  } else {
    kind = "source";
    name = tokens[i];
    i += 1;
  }

  const rest = tokens.slice(i);
  if (rest.length === 0) return null;

  // Explicit list form.
  if (rest[0].toLowerCase() === "list") {
    const values = rest
      .slice(1)
      .map(quantityOrNull)
      .filter((n): n is number => n !== null);
    if (values.length === 0) return null;
    return { kind, name, values };
  }

  // Range form: <start> <stop> <increment|points>.
  const start = quantityOrNull(rest[0]);
  const stop = quantityOrNull(rest[1]);
  const third = quantityOrNull(rest[2]);
  if (start === null || stop === null || third === null) return null;

  let values: number[];
  if (scale === "dec") values = logValues(start, stop, third, 10);
  else if (scale === "oct") values = logValues(start, stop, third, 2);
  else values = linearValues(start, stop, third);

  if (values.length === 0) return null;
  return { kind, name, values };
}

/**
 * Return a copy of `base` with the param `name` bound to `value` (both the
 * exact and lowercased key, mirroring {@link buildParamScope}'s convention).
 */
export function withStepValue(base: ParamScope, name: string, value: number): ParamScope {
  return {
    scope: { ...base.scope, [name]: value, [name.toLowerCase()]: value },
    funcs: base.funcs,
  };
}

export interface ParamStepRun<T> {
  /** The swept value for this run. */
  value: number;
  /** A human-facing trace label, e.g. `Rload=4700`. */
  label: string;
  /** Whatever the analysis closure returned. */
  result: T;
}

/**
 * Run a `param`-kind step: for each swept value, inject it into a copy of the
 * base scope and invoke `analyze`, collecting a family of results. Throws for
 * non-`param` specs (source/temp stepping is the caller's responsibility, since
 * it overrides a component value or the analysis temperature rather than a
 * scope variable).
 */
export function runParamStep<T>(
  spec: StepSpec,
  baseParams: ParamScope,
  analyze: (params: ParamScope, value: number) => T,
): ParamStepRun<T>[] {
  if (spec.kind !== "param" || !spec.name) {
    throw new Error(`runParamStep only handles param sweeps; got kind="${spec.kind}".`);
  }
  const name = spec.name;
  return spec.values.map((value) => ({
    value,
    label: `${name}=${formatStepValue(value)}`,
    result: analyze(withStepValue(baseParams ?? EMPTY_SCOPE, name, value), value),
  }));
}

/** Render a swept value as a compact, plain literal for a trace label. */
function formatStepValue(v: number): string {
  return Number.isInteger(v) ? String(v) : Number(v.toPrecision(6)).toString();
}

/**
 * Scan a document's directive lines and return the first parseable `.step`
 * spec, or `null`. (LTspice runs nested steps for multiple `.step` lines; we
 * surface the first and leave nesting as a follow-up.)
 */
export function stepFromDirectives(directives: string[]): StepSpec | null {
  for (const directive of directives) {
    const spec = parseStepDirective(directive);
    if (spec) return spec;
  }
  return null;
}
