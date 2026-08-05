import type { ComponentKind } from "./types";
import { parseQuantity } from "../simulation/quantity";

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

/** Two-terminal static contact (switch / push-button) held open or closed. */
export function isStaticContactKind(kind: ComponentKind): boolean {
  return kind === "switch" || kind === "pushButton";
}

/** Closed / pressed / on for a static SPST contact. */
export function isStaticContactClosed(value: string): boolean {
  const state = value.trim().toLowerCase();
  return state.startsWith("closed")
    || state === "pressed"
    || state === "on"
    || state === "1";
}

/** SPDT throw toward the normally-open pole (default). NC / 2 → other pole. */
export function isSpdtThrowToNo(value: string): boolean {
  const state = value.trim().toLowerCase();
  if (state === "nc" || state === "2" || state.startsWith("nc")) return false;
  return true;
}

/** Photodiode photocurrent (A). Value is Iph; blank / "D" → 100 µA. */
export function photodiodePhotocurrentAmps(value: string): number {
  const t = value.trim().replace(/µ/g, "u");
  if (!t || /^d(iode)?$/i.test(t)) return 100e-6;
  try {
    const amps = parseQuantity(t, "A");
    return Number.isFinite(amps) && amps >= 0 ? amps : 100e-6;
  } catch {
    return 100e-6;
  }
}
