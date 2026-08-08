/**
 * Behavioral (arbitrary) source `B` support.
 *
 * LTspice/ngspice B-sources carry their value as `V=<expr>` or `I=<expr>`,
 * where `<expr>` is an arbitrary expression of node voltages `V(node)` /
 * `V(a,b)`, branch currents `I(dev)`, `time`, and parameters. The native
 * ngspice engine evaluates these directly (its B-source syntax matches
 * LTspice's), so for the real engine we only normalize the spec text.
 *
 * The interim TypeScript MNA solver is linear-only. To still simulate the very
 * common *affine* behavioral sources used as ideal summers/amplifiers
 * (`V=V(a)-V(b)`, `V=2*V(in)+1`), {@link linearizeBehavioral} reduces an
 * expression to `constant + Σ coeff·V(node)` by symbolic perturbation, or
 * returns `null` when the expression is dynamic (`time`), current-dependent
 * (`I(...)`), or genuinely nonlinear - those need the native engine.
 *
 * Pure functions over numeric scopes - trivially unit-testable.
 */

import { evaluateExpression, parse as parseExpression, type Scope, type FuncDef } from "./expr";

export type BehavioralType = "V" | "I";

export interface BehavioralSpec {
  /** Output quantity the source imposes between its p/n pins. */
  type: BehavioralType;
  /** Right-hand-side expression (no leading `V=`/`I=`). */
  expr: string;
}

/**
 * Parse a behavioral value `"V=<expr>"` / `"I=<expr>"` (case-insensitive,
 * whitespace tolerant). A bare expression with no prefix defaults to `V=`.
 */
export function parseBehavioral(value: string): BehavioralSpec {
  const trimmed = value.trim();
  const m = /^([VI])\s*=(.*)$/is.exec(trimmed);
  if (m) return { type: m[1].toUpperCase() as BehavioralType, expr: m[2].trim() };
  return { type: "V", expr: trimmed };
}

/**
 * Find the index of the parenthesis matching the `(` at `open`, or -1 if none.
 */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a function-argument list on top-level (depth-0) commas. */
function splitTopLevel(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args;
}

/**
 * Translate LTspice's `if(cond, a, b)` to ngspice's native ternary
 * `(cond) ? (a) : (b)`. ngspice has no `if` *function* in B-sources (it raises
 * "no such function 'if'", live-verified) and its compatibility mode can't be
 * set per-deck, so any imported behavioral source using `if()` would otherwise
 * fail. Handles nesting (recurses into each argument) and a 2-arg `if(cond, a)`
 * (else defaults to 0). A bare `if` not immediately followed by `(`, or one
 * embedded in a longer identifier (e.g. `motif`), is left untouched.
 */
export function ifToTernary(expr: string): string {
  const lower = expr.toLowerCase();
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const isWordBoundary = i === 0 || !/[A-Za-z0-9_.]/.test(expr[i - 1]);
    if (isWordBoundary && lower.startsWith("if(", i)) {
      const open = i + 2;
      const close = matchParen(expr, open);
      if (close === -1) {
        out += expr.slice(i);
        break;
      }
      const args = splitTopLevel(expr.slice(open + 1, close)).map((a) => ifToTernary(a.trim()));
      if (args.length >= 2) {
        const elseBranch = args.length >= 3 ? args[2] : "0";
        out += `((${args[0]}) ? (${args[1]}) : (${elseBranch}))`;
        i = close + 1;
        continue;
      }
      // A single-argument "if(...)" isn't a real conditional - leave verbatim.
      out += expr.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += expr[i];
    i++;
  }
  return out;
}

