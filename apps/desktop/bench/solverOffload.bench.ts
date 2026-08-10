/**
 * Measurement harness for the solver worker offload.
 *
 * Lives outside `src/` on purpose: vitest's include glob is `src/**\/*.test.ts`
 * and `tsc --noEmit` compiles `src` and `scripts`, so a benchmark parked in
 * either would join the suite or the typecheck. It is served by the ordinary
 * Vite dev server at `/bench/index.html`.
 *
 * It answers two questions with the same build of the same code, A/B in one
 * process, so nothing about the comparison depends on remembering how a
 * different commit behaved:
 *
 *  1. How long does the main thread stay unavailable during a preview solve?
 *  2. How long does a `.step` family of 40 independent solves take, run one
 *     after another versus spread across the pool?
 *
 * Both comparisons also assert bit-identity with `Object.is`, elementwise. A
 * faster answer that is not the same answer is not an answer.
 *
 * Two things this file is careful about, because getting either wrong produces
 * a confident and completely wrong number:
 *
 * - **The clock cannot be a throttled one.** `requestAnimationFrame` stops
 *   entirely in a hidden tab and `setInterval` is clamped to about 1 Hz there,
 *   which turns "the main thread was blocked" and "nobody was watching" into
 *   the same reading. The primary ticker is therefore a `MessageChannel` ping
 *   loop: message tasks are never throttled - that is precisely why the
 *   solver's own `yieldToEventLoop` uses one - so the gap between consecutive
 *   pings is the honest latency of the main thread's task queue. The rAF and
 *   timer tickers are still recorded, and are meaningful whenever their tick
 *   counts show they were actually running.
 * - **The first run of anything is a measurement of the JIT.** Every path is
 *   warmed before it is timed, and the timed rounds alternate between the two
 *   paths so a warm-up advantage cannot accrue to whichever one happens to run
 *   second.
 */

import { runTransientAnalysis, type AnalysisResult } from "../src/simulation/linearTransient";
import { runAcSweep, type AcOptions, type AcResult } from "../src/simulation/acSweep";
import { runAcStepFamily } from "../src/simulation/stepAnalysisFamily";
import { runTransientAnalysisOffThread, solverConcurrency } from "../src/simulation/solverPool";
import { EMPTY_SCOPE } from "../src/simulation/paramScope";
import { parseStepDirective, type StepSpec } from "../src/simulation/paramStep";
import type { SchematicComponent, SchematicWire } from "../src/schematic/types";

// ---------------------------------------------------------------------------
// Circuits. Geometry follows the documented pin rule: a two-terminal part at
// (x, y) with rotation 0 has pin "a" at (x - 32, y) and pin "b" at (x + 32, y);
// a vsource has "p" at (x, y - 32) and "n" at (x, y + 32); a ground's pin sits
// on its own coordinate. Pins connect where their world coordinates coincide.
// ---------------------------------------------------------------------------

let ids = 0;
const uid = (p: string) => `${p}${++ids}`;

function part(kind: SchematicComponent["kind"], x: number, y: number, value: string, label: string): SchematicComponent {
  return { id: uid(kind), kind, x, y, rotation: 0, value, label };
}

/**
 * An N-stage RC ladder driven by one source: a series resistor per stage with
 * a shunt capacitor to ground, which is the cheapest way to get a matrix with
 * real structure rather than a toy two-node divider whose solve time is all
 * loop overhead.
 */
function rcLadder(stages: number, sourceKind: "vsource" | "vac", sourceValue: string, resistorValue: string) {
  const components: SchematicComponent[] = [part(sourceKind, 0, 32, sourceValue, "V1"), part("ground", 0, 64, "", "")];
  const wires: SchematicWire[] = [];
  for (let k = 0; k < stages; k += 1) {
    const nodeX = 128 + 128 * k;
    components.push(part("resistor", 96 + 128 * k, 0, resistorValue, `R${k + 1}`));
    components.push(part("capacitor", nodeX + 32, 64, "10n", `C${k + 1}`));
    components.push(part("ground", nodeX + 64, 64, "", ""));
    wires.push({ id: uid("w"), points: [{ x: 128 * k, y: 0 }, { x: 64 + 128 * k, y: 0 }] });
    wires.push({ id: uid("w"), points: [{ x: nodeX, y: 0 }, { x: nodeX, y: 64 }] });
  }
  return { components, wires };
}

