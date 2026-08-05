/**
 * Native single-deck `.step` family assembly (P1.6).
 *
 * The TypeScript re-run loop (`stepFamily` / App `runStepAnalysis`) already
 * expands each swept value into its own solver call and must **never** emit
 * `.step` into those decks (double-step). This module is the mutually
 * exclusive native path: one deck with `.step` emitted, one ngspice invoke,
 * multi-plot results consumed as a {@link StepFamilyResult}.
 *
 * Honesty gate:
 * - **source** and **param** sweeps are eligible (param leaves `{X}` unresolved
 *   and emits `.param` / `.step param` in the deck builder).
 * - **temp** still needs ngspice-visible tempcos (inline `tc=` is TS-only).
 * - Param braces inside SINE/PULSE/PWL/… or `AC {…}` fall back to the TS path
 *   until those emitters pass braces through honestly.
 */

import type { SchematicComponent } from "../schematic/types";
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

const WAVEFORM_FN_RE = /\b(?:SINE|SIN|PULSE|PWL|EXP|SFFM)\s*\(/i;
const AC_BRACE_RE = /\bAC\b\s*\{/i;

export type NativeStepPathOptions = {
  /** Schematic parts — used to refuse param braces the deck cannot yet emit. */
  components?: ReadonlyArray<SchematicComponent>;
};

/** True when every axis can be honored by emitting `.step` without double-step. */
export function canUseNativeStepPath(
  specs: readonly StepSpec[],
  options: NativeStepPathOptions = {},
): boolean {
  return nativeStepPathRefusal(specs, options) === null;
}

/** Why the native single-deck path refuses these specs (or null when eligible). */
export function nativeStepPathRefusal(
  specs: readonly StepSpec[],
  options: NativeStepPathOptions = {},
): string | null {
  if (specs.length === 0) return "No .step directives to run natively.";
  if (specs.some((spec) => spec.kind === "temp")) {
    return (
      "Native single-deck .step does not yet support temperature sweeps "
      + "(inline tc= tempcos are applied only on the TypeScript path). "
      + "Tau will use the TypeScript re-run path instead."
    );
  }
  if (!specs.every((spec) => (spec.kind === "source" || spec.kind === "param") && Boolean(spec.name))) {
    return "Native single-deck .step only supports source and param sweeps right now.";
  }
  const paramNames = specs
    .filter((spec) => spec.kind === "param" && spec.name)
    .map((spec) => spec.name!.toLowerCase());
  if (paramNames.length > 0 && options.components) {
    const unsupported = unsupportedNativeParamBraceReason(options.components, new Set(paramNames));
    if (unsupported) return unsupported;
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

/**
 * Param braces the R/C/L/V DC emitters can leave for ngspice are fine; waveform
 * functions and `AC {…}` still bake/parse numerically and would silently ignore
 * the sweep — refuse those so the TS re-run path stays the honest fallback.
 */
export function unsupportedNativeParamBraceReason(
  components: ReadonlyArray<SchematicComponent>,
  steppedParamNames: ReadonlySet<string>,
): string | null {
  if (steppedParamNames.size === 0) return null;
  for (const component of components) {
    const value = component.value ?? "";
    if (!value.includes("{")) continue;
    if (!valueReferencesSteppedParam(value, steppedParamNames)) continue;
    if (WAVEFORM_FN_RE.test(value)) {
      return (
        "Native single-deck .step param cannot yet leave braces inside "
        + "SINE/PULSE/PWL/EXP/SFFM source functions. "
        + "Tau will use the TypeScript re-run path instead."
      );
    }
    if (AC_BRACE_RE.test(value)) {
      return (
        "Native single-deck .step param cannot yet leave braces in AC stimuli. "
        + "Tau will use the TypeScript re-run path instead."
      );
    }
  }
  return null;
}

function valueReferencesSteppedParam(value: string, steppedParamNames: ReadonlySet<string>): boolean {
  for (const name of steppedParamNames) {
    // Word-boundary match inside or outside braces (Rload, {Rload}, {2*Rload}).
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(name)}(?:[^A-Za-z0-9_]|$)`, "i");
    if (re.test(value)) return true;
  }
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