/**
 * Rewrite LTspice's statistical functions - `rand(x)` / `random(x)` /
 * `white(x)` - to a deterministic surrogate ngspice can evaluate: ngspice
 * B-sources have no random functions ("no such function 'rand'",
 * live-verified on PLL.asc). The surrogate is the classic uniform hash
 * `frac(sin(n)*43758.5453)` over `n = floor(x)`, matching LTspice's
 * semantics of a fresh uniform [0,1) value each time floor(x) increments
 * (PLL.asc drives its loop with `rand(time*500) >= .5` - a 500-baud random
 * NRZ stream; the surrogate reproduces the distribution, live-measured
 * mean 0.546 over 150 bit periods, not LTspice's exact seed, which LTspice
 * itself doesn't keep stable across versions). Approximations: `random()`
 * (LTspice's smoothed rand) keeps the stepped surrogate - the smoothing is
 * cosmetic for data-stream uses; `white(x)` is the same hash shifted to
 * zero-mean [-0.5, 0.5). Multi-argument calls are left untouched (not
 * LTspice syntax), as are longer identifiers (e.g. `mybrand(...)`).
 */
export function statFuncsToNgspice(expr: string): string {
  const lower = expr.toLowerCase();
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const isWordBoundary = i === 0 || !/[A-Za-z0-9_.]/.test(expr[i - 1]);
    // "random(" must be tried before its prefix "rand(".
    const fn = ["random(", "rand(", "white("].find((f) => lower.startsWith(f, i));
    if (isWordBoundary && fn) {
      const open = i + fn.length - 1;
      const close = matchParen(expr, open);
      if (close === -1) {
        out += expr.slice(i);
        break;
      }
      const inner = expr.slice(open + 1, close);
      if (splitTopLevel(inner).length === 1) {
        const arg = statFuncsToNgspice(inner.trim());
        const hash = `sin(floor(${arg}))*43758.5453`;
        out += fn === "white("
          ? `((${hash})-floor(${hash})-0.5)`
          : `((${hash})-floor(${hash}))`;
        i = close + 1;
        continue;
      }
      // Multi-argument call - not LTspice's 1-arg form; leave verbatim.
      out += expr.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += expr[i];
    i++;
  }
  return out;
}

/**
 * Rewrite LTspice math functions ngspice's B-source parser lacks -
 * live-verified on the PowerSim corpus: `atan2` (ANGLE/PLL blocks), `round`
 * (QUANTIZE), `int` (PHASESHIFT3) all die with "no such function". Each is
 * rewritten to an exact ngspice-evaluable equivalent: atan2 via the
 * half-angle identity with a y=0 ternary guard, round(x) → floor(x+0.5),
 * int(x) → truncation toward zero via a sign ternary.
 */
export function ltFuncsToNgspice(expr: string): string {
  const lower = expr.toLowerCase();
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const isWordBoundary = i === 0 || !/[A-Za-z0-9_.]/.test(expr[i - 1]);
    // LTspice table(x, x1,y1, …) is ngspice pwl(x, x1,y1, …) - same
    // interpolate-and-clamp semantics, so a rename suffices; the arguments
    // keep flowing through this scanner.
    if (isWordBoundary && lower.startsWith("table(", i)) {
      out += "pwl(";
      i += "table(".length;
      continue;
    }
    // LTspice soft `_exp(x)` is overflow-safe exp; for same-deck LTspice+ngspice
    // parity emit plain `exp` (both engines accept it). Soft-cap only matters
    // for |x|≫300 — outside typical Resources/Draft1-style BV demos.
    if (isWordBoundary && lower.startsWith("_exp(", i)) {
      out += "exp(";
      i += "_exp(".length;
      continue;
    }
    const fn = ["atan2(", "round(", "int(", "uplim(", "dnlim("].find((f) => lower.startsWith(f, i));
    if (isWordBoundary && fn) {
      const open = i + fn.length - 1;
      const close = matchParen(expr, open);
      if (close === -1) {
        out += expr.slice(i);
        break;
      }
      const args = splitTopLevel(expr.slice(open + 1, close)).map((a) => ltFuncsToNgspice(a.trim()));
      if (fn === "atan2(" && args.length === 2) {
        const [y, x] = args;
        out += `(((${y}) != 0) ? (2*atan((sqrt((${x})*(${x})+(${y})*(${y}))-(${x}))/(${y}))) : (((${x}) >= 0) ? 0 : pi))`;
        i = close + 1;
        continue;
      }
      if (fn === "round(" && args.length === 1) {
        out += `floor((${args[0]})+0.5)`;
        i = close + 1;
        continue;
      }
      if (fn === "int(" && args.length === 1) {
        const a = args[0];
        out += `(((${a}) >= 0) ? floor(${a}) : ceil(${a}))`;
        i = close + 1;
        continue;
      }
      if ((fn === "uplim(" || fn === "dnlim(") && args.length === 3) {
        const [x, y, z] = args;
        // LTspice's soft limits are linear outside the transition zone and use
        // an exponential shoulder inside it. Preserve the documented z<=0
        // hard-limit behavior so the generated expression never divides by 0.
        out += fn === "uplim("
          ? `(((${z}) <= 0) ? min((${x}),(${y})) : ((((${y})-(${x})) < (${z})) ? ((${y})-(${z})*exp(((${y})-(${x})-(${z}))/(${z}))) : (${x})))`
          : `(((${z}) <= 0) ? max((${x}),(${y})) : ((((${x})-(${y})) < (${z})) ? ((${y})+(${z})*exp(((${x})-(${y})-(${z}))/(${z}))) : (${x})))`;
        i = close + 1;
        continue;
      }
      // Unexpected arity - leave verbatim rather than guessing.
      out += expr.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += expr[i];
    i++;
  }
  return out;
}

