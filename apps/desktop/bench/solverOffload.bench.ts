/**
 * Measurement harness for the solver worker offload.
 *
 * Lives outside `src/` on purpose: vitest's include glob is `src/**\/*.test.ts`
 * and `tsc --noEmit` compiles `src` and `scripts`, so a benchmark parked in
 * either would join the suite or the typecheck. It is served by the ordinary
 * Vite dev server at `/bench/index.html` and driven by `run.mjs`.
 *
 * It answers two questions with the same build of the same code, A/B in one
 * process, so nothing about the comparison depends on remembering how a
 * different commit behaved:
 *
 *  1. How long does the main thread stay unavailable during a preview solve?
 *     A `requestAnimationFrame` ticker and a `setInterval` ticker both record
 *     the longest gap between consecutive ticks while a solve runs. On the
 *     old path the maths owns the thread between cooperative yields, so the
 *     gap is the yield interval; off-thread it should collapse to frame time.
 *  2. How long does a `.step` family of ~40 independent solves take, run one
 *     after another versus spread across the pool?
 *
 * Both comparisons also assert bit-identity: every number the off-thread path
 * produces is compared with `Object.is` against the on-thread one. A faster
 * answer that is not the same answer is not an answer.
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
 * real structure (2N + 1 unknowns, a genuinely banded LHS) rather than a toy
 * two-node divider whose solve time is all loop overhead.
 */
function rcLadder(stages: number, sourceKind: "vsource" | "vac", sourceValue: string, resistorValue: string) {
  const components: SchematicComponent[] = [part(sourceKind, 0, 32, sourceValue, "V1"), part("ground", 0, 64, "", "")];
  const wires: SchematicWire[] = [];
  for (let k = 0; k < stages; k += 1) {
    const nodeX = 128 + 128 * k;
    components.push(part("resistor", 96 + 128 * k, 0, resistorValue, `R${k + 1}`));
    components.push(part("capacitor", nodeX + 32, 64, "10n", `C${k + 1}`));
    components.push(part("ground", nodeX + 64, 64, "", ""));
    // Source (or the previous stage's node) into this stage's resistor.
    wires.push({ id: uid("w"), points: [{ x: 128 * k, y: 0 }, { x: 64 + 128 * k, y: 0 }] });
    // This stage's node down to its shunt capacitor.
    wires.push({ id: uid("w"), points: [{ x: nodeX, y: 0 }, { x: nodeX, y: 64 }] });
  }
  return { components, wires };
}

// ---------------------------------------------------------------------------
// Main-thread availability. Two independent tickers, because they fail
// differently: `requestAnimationFrame` is what "the UI is smooth" actually
// means, and `setInterval` keeps measuring even if the compositor decides this
// page does not need frames.
// ---------------------------------------------------------------------------

interface Blocking {
  rafMaxGapMs: number;
  rafTicks: number;
  timerMaxGapMs: number;
  timerTicks: number;
  wallMs: number;
}

async function whileWatchingTheMainThread<T>(body: () => Promise<T>): Promise<{ value: T; blocking: Blocking }> {
  let rafMax = 0;
  let rafTicks = 0;
  let rafLast = performance.now();
  let running = true;
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
  return { value, blocking: { rafMaxGapMs: rafMax, rafTicks, timerMaxGapMs: timerMax, timerTicks, wallMs } };
}

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
// The measurements.
// ---------------------------------------------------------------------------

const TRANSIENT_STAGES = 8;
const TRANSIENT_STEPS = 20_000;
const FAMILY_MEMBERS = 40;

/** An idle reading, so the numbers below are read against what this machine and
 *  this browser do when nothing at all is happening. */
async function idleBaseline(): Promise<Blocking> {
  const { blocking } = await whileWatchingTheMainThread(
    () => new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  );
  return blocking;
}

