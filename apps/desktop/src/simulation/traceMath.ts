// Right-click trace math (LTspice-style): wrap a plotted signal in a common
// unary expression and re-plot it via the existing expression overlay path.
// Keep this pure — UI only calls wrapTraceMath / expressionForTrace.

export type TraceMathOp = "abs" | "neg" | "db" | "uramp" | "sgn" | "ddt" | "idt";

const OPS: ReadonlyArray<{ op: TraceMathOp; label: string }> = [
  { op: "abs", label: "Plot abs(…)" },
  { op: "neg", label: "Plot −(…)" },
  { op: "db", label: "Plot db(…)" },
  { op: "uramp", label: "Plot uramp(…)" },
  { op: "sgn", label: "Plot sgn(…)" },
  { op: "ddt", label: "Plot ddt(…)" },
  { op: "idt", label: "Plot idt(…)" },
];

/** Menu rows for the transient legend context menu. */
export function traceMathMenuItems(): ReadonlyArray<{ op: TraceMathOp; label: string }> {
  return OPS;
}

/**
 * Map a scope trace to a plottable expression string. Expression overlays
 * (`expr:…`) keep their authored form; ordinary V/I traces use their label
 * (`V(out)`, `I(R1)`). Reference overlays are not math sources.
 */
export function expressionForTrace(traceId: string, label: string): string | null {
  if (traceId.startsWith("ref:")) return null;
  if (traceId.startsWith("expr:")) {
    const expr = traceId.slice("expr:".length).trim();
    return expr || null;
  }
  const trimmed = label.trim();
  return trimmed || null;
}

/**
 * Wrap `expression` in a unary math op. Parentheses keep compound expressions
 * like `V(a)-V(b)` unambiguous under negation.
 */
export function wrapTraceMath(expression: string, op: TraceMathOp): string {
  const e = expression.trim();
  if (!e) return "";
  switch (op) {
    case "abs":
      return `abs(${e})`;
    case "neg":
      return `-(${e})`;
    case "db":
      return `db(${e})`;
    case "uramp":
      return `uramp(${e})`;
    case "sgn":
      return `sgn(${e})`;
    case "ddt":
      return `ddt(${e})`;
    case "idt":
      return `idt(${e})`;
  }
}
