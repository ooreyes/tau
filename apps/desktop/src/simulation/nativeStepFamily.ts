/**
 * Native single-deck `.step` family assembly (P1.6 slice B).
 *
 * The TypeScript re-run loop (`stepFamily` / App `runStepAnalysis`) already
 * expands each swept value into its own solver call and must **never** emit
 * `.step` into those decks (double-step). This module is the mutually
 * exclusive native path: one deck with `.step` emitted, one ngspice invoke,
 * multi-plot results consumed as a {@link StepFamilyResult}.
 *
 * Honesty gate: only **source**-kind sweeps are eligible today. Tau still
 * bakes `{param}` braces into element values at deck build, so a native
 * `.step param` would not actually vary the circuit. Temp sweeps need
 * ngspice-visible tempcos (inline `tc=` is handled only on the TS path).
 */

import type { StepSpec } from "./paramStep";
import {
  assertStepFamilySize,
  formatStepValue,
  MAX_FAMILY_MEMBERS,
  type StepFamilyMember,
  type StepFamilyResult,
} from "./stepFamily";

/**
 * Maximum plots a native `.step` family may request. Must stay ≤
 * Rust `MAX_EXTRA_PLOTS + 1` (current plot + extras) in `spice.rs`.
 */
export const MAX_NATIVE_STEP_PLOTS = MAX_FAMILY_MEMBERS;

/** True when every axis can be honored by emitting `.step` without unresolved braces. */
export function canUseNativeStepPath(specs: readonly StepSpec[]): boolean {
  return nativeStepPathRefusal(specs) === null;
}

/** Why the native single-deck path refuses these specs (or null when eligible). */
export function nativeStepPathRefusal(specs: readonly StepSpec[]): string | null {
  if (specs.length === 0) return "No .step directives to run natively.";
  if (specs.some((spec) => spec.kind === "param")) {
    return (
      "Native single-deck .step does not yet support param sweeps "
      + "(Tau still resolves {param} braces before the deck reaches ngspice). "
      + "Tau will use the TypeScript re-run path instead."
    );
  }
  if (specs.some((spec) => spec.kind === "temp")) {
    return (
      "Native single-deck .step does not yet support temperature sweeps "
      + "(inline tc= tempcos are applied only on the TypeScript path). "
      + "Tau will use the TypeScript re-run path instead."
    );
  }
  if (!specs.every((spec) => spec.kind === "source" && Boolean(spec.name))) {
    return "Native single-deck .step only supports source sweeps right now.";
  }
  try {
    assertStepFamilySize(specs);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  let product = 1;
  for (const spec of specs) product *= spec.values.length;
  if (product > MAX_NATIVE_STEP_PLOTS) {
    return (
      `.step asks for ${product} plots; Tau's native transfer limit is ${MAX_NATIVE_STEP_PLOTS}. `
      + "Reduce the sweep or use the TypeScript re-run path."
    );
  }
  return null;
}

/** Cartesian product of axis labels in LTspice outer×inner order (first = outer). */
export function nativeStepMemberLabels(specs: readonly StepSpec[]): string[] {
  if (specs.length === 0) return [];
  let labels = [""];
  for (const spec of specs) {
    const name = spec.kind === "temp" ? "temp" : (spec.name ?? "step");
    const next: string[] = [];
    for (const prefix of labels) {
      for (const value of spec.values) {
        const fragment = `${name}=${formatStepValue(value)}`;
        next.push(prefix ? `${prefix}, ${fragment}` : fragment);
      }
    }
    labels = next;
  }
  return labels;
}

/** Innermost-axis value per member (overlay colour key), matching nestedStepContexts. */
export function nativeStepMemberValues(specs: readonly StepSpec[]): number[] {
  if (specs.length === 0) return [];
  const inner = specs[specs.length - 1]!;
  const outerCount = specs.slice(0, -1).reduce((n, spec) => n * spec.values.length, 1);
  const out: number[] = [];
  for (let o = 0; o < outerCount; o += 1) {
    for (const value of inner.values) out.push(value);
  }
  return out;
}

export interface NativePlotVectors {
  name: string;
  vectors: ReadonlyArray<{ name: string; real: number[]; imaginary: number[] | null }>;
}

/**
 * Order ngspice step plots oldest→newest. The IPC payload keeps the newest
 * plot as the primary `vectors` and earlier steps in `extraPlots` (creation
 * order). Concatenating extras then current matches `.step` enumeration order.
 */
export function orderNativeStepPlots(
  current: NativePlotVectors,
  extraPlots: ReadonlyArray<NativePlotVectors>,
): NativePlotVectors[] {
  return [...extraPlots, current];
}

/**
 * Zip ordered native plots with expected step labels into a family.
 * Mismatched plot/label counts refuse rather than inventing members.
 */
export function assembleNativeStepFamily(
  plots: ReadonlyArray<NativePlotVectors>,
  specs: readonly StepSpec[],
  memberFromPlot: (plot: NativePlotVectors, label: string, value: number, index: number) => StepFamilyMember,
): StepFamilyResult {
  const refusal = nativeStepPathRefusal(specs);
  if (refusal) {
    return { ok: false, message: refusal, members: [], warnings: [] };
  }
  const labels = nativeStepMemberLabels(specs);
  const values = nativeStepMemberValues(specs);
  if (plots.length !== labels.length) {
    return {
      ok: false,
      message:
        `ngspice returned ${plots.length} step plot(s) but .step asks for ${labels.length}. `
        + "No partial family was fabricated.",
      members: [],
      warnings: [],
    };
  }
  const members = plots.map((plot, index) =>
    memberFromPlot(plot, labels[index]!, values[index]!, index),
  );
  const warnings = members.find((m) => m.result.ok)?.result.warnings ?? [];
  return {
    ok: members.some((m) => m.result.ok),
    spec: specs[0],
    members,
    warnings,
  };
}
