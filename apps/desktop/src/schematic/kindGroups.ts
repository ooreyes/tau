import type { ComponentKind } from "./types";

/** Ordinary and polarized capacitors share the same C device / stamps. */
export function isCapacitorKind(kind: ComponentKind): boolean {
  return kind === "capacitor" || kind === "polarizedCapacitor";
}

/**
 * Ideal independent voltage sources that participate in the MNA V-branch
 * (branch current unknown). `vpulse` is emitted as a time function on the same
 * pins but is handled separately in the transient solver.
 */
export function isIndependentVoltageBranchKind(kind: ComponentKind): boolean {
  return kind === "vsource" || kind === "vac" || kind === "logicConstant";
}

/** Parse a logic-constant value to volts. EveryCircuit-style 0/1, plus optional
 *  engineering voltage (e.g. "5" for 5 V logic). */
export function logicConstantVolts(value: string): number {
  const t = value.trim().toLowerCase();
  if (t === "" || t === "0" || t === "low" || t === "l" || t === "false") return 0;
  if (t === "1" || t === "high" || t === "h" || t === "true") return 1;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  throw new Error(`Logic constant value must be 0, 1, or a voltage number (got "${value}").`);
}
