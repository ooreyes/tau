import type { ComponentKind } from "./types";

/** Capacitor device kinds that share the same C stamps. */
export function isCapacitorKind(kind: ComponentKind): boolean {
  return kind === "capacitor";
}

/**
 * Ideal independent voltage sources that participate in the MNA V-branch
 * (branch current unknown). `vpulse` is emitted as a time function on the same
 * pins but is handled separately in the transient solver.
 */
export function isIndependentVoltageBranchKind(kind: ComponentKind): boolean {
  return kind === "vsource" || kind === "vac";
}