// ---------------------------------------------------------------------------
// Main-thread availability.
// ---------------------------------------------------------------------------

interface Blocking {
  /** The headline: longest gap between two consecutive main-thread macrotasks. */
  portMaxGapMs: number;
  portTicks: number;
  rafMaxGapMs: number;
  rafTicks: number;
  timerMaxGapMs: number;
  timerTicks: number;
  wallMs: number;
}

async function whileWatchingTheMainThread<T>(body: () => Promise<T>): Promise<{ value: T; blocking: Blocking }> {
  let running = true;

  let portMax = 0;
  let portTicks = 0;
  let portLast = performance.now();
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const now = performance.now();
    portMax = Math.max(portMax, now - portLast);
    portLast = now;
    portTicks += 1;
    if (running) channel.port2.postMessage(null);
  };
  channel.port2.postMessage(null);

  let rafMax = 0;
  let rafTicks = 0;
  let rafLast = performance.now();
  const raf = () => {
    if (!running) return;
    const now = performance.now();
    rafMax = Math.max(rafMax, now - rafLast);
    rafLast = now;
    rafTicks += 1;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  let timerMax = 0;
  let timerTicks = 0;
  let timerLast = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    timerMax = Math.max(timerMax, now - timerLast);
    timerLast = now;
    timerTicks += 1;
  }, 4);

  const startedAt = performance.now();
  const value = await body();
  const wallMs = performance.now() - startedAt;

  running = false;
  clearInterval(timer);
  channel.port1.close();
  channel.port2.close();
  return {
    value,
    blocking: { portMaxGapMs: portMax, portTicks, rafMaxGapMs: rafMax, rafTicks, timerMaxGapMs: timerMax, timerTicks, wallMs },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const tidy = (b: Blocking): Blocking => ({
  ...b,
  portMaxGapMs: round(b.portMaxGapMs),
  rafMaxGapMs: round(b.rafMaxGapMs),
  timerMaxGapMs: round(b.timerMaxGapMs),
  wallMs: round(b.wallMs),
});

/** Of several rounds, the one with the shortest wall time - the round least
 *  disturbed by whatever else the machine was doing. */
const best = (rounds: Blocking[]): Blocking => tidy(rounds.reduce((a, b) => (b.wallMs < a.wallMs ? b : a)));
const worstGap = (rounds: Blocking[]) => round(Math.max(...rounds.map((r) => r.portMaxGapMs)));

// ---------------------------------------------------------------------------
// Identity checks. `Object.is` rather than `===` so a `-0` that turned into a
// `0` somewhere in the structured clone is caught rather than waved through.
// ---------------------------------------------------------------------------

function sameNumbers(a: readonly number[], b: readonly number[], where: string): string[] {
  if (a.length !== b.length) return [`${where}: length ${a.length} vs ${b.length}`];
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return [`${where}[${i}]: ${a[i]} vs ${b[i]}`];
  }
  return [];
}

function sameTransient(a: AnalysisResult, b: AnalysisResult): string[] {
  if (!a.ok || !b.ok) return [`ok ${a.ok} vs ${b.ok}`];
  const problems = sameNumbers(a.times, b.times, "times");
  if (a.traces.length !== b.traces.length) problems.push(`traces ${a.traces.length} vs ${b.traces.length}`);
  a.traces.forEach((trace, i) => problems.push(...sameNumbers(trace.values, b.traces[i]?.values ?? [], `trace ${trace.label}`)));
  a.currents.forEach((current, i) => problems.push(...sameNumbers(current.values, b.currents[i]?.values ?? [], `current ${current.label}`)));
  if (a.stats.sampleCount !== b.stats.sampleCount) problems.push("sampleCount");
  return problems;
}

