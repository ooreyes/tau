/**
 * `.step` family-of-curves wiring (LTspice parity).
 *
 * The parser/value-enumerator and the generic `param` runner live in
 * `paramStep.ts`. This module turns a {@link StepSpec} into a list of concrete
 * {@link StepContext}s - one per swept value - that the UI can hand to *any*
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
import { withStepValue, parseStepDirective, type StepSpec } from "./paramStep";
import { applyTemperature } from "./temperature";

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
  /** Components to solve with (source/temp kinds rewrite here; otherwise = base). */
  components: SchematicComponent[];
  /** Analysis temperature (°C) for this member; set only for a `temp` sweep so
   *  the caller can also forward it to a native `.temp` deck. */
  temperature?: number;
}

/** Render a swept value as a compact, plain literal for a trace label / override. */
export function formatStepValue(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}

/**
 * Expand a `.step` spec into one {@link StepContext} per swept value (capped at
 * {@link MAX_FAMILY_MEMBERS}). Returns at most `MAX_FAMILY_MEMBERS` contexts even
 * when the spec enumerates more - the family overlay only needs a readable set.
 *
 * - **param**: the value is injected into a copy of `baseParams` ({@link withStepValue}).
 * - **source**: the component whose ref-des (`label`) matches `spec.name`
 *   (case-insensitive) has its `value` replaced with the swept literal; the
 *   scope is unchanged.
 * - **temp**: each value sets the analysis temperature; every temperature-
 *   dependent resistor (inline `tc=` tempco) is rescaled via {@link applyTemperature}
 *   and the value is carried on `context.temperature`.
 *
 * Throws when a `source` spec names a component that is not present, so the
 * caller can show a precise error instead of silently sweeping nothing.
 */
export function stepContexts(
  spec: StepSpec,
  baseParams: ParamScope,
  baseComponents: SchematicComponent[],
): StepContext[] {
  validateStep(spec, baseComponents);
  return spec.values.slice(0, MAX_FAMILY_MEMBERS).map((value) => {
    const t = applyStepValue(spec, value, baseParams, baseComponents);
    return { label: t.label, value, params: t.params, components: t.components, temperature: t.temperature };
  });
}

/** Check a spec can run against the base component list, throwing a precise
 *  message (missing sweep name; a `source` naming an absent component). Extracted
 *  so a nested product validates each axis once, up front. */
function validateStep(spec: StepSpec, baseComponents: SchematicComponent[]): void {
  if (spec.kind === "temp") return;
  if (!spec.name) throw new Error(`.step ${spec.kind} is missing a name to sweep.`);
  if (spec.kind === "source") {
    const name = spec.name;
    if (!baseComponents.some((c) => c.label.toLowerCase() === name.toLowerCase())) {
      throw new Error(`.step ${name}: no component named “${name}” to sweep.`);
    }
  }
}

/** Apply one spec's swept `value` to a (params, components) base, returning the
 *  transformed pair and a label fragment. Assumes {@link validateStep} passed. */
function applyStepValue(
  spec: StepSpec,
  value: number,
  params: ParamScope,
  components: SchematicComponent[],
): { label: string; params: ParamScope; components: SchematicComponent[]; temperature?: number } {
  if (spec.kind === "temp") {
    return { label: `temp=${formatStepValue(value)}`, params, components: applyTemperature(components, value), temperature: value };
  }
  const name = spec.name!;
  const label = `${name}=${formatStepValue(value)}`;
  if (spec.kind === "param") {
    return { label, params: withStepValue(params, name, value), components };
  }
  // source: override the matched component's value, leave the scope alone.
  const next = components.map((c) =>
    c.label.toLowerCase() === name.toLowerCase() ? { ...c, value: formatStepValue(value) } : c,
  );
  return { label, params, components: next };
}

/**
 * Expand two or more `.step` specs into the Cartesian product of contexts -
 * LTspice's nested outer×inner sweep (the first spec is the outermost loop).
 * Each member composes every axis's transform (param scope injection, source
 * override, temp rescale) onto the base, joins the axis labels with `", "`, and
 * merges the innermost temperature. The whole product is capped at
 * {@link MAX_FAMILY_MEMBERS} so a large grid stays a readable overlay.
 *
 * With a single spec this is exactly {@link stepContexts}; with none it returns
 * `[]`. `member.value` reflects the innermost axis (what the overlay colour-ramps).
 */
export function nestedStepContexts(
  specs: StepSpec[],
  baseParams: ParamScope,
  baseComponents: SchematicComponent[],
): StepContext[] {
  if (specs.length === 0) return [];
  if (specs.length === 1) return stepContexts(specs[0], baseParams, baseComponents);
  specs.forEach((spec) => validateStep(spec, baseComponents));

  let contexts: StepContext[] = [
    { label: "", value: 0, params: baseParams, components: baseComponents },
  ];
  for (const spec of specs) {
    const next: StepContext[] = [];
    outer: for (const ctx of contexts) {
      for (const value of spec.values) {
        const t = applyStepValue(spec, value, ctx.params, ctx.components);
        next.push({
          label: ctx.label ? `${ctx.label}, ${t.label}` : t.label,
          value,
          params: t.params,
          components: t.components,
          temperature: t.temperature ?? ctx.temperature,
        });
        if (next.length >= MAX_FAMILY_MEMBERS) break outer;
      }
    }
    contexts = next;
  }
  return contexts.slice(0, MAX_FAMILY_MEMBERS);
}

/** Collect every runnable `.step` spec from a directive block, outermost first
 *  (LTspice runs the first `.step` as the outer loop). Non-`.step` lines and
 *  unparsable specs are skipped. */
export function runnableStepsFromDirectives(directives: string[]): StepSpec[] {
  const specs: StepSpec[] = [];
  for (const directive of directives) {
    const spec = parseStepDirective(directive);
    if (isRunnableStep(spec)) specs.push(spec);
  }
  return specs;
}

/** True when the spec is a `.step` the interim engine can run a family for
 *  (param, source, or temp - the last via resistor tempco rescaling). */
export function isRunnableStep(spec: StepSpec | null): spec is StepSpec {
  return spec !== null && (spec.kind === "param" || spec.kind === "source" || spec.kind === "temp");
}
