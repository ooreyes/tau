/**
 * The live-run model: what a continuously running simulation keeps, what it
 * shows, how fast it is actually going, and — above all — what it is allowed to
 * claim.
 *
 * This module is deliberately inert. No React, no Tauri, no timers, no I/O:
 * pure functions and plain classes over plain data. The UI owns the animation
 * frame, the Rust side owns the solver, and both talk to the types declared
 * here, so the hard decisions below get made once, in the open, under test,
 * rather than three times by accident inside somebody's callback.
 *
 * ## Measured facts this design answers to
 *
 * From a spike against the real engine, not from guesses: the solver produces
 * roughly 500k points/s on a trivial RC (~300k while polled every 20 ms); a
 * stop takes 10–13 ms to take effect and that latency is structural; the worst
 * single tail poll cost 5.1 ms; and two million samples land in about four
 * seconds at full tilt. Two consequences run through everything below. Stopping
 * once per frame is not available to us as a pacing mechanism — by the time a
 * stop lands the solver has already run past where we wanted it — so pacing is
 * done with *breakpoints scheduled ahead* of the solve. And a free-running
 * solver fills any fixed-size buffer within seconds, so the buffer wrapping is
 * the normal case, not the exceptional one, which is precisely why it has to be
 * reported instead of hidden.
 *
 * ## The three model decisions (spec — each one has a test)
 *
 * 1. **Rate is a first-class control with breakpoint pacing, and the run is
 *    NEVER fast-forwarded.** The user sets circuit-seconds per wall-clock
 *    second; {@link pacingDecision} converts that into the next breakpoint the
 *    solver may run to, always at least {@link MIN_BREAKPOINT_LEAD_MS} of wall
 *    clock ahead so the stop latency can be absorbed. When the solver is ahead
 *    of the requested rate we hold it at a breakpoint. When it is behind we do
 *    *not* let it skip: the `behind` decision carries no breakpoint at all, so
 *    there is no field a consumer could use to jump the run forward.
 *
 * 2. **When the solver cannot keep up, REPORT THE ACHIEVED RATE.** Never drop,
 *    interpolate or extrapolate samples to manufacture the requested timebase.
 *    {@link rateReport} will return the measured rate or admit that it does not
 *    know one yet; it will never present the target as if it had been measured.
 *    A live scope that silently lies about its timebase is worse than a slow
 *    one, because a slow one is visibly slow.
 *
 * 3. **Ring wrapping is REPORTED, never presented as the whole run.** Every
 *    view of the buffer carries {@link LiveSampleView.isWholeRun} and the count
 *    of discarded samples alongside the numbers themselves, so a consumer
 *    cannot get the data without also getting the truth about it, and the UI
 *    can say "history before t = … was discarded".
 *
 * AGENTS.md forbids silent model substitution; these three predicates are how
 * this module obeys that rule.
 */

/** Ignore differences below this in seconds-vs-seconds comparisons. */
const EPS = 1e-12;