/**
 * Rewrite LTspice's `%` modulo operator - ngspice B-source expressions have no
 * `%` ("unknown parameter (%)", live-verified on SRF_PLL's
 * `V=V(θ_pll)%(2*pi)`) - as the floor identity a−b·floor(a/b). Operands are
 * taken as the adjacent "atoms": a parenthesized group, a call like `V(x)`,
 * or a bare number/identifier token.
 */
export function moduloToFloor(expr: string): string {
  let result = expr;
  for (let pass = 0; pass < 8; pass += 1) {
    const at = result.indexOf("%");
    if (at < 0) break;
    // Left atom: scan backward over whitespace, then a balanced group and/or token.
    let leftEnd = at;
    while (leftEnd > 0 && /\s/.test(result[leftEnd - 1])) leftEnd -= 1;
    let leftStart = leftEnd;
    if (result[leftStart - 1] === ")") {
      let depth = 0;
      while (leftStart > 0) {
        leftStart -= 1;
        if (result[leftStart] === ")") depth += 1;
        else if (result[leftStart] === "(") depth -= 1;
        if (depth === 0) break;
      }
      // A call's name precedes its group: V(x), floor(x), …
      while (leftStart > 0 && /[\w.]/.test(result[leftStart - 1])) leftStart -= 1;
    } else {
      while (leftStart > 0 && /[\w.]/.test(result[leftStart - 1])) leftStart -= 1;
    }
    // Right atom: whitespace, then token and/or balanced group.
    let rightStart = at + 1;
    while (rightStart < result.length && /\s/.test(result[rightStart])) rightStart += 1;
    let rightEnd = rightStart;
    while (rightEnd < result.length && /[\w.]/.test(result[rightEnd])) rightEnd += 1;
    if (result[rightEnd] === "(") {
      let depth = 0;
      while (rightEnd < result.length) {
        if (result[rightEnd] === "(") depth += 1;
        else if (result[rightEnd] === ")") depth -= 1;
        rightEnd += 1;
        if (depth === 0) break;
      }
    }
    const a = result.slice(leftStart, leftEnd);
    const b = result.slice(rightStart, rightEnd);
    if (!a || !b) break; // malformed - leave for the engine to report
    result = `${result.slice(0, leftStart)}((${a})-(${b})*floor((${a})/(${b})))${result.slice(rightEnd)}`;
  }
  return result;
}

/**
 * Normalize a behavioral value to a canonical ngspice B-source spec
 * (`"V=<expr>"` or `"I=<expr>"`). LTspice `if()` calls are rewritten to ngspice
 * ternaries, `rand`/`random`/`white` to their deterministic surrogates,
 * `atan2`/`round`/`int`/`table` to ngspice-evaluable equivalents, and `%` to
 * its floor identity. Throws when the expression body is empty.
 */
