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

/* ------------------------------------------------------------------------ *
 * Getting the answer back without spending the saving on the return trip.
 *
 * Moving the solve off the main thread is only a win if handing the result
 * back is cheap, and by default it is not. A worker's reply is structured
 * cloned, and the deserialising half of that clone runs on the main thread in
 * one uninterruptible task. Measured on a 20 000-step, nine-node transient -
 * 540 027 samples across 28 series - that task was **75 ms**: four dropped
 * frames, arriving exactly when the user expects to see their waveform, and
 * enough to make the peak stall *worse* than the 30-60 ms the cooperative
 * yields used to produce.
 *
 * The fix is to stop copying the samples at all. A `Float64Array` moves as a
 * transferable: its buffer changes owner, nothing is walked, and the receiving
 * side pays nothing for the bytes. On the same machine, cloning one 540 027
 * element `number[]` costs 21.2 ms while cloning the equivalent `Float64Array`
 * costs 1.1 ms, and rebuilding a plain array from it in a preallocated loop
 * costs 4.2 ms - so the whole round trip lands near 5 ms instead of 75 ms.
 *
 * The rebuild back to `number[]` is deliberate. The declared result types say
 * `number[]`, the plot, measurement and export layers assume it, and hundreds
 * of tests compare against literal arrays; a `Float64Array` leaking out of the
 * worker would be a public type change dressed up as an optimisation. The
 * round trip is exact - every IEEE-754 double, including `NaN`, the infinities
 * and negative zero, survives a `Float64Array` unchanged - so the value the
 * caller sees is bit-for-bit the value the solver computed.
 * ------------------------------------------------------------------------ */

/**
 * Below this length a series is not worth a transferable. Each one costs an
 * `ArrayBuffer` allocation, an entry in the transfer list and a rebuild on the
 * far side; a handful of samples clones faster than all of that.
 */
const TRANSFERABLE_SERIES_MIN = 64;

/**
 * Copy an array into a `Float64Array`, or return null when it turns out not to
 * be a numeric series after all.
 *
 * Every element is type-checked rather than just the first: an
 * `ExtractedNet`'s `points` is an array of objects, and inferring the whole
 * array's type from element zero would be a rule that happens to hold today
 * rather than one that is true. The check and the copy share a single indexed
 * pass, and the copy is written by hand instead of with `Float64Array.from`,
 * because `from` goes through the iterator protocol for anything iterable -
 * and an array is iterable. On a 3.3-million-sample transient the tidy
 * two-pass `for..of` + `from` version cost 119 ms; this costs a fraction of
 * that, and it runs on the worker where every millisecond is still latency the
 * user waits through.
 */
function toNumberSeries(value: unknown[]): Float64Array | null {
  const length = value.length;
  if (length < TRANSFERABLE_SERIES_MIN) return null;
  const packed = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const item = value[i];
    if (typeof item !== "number") return null;
    packed[i] = item;
  }
  return packed;
}

function packValue(value: unknown, seen: Set<object>, transfer: Transferable[]): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    const packed = toNumberSeries(value);
    if (packed) {
      transfer.push(packed.buffer);
      return packed;
    }
    for (let i = 0; i < value.length; i += 1) value[i] = packValue(value[i], seen, transfer);
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = packValue(record[key], seen, transfer);
  return record;
}

/**
 * Rewrite a result's numeric series as transferable `Float64Array`s, in place,
 * and list the buffers to hand over. Called only inside the worker, on a
 * result the worker is about to discard, so mutating it is free.
 */
export function packSolverResult(result: SolverJobResult): { payload: SolverJobResult; transfer: Transferable[] } {
  const transfer: Transferable[] = [];
  const payload = packValue(result, new Set(), transfer) as SolverJobResult;
  return { payload, transfer };
}

function unpackValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Float64Array) {
    // A preallocated loop, not `Array.from`: same result, measured 4.2 ms
    // against 19.1 ms for half a million samples, and this one runs on the
    // thread the whole exercise exists to keep free.
    const out = new Array<number>(value.length);
    for (let i = 0; i < value.length; i += 1) out[i] = value[i];
    return out;
  }
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = unpackValue(value[i], seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = unpackValue(record[key], seen);
  return record;
}

/**
 * Undo {@link packSolverResult}: every transferred series becomes a plain
 * `number[]` again, so nothing downstream can tell the result crossed a
 * thread. Mutates the freshly deserialised message, which nobody else holds.
 */
export function unpackSolverResult(payload: SolverJobResult): SolverJobResult {
  return unpackValue(payload, new Set()) as SolverJobResult;
}
