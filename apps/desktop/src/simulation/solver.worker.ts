/**
 * The preview solvers, running on a thread that is not the one painting the
 * app.
 *
 * Before this existed the TypeScript solver owned the main thread outright and
 * stayed nominally responsive by yielding cooperatively every ~16 ms (see
 * `yieldToEventLoop` in `linearTransient.ts`). Those yields are cheap - one
 * was measured at 0.108 ms - and they are not the problem. The problem is what
 * they cannot fix: between two yields the browser cannot paint or run an event
 * handler, so every frame during a solve is a frame the maths is holding, and
 * no amount of yielding lets the arithmetic use a second core. Moving the same
 * code to a worker fixes both at once, and it does it without touching a line
 * of the numerics.
 *
 * This file is deliberately thin. It owns no maths; it decodes a message into
 * a {@link SolverJob}, hands it to the shared {@link runSolverJob}, and encodes
 * the answer back. Every numerical decision still lives in the solver modules,
 * which is what keeps an off-thread result bit-identical to an on-thread one.
 *
 * Cancellation crosses the boundary as a message rather than as a shared flag.
 * A `SharedArrayBuffer` would be the lower-latency channel, but it requires
 * cross-origin isolation headers that the Tauri shell and the dev server do not
 * set, and the latency does not matter here: the solver already parks on a
 * `MessageChannel` macrotask at every yield checkpoint, so a posted abort is
 * drained from this worker's task queue on the very next checkpoint - the same
 * ~16 ms granularity the main-thread path always had.
 */

import { runSolverJob, type SolverWorkerRequest, type SolverWorkerResponse } from "./solverJobs";

/**
 * The subset of `DedicatedWorkerGlobalScope` this file uses.
 *
 * The app's `tsconfig` loads the `DOM` lib, under which the global `self` is a
 * `Window` - whose `postMessage` demands a target origin and whose `onmessage`
 * has window semantics. Swapping the whole program to the `webworker` lib to
 * fix one file is not on the table (the other 200 modules genuinely are DOM
 * code), and `@ts-expect-error` would suppress real mistakes along with the
 * false one. Naming the two members actually used keeps the call sites honestly
 * typed and fails loudly if either signature is ever misremembered.
 */
interface DedicatedWorkerScope {
  postMessage(message: SolverWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<SolverWorkerRequest>) => void): void;
}

const scope = self as unknown as DedicatedWorkerScope;

/**
 * The job in flight, if any. The pool guarantees one at a time per worker, so
 * this is a single slot rather than a map: an `abort` naming any other token is
 * for a job that has already finished and is simply ignored.
 */
let active: { token: number; controller: AbortController } | null = null;

scope.addEventListener("message", (event) => {
  const request = event.data;

  if (request.type === "abort") {
    if (active?.token === request.token) active.controller.abort();
    return;
  }

  const { token, job, startAborted, wantProgress } = request;
  const controller = new AbortController();
  if (startAborted) controller.abort();
  active = { token, controller };

  void runSolverJob(job, {
    signal: controller.signal,
    // Progress is only wired up when the requester asked for it. The transient
    // solver calls this at every yield checkpoint, and an unwanted post per
    // checkpoint is real cross-thread traffic - during a parallel `.step`
    // sweep, one such stream per worker, all landing on the one thread the
    // whole exercise is about keeping free.
    onProgress: wantProgress ? (fraction) => scope.postMessage({ type: "progress", token, fraction }) : undefined,
  }).then(
    (result) => {
      active = null;
      scope.postMessage({ type: "done", token, result });
    },
    (error: unknown) => {
      // The solvers catch their own failures and return an `ok: false` result,
      // so reaching here means something outside the numerics broke - a
      // malformed job, or an out-of-memory. Report it as this job's failure so
      // the pool can retry it on the main thread instead of the worker dying
      // silently and the caller waiting forever.
      active = null;
      scope.postMessage({
        type: "failed",
        token,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
});
