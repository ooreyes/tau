/**
 * `.step` family-of-curves for the frequency- and DC-domain analyses
 * (LTspice parity).
 *
 * `stepFamily.ts` builds the analysis-agnostic {@link StepContext}s (one per
 * swept value, nested products included) and the transient family is assembled
 * directly in `App`. This module is the AC/DC counterpart: a small generic core
 * ({@link runStepFamily}) that re-runs *any* synchronous solver once per context
 * and collects the results, plus two concrete wrappers ({@link runAcStepFamily},
 * {@link runDcStepFamily}) that drive the interim TS `.ac`/`.dc` solvers.
 *
 * Keeping the core generic over the result shape (via `resultOk`) means the
 * exact same family logic serves the Bode sweep and the DC sweep - and stays
 * unit-testable against the real TS solvers with no native engine.
 */

import type { SchematicComponent, SchematicWire, NetLabel } from "../schematic/types";
import type { ParamScope } from "./paramScope";
import type { StepSpec } from "./paramStep";
import type { CouplingSpec } from "./coupling";
import {
  nestedStepContexts,
  stepTruncationWarning,
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
  // The truncation notice leads: it describes the sweep the user asked for
  // rather than one member's circuit, and it is the one warning that changes
  // how the whole overlay should be read.
  const truncation = stepTruncationWarning(specs);
  return {
    ok: members.some((m) => resultOk(m.result)),
    spec: specs[0],
    members,
    warnings: [
      ...(truncation ? [truncation] : []),
      ...(firstOk ? resultWarnings(firstOk.result) : []),
    ],
  };
}

/**
 * One curve of a family overlay: the chosen signal at one step value. The UI
 * draws `series` with one color per step and labels each with the step value
 * (e.g. `Rval=1000`), mirroring the transient `StepPlot`.
 */
export interface AcFamilyOverlay {
  /** The signal plotted across the family (first trace of the first ok member). */
  signal: string;
  series: { label: string; freqs: number[]; magDb: number[]; phaseDeg: number[] }[];
}

/** True when two sampled series differ anywhere beyond numerical noise. */
function seriesDiffer(a: number[], b: number[]): boolean {
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return true;
  }
  return a.length !== b.length;
}

/**
 * Reduce an AC `.step` family to one plottable signal across all successful
 * members. The chosen signal is the first trace of the first ok member that
 * actually *responds* to the step (differs between members) - a source node
 * pinned at 0 dB would make a useless family - falling back to the first trace
 * when everything is flat. Members that lost the signal are skipped, not
 * errors. Returns `null` when there is nothing to draw (no family, all-failed,
 * no traces).
 */
export function acFamilyOverlaySeries(
  family: AnalysisFamily<AcResult> | null | undefined,
): AcFamilyOverlay | null {
  if (!family?.ok) return null;
  const ok: { label: string; result: Extract<AcResult, { ok: true }> }[] = [];
  for (const member of family.members) {
    if (member.result.ok) ok.push({ label: member.label, result: member.result });
  }
  const first = ok[0]?.result;
  if (!first) return null;
  const chosen =
    first.traces.find((t) =>
      ok.some((m) => {
        const other = m.result.traces.find((o) => o.id === t.id);
        return other !== undefined && seriesDiffer(other.magDb, t.magDb);
      }),
    ) ?? first.traces[0];
  if (!chosen) return null;
  const series: AcFamilyOverlay["series"] = [];
  for (const member of ok) {
    const trace = member.result.traces.find((t) => t.id === chosen.id);
    if (!trace) continue;
    series.push({ label: member.label, freqs: member.result.freqs, magDb: trace.magDb, phaseDeg: trace.phaseDeg });
  }
  return series.length > 0 ? { signal: chosen.label, series } : null;
}

/** The DC counterpart of {@link AcFamilyOverlay}: one transfer curve per step. */
export interface DcFamilyOverlay {
  /** The signal plotted across the family (first non-ground net of the first ok member). */
  signal: string;
  series: { label: string; sweep: number[]; voltages: number[] }[];
}

/**
 * Reduce a DC `.step` family to one plottable net across all successful
 * members. Ground (always 0 V) is excluded; among the rest the chosen net is
 * the first that responds to the step (differs between members) - the swept
 * source's own node is identical in every member - falling back to the first
 * non-ground net when everything matches. Returns `null` when there is
 * nothing to draw.
 */
export function dcFamilyOverlaySeries(
  family: AnalysisFamily<DcSweepResult> | null | undefined,
): DcFamilyOverlay | null {
  if (!family?.ok) return null;
  const ok: { label: string; result: Extract<DcSweepResult, { ok: true }> }[] = [];
  for (const member of family.members) {
    if (member.result.ok) ok.push({ label: member.label, result: member.result });
  }
  const first = ok[0]?.result;
  if (!first) return null;
  const candidates = first.nets.filter((n) => !n.ground);
  const chosen =
    candidates.find((n) =>
      ok.some((m) => {
        const other = m.result.nets.find((o) => o.id === n.id);
        return other !== undefined && seriesDiffer(other.voltages, n.voltages);
      }),
    ) ?? candidates[0];
  if (!chosen) return null;
  const series: DcFamilyOverlay["series"] = [];
  for (const member of ok) {
    const net = member.result.nets.find((n) => n.id === chosen.id);
    if (!net) continue;
    series.push({ label: member.label, sweep: member.result.sweep, voltages: net.voltages });
  }
  return series.length > 0 ? { signal: chosen.label, series } : null;
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
