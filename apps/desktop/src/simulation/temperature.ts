/**
 * Temperature model for the interim TS solver (LTspice parity).
 *
 * The native ngspice path already honours `.temp` through its device models
 * (see `engine/spiceNetlist.ts`). The interim linear solver has no device
 * temperature physics, but the one temperature effect it *can* model exactly is
 * LTspice's **resistor temperature coefficient**: a resistor whose value carries
 * an inline `tc=tc1[,tc2]` spec scales with temperature as
 *
 *     R(T) = R0 · (1 + tc1·ΔT + tc2·ΔT²),   ΔT = T − Tnom
 *
 * matching LTspice/ngspice. Applying that law at context-build time (rewriting a
 * resistor's numeric value per temperature) lets `.step temp` produce a real
 * family of curves without touching the solver, and keeps the whole thing pure
 * and unit-testable. Resistors without a `tc=` spec are temperature-independent
 * (LTspice default tc = 0) and pass through unchanged.
 */

import type { SchematicComponent } from "../schematic/types";
import { parseQuantity } from "./quantity";

/** Nominal temperature (27 °C), matching ngspice/LTspice TNOM. */
export const TNOM_C = 27;

/** A resistor's base resistance plus its linear/quadratic temperature coefficients. */
export interface ResistorTemp {
  /** Base resistance at Tnom (Ω). */
  resistance: number;
  /** Linear temperature coefficient (1/°C). Zero when no `tc=` spec is present. */
  tc1: number;
  /** Quadratic temperature coefficient (1/°C²). Zero when absent. */
  tc2: number;
}

// `tc=0.001` or `tc=0.001,1e-6` (comma- or space-separated second coefficient),
// tolerating whitespace around `=` and the separator. Matches LTspice's inline form.
const TC_RE = /\btc\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:\s*[, ]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?))?/i;

/**
 * Strip an LTspice `tc=tc1[,tc2]` tempco token from a resistor value string,
 * leaving just the magnitude (e.g. `"1k tc=0.001,0"` → `"1k"`). Returns the
 * trimmed input unchanged when there is no `tc=` spec.
 */
export function stripTcSpec(value: string): string {
  return value.replace(TC_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Translate LTspice's inline `tc=tc1[,tc2]` into ngspice instance parameters
 * (`tc1=` / `tc2=`). Empty when the value carries no tempco. Native `.temp` /
 * `.step temp` only shift resistance when these are visible on the element line;
 * the TypeScript path still uses {@link applyTemperature} separately.
 */
export function ngspiceResistorTempcoSuffix(value: string): string {
  const match = value.match(TC_RE);
  if (!match) return "";
  const parts: string[] = [`tc1=${match[1]}`];
  if (match[2] !== undefined && match[2] !== "") {
    const tc2 = Number(match[2]);
    if (Number.isFinite(tc2) && tc2 !== 0) parts.push(`tc2=${match[2]}`);
  }
  return ` ${parts.join(" ")}`;
}

/**
 * Parse a resistor value that may carry an inline `tc=tc1[,tc2]` tempco into its
 * base resistance and coefficients. Throws when the magnitude cannot be parsed
 * (e.g. an unresolved parameter expression) so callers can fall back cleanly.
 */
export function parseResistorTemp(value: string): ResistorTemp {
  const match = value.match(TC_RE);
  const tc1 = match ? Number(match[1]) : 0;
  const tc2 = match && match[2] !== undefined ? Number(match[2]) : 0;
  const resistance = parseQuantity(stripTcSpec(value), "Ω");
  return {
    resistance,
    tc1: Number.isFinite(tc1) ? tc1 : 0,
    tc2: Number.isFinite(tc2) ? tc2 : 0,
  };
}

/**
 * Resistance at a given temperature per LTspice's tempco law:
 * `R(T) = R0·(1 + tc1·ΔT + tc2·ΔT²)`, `ΔT = tempC − tnomC`. With zero
 * coefficients this is just `R0`.
 */
export function resistanceAtTemperature(spec: ResistorTemp, tempC: number, tnomC = TNOM_C): number {
  const dt = tempC - tnomC;
  return spec.resistance * (1 + spec.tc1 * dt + spec.tc2 * dt * dt);
}

/**
 * Return a copy of `components` with every temperature-dependent resistor's
 * value rewritten to its resistance at `tempC`. A resistor is temperature
 * dependent only when it carries a nonzero `tc=` coefficient; all other
 * components (and tc-less resistors, and resistors whose value is an unparsable
 * expression) are passed through untouched so the solver sees identical input.
 */
export function applyTemperature(components: SchematicComponent[], tempC: number): SchematicComponent[] {
  return components.map((component) => {
    if (component.kind !== "resistor") return component;
    let spec: ResistorTemp;
    try {
      spec = parseResistorTemp(component.value);
    } catch {
      return component; // expression / unresolved value - leave for the solver to handle.
    }
    if (spec.tc1 === 0 && spec.tc2 === 0) return component;
    const scaled = resistanceAtTemperature(spec, tempC);
    return { ...component, value: String(scaled) };
  });
}
