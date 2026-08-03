import type { SchematicComponent } from "./types";

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