async function transientComparison() {
  const { components, wires } = rcLadder(TRANSIENT_STAGES, "vsource", "5", "1k");
  const options = { stopTime: 2e-3, steps: TRANSIENT_STEPS };

  const before = await whileWatchingTheMainThread(() => runTransientAnalysis({ components, wires }, options));
  // Warm the pool first, then measure: a module worker's boot is a one-off
  // session cost, and folding it into the first solve would report it as if it
  // were per-run. It is reported separately below.
  const warmStart = performance.now();
  await runTransientAnalysisOffThread({ components, wires }, { stopTime: 2e-3, steps: 8 });
  const workerColdStartMs = performance.now() - warmStart;

  const after = await whileWatchingTheMainThread(() => runTransientAnalysisOffThread({ components, wires }, options));

  const progress: number[] = [];
  await runTransientAnalysisOffThread({ components, wires }, options, { onProgress: (f) => progress.push(f) });

  const controller = new AbortController();
  const aborted = await runTransientAnalysisOffThread({ components, wires }, options, {
    signal: controller.signal,
    onProgress: (f) => { if (f >= 0.3) controller.abort(); },
  });

  return {
    stages: TRANSIENT_STAGES,
    steps: TRANSIENT_STEPS,
    workerColdStartMs,
    onThread: before.blocking,
    offThread: after.blocking,
    identical: sameTransient(before.value, after.value),
    progressTicks: progress.length,
    progressMonotonic: progress.every((f, i) => i === 0 || f >= progress[i - 1]),
    progressFirst: progress[0],
    progressLast: progress[progress.length - 1],
    abortOk: aborted.ok,
    abortSamples: aborted.ok ? aborted.stats.sampleCount : -1,
    abortFullSamples: TRANSIENT_STEPS + 1,
    abortWarning: aborted.warnings.find((w) => /stopped early/i.test(w)) ?? null,
  };
}

async function familyComparison() {
  const { components, wires } = rcLadder(6, "vac", "1 1k", "{Rval}");
  const acOptions: AcOptions = { startHz: 1, stopHz: 1e6, pointsPerDecade: 120 };
  const spec = parseStepDirective(`.step param Rval 1000 ${1000 + (FAMILY_MEMBERS - 1) * 10} 10`) as StepSpec;

  // The sequential reference is written out rather than taken from a previous
  // commit: it is exactly what the family runner did before the pool existed -
  // one `runAcSweep` per context, in order, on this thread.
  const sequential = await whileWatchingTheMainThread(async () => {
    const out: { label: string; result: AcResult }[] = [];
    for (const value of spec.values) {
      out.push({
        label: `Rval=${value}`,
        result: runAcSweep(
          { components, wires, params: { scope: { Rval: value, rval: value }, funcs: {} } },
          acOptions,
        ),
      });
    }
    return out;
  });

  const parallel = await whileWatchingTheMainThread(() =>
    Promise.resolve(runAcStepFamily([spec], EMPTY_SCOPE, { components, wires }, acOptions)),
  );

  const family = parallel.value;
  const problems: string[] = [];
  if (family.members.length !== sequential.value.length) {
    problems.push(`member count ${family.members.length} vs ${sequential.value.length}`);
  }
  family.members.forEach((member, i) => {
    const reference = sequential.value[i];
    if (!reference) return;
    if (member.label !== reference.label) problems.push(`order at ${i}: ${member.label} vs ${reference.label}`);
    problems.push(...sameAc(member.result, reference.result).map((p) => `member ${i} ${p}`));
  });

  return {
    members: family.members.length,
    concurrency: solverConcurrency(),
    sequential: sequential.blocking,
    parallel: parallel.blocking,
    speedup: sequential.blocking.wallMs / parallel.blocking.wallMs,
    identical: problems,
    warnings: family.warnings,
    ok: family.ok,
  };
}

async function main() {
  const report = {
    hardwareConcurrency: navigator.hardwareConcurrency,
    poolSize: solverConcurrency(),
    idle: await idleBaseline(),
    transient: await transientComparison(),
    family: await familyComparison(),
  };
  (window as unknown as { __benchReport: unknown }).__benchReport = report;
  const out = document.getElementById("out");
  if (out) out.textContent = JSON.stringify(report, null, 2);
}

void main();
