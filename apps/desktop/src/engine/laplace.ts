/**
 * LTspice `Laplace=…` transfer functions on E/G sources → ngspice.
 *
 * LTspice's arbitrary-behavioral E (VCVS) and G (VCCS) sources accept a
 * `Laplace=H(s)` continuous-transfer-function spec, e.g.
 *   E1 … Laplace=A0/(1+s/wp1)/(1+s/wp2)
 *   E2 … Laplace=1/(1+.001*s)**2
 * ngspice (≤46) has no native `LAPLACE` keyword on E/G, but its XSPICE `s_xfer`
 * code model realizes any *rational* H(s) from numerator/denominator polynomial
 * coefficient lists. We expand the LTspice expression symbolically into those
 * coefficients (params already resolved against the schematic scope) and emit an
 * `A`-device + `.model s_xfer`.
 *
 * Two cases can't be a finite rational polynomial in s - transport delay
 * `exp(-T*s)` and fractional/root responses `sqrt(1+τ*s)` (LTspice's own
 * TwoTau/HalfSlope demos). Tau can use their DC gain H(0) exactly for static
 * analyses, but must refuse dynamic analyses rather than silently simulate a
 * different transfer function.
 */
import { parse, evaluateExpression, type Scope, type FuncDef } from "../simulation/expr";

type Node = ReturnType<typeof parse>;

/** A rational function of s. Coefficients ascending: `coeff[i]` multiplies sⁱ. */
interface Rational {
  num: number[];
  den: number[];
}

/** A polynomial that cannot be expressed as a finite rational in s. */
class NonRationalError extends Error {}

// --- polynomial arithmetic (ascending coefficient arrays) ---------------------

function polyTrim(p: number[]): number[] {
  let last = p.length - 1;
  while (last > 0 && Math.abs(p[last]) < 1e-300) last -= 1;
  return p.slice(0, last + 1);
}

function polyAdd(a: number[], b: number[]): number[] {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < a.length; i += 1) out[i] += a[i];
  for (let i = 0; i < b.length; i += 1) out[i] += b[i];
  return polyTrim(out);
}

function polyScale(a: number[], k: number): number[] {
  return polyTrim(a.map((c) => c * k));
}

function polyMul(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
  }
  return polyTrim(out);
}

// --- rational arithmetic ------------------------------------------------------

const ratConst = (k: number): Rational => ({ num: [k], den: [1] });
const RAT_S: Rational = { num: [0, 1], den: [1] };

function ratAdd(a: Rational, b: Rational): Rational {
  return { num: polyAdd(polyMul(a.num, b.den), polyMul(b.num, a.den)), den: polyMul(a.den, b.den) };
}
function ratSub(a: Rational, b: Rational): Rational {
  return ratAdd(a, { num: polyScale(b.num, -1), den: b.den });
}
function ratMul(a: Rational, b: Rational): Rational {
  return { num: polyMul(a.num, b.num), den: polyMul(a.den, b.den) };
}
function ratDiv(a: Rational, b: Rational): Rational {
  if (polyTrim(b.num).length === 1 && Math.abs(b.num[0]) < 1e-300) {
    throw new NonRationalError("division by zero in Laplace expression");
  }
  return { num: polyMul(a.num, b.den), den: polyMul(a.den, b.num) };
}
function ratPow(a: Rational, n: number): Rational {
  if (!Number.isInteger(n)) throw new NonRationalError(`non-integer power s**${n}`);
  if (n < 0) return ratPow({ num: a.den, den: a.num }, -n);
  let out = ratConst(1);
  for (let i = 0; i < n; i += 1) out = ratMul(out, a);
  return out;
}

// --- symbolic evaluation ------------------------------------------------------

/** Evaluate a node that must NOT reference `s` to a constant (exponents, params). */
function constOf(node: Node, scope: Scope, funcs: Record<string, FuncDef>): number {
  if (node.k === "var" && node.name.toLowerCase() === "s") {
    throw new NonRationalError("`s` where a constant was required");
  }
  // Re-stringify-free path: lean on the numeric evaluator with s absent.
  return evalConst(node, scope, funcs);
}

function evalConst(node: Node, scope: Scope, funcs: Record<string, FuncDef>): number {
  switch (node.k) {
    case "num":
      return node.v;
    case "var": {
      const v = lookup(scope, node.name);
      if (v === undefined) throw new NonRationalError(`unknown symbol "${node.name}"`);
      return v;
    }
    case "unary":
      return node.op === "-" ? -evalConst(node.x, scope, funcs) : evalConst(node.x, scope, funcs);
    case "bin": {
      const a = evalConst(node.a, scope, funcs);
      const b = evalConst(node.b, scope, funcs);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "^": case "**": return a ** b;
        default: throw new NonRationalError(`operator ${node.op} in constant`);
      }
    }
    default:
      throw new NonRationalError("non-constant subexpression");
  }
}