function sameAc(a: AcResult, b: AcResult): string[] {
  if (!a.ok || !b.ok) return [`ok ${a.ok} vs ${b.ok}`];
  const problems = sameNumbers(a.freqs, b.freqs, "freqs");
  a.traces.forEach((trace, i) => {
    problems.push(...sameNumbers(trace.magDb, b.traces[i]?.magDb ?? [], `magDb ${trace.label}`));
    problems.push(...sameNumbers(trace.phaseDeg, b.traces[i]?.phaseDeg ?? [], `phaseDeg ${trace.label}`));
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Is the pool actually carrying the work? Everything here degrades silently to
// the inline path by design, so a benchmark that does not check this can very
// happily measure the old code twice and report a 1.0x speedup as a finding.
// ---------------------------------------------------------------------------

async function workerSmokeTest(): Promise<{ usable: boolean; detail: string }> {
  if (typeof Worker === "undefined") return { usable: false, detail: "no Worker in this runtime" };
  let worker: Worker;
  try {
    worker = new Worker(new URL("../src/simulation/solver.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    return { usable: false, detail: `construction threw: ${String(error)}` };
  }
  const { components, wires } = rcLadder(1, "vsource", "5", "1k");
  return new Promise((resolve) => {
    const finish = (usable: boolean, detail: string) => {
      worker.terminate();
      resolve({ usable, detail });
    };
    worker.onerror = (event) => finish(false, `error event: ${event.message} @ ${event.filename}:${event.lineno}`);
    worker.onmessageerror = () => finish(false, "messageerror event");
    worker.onmessage = (event) => finish(event.data?.type === "done", `first message: ${event.data?.type}`);
    worker.postMessage({
      type: "run",
      token: 1,
      job: { kind: "tran", schematic: { components, wires }, options: { stopTime: 1e-3, steps: 8 } },
      startAborted: false,
      wantProgress: false,
    });
    setTimeout(() => finish(false, "no answer within 10s"), 10_000);
  });
}

// ---------------------------------------------------------------------------
// The measurements.
// ---------------------------------------------------------------------------

const TRANSIENT_STAGES = 8;
const TRANSIENT_STEPS = 20_000;
const FAMILY_MEMBERS = 40;
const ROUNDS = 3;

async function idleBaseline(): Promise<Blocking> {
  const { blocking } = await whileWatchingTheMainThread(
    () => new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  );
  return tidy(blocking);
}

async function transientComparison() {
  const { components, wires } = rcLadder(TRANSIENT_STAGES, "vsource", "5", "1k");
  const options = { stopTime: 2e-3, steps: TRANSIENT_STEPS };

  // Warm both paths, and time the worker's first-ever job separately: a module
  // worker's boot is a one-off session cost and folding it into a solve would
  // report it as if it recurred.
  await runTransientAnalysis({ components, wires }, { stopTime: 2e-3, steps: 2000 });
  const coldStart = performance.now();
  await runTransientAnalysisOffThread({ components, wires }, { stopTime: 2e-3, steps: 8 });
  const workerColdStartMs = round(performance.now() - coldStart);
  await runTransientAnalysisOffThread({ components, wires }, { stopTime: 2e-3, steps: 2000 });

  const onThread: Blocking[] = [];
  const offThread: Blocking[] = [];
  let onResult: AnalysisResult | null = null;
  let offResult: AnalysisResult | null = null;
  for (let round_ = 0; round_ < ROUNDS; round_ += 1) {
    const on = await whileWatchingTheMainThread(() => runTransientAnalysis({ components, wires }, options));
    onThread.push(on.blocking);
    onResult = on.value;
    const off = await whileWatchingTheMainThread(() => runTransientAnalysisOffThread({ components, wires }, options));
    offThread.push(off.blocking);
    offResult = off.value;
  }

  const progress: number[] = [];
  await runTransientAnalysisOffThread({ components, wires }, options, { onProgress: (f) => progress.push(f) });

  const controller = new AbortController();
  const aborted = await runTransientAnalysisOffThread({ components, wires }, options, {
    signal: controller.signal,
    onProgress: (f) => { if (f >= 0.3) controller.abort(); },
  });

  const preAborted = new AbortController();
  preAborted.abort();
  const preAbortedResult = await runTransientAnalysisOffThread({ components, wires }, options, { signal: preAborted.signal });

  return {
    stages: TRANSIENT_STAGES,
    steps: TRANSIENT_STEPS,
    workerColdStartMs,
    onThread: { best: best(onThread), worstGapMs: worstGap(onThread), rounds: onThread.map(tidy) },
    offThread: { best: best(offThread), worstGapMs: worstGap(offThread), rounds: offThread.map(tidy) },
    identical: onResult && offResult ? sameTransient(onResult, offResult) : ["missing result"],
    contract: {
      progressTicks: progress.length,
      progressMonotonic: progress.every((f, i) => i === 0 || f >= progress[i - 1]),
      progressFirst: progress[0],
      progressLast: progress[progress.length - 1],
      abortOk: aborted.ok,
      abortSamples: aborted.ok ? aborted.stats.sampleCount : -1,
      fullSamples: TRANSIENT_STEPS + 1,
      abortWarning: aborted.warnings.find((w) => /stopped early/i.test(w)) ?? null,
      preAbortedOk: preAbortedResult.ok,
      preAbortedSamples: preAbortedResult.ok ? preAbortedResult.stats.sampleCount : -1,
    },
  };
}

async function familyComparison() {
  const { components, wires } = rcLadder(6, "vac", "1 1k", "{Rval}");
  const acOptions: AcOptions = { startHz: 1, stopHz: 1e6, pointsPerDecade: 120 };
  const spec = parseStepDirective(`.step param Rval 1000 ${1000 + (FAMILY_MEMBERS - 1) * 10} 10`) as StepSpec;

  // The sequential reference is written out rather than recovered from a
  // previous commit: it is exactly what the family runner did before the pool
  // existed - one `runAcSweep` per context, in order, on this thread.
  const sequentialOnce = () =>
    spec.values.map((value) => ({
      label: `Rval=${value}`,
      result: runAcSweep(
        { components, wires, params: { scope: { Rval: value, rval: value }, funcs: {} } },
        acOptions,
      ),
    }));

  sequentialOnce();
  await runAcStepFamily([spec], EMPTY_SCOPE, { components, wires }, acOptions);

  const sequential: Blocking[] = [];
  const parallel: Blocking[] = [];
  let reference: ReturnType<typeof sequentialOnce> = [];
  let family: Awaited<ReturnType<typeof runAcStepFamily>> | null = null;
  for (let round_ = 0; round_ < ROUNDS; round_ += 1) {
    const seq = await whileWatchingTheMainThread(async () => sequentialOnce());
    sequential.push(seq.blocking);
    reference = seq.value;
    const par = await whileWatchingTheMainThread(() =>
      Promise.resolve(runAcStepFamily([spec], EMPTY_SCOPE, { components, wires }, acOptions)),
    );
    parallel.push(par.blocking);
    family = par.value;
  }

  const problems: string[] = [];
  const members = family?.members ?? [];
  if (members.length !== reference.length) problems.push(`member count ${members.length} vs ${reference.length}`);
  members.forEach((member, i) => {
    const expected = reference[i];
    if (!expected) return;
    if (member.label !== expected.label) problems.push(`order at ${i}: ${member.label} vs ${expected.label}`);
    problems.push(...sameAc(member.result, expected.result).map((p) => `member ${i} ${p}`));
  });

  const bestSequential = best(sequential);
  const bestParallel = best(parallel);
  return {
    members: members.length,
    concurrency: solverConcurrency(),
    sequential: { best: bestSequential, worstGapMs: worstGap(sequential), rounds: sequential.map(tidy) },
    parallel: { best: bestParallel, worstGapMs: worstGap(parallel), rounds: parallel.map(tidy) },
    speedup: round(bestSequential.wallMs / bestParallel.wallMs),
    identical: problems,
    warnings: family?.warnings ?? [],
    ok: family?.ok ?? false,
  };
}

async function main() {
  const smoke = await workerSmokeTest();
  const report = {
    hardwareConcurrency: navigator.hardwareConcurrency,
    poolSize: solverConcurrency(),
    workerSmokeTest: smoke,
    idle: await idleBaseline(),
    transient: await transientComparison(),
    family: await familyComparison(),
    poolSizeAfter: solverConcurrency(),
  };
  (window as unknown as { __benchReport: unknown }).__benchReport = report;
  const out = document.getElementById("out");
  if (out) out.textContent = JSON.stringify(report, null, 2);
}

void main();
