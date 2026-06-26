/**
 * `.step` family-of-curves wiring (FEATURE_PARITY §4 `.step`, §6 family overlay).
 *
 * The parser/value-enumerator and the generic `param` runner live in
 * `paramStep.ts`. This module turns a {@link StepSpec} into a list of concrete
 * {@link StepContext}s — one per swept value — that the UI can hand to *any*
 * solver (transient/AC/op, TS or native) to build a family of result curves.
 *
 * It is the piece `runParamStep` could not be: `runParamStep` only injects into
 * the param scope, but real LTspice `.step` directives also sweep a **source**
 * (override a component's value) or **temperature**. Keeping context-building
 * pure (no solver dependency) makes all three kinds unit-testable without a
 * native engine and lets the caller drive sync or async runners.
 */

import type { SchematicComponent } from "../schematic/types";
import type { ParamScope } from "./paramScope";
import type { AnalysisResult } from "./linearTransient";
import { withStepValue, type StepSpec } from "./paramStep";

/** One member of a stepped transient family: a swept value and its result. */
export interface StepFamilyMember {
  label: string;
  value: number;
  result: AnalysisResult;
}

/** A family of transient curves produced by re-running a `.step` sweep. */
export interface StepFamilyResult {
  ok: boolean;
  /** The `.step` spec that drove the family (absent on failure). */
  spec?: StepSpec;
  members: StepFamilyMember[];
  /** Set when the family could not be built (no `.step`, temp sweep, etc.). */
  message?: string;
  warnings: string[];
}

/** Cap on stepped runs surfaced as an overlay family, bounding native re-runs
 *  (a `.step` with hundreds of points would otherwise launch hundreds of sims). */
export const MAX_FAMILY_MEMBERS = 16;

/** One concrete step: the swept value with the scope and component list it
 *  should be solved against. Exactly one of scope/components differs from base. */
export interface StepContext {
  /** Human-facing trace label, e.g. `Rload=4700` or `V1=5`. */
  label: string;
  /** The swept value for this member. */
  value: number;
  /** Param scope to solve with (param-kind injects here; otherwise = base). */
  params: ParamScope;
  /** Components to solve with (source-kind overrides here; otherwise = base). */
  components: SchematicComponent[];
}

/** Render a swept value as a compact, plain literal for a trace label / override. */
export function formatStepValue(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}

/**
 * Expand a `.step` spec into one {@link StepContext} per swept value (capped at
 * {@link MAX_FAMILY_MEMBERS}). Returns at most `MAX_FAMILY_MEMBERS` contexts even
 * when the spec enumerates more — the family overlay only needs a readable set.
 *
 * - **param**: the value is injected into a copy of `baseParams` ({@link withStepValue}).
 * - **source**: the component whose ref-des (`label`) matches `spec.name`
 *   (case-insensitive) has its `value` replaced with the swept literal; the
 *   scope is unchanged.
 * - **temp**: throws — temperature sweep needs solver temp support that the
 *   interim engine does not model yet; the caller surfaces the message.
 *
 * Throws when a `source` spec names a component that is not present, so the
 * caller can show a precise error instead of silently sweeping nothing.
 */
export function stepContexts(
  spec: StepSpec,
  baseParams: ParamScope,
  baseComponents: SchematicComponent[],
): StepContext[] {
  if (spec.kind === "temp") {
    throw new Error("Temperature stepping (.step temp) isn’t supported by the interim solver yet.");
  }
  if (!spec.name) {
    throw new Error(`.step ${spec.kind} is missing a name to sweep.`);
  }
  const name = spec.name;

  if (spec.kind === "source") {
    const target = baseComponents.find((c) => c.label.toLowerCase() === name.toLowerCase());
    if (!target) {
      throw new Error(`.step ${name}: no component named “${name}” to sweep.`);
    }
  }

  const values = spec.values.slice(0, MAX_FAMILY_MEMBERS);
  return values.map((value) => {
    const label = `${name}=${formatStepValue(value)}`;
    if (spec.kind === "param") {
      return { label, value, params: withStepValue(baseParams, name, value), components: baseComponents };
    }
    // source: override the matched component's value, leave the scope alone.
    const components = baseComponents.map((c) =>
      c.label.toLowerCase() === name.toLowerCase() ? { ...c, value: formatStepValue(value) } : c,
    );
    return { label, value, params: baseParams, components };
  });
}

/** True when at least one of the spec's directives is a `.step` we can run
 *  (param or source). Temp specs are recognized by the parser but not runnable. */
export function isRunnableStep(spec: StepSpec | null): spec is StepSpec {
  return spec !== null && (spec.kind === "param" || spec.kind === "source");
}
