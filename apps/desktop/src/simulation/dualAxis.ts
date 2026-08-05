/**
 * Dual Y-axis planning for mixed voltage/current panes (LTspice parity).
 *
 * When a single transient pane holds both volt and amp traces, LTspice draws
 * volts on the left axis and amps on the right. Tau previously collapsed mixed
 * units to a blank/`V` axis via {@link commonTraceUnit}. This module decides
 * when a pane qualifies for dual-Y and which side each unit belongs on —
 * pure, DOM-free, unit-tested.
 */

import type { TraceUnit } from "./linearTransient";

export type DualAxisSide = "left" | "right";

export interface DualAxisPlan {
  /** True only for a clean V+A mix (exactly those two electrical units). */
  dual: boolean;
  /** Left-axis unit (volts when dual). */
  leftUnit: TraceUnit;
  /** Right-axis unit (amps when dual); null in single-axis mode. */
  rightUnit: TraceUnit | null;
}

/**
 * Plan left/right Y axes for a pane's trace units.
 *
 * - All same unit (or empty) → single axis with that unit (default `"V"`).
 * - Exactly `{V, A}` (order-independent; blanks ignored) → dual: left V, right A.
 * - Any other mix (V+W, three units, …) → single axis with `""` (caller falls
 *   back), matching prior `commonTraceUnit` honesty — we do not invent a third
 *   axis or silently drop a unit onto the wrong scale.
 */
export function planDualAxisY(units: ReadonlyArray<TraceUnit>): DualAxisPlan {
  const seen = [...new Set(units.filter((u) => u !== ""))];
  if (seen.length === 0) {
    return { dual: false, leftUnit: "V", rightUnit: null };
  }
  if (seen.length === 1) {
    return { dual: false, leftUnit: seen[0], rightUnit: null };
  }
  const set = new Set(seen);
  if (set.size === 2 && set.has("V") && set.has("A")) {
    return { dual: true, leftUnit: "V", rightUnit: "A" };
  }
  return { dual: false, leftUnit: "", rightUnit: null };
}

/** Which Y axis a trace with `unit` uses under `plan`. Unknown → left. */
export function dualAxisSide(unit: TraceUnit, plan: DualAxisPlan): DualAxisSide {
  if (!plan.dual) return "left";
  if (unit === plan.rightUnit) return "right";
  return "left";
}

/**
 * Split traces into left/right groups for bounds + path mapping.
 * Empty-unit traces ride the left axis (same as a bare voltage probe).
 */
export function partitionTracesByAxis<T extends { unit: TraceUnit }>(
  traces: ReadonlyArray<T>,
  plan: DualAxisPlan,
): { left: T[]; right: T[] } {
  if (!plan.dual) return { left: [...traces], right: [] };
  const left: T[] = [];
  const right: T[] = [];
  for (const t of traces) {
    if (dualAxisSide(t.unit, plan) === "right") right.push(t);
    else left.push(t);
  }
  return { left, right };
}
