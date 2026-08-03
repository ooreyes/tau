import type { SchematicComponent } from "./types";
import { stripIcSpec } from "../engine/icSpec";
import { parseQuantity } from "../simulation/quantity";

/** LTspice's nonlinear capacitor form stores charge as `Q=<expression>` in
 * the ordinary capacitor Value field. */
export function isChargeDefinedCapacitor(component: SchematicComponent): boolean {
  return component.kind === "capacitor" && /^\s*Q\s*=/i.test(component.value);
}

/** The interim preview solvers have only a constant-C stamp. AC/noise require
 * dQ/dV and transient requires dQ/dt, so coercing Q= to a number would be a
 * different circuit. The packaged desktop path uses native ngspice instead. */
export function previewChargeDefinedCapacitorMessage(
  components: readonly SchematicComponent[],
): string | null {
  const component = components.find(isChargeDefinedCapacitor);
  if (!component) return null;
  const ref = component.label.trim() || "The charge-defined capacitor";
  return `${ref} uses LTspice's Q=<charge expression> capacitor model. It requires the native ngspice engine; this preview solver will not replace it with a constant capacitance.`;
}

/** LTspice accepts negative constant capacitance for active network synthesis.
 * The packaged path translates it exactly through Q(V)=C*V. The preview
 * solvers intentionally decline it until their linear stamps are audited for
 * non-passive C, rather than rejecting it as malformed or changing the sign. */
export function previewNegativeCapacitorMessage(
  components: readonly SchematicComponent[],
): string | null {
  for (const component of components) {
    if (component.kind !== "capacitor" || isChargeDefinedCapacitor(component)) continue;
    let capacitance: number;
    try {
      capacitance = parseQuantity(stripIcSpec(component.value), "F");
    } catch {
      continue;
    }
    if (Number.isFinite(capacitance) && capacitance < 0) {
      const ref = component.label.trim() || "The negative capacitor";
      return `${ref} uses LTspice's negative-capacitance active-network model. It requires the native ngspice engine, where Tau preserves it exactly as Q(V)=C*V; this preview solver will not change or approximate its sign.`;
    }
  }
  return null;
}
