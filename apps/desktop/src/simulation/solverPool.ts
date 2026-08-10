/**
 * A small pool of solver workers, and the promise that using it changes
 * nothing observable.
 *
 * Every export here is a drop-in for the plain solver call it shadows:
 * {@link runTransientAnalysisOffThread} takes and returns exactly what
 * `runTransientAnalysis` does, honours the same `onProgress` stream, aborts on
 * the same `AbortSignal`, resolves with the same partial `ok: true` result when
 * it does, and - like the function it stands in for - never rejects. The only
 * difference is which thread the arithmetic ran on.
 *
 * **The fallback is not a nicety, it is the load-bearing half.** There is no
 * `Worker` in a Node process, and the entire test suite runs under vitest with
 * `environment: "node"`; there is none in jsdom either. A worker can also fail
 * to construct (a hardened webview, a blocked module script) or die mid-job.
 * In every one of those cases the work is done inline on the calling thread
 * through the identical {@link runSolverJob} the worker would have called, so
 * the app degrades to precisely its old behaviour rather than to an error.
 *
 * Pool size is `min(hardwareConcurrency - 1, 8)`, floored at 1: one core is
 * left for the thread that has to paint the results, and the ceiling exists
 * because a `.step` family is memory-bound as much as compute-bound - past a
 * handful of concurrent solves the extra threads contend for cache and
 * allocation rather than adding throughput. Workers are created on demand and
 * then kept: a module worker costs tens of milliseconds to boot, which is a
 * large fraction of a small solve, so paying it once per session beats paying
 * it once per run.
 */

import type { AnalysisOptions, AnalysisResult, TransientRunControl } from "./linearTransient";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep, type AcOptions, type AcResult } from "./acSweep";
import { runDcSweep, type DcSweepResult, type DcSweepSpec } from "./dcSweep";
import {
  runSolverJob,
  unpackSolverResult,
  type SolverJob,
  type SolverJobResult,
  type SolverJobSchematic,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "./solverJobs";

/** See the module comment: one core stays with the UI, and past eight threads
 *  a family sweep stops scaling. */
const MAX_POOL_WORKERS = 8;

interface PendingJob {
  token: number;
  settle: (outcome: { ok: true; result: SolverJobResult } | { ok: false }) => void;
  onProgress?: (fraction: number) => void;
}

interface PooledWorker {
  worker: Worker;
  /** The job this worker is running, or null when it is idle. */
  pending: PendingJob | null;
  /** Set once the worker has been terminated so a late event cannot resurrect
   *  it into the idle list. */
  retired: boolean;
}

const workers: PooledWorker[] = [];
const idle: PooledWorker[] = [];
/** Callers parked because every worker is busy, served first-come-first-served
 *  so a long family sweep cannot starve a run the user just started. */
const waiting: ((worker: PooledWorker | null) => void)[] = [];

let nextToken = 1;
/**
 * Set when workers have proven themselves unusable in this environment, which
 * is a different thing from one worker dying. A webview that cannot load module
 * workers at all fails on the very first attempt, and retrying that per solve
 * would add a failed thread spawn to every run forever; a worker that dies
 * after the pool has already produced results is a one-off and leaves the pool
 * enabled.
 */
let poolDisabled = false;
let anyWorkerSucceeded = false;

/** `hardwareConcurrency` is absent in some webviews and reported as 0 in a few;
 *  both fall through the `Math.max` to a single worker, which is still off the
 *  UI thread and still the whole point of phase one. */
function desiredPoolSize(): number {
  const cores =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 0;
  return Math.max(1, Math.min(MAX_POOL_WORKERS, cores - 1));
}

function workersUsable(): boolean {
  return !poolDisabled && typeof Worker !== "undefined";
}

/** How many solves this environment can genuinely run at once. Callers use it
 *  to size their own batching; it reports 1 wherever the fallback is in force,
 *  which is the honest answer - the inline path is one solve at a time. */
export function solverConcurrency(): number {
  return workersUsable() ? desiredPoolSize() : 1;
}

function createWorker(): PooledWorker | null {
  let worker: Worker;
  try {
    // Vite resolves this form statically and emits the worker as its own
    // chunk; the `new URL(..., import.meta.url)` shape is what it matches on,
    // so it must stay literal. Guarded by `workersUsable` above, so a runtime
    // without `Worker` never reaches the constructor.
    worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  } catch {
    disablePool();
    return null;
  }

  const slot: PooledWorker = { worker, pending: null, retired: false };

  worker.addEventListener("message", (event: MessageEvent<SolverWorkerResponse>) => {
    const message = event.data;
    const pending = slot.pending;
    // A message whose token does not match the job in flight belongs to a job
    // that already settled - typically a progress post that was in the queue
    // when an abort landed. Replaying it into the next job's callbacks would
    // report another run's progress, so stale tokens are dropped.
    if (!pending || pending.token !== message.token) return;
    if (message.type === "progress") {
      pending.onProgress?.(message.fraction);
      return;
    }
    slot.pending = null;
    if (message.type === "done") {
      anyWorkerSucceeded = true;
      // Free the worker before rebuilding the arrays, so the slot is already
      // handed to the next queued job by the time this task ends rather than
      // sitting idle behind an unpack that has nothing to do with it.
      releaseWorker(slot);
      pending.settle({ ok: true, result: unpackSolverResult(message.result) });
    } else {
      releaseWorker(slot);
      pending.settle({ ok: false });
    }
  });

  // An `error` here is the worker itself failing - the module script not
  // loading, or the thread dying - not a solver returning `ok: false`, which
  // arrives as an ordinary `done`. Either way the thread is no longer
  // trustworthy, so it is retired and the caller falls back inline.
  const fail = () => retireWorker(slot);
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", fail);

  workers.push(slot);
  return slot;
}

function disablePool(): void {
  poolDisabled = true;
  // Anyone parked waiting for a worker that will never exist has to be told to
  // run inline instead, or they wait forever.
  while (waiting.length > 0) waiting.shift()?.(null);
}

function retireWorker(slot: PooledWorker): void {
  if (slot.retired) return;
  slot.retired = true;
  slot.worker.terminate();
  const index = workers.indexOf(slot);
  if (index >= 0) workers.splice(index, 1);
  const idleIndex = idle.indexOf(slot);
  if (idleIndex >= 0) idle.splice(idleIndex, 1);

  const pending = slot.pending;
  slot.pending = null;
  pending?.settle({ ok: false });

  // A worker dying before the pool has ever produced a single result says the
  // environment cannot run them, not that one job was unlucky.
  if (!anyWorkerSucceeded) disablePool();
}

function releaseWorker(slot: PooledWorker): void {
  if (slot.retired) return;
  const next = waiting.shift();
  if (next) next(slot);
  else idle.push(slot);
}

async function acquireWorker(): Promise<PooledWorker | null> {
  if (!workersUsable()) return null;
  // Last in, first out: the most recently used worker is the one whose code
  // and heap are still warm.
  const free = idle.pop();
  if (free) return free;
  if (workers.length < desiredPoolSize()) return createWorker();
  return new Promise<PooledWorker | null>((resolve) => waiting.push(resolve));
}

/**
 * Hand one job to one worker. Resolves with the worker's answer, or with null
 * when the worker could not deliver one - a broken thread, or a job the
 * structured clone algorithm refuses. Never rejects: the caller's contract
 * forbids it, and "the worker could not do this" is a routing decision, not an
 * error to surface.
 */
function runOnWorker(
  slot: PooledWorker,
  job: SolverJob,
  control?: TransientRunControl,
): Promise<SolverJobResult | null> {
  return new Promise<SolverJobResult | null>((resolve) => {
    const token = nextToken;
    nextToken += 1;
    const signal = control?.signal;

    let onAbort: (() => void) | undefined;
    const settle = (outcome: { ok: true; result: SolverJobResult } | { ok: false }) => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      resolve(outcome.ok ? outcome.result : null);
    };

    slot.pending = { token, settle, onProgress: control?.onProgress };

    // An abort that arrives while the solve is in flight is forwarded as a
    // message; a signal that was *already* aborted is passed as `startAborted`
    // instead, because the worker has to be told at dispatch time - there will
    // be no later event to relay.
    if (signal && !signal.aborted) {
      onAbort = () => slot.worker.postMessage({ type: "abort", token } satisfies SolverWorkerRequest);
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      slot.worker.postMessage({
        type: "run",
        token,
        job,
        startAborted: signal?.aborted ?? false,
        wantProgress: control?.onProgress !== undefined,
      } satisfies SolverWorkerRequest);
    } catch {
      // Structured clone refused the job. The worker is healthy, so it goes
      // straight back into rotation and only this job falls back inline.
      slot.pending = null;
      releaseWorker(slot);
      settle({ ok: false });
    }
  });
}