function lookup(scope: Scope, name: string): number | undefined {
  if (name in scope) return scope[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(scope)) if (k.toLowerCase() === lower) return scope[k];
  return undefined;
}

/** Walk the parsed transfer function into a rational function of s. */
function toRational(node: Node, scope: Scope, funcs: Record<string, FuncDef>): Rational {
  switch (node.k) {
    case "num":
      return ratConst(node.v);
    case "var": {
      if (node.name.toLowerCase() === "s") return RAT_S;
      const v = lookup(scope, node.name);
      if (v === undefined) throw new NonRationalError(`unknown symbol "${node.name}"`);
      return ratConst(v);
    }
    case "unary":
      return node.op === "-"
        ? { num: polyScale(toRational(node.x, scope, funcs).num, -1), den: toRational(node.x, scope, funcs).den }
        : toRational(node.x, scope, funcs);
    case "bin": {
      if (node.op === "^" || node.op === "**") {
        return ratPow(toRational(node.a, scope, funcs), constOf(node.b, scope, funcs));
      }
      const a = toRational(node.a, scope, funcs);
      const b = toRational(node.b, scope, funcs);
      switch (node.op) {
        case "+": return ratAdd(a, b);
        case "-": return ratSub(a, b);
        case "*": return ratMul(a, b);
        case "/": return ratDiv(a, b);
        default: throw new NonRationalError(`operator ${node.op} not rational in s`);
      }
    }
    case "call":
      // exp(), sqrt(), … are transcendental in s - not a finite polynomial.
      throw new NonRationalError(`function ${node.name}() is not a rational transfer`);
    case "tern":
      throw new NonRationalError("ternary not allowed in a Laplace transfer");
  }
}

// --- public API ---------------------------------------------------------------

/**
 * If `value` is an LTspice `Laplace=…` spec, return the bare transfer expression
 * (everything after `Laplace=`, leading/trailing space trimmed); else `null`.
 */
export function laplaceTransfer(value: string): string | null {
  const m = /(?:^|\s)laplace\s*=\s*(.+)$/i.exec(value.trim());
  return m ? m[1].trim() : null;
}

/** Format a coefficient for an ngspice list (compact, ngspice-parseable). */
function fmt(x: number): string {
  if (!Number.isFinite(x)) throw new NonRationalError("non-finite coefficient");
  if (x === 0) return "0";
  // Avoid "-0" and overly long decimals; exponential is fine for ngspice.
  const s = Math.abs(x) >= 1e-4 && Math.abs(x) < 1e15 ? String(Number(x.toPrecision(12))) : x.toExponential(10);
  return s;
}

export interface LaplaceLines {
  lines: string[];
  /** true when realized exactly; false when rendered as its DC-only gain. */
  exact: boolean;
  /** The constant H(0) used for an OP/DC/TF-only source. */
  dcGain?: number;
}

export type LaplaceClassification =
  | { kind: "constant"; gain: number }
  | { kind: "voltage-rational"; numerator: number[]; denominator: number[] }
  | { kind: "dc-only"; dcGain: number; reason: "non-rational" | "current-dynamic" };

export const LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE = "deck.refused.laplace.dynamic_transfer" as const;
export type LaplaceSourceKind = "vcvs" | "vccs";

export interface LaplaceRefusalDiagnostic {
  code: typeof LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE;
  message: string;
  ref: string;
  sourceKind: LaplaceSourceKind;
  transfer: string;
  analysis: "tran" | "op" | "ac" | "dc" | "tf" | "noise";
  dcGain: number;
  reason: "non-rational" | "current-dynamic";
}

/** A deck-build refusal with the same user-facing form as other simulation refusals. */
export class LaplaceAnalysisRefusal extends Error {
  readonly code = LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE;
  readonly diagnostic: Readonly<LaplaceRefusalDiagnostic>;

  constructor(diagnostic: LaplaceRefusalDiagnostic) {
    super(diagnostic.message);
    this.name = "LaplaceAnalysisRefusal";
    this.diagnostic = Object.freeze(diagnostic);
  }
}

/**
 * Classify a Laplace transfer independently of deck-node rendering. This keeps
 * the preflight policy and the emitted circuit on exactly the same semantics.
 */
