/**
 * `.step` family-of-curves for the frequency- and DC-domain analyses
 * (FEATURE_PARITY §4 `.step`, §6 family overlay).
 *
 * `stepFamily.ts` builds the analysis-agnostic {@link StepContext}s (one per
 * swept value, nested products included) and the transient family is assembled
 * directly in `App`. This module is the AC/DC counterpart: a small generic core
 * ({@link runStepFamily}) that re-runs *any* synchronous solver once per context
 * and collects the results, plus two concrete wrappers ({@link runAcStepFamily},
 * {@link runDcStepFamily}) that drive the interim TS `.ac`/`.dc` solvers.
 *
 * Keeping the core generic over the result shape (via `resultOk`) means the
 * exact same family logic serves the Bode sweep and the DC sweep — and stays
 * unit-testable against the real TS solvers with no native engine.
 */

import type { SchematicComponent, SchematicWire, NetLabel } from "../schematic/types";
import type { ParamScope } from "./paramScope";
import type { StepSpec } from "./paramStep";
import type { CouplingSpec } from "./coupling";
import {
  nestedStepContexts,
  type StepContext,
} from "./stepFamily";
import { runAcSweep, type AcResult, type AcOptions } from "./acSweep";
import { runDcSweep, type DcSweepResult, type DcSweepSpec } from "./dcSweep";

/** One member of an arbitrary-analysis step family: a swept value + its result. */
export interface AnalysisFamilyMember<R> {
  label: string;
  value: number;
  result: R;
}

/** A family of any analysis's results produced by re-running a `.step` sweep. */
export interface AnalysisFamily<R> {
  ok: boolean;
  /** The outermost `.step` spec that drove the family (absent on failure). */
  spec?: StepSpec;
  members: AnalysisFamilyMember<R>[];
  /** Set when the family could not be built (no `.step`, bad source, …). */
  message?: string;
  warnings: string[];
}

/**
 * Re-run a synchronous analysis once per `.step` context, collecting a family
 * of results. Generic over the analysis: the caller supplies a `run(ctx)`
 * closure (uses `ctx.params`/`ctx.components`) and a `resultOk`/`resultWarnings`
 * accessor pair so this stays result-shape-agnostic.
 *
 * Multiple specs form LTspice's nested outer×inner product (via
 * {@link nestedStepContexts}); a single spec is the ordinary family; none yields
 * a clear `ok:false` message. Expansion errors (e.g. a `source` sweep naming an
 * absent component) surface as `ok:false` with the thrown message.
 */
export function runStepFamily<R>(
  specs: StepSpec[],
  baseParams: ParamScope,
  baseComponents: SchematicComponent[],
  run: (ctx: StepContext) => R,
  resultOk: (result: R) => boolean,
  resultWarnings: (result: R) => string[],
): AnalysisFamily<R> {
  if (specs.length === 0) {
    return {
      ok: false,
      message:
        "Add a “.step param <name> <start> <stop> <incr>”, “.step <source> …”, or “.step temp …” directive to sweep.",
      members: [],
      warnings: [],
    };
  }

  let contexts: StepContext[];
  try {
    contexts = nestedStepContexts(specs, baseParams, baseComponents);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not expand this .step.",
      members: [],
      warnings: [],
    };
  }

  const members: AnalysisFamilyMember<R>[] = contexts.map((ctx) => ({
    label: ctx.label,
    value: ctx.value,
    result: run(ctx),
  }));

  // Surface the first successful member's warnings (they share a circuit shape,
  // so a representative warning set is all the overlay needs).
  const firstOk = members.find((m) => resultOk(m.result));
  return {
    ok: members.some((m) => resultOk(m.result)),
    spec: specs[0],
    members,
    warnings: firstOk ? resultWarnings(firstOk.result) : [],
  };
}

/** Schematic inputs shared by the AC/DC family wrappers (base, un-swept). */
export interface FamilySchematic {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  couplings?: CouplingSpec[];
}

/**
 * Run an AC (Bode) sweep once per `.step` value, producing a family of
 * frequency responses to overlay. Each context's params/components drive the
 * TS `runAcSweep`; the base wires/netLabels/couplings are shared.
 */
export function runAcStepFamily(
  specs: StepSpec[],
  baseParams: ParamScope,
  schematic: FamilySchematic,
  options: AcOptions,
): AnalysisFamily<AcResult> {
  return runStepFamily(
    specs,
    baseParams,
    schematic.components,
    (ctx) =>
      runAcSweep(
        {
          components: ctx.components,
          wires: schematic.wires,
          netLabels: schematic.netLabels,
          params: ctx.params,
          couplings: schematic.couplings,
        },
        options,
      ),
    (result) => result.ok,
    (result) => result.warnings,
  );
}

/**
 * Run a DC source sweep once per `.step` value, producing a family of DC
 * transfer curves. The `.step` axis is the outer (family) sweep; `dcSpec` is
 * the per-run source sweep. Each context's params/components drive
 * `runDcSweep`; the base wires/netLabels are shared.
 */
export function runDcStepFamily(
  specs: StepSpec[],
  baseParams: ParamScope,
  schematic: Omit<FamilySchematic, "couplings">,
  dcSpec: DcSweepSpec,
): AnalysisFamily<DcSweepResult> {
  return runStepFamily(
    specs,
    baseParams,
    schematic.components,
    (ctx) =>
      runDcSweep(
        {
          components: ctx.components,
          wires: schematic.wires,
          netLabels: schematic.netLabels,
          params: ctx.params,
        },
        dcSpec,
      ),
    (result) => result.ok,
    (result) => result.warnings,
  );
}