function assertNever(x: never, what: string): never {
  throw new Error(`${what}: unhandled variant ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// Run mode
// ---------------------------------------------------------------------------

/**
 * The authored `.tran` fields this module cares about. Structurally a
 * supertype of `AnalysisOptions` from `linearTransient`, so the result of
 * `parseTranDirective` can be handed straight in without this unit importing
 * the solver (the test pins that assignability so the two cannot drift).
 */
export interface AuthoredTran {
  stopTime: number;
  steps?: number;
  startTime?: number;
}

/** Where a WINDOW run's bounds came from, kept so the UI can show provenance. */
export interface WindowOrigin {
  /** `authored-tran` until the user edits the bounds, then `user`. */
  source: "authored-tran" | "user";
  /**
   * The bounds exactly as imported. Retained even after the user edits them:
   * an imported LTspice file must be able to say "you changed this from
   * `.tran 5m`" and offer the original back, rather than quietly forgetting
   * what the document asked for.
   */
  authored: {
    startTime: number;
    stopTime: number;
    steps: number | null;
    directive: string | null;
  } | null;
}

/**
 * A continuous run. `targetRate` is circuit-seconds per wall-clock second;
 * `null` means free-run, i.e. as fast as the solver goes, with no claim about
 * the timebase beyond the measured one.
 */
export interface LiveRunPlan {
  mode: "live";
  targetRate: number | null;
  sampleBudget: number;
  /** Circuit-time ceiling, or `null` for an indefinite run. */
  horizonSeconds: number | null;
}

/** A bounded transient of an explicit, visible, editable duration. */
export interface WindowRunPlan {
  mode: "window";
  startTime: number;
  stopTime: number;
  targetRate: number | null;
  sampleBudget: number;
  origin: WindowOrigin;
}

export type RunPlan = LiveRunPlan | WindowRunPlan;

/**
 * Budget for a bounded transient. Two million samples is about four seconds of
 * full-tilt solving; a bounded window that wants more than that is not the
 * circuit the user drew, and the run should stop and say so rather than grind.
 */
export const DEFAULT_SAMPLE_BUDGET = 2_000_000;

/**
 * Budget for a continuous run. The ring keeps memory flat no matter how long a
 * LIVE run goes, so this bound is not about memory — it is the guard against a
 * run left going forever in a window nobody is watching. At the measured 500k
 * samples/s it is roughly a hundred seconds of free-running solve, and far
 * longer than that at any human-chosen rate.
 */
export const DEFAULT_LIVE_SAMPLE_BUDGET = 50_000_000;

/** A continuous run with no horizon: the default when nothing is authored. */
export function liveRunPlan(opts: Partial<Omit<LiveRunPlan, "mode">> = {}): LiveRunPlan {
  return {
    mode: "live",
    targetRate: opts.targetRate ?? null,
    sampleBudget: opts.sampleBudget ?? DEFAULT_LIVE_SAMPLE_BUDGET,
    horizonSeconds: opts.horizonSeconds ?? null,
  };
}

/**
 * Map an authored `.tran` onto a WINDOW-mode plan.
 *
 * LTspice's `Tstart` suppresses *output* before that time rather than starting
 * the solve there, so it maps to the window's left edge, and `Tstop` maps to
 * the horizon. The point of doing this as data is that an imported file still
 * reproduces LTspice, but the duration it reproduces is now a visible number
 * the user can edit — not an invisible consequence of a directive buried in the
 * schematic. Authored `steps` is recorded as provenance only: it is the file's
 * requested output resolution, not a budget, because the engine's adaptive
 * timestep may legitimately emit a different number of samples.
 */
export function windowPlanFromAuthoredTran(
  tran: AuthoredTran,
  opts: { directive?: string | null; targetRate?: number | null; sampleBudget?: number } = {},
): WindowRunPlan {
  const startTime = Number.isFinite(tran.startTime ?? 0) ? Math.max(0, tran.startTime ?? 0) : 0;
  const stopTime = tran.stopTime;
  const steps = Number.isFinite(tran.steps ?? NaN) ? (tran.steps as number) : null;
  return {
    mode: "window",
    startTime,
    stopTime,
    targetRate: opts.targetRate ?? null,
    sampleBudget: opts.sampleBudget ?? DEFAULT_SAMPLE_BUDGET,
    origin: {
      source: "authored-tran",
      authored: { startTime, stopTime, steps, directive: opts.directive ?? null },
    },
  };
}

/**
 * LIVE is the default mode, but only for a document that does not author a
 * `.tran`. An imported LTspice file has said what it wants; overriding that
 * with a continuous run would be exactly the silent substitution AGENTS.md
 * forbids, so it starts in WINDOW — visibly, and editable from there.
 */
export function defaultRunPlan(
  tran: AuthoredTran | null,
  opts: { directive?: string | null } = {},
): RunPlan {
  if (tran && Number.isFinite(tran.stopTime) && tran.stopTime > 0) {
    return windowPlanFromAuthoredTran(tran, opts);
  }
  return liveRunPlan();
}

/** Re-bound a WINDOW run from the UI. The authored provenance survives the edit. */
export function withWindowBounds(
  plan: WindowRunPlan,
  bounds: { startTime?: number; stopTime?: number },
): WindowRunPlan {
  const startTime = bounds.startTime ?? plan.startTime;
  const stopTime = bounds.stopTime ?? plan.stopTime;
  return {
    ...plan,
    startTime,
    stopTime,
    origin: { source: "user", authored: plan.origin.authored },
  };
}

/** Put an edited window back to what the document authored, when there was one. */
export function revertWindowToAuthored(plan: WindowRunPlan): WindowRunPlan {
  const authored = plan.origin.authored;
  if (!authored) return plan;
  return {
    ...plan,
    startTime: authored.startTime,
    stopTime: authored.stopTime,
    origin: { source: "authored-tran", authored },
  };
}

/** Whether the visible window no longer matches what the file asked for. */
export function isWindowEditedFromAuthored(plan: WindowRunPlan): boolean {
  const authored = plan.origin.authored;
  if (!authored) return false;
  return (
    Math.abs(plan.startTime - authored.startTime) > EPS ||
    Math.abs(plan.stopTime - authored.stopTime) > EPS
  );
}

/** Circuit-time ceiling of a plan, or `null` when the run is indefinite. */
export function runPlanHorizon(plan: RunPlan): number | null {
  return plan.mode === "window" ? plan.stopTime : plan.horizonSeconds;
}

// ---------------------------------------------------------------------------
// Stop reasons
// ---------------------------------------------------------------------------

/**
 * Every way a live run can end, as a closed union. A stopped run must never
 * render identically to a running one, and that starts with the data model
 * having a reason at all — an untyped `isRunning: false` is how a UI ends up
 * showing a frozen plot with no explanation.
 */
export type StopReason =
  | { kind: "user-stopped" }
  | { kind: "left-simulator" }
  | { kind: "sample-budget"; atCircuitTime: number; budget: number }
  | { kind: "horizon-reached"; atCircuitTime: number }
  | { kind: "diverged"; atCircuitTime: number; detail: string }
  | { kind: "circuit-edited" };

export type StopReasonKind = StopReason["kind"];

/** Every kind, so exhaustiveness can be asserted by a test rather than hoped for. */
export const STOP_REASON_KINDS: readonly StopReasonKind[] = [
  "user-stopped",
  "left-simulator",
  "sample-budget",
  "horizon-reached",
  "diverged",
  "circuit-edited",
];

export const userStopped = (): StopReason => ({ kind: "user-stopped" });
export const leftSimulator = (): StopReason => ({ kind: "left-simulator" });
export const circuitEdited = (): StopReason => ({ kind: "circuit-edited" });

/**
 * The stop reasons the run can work out for itself from its own counters.
 * The other three (`user-stopped`, `left-simulator`, `circuit-edited`) are
 * external events and are constructed by whoever observes them.
 *
 * Order matters and is a judgement, not an accident. Divergence wins because a
 * diverged run's remaining counters are meaningless. The horizon beats the
 * budget because a run that reached the end the user asked for *completed*,
 * and calling that "truncated" would understate a good result; a budget that
 * bites before the horizon still fires first, simply because it happens first.
 */
export function evaluateStopReason(input: {
  plan: RunPlan;
  samplesSolved: number;
  solvedCircuitTime: number;
  diverged?: { atCircuitTime: number; detail: string } | null;
}): StopReason | null {
  const { plan, samplesSolved, solvedCircuitTime } = input;
  if (input.diverged) {
    return {
      kind: "diverged",
      atCircuitTime: input.diverged.atCircuitTime,
      detail: input.diverged.detail,
    };
  }
  const horizon = runPlanHorizon(plan);
  if (horizon !== null && solvedCircuitTime >= horizon - EPS) {
    return { kind: "horizon-reached", atCircuitTime: solvedCircuitTime };
  }
  if (samplesSolved >= plan.sampleBudget) {
    return {
      kind: "sample-budget",
      atCircuitTime: solvedCircuitTime,
      budget: plan.sampleBudget,
    };
  }
  return null;
}

/** Whether the run ended because it finished, as opposed to being cut short. */
export function isCompletionStop(reason: StopReason): boolean {
  return reason.kind === "horizon-reached";
}

/** Human sentence for a stop. Distinct per kind, and never blank. */
export function describeStopReason(reason: StopReason, formatTime = formatSeconds): string {
  switch (reason.kind) {
    case "user-stopped":
      return "Stopped.";
    case "left-simulator":
      return "Stopped — you left the simulator.";
    case "sample-budget":
      return `Stopped at ${formatTime(reason.atCircuitTime)} — sample budget of ${reason.budget.toLocaleString("en-US")} reached.`;
    case "horizon-reached":
      return `Finished at ${formatTime(reason.atCircuitTime)}.`;
    case "diverged":
      return `Stopped at ${formatTime(reason.atCircuitTime)} — solution diverged: ${reason.detail}`;
    case "circuit-edited":
      return "Stopped — the circuit changed.";
    default:
      return assertNever(reason, "describeStopReason");
  }
}

/** Compact engineering-notation seconds for the sentences above. */
export function formatSeconds(t: number): string {
  if (!Number.isFinite(t)) return "—";
  const abs = Math.abs(t);
  if (abs === 0) return "0 s";
  const units: readonly [number, string][] = [
    [1, "s"],
    [1e-3, "ms"],
    [1e-6, "µs"],
    [1e-9, "ns"],
    [1e-12, "ps"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      const v = t / scale;
      return `${Number(v.toFixed(3))} ${suffix}`;
    }
  }
  return `${t.toExponential(3)} s`;
}

// ---------------------------------------------------------------------------
// Achieved rate
// ---------------------------------------------------------------------------

/**
 * Smoothing window for the achieved-rate estimate. The engine is polled about
 * every 20 ms, so half a second is roughly 25 observations: long enough that a
 * single 5.1 ms tail poll does not visibly move the number, short enough that
 * the readout still responds when the circuit gets hard to solve.
 */
export const RATE_WINDOW_MS = 500;

/**
 * Below two polls' worth of wall clock there is no rate, only noise. Reporting
 * a number from a 3 ms span would be a guess wearing a measurement's clothes.
 */
export const MIN_RATE_SPAN_MS = 40;

/**
 * Circuit-seconds solved per wall-clock second, measured over a sliding window.
 *
 * Returns `null` rather than a guess whenever it has not yet seen enough to
 * know — the caller must render that as "measuring", never as the target rate.
 * A genuinely stalled solver is different from an unknown one and reports 0.
 */
export class AchievedRateEstimator {
  private readonly windowMs: number;
  private readonly wallMs: number[] = [];
  private readonly circuitTimes: number[] = [];

  constructor(windowMs: number = RATE_WINDOW_MS) {
    if (!(windowMs > 0)) throw new Error("AchievedRateEstimator: windowMs must be > 0");
    this.windowMs = windowMs;
  }

  /**
   * Record that at `wallClockMs` the solver had reached `solvedCircuitTime`.
   *
   * Either clock going backwards means this is a different run, not a negative
   * rate, so the estimator resets and goes back to reporting `null` until it
   * has re-established a measurement.
   */
  observe(wallClockMs: number, solvedCircuitTime: number): void {
    if (!Number.isFinite(wallClockMs) || !Number.isFinite(solvedCircuitTime)) return;
    const n = this.wallMs.length;
    if (n > 0) {
      const lastWall = this.wallMs[n - 1]!;
      const lastTime = this.circuitTimes[n - 1]!;
      if (wallClockMs < lastWall || solvedCircuitTime < lastTime) {
        this.reset();
      }
    }
    this.wallMs.push(wallClockMs);
    this.circuitTimes.push(solvedCircuitTime);
    this.trim();
  }

  /** Slide the window forward, always keeping the two endpoints a rate needs. */
  private trim(): void {
    const newest = this.wallMs[this.wallMs.length - 1]!;
    while (this.wallMs.length > 2 && newest - this.wallMs[0]! > this.windowMs) {
      this.wallMs.shift();
      this.circuitTimes.shift();
    }
  }

  /** Measured circuit-seconds per wall-second, or `null` when not yet known. */
  rate(): number | null {
    const n = this.wallMs.length;
    if (n < 2) return null;
    const spanMs = this.wallMs[n - 1]! - this.wallMs[0]!;
    if (spanMs < MIN_RATE_SPAN_MS) return null;
    const dCircuit = this.circuitTimes[n - 1]! - this.circuitTimes[0]!;
    return dCircuit / (spanMs / 1000);
  }

  /** True when the newest observation is older than the smoothing window. */
  isStale(nowMs: number): boolean {
    const n = this.wallMs.length;
    if (n === 0) return true;
    return nowMs - this.wallMs[n - 1]! > this.windowMs;
  }

  reset(): void {
    this.wallMs.length = 0;
    this.circuitTimes.length = 0;
  }

  get observationCount(): number {
    return this.wallMs.length;
  }
}

/**
 * What the UI is allowed to print next to "rate".
 *
 * There is deliberately no variant that carries the target as the displayed
 * value. Either a rate was measured, in which case that measurement is what
 * gets shown, or none was, in which case the honest answer is that we do not
 * know yet.
 */
export type RateReport =
  | { source: "unknown"; targetRate: number | null }
  | { source: "achieved"; rate: number; targetRate: number | null; keepingUp: boolean };

/** Fractional shortfall tolerated before the run is called "not keeping up". */
export const RATE_KEEPUP_TOLERANCE = 0.05;

export function rateReport(
  targetRate: number | null,
  achievedRate: number | null,
  tolerance: number = RATE_KEEPUP_TOLERANCE,
): RateReport {
  if (achievedRate === null || !Number.isFinite(achievedRate)) {
    return { source: "unknown", targetRate };
  }
  const keepingUp =
    targetRate === null || !(targetRate > 0) ? true : achievedRate >= targetRate * (1 - tolerance);
  return { source: "achieved", rate: achievedRate, targetRate, keepingUp };
}

/**
 * The number to print, or `null` for "measuring…". Never falls back to the
 * target: that fallback is exactly the lie this module exists to prevent.
 */
export function displayRate(report: RateReport): number | null {
  return report.source === "achieved" ? report.rate : null;
}

/** Whether the UI must show that the run is slower than the user asked for. */
export function shouldWarnRateShortfall(report: RateReport): boolean {
  return report.source === "achieved" && report.targetRate !== null && !report.keepingUp;
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Measured worst-case wall time between asking the solver to stop and it stopping. */
export const STOP_LATENCY_MS = 13;

/** The cadence the engine is polled at, and so the granularity of any decision. */
export const POLL_INTERVAL_MS = 20;

/**
 * A breakpoint closer than this cannot be honoured: the request has to survive
 * one poll interval and then the stop latency before it takes effect. Every
 * breakpoint this module hands out is at least this far ahead in wall clock,
 * which is why pacing is done with breakpoints and not with per-frame stops.
 */
export const MIN_BREAKPOINT_LEAD_MS = POLL_INTERVAL_MS + STOP_LATENCY_MS;

/**
 * What should happen next, given a target rate and where the solve has got to.
 *
 * Note what is absent: the `behind` variant has no breakpoint field. There is
 * no way to express "skip forward to catch up", because catching up would mean
 * fabricating circuit time nobody solved.
 */
export type PacingDecision =
  | { kind: "free-run" }
  | { kind: "on-pace"; breakpointCircuitTime: number }
  | { kind: "hold"; breakpointCircuitTime: number; aheadSeconds: number }
  | { kind: "behind"; targetRate: number; achievedRate: number | null; shortfallSeconds: number };

/** Where the requested rate says the run should have got to by now. */
export function paceDueCircuitTime(
  startCircuitTime: number,
  targetRate: number,
  wallElapsedSeconds: number,
): number {
  return startCircuitTime + targetRate * Math.max(0, wallElapsedSeconds);
}

/** Circuit-seconds the solver will cover before a stop request can land. */
export function breakpointLeadSeconds(targetRate: number): number {
  return targetRate * (MIN_BREAKPOINT_LEAD_MS / 1000);
}

export function pacingDecision(input: {
  targetRate: number | null;
  achievedRate: number | null;
  solvedCircuitTime: number;
  dueCircuitTime: number;
}): PacingDecision {
  const { targetRate, achievedRate, solvedCircuitTime, dueCircuitTime } = input;
  if (targetRate === null || !(targetRate > 0) || !Number.isFinite(targetRate)) {
    return { kind: "free-run" };
  }
  const lead = breakpointLeadSeconds(targetRate);
  const ahead = solvedCircuitTime - dueCircuitTime;

  // Never rewind: a breakpoint behind the solve would already have passed.
  const nextBreakpoint = Math.max(solvedCircuitTime, dueCircuitTime + lead);

  if (ahead > lead) {
    return { kind: "hold", breakpointCircuitTime: nextBreakpoint, aheadSeconds: ahead };
  }
  if (-ahead > lead) {
    return { kind: "behind", targetRate, achievedRate, shortfallSeconds: -ahead };
  }
  return { kind: "on-pace", breakpointCircuitTime: nextBreakpoint };
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

/**
 * Retained samples, per channel, at a fixed memory cost. 2^19 samples with four
 * channels is five Float64Arrays of 4.2 MB — about 21 MB, flat, for a run of
 * any length. At the measured 500k samples/s a free-running solve overwrites
 * that in roughly a second, which is the whole reason wrapping is reported
 * rather than swept under the plot.
 */
export const DEFAULT_RING_CAPACITY = 1 << 19;

/**
 * A slice of the buffer together with the truth about what it is.
 *
 * The flags travel with the numbers on purpose. A consumer physically cannot
 * obtain the samples without also obtaining `isWholeRun`, so "we plotted the
 * tail and called it the run" is not an available mistake.
 */
export interface LiveSampleView {
  times: Float64Array;
  channels: Float64Array[];
  /** True only when these samples are literally every sample the run produced. */
  isWholeRun: boolean;
  /** How many samples the ring has thrown away since the run began. */
  discardedSamples: number;
  /** Circuit time of the very first sample ever pushed, remembered after discard. */
  runStartTime: number | null;
  /** Circuit time of the oldest sample still retained. */
  retainedFromTime: number | null;
}

/**
 * A bounded ring over the live sample stream.
 *
 * Times must arrive non-decreasing, and a violation throws rather than being
 * absorbed. The alternative is worse than a crash: {@link LiveSampleRing.sliceByTime}
 * binary-searches this array, so a silently out-of-order push produces a
 * plausible-looking but wrong window — the exact class of quiet wrongness this
 * unit exists to rule out. Between runs, call {@link LiveSampleRing.clear}.
 */
export class LiveSampleRing {
  readonly capacity: number;
  readonly channelCount: number;

  private readonly timeStore: Float64Array;
  private readonly channelStore: Float64Array[];
  private start = 0;
  private count = 0;
  private discarded = 0;
  private firstTime: number | null = null;
  private lastTime: number | null = null;

  constructor(opts: { capacity?: number; channelCount: number }) {
    const capacity = Math.floor(opts.capacity ?? DEFAULT_RING_CAPACITY);
    if (!(capacity >= 1)) throw new Error("LiveSampleRing: capacity must be >= 1");
    if (!(opts.channelCount >= 0)) throw new Error("LiveSampleRing: channelCount must be >= 0");
    this.capacity = capacity;
    this.channelCount = Math.floor(opts.channelCount);
    this.timeStore = new Float64Array(capacity);
    this.channelStore = Array.from(
      { length: this.channelCount },
      () => new Float64Array(capacity),
    );
  }

  /** Samples currently retained. */
  get length(): number {
    return this.count;
  }

  /** Samples pushed since the run began, including those since discarded. */
  get totalSamples(): number {
    return this.count + this.discarded;
  }

  get discardedSamples(): number {
    return this.discarded;
  }

  /** The honesty predicate: has any history been dropped? */
  hasDiscardedHistory(): boolean {
    return this.discarded > 0;
  }

  get runStartTime(): number | null {
    return this.firstTime;
  }

  get earliestRetainedTime(): number | null {
    return this.count === 0 ? null : this.timeStore[this.start]!;
  }

  get latestTime(): number | null {
    return this.count === 0 ? null : this.lastTime;
  }

  push(t: number, values: readonly number[]): void {
    if (values.length !== this.channelCount) {
      throw new Error(
        `LiveSampleRing.push: expected ${this.channelCount} channel values, got ${values.length}`,
      );
    }
    this.pushSample(t, (c) => values[c]!);
  }

  /** Append a whole poll's worth of samples, column-oriented as the engine emits them. */
  pushChunk(chunk: { times: ArrayLike<number>; channels: readonly ArrayLike<number>[] }): void {
    if (chunk.channels.length !== this.channelCount) {
      throw new Error(
        `LiveSampleRing.pushChunk: expected ${this.channelCount} channels, got ${chunk.channels.length}`,
      );
    }
    const n = chunk.times.length;
    for (const channel of chunk.channels) {
      if (channel.length !== n) {
        throw new Error("LiveSampleRing.pushChunk: channel length does not match times length");
      }
    }
    for (let i = 0; i < n; i += 1) {
      this.pushSample(chunk.times[i]!, (c) => chunk.channels[c]![i]!);
    }
  }

  private pushSample(t: number, valueAt: (channel: number) => number): void {
    if (!Number.isFinite(t)) throw new Error("LiveSampleRing: sample time must be finite");
    if (this.lastTime !== null && t < this.lastTime) {
      throw new Error(
        `LiveSampleRing: sample times must be non-decreasing (got ${t} after ${this.lastTime})`,
      );
    }
    const slot = (this.start + this.count) % this.capacity;
    this.timeStore[slot] = t;
    for (let c = 0; c < this.channelCount; c += 1) {
      this.channelStore[c]![slot] = valueAt(c);
    }
    if (this.count === this.capacity) {
      this.start = (this.start + 1) % this.capacity;
      this.discarded += 1;
    } else {
      this.count += 1;
    }
    if (this.firstTime === null) this.firstTime = t;
    this.lastTime = t;
  }

  /** Everything still retained, flagged with whether that is the whole run. */
  snapshot(): LiveSampleView {
    return this.viewOf(0, this.count);
  }

  /**
   * The retained samples inside `[t0, t1]`. `isWholeRun` stays false whenever
   * anything has been discarded or the slice is a strict subset, so a zoomed-in
   * view can never be mistaken for the complete record.
   */
  sliceByTime(t0: number, t1: number): LiveSampleView {
    if (this.count === 0 || !(t1 >= t0)) return this.viewOf(0, 0);
    const from = this.lowerBound(t0);
    const to = this.upperBound(t1);
    return this.viewOf(from, Math.max(from, to));
  }

  /** First logical index whose time is >= `t`. */
  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** One past the last logical index whose time is <= `t`. */
  private upperBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private timeAt(i: number): number {
    return this.timeStore[(this.start + i) % this.capacity]!;
  }

  private viewOf(from: number, to: number): LiveSampleView {
    const n = Math.max(0, to - from);
    const times = new Float64Array(n);
    const channels = this.channelStore.map(() => new Float64Array(n));
    for (let i = 0; i < n; i += 1) {
      const slot = (this.start + from + i) % this.capacity;
      times[i] = this.timeStore[slot]!;
      for (let c = 0; c < this.channelCount; c += 1) {
        channels[c]![i] = this.channelStore[c]![slot]!;
      }
    }
    return {
      times,
      channels,
      isWholeRun: this.discarded === 0 && n === this.count,
      discardedSamples: this.discarded,
      runStartTime: this.firstTime,
      retainedFromTime: this.earliestRetainedTime,
    };
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.discarded = 0;
    this.firstTime = null;
    this.lastTime = null;
  }
}

/**
 * The sentence the UI must show when history has gone. Returns `null` when the
 * buffer still holds the whole run, so the caller renders nothing rather than a
 * reassuring "complete" badge that would eventually become a lie.
 */
export function describeDiscardedHistory(
  view: LiveSampleView,
  formatTime = formatSeconds,
): string | null {
  if (view.isWholeRun || view.discardedSamples === 0) return null;
  const from = view.retainedFromTime;
  const start = view.runStartTime;
  if (from === null || start === null) {
    return `Showing a tail of the run — ${view.discardedSamples.toLocaleString("en-US")} earlier samples discarded.`;
  }
  return `Showing ${formatTime(from)} onward — ${view.discardedSamples.toLocaleString("en-US")} samples before that were discarded.`;
}

// ---------------------------------------------------------------------------
// Window accounting
// ---------------------------------------------------------------------------

/**
 * The visible timebase. `anchorEndTime === null` means the window follows the
 * newest sample; a number pins the right edge there and new samples scroll
 * underneath without moving it.
 */
export interface TimeWindow {
  spanSeconds: number;
  anchorEndTime: number | null;
}

/** The resolved slice of circuit time to draw, plus what is missing from it. */
export interface VisibleWindow {
  t0: number;
  t1: number;
  following: boolean;
  /** The left edge falls in history the ring has already discarded. */
  clippedByDiscard: boolean;
}

export function followingWindow(spanSeconds: number): TimeWindow {
  if (!(spanSeconds > 0)) throw new Error("followingWindow: spanSeconds must be > 0");
  return { spanSeconds, anchorEndTime: null };
}

export function isFollowing(window: TimeWindow): boolean {
  return window.anchorEndTime === null;
}

/**
 * Dragging the trace pins the window: the user asked to look at a particular
 * moment, and having new samples yank it away is the single most infuriating
 * behaviour a live scope can have.
 *
 * Panning right past the newest sample is the exception — there is nothing
 * beyond "now" to look at, so that gesture means "take me back to live" and
 * resumes following.
 */
export function panWindow(
  window: TimeWindow,
  deltaSeconds: number,
  latestTime: number,
): TimeWindow {
  const currentEnd = window.anchorEndTime ?? latestTime;
  const end = currentEnd + deltaSeconds;
  if (end >= latestTime) return { spanSeconds: window.spanSeconds, anchorEndTime: null };
  return { spanSeconds: window.spanSeconds, anchorEndTime: end };
}

/**
 * Changing the timebase is a knob, not a gesture on the trace, so it preserves
 * follow state: zooming out on a live run should show more history and stay
 * live. A following window zooms about its right edge (the newest sample stays
 * pinned to "now"); a pinned window zooms about its centre, which is what the
 * user is looking at.
 */
export function zoomWindow(window: TimeWindow, factor: number): TimeWindow {
  if (!(factor > 0) || !Number.isFinite(factor)) return window;
  const spanSeconds = window.spanSeconds * factor;
  if (window.anchorEndTime === null) return { spanSeconds, anchorEndTime: null };
  const centre = window.anchorEndTime - window.spanSeconds / 2;
  return { spanSeconds, anchorEndTime: centre + spanSeconds / 2 };
}

export function resumeFollow(window: TimeWindow): TimeWindow {
  return { spanSeconds: window.spanSeconds, anchorEndTime: null };
}

/**
 * Resolve the window against the data that actually exists.
 *
 * `clippedByDiscard` is the honesty half: when the requested left edge is older
 * than anything the ring still holds, the plot's left edge is not the start of
 * the window the user asked for, and the UI has to be able to say so.
 */
export function visibleWindow(
  window: TimeWindow,
  data: {
    latestTime: number | null;
    earliestRetainedTime: number | null;
    hasDiscardedHistory: boolean;
  },
): VisibleWindow {
  const following = window.anchorEndTime === null;
  const t1 = following ? (data.latestTime ?? 0) : window.anchorEndTime!;
  const t0 = t1 - window.spanSeconds;
  const earliest = data.earliestRetainedTime;
  // Only history the ring threw away counts as clipping. Scrolling back past
  // the start of a short run is merely empty axis, and must not be dressed up
  // as data loss — a warning that cries wolf stops being read.
  const clippedByDiscard =
    data.hasDiscardedHistory && earliest !== null && t0 < earliest - EPS;
  return { t0, t1, following, clippedByDiscard };
}

// ---------------------------------------------------------------------------
// Run status
// ---------------------------------------------------------------------------

/**
 * The run's own state. Carrying the stop reason in the type is what makes
 * "a stopped run must never render identically to a running one" enforceable
 * instead of aspirational.
 */
export type LiveRunStatus =
  | { phase: "idle" }
  | { phase: "running"; solvedCircuitTime: number; rate: RateReport }
  | { phase: "stopped"; solvedCircuitTime: number; reason: StopReason };

export function isRunning(status: LiveRunStatus): boolean {
  return status.phase === "running";
}

/** Short label for the status chip. Distinct for every phase and stop reason. */
export function runStatusLabel(status: LiveRunStatus, formatTime = formatSeconds): string {
  switch (status.phase) {
    case "idle":
      return "Ready.";
    case "running": {
      const rate = displayRate(status.rate);
      const at = `Running — t = ${formatTime(status.solvedCircuitTime)}`;
      if (rate === null) return `${at}, measuring rate…`;
      const suffix = shouldWarnRateShortfall(status.rate) ? " (slower than requested)" : "";
      return `${at}, ${Number(rate.toPrecision(3))}× circuit s per s${suffix}`;
    }
    case "stopped":
      return describeStopReason(status.reason, formatTime);
    default:
      return assertNever(status, "runStatusLabel");
  }
}