export function classifyLaplaceTransfer(args: {
  transfer: string;
  isCurrent: boolean;
  scope: Scope;
  funcs: Record<string, FuncDef>;
}): LaplaceClassification {
  const { transfer, isCurrent, scope, funcs } = args;
  const tree = parse(transfer);
  try {
    const rat = toRational(tree, scope, funcs);
    const numerator = polyTrim(rat.num);
    const denominator = polyTrim(rat.den);
    if (numerator.length === 1 && denominator.length === 1) {
      return { kind: "constant", gain: numerator[0] / denominator[0] };
    }
    if (!isCurrent) return { kind: "voltage-rational", numerator, denominator };
    const dcGain = evaluateExpression(transfer, { ...scope, s: 0 }, funcs);
    if (!Number.isFinite(dcGain)) throw new Error(`Laplace transfer "${transfer}" has no finite DC gain.`);
    return { kind: "dc-only", dcGain, reason: "current-dynamic" };
  } catch (error) {
    if (!(error instanceof NonRationalError)) throw error;
    const dcGain = evaluateExpression(transfer, { ...scope, s: 0 }, funcs);
    if (!Number.isFinite(dcGain)) throw new Error(`Laplace transfer "${transfer}" has no finite DC gain.`);
    return { kind: "dc-only", dcGain, reason: "non-rational" };
  }
}

/** Reject a dynamic analysis when Tau would otherwise reduce H(s) to H(0). */
export function assertLaplaceAnalysisSupported(args: {
  analysis: "tran" | "op" | "ac" | "dc" | "tf" | "noise";
  ref: string;
  sourceKind: LaplaceSourceKind;
  transfer: string;
  classification: LaplaceClassification;
}): void {
  const { analysis, ref, sourceKind, transfer, classification } = args;
  if (classification.kind !== "dc-only" || analysis === "op" || analysis === "dc" || analysis === "tf") return;
  const capability = classification.reason === "non-rational"
    ? "is not a finite rational transfer"
    : "is a dynamic current-controlled transfer Tau cannot realize exactly";
  const message = `Simulation refused: ${ref}'s Laplace transfer "${transfer}" ${capability} for .${analysis}. `
    + "Tau only supports its exact H(0) DC gain for .op, .dc, and .tf. No approximate or partial circuit was run.";
  throw new LaplaceAnalysisRefusal({
    code: LAPLACE_DYNAMIC_TRANSFER_REFUSAL_CODE,
    message,
    ref,
    sourceKind,
    transfer,
    analysis,
    dcGain: classification.dcGain,
    reason: classification.reason,
  });
}

/**
 * Build the deck lines for an E (voltage, `isCurrent=false`) or G (current,
 * `isCurrent=true`) source whose value is a `Laplace=H(s)` spec.
 *
 * Voltage sources realize a rational H(s) with an XSPICE `s_xfer` A-device
 * (coefficients emitted highest-power-first, ngspice's convention). Constant
 * E/G sources are exact controlled sources. A `dc-only` result is emitted as
 * H(0), after the deck preflight has restricted it to OP/DC/TF analyses.
 */
export function laplaceSourceLines(args: {
  base: string;
  op: string;
  on: string;
  cp: string;
  cn: string;
  transfer: string;
  isCurrent: boolean;
  scope: Scope;
  funcs: Record<string, FuncDef>;
}): LaplaceLines {
  const { base, op, on, cp, cn, transfer, isCurrent, scope, funcs } = args;
  const classification = classifyLaplaceTransfer({ transfer, isCurrent, scope, funcs });
  if (classification.kind === "constant") {
    const prefix = isCurrent ? "G" : "E";
    return { lines: [`${prefix}_${base} ${op} ${on} ${cp} ${cn} ${fmt(classification.gain)}`], exact: true };
  }
  if (classification.kind === "voltage-rational") {
    const numList = [...classification.numerator].reverse().map(fmt).join(" ");
    const denList = [...classification.denominator].reverse().map(fmt).join(" ");
    const model = `XF_${base}`;
    return {
      lines: [
        `A_${base} %vd(${cp} ${cn}) %vd(${op} ${on}) ${model}`,
        `.model ${model} s_xfer(num_coeff=[${numList}] den_coeff=[${denList}])`,
      ],
      exact: true,
    };
  }
  const prefix = isCurrent ? "G" : "E";
  return {
    lines: [`${prefix}_${base} ${op} ${on} ${cp} ${cn} ${fmt(classification.dcGain)}`],
    exact: false,
    dcGain: classification.dcGain,
  };
}