/**
 * Run a job wherever it can be run: on a pool worker when one exists, inline
 * otherwise, and inline again if the worker fails to answer. The inline path
 * calls the same {@link runSolverJob} the worker calls, over the same inputs,
 * so the two produce identical numbers rather than merely similar ones.
 */
async function dispatch(job: SolverJob, control?: TransientRunControl): Promise<SolverJobResult> {
  const slot = await acquireWorker();
  if (!slot) return runSolverJob(job, control);
  const settled = await runOnWorker(slot, job, control);
  return settled ?? runSolverJob(job, control);
}

/**
 * The off-thread stand-in for `runTransientAnalysis`, with an identical
 * signature and identical guarantees.
 */
export async function runTransientAnalysisOffThread(
  schematic: SolverJobSchematic,
  options: AnalysisOptions,
  control?: TransientRunControl,
): Promise<AnalysisResult> {
  const settled = await dispatch({ kind: "tran", schematic, options }, control);
  // The pool matches every answer to the request that produced it by token, so
  // a job can only come back tagged with the kind it was sent as. The check is
  // here so the narrowing is proven rather than asserted, and its unreachable
  // branch does the only sane thing: answer the question that was asked.
  return settled.kind === "tran" ? settled.result : runTransientAnalysis(schematic, options, control);
}

/** The off-thread stand-in for `runAcSweep`. Synchronous on the calling side
 *  becomes a promise here; the sweep itself is unchanged. */
export async function runAcSweepOffThread(
  schematic: SolverJobSchematic,
  options: AcOptions,
): Promise<AcResult> {
  const settled = await dispatch({ kind: "ac", schematic, options });
  return settled.kind === "ac" ? settled.result : runAcSweep(schematic, options);
}

/** The off-thread stand-in for `runDcSweep`. */
export async function runDcSweepOffThread(
  schematic: SolverJobSchematic,
  spec: DcSweepSpec,
): Promise<DcSweepResult> {
  const settled = await dispatch({ kind: "dc", schematic, spec });
  return settled.kind === "dc" ? settled.result : runDcSweep(schematic, spec);
}