export function behavioralSpecText(value: string): string {
  const { type, expr } = parseBehavioral(value);
  if (!expr) throw new Error("Behavioral source needs a V=/I= expression.");
  return `${type}=${moduloToFloor(ltFuncsToNgspice(statFuncsToNgspice(ifToTernary(expr))))}`;
}

/** Compose a behavioral value from its two halves, in the deck's spelling. */
export function formatBehavioral(type: BehavioralType, expr: string): string {
  return `${type}=${expr.trim()}`;
}

/** A behavioral value judged before the run, for the Properties panel. */
export interface BehavioralCheck {
  /** False only when Tau can prove the deck cannot be built from this value. */
  ok: boolean;
  /** The canonical `V=`/`I=` line the deck would emit, when there is one. */
  spec: string | null;
  /** Why it was refused, in the engine's own words. Null when `ok`. */
  reason: string | null;
}

/**
 * Judge a behavioral value the way the run would, so the panel can refuse a
 * malformed expression at the keystroke instead of at the transient.
 *
 * Both checks are the engine's own code, not a second parser: the value goes
 * through {@link behavioralSpecText} (which is what the deck emits, and which
 * throws on a missing expression), and the expression it produces goes through
 * `expr.ts`'s `parse` - the same parser `linearizeBehavioral` evaluates with.
 *
 * One error is deliberately NOT a refusal. `expr.ts`'s tokenizer accepts only
 * `[A-Za-z0-9_µ]` in an identifier, while ngspice node names and LTspice
 * `{param}` braces are wider than that, so `Unexpected character` means "Tau's
 * checker cannot read this", not "the engine will reject it". Refusing there
 * would block a legal imported expression, which is worse than passing a bad
 * one through to the run: a false refusal edits nothing and blames the user.
 */
export function checkBehavioral(value: string): BehavioralCheck {
  let spec: string;
  try {
    spec = behavioralSpecText(value);
  } catch (error) {
    return { ok: false, spec: null, reason: (error as Error).message };
  }
  try {
    // Past the `V=`/`I=` head that behavioralSpecText just normalized.
    parseExpression(spec.slice(2));
  } catch (error) {
    const message = (error as Error).message;
    if (/^Unexpected character/.test(message)) return { ok: true, spec, reason: null };
    return { ok: false, spec: null, reason: /[.!?]$/.test(message) ? message : `${message}.` };
  }
  return { ok: true, spec, reason: null };
}

/**
 * Resolve a behavioral source's value to a linear model for the TS MNA solver,
 * or throw a clear, user-facing error when the expression is beyond the linear
 * solver's reach (nonlinear / time-dependent / current-controlled / unknown
 * params). The native ngspice engine handles those - this is only the
 * browser/test path.
 */
export function linearBSourceModel(
  label: string,
  value: string,
  scope: Scope = {},
  funcs: Record<string, FuncDef> = {},
): LinearBehavioral {
  const model = linearizeBehavioral(parseBehavioral(value), scope, funcs);
  if (!model) {
    throw new Error(
      `Behavioral source ${label || "B"} ("${value}") needs the native engine: its expression is nonlinear, time-dependent, current-controlled (I(...)), or uses unknown parameters. The interim linear solver handles only affine V(node) expressions.`,
    );
  }
  return model;
}

/** An affine model of a behavioral source: `constant + Σ coeff·V(node)`. */
export interface LinearBehavioral {
  type: BehavioralType;
  /** Constant term (all controlling node voltages = 0). */
  constant: number;
  /** node name (lowercased) → coefficient on `V(node)`. */
  coeffs: Map<string, number>;
}

/** A controlling term `coeff·V(node)` of a linearized behavioral source, with
 *  the node resolved to an MNA matrix index (ground → −1, already dropped). */
export interface BehavioralTerm {
  index: number;
  coeff: number;
}

