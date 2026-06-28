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
 * (`I(...)`), or genuinely nonlinear — those need the native engine.
 *
 * Pure functions over numeric scopes — trivially unit-testable.
 */

import { evaluateExpression, type Scope, type FuncDef } from "./expr";

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
 * Normalize a behavioral value to a canonical ngspice/LTspice B-source spec
 * (`"V=<expr>"` or `"I=<expr>"`). Throws when the expression body is empty.
 */
export function behavioralSpecText(value: string): string {
  const { type, expr } = parseBehavioral(value);
  if (!expr) throw new Error("Behavioral source needs a V=/I= expression.");
  return `${type}=${expr}`;
}

/** An affine model of a behavioral source: `constant + Σ coeff·V(node)`. */
export interface LinearBehavioral {
  type: BehavioralType;
  /** Constant term (all controlling node voltages = 0). */
  constant: number;
  /** node name (lowercased) → coefficient on `V(node)`. */
  coeffs: Map<string, number>;
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
    // Unknown function/param, or a non-affine construct that throws — defer to
    // the native engine.
    return null;
  }
}
