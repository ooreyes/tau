// Dimensional-unit inference for plotted waveform expressions (FEATURE_PARITY §6
// "plot arbitrary expressions" — per-trace axis/unit).
//
// The expression bar under the transient scope plots any expression of the
// simulated signals. Until now every derived trace was labelled volts, so
// probing a branch current `I(R1)` or instantaneous power `V(out)*I(R1)` drew an
// axis that read in "V" — wrong. LTspice picks the axis unit from the physical
// dimension of the expression, so we do the same: walk the *same* AST the
// evaluator uses (`expr.ts`), treat `V(...)` as volts and `I(...)` as amps, and
// propagate the {volt, amp} exponents through the arithmetic. The result maps to
// a single SI symbol when it's one of the common electrical quantities.
//
// This is pure (string in, unit string out) so it is trivially unit-tested with
// hand-computed expectations, and it shares the parser with the evaluator so the
// two never disagree about what `V(a,b)` or `2*V(in)+1` means.

import { parse, type Node } from "./expr";
import type { TraceUnit } from "./linearTransient";

/** A physical dimension as exponents of volts and amps. `null` = unknown
 *  (an inconsistent sum like `V(a)+I(b)`, or a non-constant power). */
type Dim = { v: number; a: number } | null;

const DIMLESS: Dim = { v: 0, a: 0 };
const VOLT: Dim = { v: 1, a: 0 };
const AMP: Dim = { v: 0, a: 1 };

/** Functions that preserve their argument's dimension (LTspice: `abs(I(L1))`
 *  is still amps). Everything else — trig, exp, log, sqrt, db/mag/ph — collapses
 *  to a dimensionless number for axis-labelling purposes. */
const DIM_PRESERVING = new Set(["abs", "min", "max", "limit", "uramp"]);

function sameDim(a: Dim, b: Dim): boolean {
  return a !== null && b !== null && a.v === b.v && a.a === b.a;
}

function dimOf(node: Node): Dim {
  switch (node.k) {
    case "num":
      return DIMLESS;
    case "var":
      // A `.param`/`.func` scalar (e.g. Rload) — treated as a plain number for
      // unit purposes; we don't track parameter units.
      return DIMLESS;
    case "call": {
      const name = node.name.toLowerCase();
      if (name === "v") return VOLT;
      if (name === "i") return AMP;
      if (DIM_PRESERVING.has(name)) {
        // Dimension of the (matching) arguments; mismatched args → unknown.
        const dims = node.args.map(dimOf);
        if (dims.length === 0) return DIMLESS;
        const first = dims[0];
        return dims.every((d) => sameDim(d, first)) ? first : null;
      }
      return DIMLESS; // sin/exp/sqrt/db/mag/… strip units
    }
    case "unary":
      return node.op === "!" ? DIMLESS : dimOf(node.x);
    case "tern": {
      const a = dimOf(node.a);
      const b = dimOf(node.b);
      return sameDim(a, b) ? a : null;
    }
    case "bin": {
      const a = dimOf(node.a);
      const b = dimOf(node.b);
      switch (node.op) {
        case "+":
        case "-":
          // Addition only makes dimensional sense between like quantities.
          return sameDim(a, b) ? a : null;
        case "%":
          return a;
        case "*":
          return a && b ? { v: a.v + b.v, a: a.a + b.a } : null;
        case "/":
          return a && b ? { v: a.v - b.v, a: a.a - b.a } : null;
        case "^": {
          // Only a constant integer exponent yields a clean dimension.
          if (!a) return null;
          if (node.b.k === "num" && Number.isInteger(node.b.v)) {
            return { v: a.v * node.b.v, a: a.a * node.b.v };
          }
          return a.v === 0 && a.a === 0 ? DIMLESS : null;
        }
        // relational / equality / logical → a boolean (0/1)
        default:
          return DIMLESS;
      }
    }
  }
}

function unitFromDim(dim: Dim): TraceUnit {
  if (!dim) return "";
  const { v, a } = dim;
  if (v === 0 && a === 0) return "";
  if (v === 1 && a === 0) return "V";
  if (v === 0 && a === 1) return "A";
  if (v === 1 && a === 1) return "W"; // power V·I
  if (v === 1 && a === -1) return "Ω"; // V/I
  if (v === -1 && a === 1) return "S"; // I/V
  return ""; // V², A², etc. — no single common symbol
}

/**
 * Infer the physical unit a plotted expression carries (for the scope axis /
 * legend). `V(a)-V(b)` → "V", `I(R1)` → "A", `V(out)*I(R1)` → "W",
 * `V(out)/I(out)` → "Ω". Returns "" for a dimensionless or un-inferable
 * expression (the caller can fall back to its own default). Never throws — a
 * malformed expression yields "".
 */
export function inferExpressionUnit(expr: string): TraceUnit {
  const trimmed = expr.trim();
  if (!trimmed) return "";
  let ast: Node;
  try {
    ast = parse(trimmed);
  } catch {
    return "";
  }
  return unitFromDim(dimOf(ast));
}

/**
 * The unit shared by every trace in a set, or "" when they disagree (mixed
 * V/A traces, as when node voltages and a probed current share one pane). Used
 * to label the scope's value axis only when it's unambiguous.
 */
export function commonTraceUnit(units: TraceUnit[]): TraceUnit {
  const seen = units.filter((u) => u !== "");
  if (seen.length === 0) return "";
  return seen.every((u) => u === seen[0]) ? seen[0] : "";
}
