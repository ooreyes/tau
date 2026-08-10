/**
 * The unit of work the preview solvers can be handed *somewhere else*.
 *
 * The TypeScript solvers (`runTransientAnalysis`, `runAcSweep`, `runDcSweep`)
 * are ordinary functions taking rich argument lists, and that is exactly what
 * cannot cross a Web Worker boundary: a worker is addressed with one
 * structured-cloneable message, not with a call signature. This module is the
 * narrowing that makes the crossing possible - a single discriminated
 * {@link SolverJob} describing *which* preview analysis to run and with what
 * inputs, and a single {@link runSolverJob} that turns one back into a call.
 *
 * Everything in a job and in a {@link SolverJobResult} is deliberately plain
 * data: schematic components, wires, net labels, a numeric `.param` scope, and
 * result arrays of doubles. Nothing here may grow a function, a `Map`, a class
 * instance, or a DOM handle, because `postMessage` would throw a
 * `DataCloneError` on it and the whole offload would silently fall back to the
 * main thread. The types below are the enforcement point for that rule.
 *
 * The other half of the point is that `runSolverJob` is the *only* place a job
 * is executed. The worker calls it and the main-thread fallback calls it, so
 * the two paths cannot drift: a result produced off-thread runs the identical
 * solver code over the identical inputs, and is therefore bit-identical to the
 * one the main thread would have produced. That guarantee is why the offload
 * is safe to make unconditional rather than opt-in.
 */

import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import type { CouplingSpec } from "./coupling";
import type { ParamScope } from "./paramScope";
import { runTransientAnalysis, type AnalysisOptions, type AnalysisResult, type TransientRunControl } from "./linearTransient";
import { runAcSweep, type AcOptions, type AcResult } from "./acSweep";
import { runDcSweep, type DcSweepResult, type DcSweepSpec } from "./dcSweep";

/** The schematic inputs every preview solver takes, in their broadest form.
 *  `runDcSweep` ignores `couplings` (it has no inductor stamps to couple), so
 *  one shape serves all three rather than three near-identical ones. */
export interface SolverJobSchematic {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels?: NetLabel[];
  params?: ParamScope;
  couplings?: CouplingSpec[];
}

export type SolverJob =
  | { kind: "tran"; schematic: SolverJobSchematic; options: AnalysisOptions }
  | { kind: "ac"; schematic: SolverJobSchematic; options: AcOptions }
  | { kind: "dc"; schematic: SolverJobSchematic; spec: DcSweepSpec };

/** A job's answer, tagged with the job kind so the caller can narrow back to
 *  the concrete result type it asked for without an unchecked cast. */
export type SolverJobResult =
  | { kind: "tran"; result: AnalysisResult }
  | { kind: "ac"; result: AcResult }
  | { kind: "dc"; result: DcSweepResult };

/**
 * Run one job to completion.
 *
 * Only the transient solver has anything to say mid-flight, so `control` is
 * forwarded only there; the AC and DC sweeps are synchronous by construction
 * and finish in one turn. Awaiting them anyway costs a microtask and keeps
 * every caller on one uniform `Promise` shape.
 */
export async function runSolverJob(
  job: SolverJob,
  control?: TransientRunControl,
): Promise<SolverJobResult> {
  switch (job.kind) {
    case "tran":
      return { kind: "tran", result: await runTransientAnalysis(job.schematic, job.options, control) };
    case "ac":
      return { kind: "ac", result: runAcSweep(job.schematic, job.options) };
    case "dc":
      return { kind: "dc", result: runDcSweep(job.schematic, job.spec) };
  }
}

/* ------------------------------------------------------------------------ *
 * The wire format between the pool and one worker.
 *
 * A worker runs exactly one job at a time - the pool owns the queueing - so a
 * single `token` per worker is enough to tell a live conversation from a stale
 * one. Tokens matter because an abandoned job (its requester gave up, or the
 * worker was recycled) can still deliver messages afterwards, and replaying
 * those into the next job's callbacks would corrupt an unrelated run.
 * ------------------------------------------------------------------------ */

/** Pool → worker. `startAborted` exists because an `AbortSignal` cannot be
 *  cloned: a signal that was already aborted before dispatch has to be
 *  reconstructed inside the worker, and it must be reconstructed as *aborted
 *  from the start* so the solver stops at its first checkpoint exactly as it
 *  would have on the main thread. */
export type SolverWorkerRequest =
  | { type: "run"; token: number; job: SolverJob; startAborted: boolean; wantProgress: boolean }
  | { type: "abort"; token: number };

/** Worker → pool. A job that throws is reported rather than left to the
 *  worker's `error` event, so the pool can distinguish "this job failed" from
 *  "this worker is broken" and only retire the worker for the latter. */
export type SolverWorkerResponse =
  | { type: "progress"; token: number; fraction: number }
  | { type: "done"; token: number; result: SolverJobResult }
  | { type: "failed"; token: number; message: string };