/**
 * Map a linear behavioral model's node names to MNA matrix indices via the
 * solver's net-name lookup. Ground (`0`/`gnd`) is dropped (V = 0). Throws a
 * clear error when the expression references a node not present in the circuit.
 */
export function resolveBehavioralTerms(
  model: LinearBehavioral,
  label: string,
  netByName: Map<string, number>,
): BehavioralTerm[] {
  const terms: BehavioralTerm[] = [];
  for (const [name, coeff] of model.coeffs) {
    if (name === "0" || name === "gnd") continue;
    const index = netByName.get(name);
    if (index === undefined) {
      throw new Error(`Behavioral source ${label || "B"} references unknown node V(${name}).`);
    }
    terms.push({ index, coeff });
  }
  return terms;
}

// Match V(node) and V(a,b). Group 1 = first node, group 2 = optional second.
const V_REF = /\bV\s*\(\s*([\w.]+)\s*(?:,\s*([\w.]+)\s*)?\)/gi;
const TOL = 1e-9;

/** True when an identifier in the expression is a per-node voltage var. */
function nodeVar(node: string): string {
  return `__vn_${node.toLowerCase()}`;
}

/**
 * Reduce a behavioral spec to an affine function of node voltages, or return
 * `null` when it cannot be (dynamic / current-dependent / nonlinear), so the
 * caller can fall back to the native engine.
 *
 * @param spec   parsed behavioral spec
 * @param params parameter scope (`.param`/`.func` values) used to resolve
 *               constants embedded in the expression
 * @param funcs  user `.func` definitions
 */
export function linearizeBehavioral(
  spec: BehavioralSpec,
  params: Scope = {},
  funcs: Record<string, FuncDef> = {},
): LinearBehavioral | null {
  const { expr } = spec;
  // Dynamic or current-controlled forms are out of scope for the linear solver.
  if (/\btime\b/i.test(expr)) return null;
  if (/\bI\s*\(/i.test(expr)) return null;

  // Replace every V(node)/V(a,b) with arithmetic over synthetic per-node vars.
  const nodes = new Set<string>();
  const rewritten = expr.replace(V_REF, (_m, a: string, b?: string) => {
    nodes.add(a.toLowerCase());
    if (b) {
      nodes.add(b.toLowerCase());
      return `(${nodeVar(a)} - ${nodeVar(b)})`;
    }
    return nodeVar(a);
  });

  const nodeList = [...nodes];
  const evalAt = (values: Record<string, number>): number => {
    const scope: Scope = { ...params };
    for (const n of nodeList) scope[nodeVar(n)] = values[n] ?? 0;
    return evaluateExpression(rewritten, scope, funcs);
  };

  let constant: number;
  try {
    constant = evalAt({});
    if (!Number.isFinite(constant)) return null;

    const coeffs = new Map<string, number>();
    for (const n of nodeList) {
      const at1 = evalAt({ [n]: 1 });
      const coeff = at1 - constant;
      // Linearity check: f(2·e_n) must equal constant + 2·coeff.
      const at2 = evalAt({ [n]: 2 });
      if (Math.abs(at2 - (constant + 2 * coeff)) > TOL + TOL * Math.abs(at2)) {
        return null;
      }
      coeffs.set(n, coeff);
    }
    // Global linearity check: evaluate at a probe point with a *distinct*
    // nonzero value per node and confirm it matches the affine prediction.
    // This rejects cross-products (V(a)·V(b)), higher-order products
    // (2·V(a)·V(b)·V(c)), and powers that single-axis perturbation misses.
    if (nodeList.length > 0) {
      const probe: Record<string, number> = {};
      nodeList.forEach((n, i) => (probe[n] = 1.3 * i + 0.7));
      const actual = evalAt(probe);
      let expected = constant;
      for (const n of nodeList) expected += (coeffs.get(n) ?? 0) * probe[n];
      if (Math.abs(actual - expected) > TOL + TOL * Math.abs(actual)) return null;
    }
    return { type: spec.type, constant, coeffs };
  } catch {
    // Unknown function/param, or a non-affine construct that throws - defer to
    // the native engine.
    return null;
  }
}
