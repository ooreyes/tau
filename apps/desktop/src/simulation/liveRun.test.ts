/**
 * The contract for the live-run core.
 *
 * Three of these suites are load-bearing in a way the others are not. "NEVER
 * fast-forward", "report the achieved rate", and "ring wrapping is reported"
 * are the module's spec, not implementation details, and each is tested in both
 * directions — a buffer that has not wrapped must positively report that it has
 * not, or the honest case is indistinguishable from an untested one.
 *
 * Everything here is pure data. There is no fake timer and no clock: wall time
 * is a number the caller passes in, which is exactly why this unit can be
 * tested at all.
 */

import { describe, it, expect } from "vitest";
import type { AnalysisOptions } from "./linearTransient";
import {
  AchievedRateEstimator,
  DEFAULT_LIVE_SAMPLE_BUDGET,
  DEFAULT_SAMPLE_BUDGET,
  LiveSampleRing,
  MIN_BREAKPOINT_LEAD_MS,
  RATE_WINDOW_MS,
  STOP_LATENCY_MS,
  STOP_REASON_KINDS,
  breakpointLeadSeconds,
  circuitEdited,
  defaultRunPlan,
  describeDiscardedHistory,
  describeStopReason,
  displayRate,
  evaluateStopReason,
  followingWindow,
  formatSeconds,
  isCompletionStop,
  isFollowing,
  isRunning,
  isWindowEditedFromAuthored,
  leftSimulator,
  liveRunPlan,
  paceDueCircuitTime,
  pacingDecision,
  panWindow,
  rateReport,
  resumeFollow,
  revertWindowToAuthored,
  runPlanHorizon,
  runStatusLabel,
  shouldWarnRateShortfall,
  userStopped,
  visibleWindow,
  windowPlanFromAuthoredTran,
  withWindowBounds,
  zoomWindow,
  type LiveRunStatus,
  type StopReason,
  type StopReasonKind,
} from "./liveRun";

// ---------------------------------------------------------------------------

describe("LiveSampleRing — bounded retention", () => {
  it("keeps memory flat over an indefinite stream", () => {
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 2 });
    for (let i = 0; i < 10_000; i += 1) ring.push(i * 1e-6, [i, -i]);
    expect(ring.length).toBe(8);
    expect(ring.capacity).toBe(8);
    expect(ring.totalSamples).toBe(10_000);
    expect(ring.snapshot().times).toHaveLength(8);
  });

  it("returns the samples it was given, in order, per channel", () => {
    const ring = new LiveSampleRing({ capacity: 4, channelCount: 2 });
    ring.push(0, [1, 10]);
    ring.push(1, [2, 20]);
    ring.push(2, [3, 30]);
    const view = ring.snapshot();
    expect(Array.from(view.times)).toEqual([0, 1, 2]);
    expect(Array.from(view.channels[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(view.channels[1]!)).toEqual([10, 20, 30]);
  });

  it("accepts a column-oriented chunk the way the engine emits one", () => {
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 2 });
    ring.pushChunk({ times: [0, 1, 2], channels: [[1, 2, 3], [10, 20, 30]] });
    expect(Array.from(ring.snapshot().times)).toEqual([0, 1, 2]);
    expect(Array.from(ring.snapshot().channels[1]!)).toEqual([10, 20, 30]);
    expect(ring.latestTime).toBe(2);
  });

  it("refuses a chunk whose channels are misaligned rather than silently skewing traces", () => {
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 2 });
    expect(() => ring.pushChunk({ times: [0, 1], channels: [[1, 2], [10]] })).toThrow(
      /channel length/i,
    );
    expect(() => ring.pushChunk({ times: [0], channels: [[1]] })).toThrow(/expected 2 channels/i);
    expect(() => ring.push(0, [1])).toThrow(/expected 2 channel values/i);
  });

  it("refuses out-of-order sample times, because sliceByTime binary-searches them", () => {
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 1 });
    ring.push(1, [0]);
    expect(() => ring.push(0.5, [0])).toThrow(/non-decreasing/i);
    // A rerun is a clear(), not an out-of-order push.
    ring.clear();
    expect(() => ring.push(0.5, [0])).not.toThrow();
  });
});

describe("LiveSampleRing — wrapping is reported, never presented as the whole run", () => {
  it("a buffer that has NOT wrapped reports that it has not", () => {
    const ring = new LiveSampleRing({ capacity: 4, channelCount: 1 });
    ring.push(0, [0]);
    ring.push(1, [1]);
    expect(ring.hasDiscardedHistory()).toBe(false);
    expect(ring.discardedSamples).toBe(0);
    const view = ring.snapshot();
    expect(view.isWholeRun).toBe(true);
    expect(view.discardedSamples).toBe(0);
    expect(describeDiscardedHistory(view)).toBeNull();
  });

  it("a buffer that HAS wrapped reports the loss alongside the numbers", () => {
    const ring = new LiveSampleRing({ capacity: 4, channelCount: 1 });
    for (let i = 0; i < 6; i += 1) ring.push(i, [i]);
    expect(ring.hasDiscardedHistory()).toBe(true);
    expect(ring.discardedSamples).toBe(2);
    expect(ring.totalSamples).toBe(6);
    const view = ring.snapshot();
    expect(Array.from(view.times)).toEqual([2, 3, 4, 5]);
    expect(view.isWholeRun).toBe(false);
    expect(view.discardedSamples).toBe(2);
    // The origin of the run survives the discard, so the UI can say what is gone.
    expect(view.runStartTime).toBe(0);
    expect(view.retainedFromTime).toBe(2);
    expect(describeDiscardedHistory(view)).toMatch(/discarded/i);
  });

  it("a zoomed slice is never labelled the whole run even with nothing discarded", () => {
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 1 });
    for (let i = 0; i < 5; i += 1) ring.push(i, [i * 10]);
    const all = ring.sliceByTime(-1, 99);
    expect(all.isWholeRun).toBe(true);

    const zoomed = ring.sliceByTime(1, 3);
    expect(Array.from(zoomed.times)).toEqual([1, 2, 3]);
    expect(Array.from(zoomed.channels[0]!)).toEqual([10, 20, 30]);
    expect(zoomed.isWholeRun).toBe(false);
  });

  it("slices correctly across the wrap point", () => {
    const ring = new LiveSampleRing({ capacity: 4, channelCount: 1 });
    for (let i = 0; i < 7; i += 1) ring.push(i, [i * 2]);
    // Retained: t = 3,4,5,6 with the physical start mid-array.
    expect(Array.from(ring.sliceByTime(4, 5).times)).toEqual([4, 5]);
    expect(Array.from(ring.sliceByTime(4, 5).channels[0]!)).toEqual([8, 10]);
    // Asking for discarded history yields nothing, not stale samples.
    expect(Array.from(ring.sliceByTime(0, 1).times)).toEqual([]);
  });

  it("clear() forgets the discard as well as the samples", () => {
    const ring = new LiveSampleRing({ capacity: 2, channelCount: 1 });
    for (let i = 0; i < 5; i += 1) ring.push(i, [i]);
    expect(ring.hasDiscardedHistory()).toBe(true);
    ring.clear();
    expect(ring.hasDiscardedHistory()).toBe(false);
    expect(ring.length).toBe(0);
    expect(ring.runStartTime).toBeNull();
    expect(ring.latestTime).toBeNull();
    expect(ring.snapshot().isWholeRun).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("window accounting", () => {
  it("a following window rides the newest sample", () => {
    const w = followingWindow(1);
    expect(isFollowing(w)).toBe(true);
    const first = visibleWindow(w, {
      latestTime: 2,
      earliestRetainedTime: 0,
      hasDiscardedHistory: false,
    });
    expect(first).toMatchObject({ t0: 1, t1: 2, following: true });
    const later = visibleWindow(w, {
      latestTime: 5,
      earliestRetainedTime: 0,
      hasDiscardedHistory: false,
    });
    expect(later).toMatchObject({ t0: 4, t1: 5 });
  });

  it("panning pins the window so arriving samples cannot yank it away", () => {
    const pinned = panWindow(followingWindow(1), -3, 10);
    expect(isFollowing(pinned)).toBe(false);
    const before = visibleWindow(pinned, {
      latestTime: 10,
      earliestRetainedTime: 0,
      hasDiscardedHistory: false,
    });
    const after = visibleWindow(pinned, {
      latestTime: 99,
      earliestRetainedTime: 0,
      hasDiscardedHistory: false,
    });
    expect(before).toEqual(after);
    expect(after).toMatchObject({ t0: 6, t1: 7, following: false });
  });

  it("panning past the newest sample means 'take me back to live'", () => {
    const pinned = panWindow(followingWindow(1), -3, 10);
    const resumed = panWindow(pinned, 5, 10);
    expect(isFollowing(resumed)).toBe(true);
    expect(isFollowing(resumeFollow(pinned))).toBe(true);
  });

  it("zoom is a knob: it changes the span and preserves follow state", () => {
    const live = zoomWindow(followingWindow(1), 2);
    expect(live).toEqual({ spanSeconds: 2, anchorEndTime: null });

    const pinned = panWindow(followingWindow(2), -4, 10); // [4, 6]
    const zoomed = zoomWindow(pinned, 2);
    expect(isFollowing(zoomed)).toBe(false);
    expect(zoomed.spanSeconds).toBe(4);
    // Zoomed about the centre (t = 5) the user was looking at.
    expect(zoomed.anchorEndTime).toBeCloseTo(7, 12);
  });

  it("reports when the visible left edge falls in discarded history", () => {
    const w = followingWindow(10);
    const clipped = visibleWindow(w, {
      latestTime: 20,
      earliestRetainedTime: 15,
      hasDiscardedHistory: true,
    });
    expect(clipped.clippedByDiscard).toBe(true);
  });

  it("does not cry data loss when the window merely predates a short run", () => {
    const w = followingWindow(10);
    const early = visibleWindow(w, {
      latestTime: 2,
      earliestRetainedTime: 0,
      hasDiscardedHistory: false,
    });
    expect(early.t0).toBe(-8);
    expect(early.clippedByDiscard).toBe(false);

    // Discards happened, but the window sits entirely inside what is retained.
    const inside = visibleWindow(followingWindow(2), {
      latestTime: 20,
      earliestRetainedTime: 15,
      hasDiscardedHistory: true,
    });
    expect(inside.clippedByDiscard).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("AchievedRateEstimator", () => {
  it("admits it does not know yet instead of guessing", () => {
    const est = new AchievedRateEstimator();
    expect(est.rate()).toBeNull();
    est.observe(0, 0);
    expect(est.rate()).toBeNull();
    est.observe(5, 0.005); // 5 ms is below the two-poll floor
    expect(est.rate()).toBeNull();
  });

  it("measures circuit-seconds per wall-second", () => {
    const est = new AchievedRateEstimator();
    est.observe(0, 0);
    est.observe(100, 0.05);
    expect(est.rate()).toBeCloseTo(0.5, 12);
  });

  it("reports 0 for a stalled solver — stalled is known, not unknown", () => {
    const est = new AchievedRateEstimator();
    est.observe(0, 1);
    est.observe(100, 1);
    expect(est.rate()).toBe(0);
  });

  it("slides, so the number follows a solver that falls off a cliff", () => {
    const est = new AchievedRateEstimator(RATE_WINDOW_MS);
    for (let ms = 0; ms <= 500; ms += 20) est.observe(ms, ms / 1000);
    expect(est.rate()).toBeCloseTo(1, 6);
    for (let ms = 520; ms <= 1000; ms += 20) est.observe(ms, 0.5);
    expect(est.rate()).toBe(0);
  });

  it("resets rather than reporting a negative rate when either clock rewinds", () => {
    const est = new AchievedRateEstimator();
    est.observe(0, 0);
    est.observe(100, 0.1);
    expect(est.rate()).toBeCloseTo(1, 12);

    est.observe(50, 0.2); // wall clock went backwards: a new run
    expect(est.rate()).toBeNull();
    expect(est.observationCount).toBe(1);

    const other = new AchievedRateEstimator();
    other.observe(0, 5);
    other.observe(100, 6);
    other.observe(200, 0); // circuit time restarted
    expect(other.rate()).toBeNull();
  });

  it("knows when its own measurement has gone stale", () => {
    const est = new AchievedRateEstimator(500);
    expect(est.isStale(0)).toBe(true);
    est.observe(1000, 1);
    expect(est.isStale(1400)).toBe(false);
    expect(est.isStale(1600)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("honesty: report the achieved rate, never the requested one", () => {
  it("shows the measured rate when the solver cannot keep up", () => {
    const report = rateReport(1, 0.4);
    expect(report.source).toBe("achieved");
    expect(displayRate(report)).toBe(0.4);
    expect(shouldWarnRateShortfall(report)).toBe(true);
  });

  it("never substitutes the target when no rate has been measured", () => {
    const report = rateReport(1, null);
    expect(report.source).toBe("unknown");
    expect(displayRate(report)).toBeNull();
    // The target is still carried, but as the request — not as a measurement.
    expect(report.targetRate).toBe(1);
    expect(shouldWarnRateShortfall(report)).toBe(false);
  });

  it("does not nag when the solver is keeping up, or when nothing was requested", () => {
    expect(shouldWarnRateShortfall(rateReport(1, 0.99))).toBe(false);
    expect(shouldWarnRateShortfall(rateReport(1, 1.5))).toBe(false);
    expect(shouldWarnRateShortfall(rateReport(null, 0.001))).toBe(false);
    expect(displayRate(rateReport(null, 0.001))).toBe(0.001);
  });
});

describe("honesty: pacing never fast-forwards", () => {
  it("a solver that has fallen behind is reported, not skipped forward", () => {
    const decision = pacingDecision({
      targetRate: 1,
      achievedRate: 0.2,
      solvedCircuitTime: 0.5,
      dueCircuitTime: 3,
    });
    expect(decision.kind).toBe("behind");
    // The decisive assertion: there is no field a consumer could jump to.
    expect("breakpointCircuitTime" in decision).toBe(false);
    expect(Object.keys(decision).sort()).toEqual([
      "achievedRate",
      "kind",
      "shortfallSeconds",
      "targetRate",
    ]);
    if (decision.kind === "behind") {
      expect(decision.shortfallSeconds).toBeCloseTo(2.5, 12);
      expect(decision.achievedRate).toBe(0.2);
    }
  });

  it("a solver running ahead is held at a breakpoint, and the breakpoint never rewinds", () => {
    const decision = pacingDecision({
      targetRate: 1,
      achievedRate: 5,
      solvedCircuitTime: 1.5,
      dueCircuitTime: 1,
    });
    expect(decision.kind).toBe("hold");
    if (decision.kind === "hold") {
      expect(decision.aheadSeconds).toBeCloseTo(0.5, 12);
      // Already solved past the due time: the breakpoint sits at the solve, not before it.
      expect(decision.breakpointCircuitTime).toBe(1.5);
    }
  });

  it("an on-pace run gets a breakpoint far enough ahead to survive the stop latency", () => {
    const decision = pacingDecision({
      targetRate: 2,
      achievedRate: 2,
      solvedCircuitTime: 1,
      dueCircuitTime: 1,
    });
    expect(decision.kind).toBe("on-pace");
    if (decision.kind === "on-pace") {
      const leadSeconds = decision.breakpointCircuitTime - 1;
      // Measured stop latency is 10-13 ms and the poll interval is 20 ms, so a
      // breakpoint any closer than their sum could not be honoured.
      expect(leadSeconds).toBeCloseTo(breakpointLeadSeconds(2), 12);
      expect((leadSeconds / 2) * 1000).toBeGreaterThanOrEqual(STOP_LATENCY_MS);
      expect(MIN_BREAKPOINT_LEAD_MS).toBeGreaterThan(STOP_LATENCY_MS);
    }
  });

  it("free-runs when no rate was requested, and makes no timebase claim", () => {
    for (const targetRate of [null, 0, -1, Number.NaN]) {
      const decision = pacingDecision({
        targetRate,
        achievedRate: 12345,
        solvedCircuitTime: 1,
        dueCircuitTime: 0,
      });
      expect(decision).toEqual({ kind: "free-run" });
    }
  });

  it("derives where the run is due from the requested rate alone", () => {
    expect(paceDueCircuitTime(0, 0.5, 4)).toBeCloseTo(2, 12);
    expect(paceDueCircuitTime(1, 2, 0.5)).toBeCloseTo(2, 12);
    // Negative elapsed wall clock cannot pull the due time backwards.
    expect(paceDueCircuitTime(1, 2, -5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("run mode is data, not a hidden consequence of a directive", () => {
  it("defaults to LIVE when the document authors no .tran", () => {
    const plan = defaultRunPlan(null);
    expect(plan.mode).toBe("live");
    expect(runPlanHorizon(plan)).toBeNull();
    expect(plan.sampleBudget).toBe(DEFAULT_LIVE_SAMPLE_BUDGET);
  });

  it("maps an authored .tran onto a visible WINDOW instead of running free", () => {
    // Structurally the very object parseTranDirective returns, so the two
    // shapes cannot drift apart without this line failing to compile.
    const authored: AnalysisOptions = { stopTime: 0.005, steps: 240 };
    const plan = defaultRunPlan(authored, { directive: ".tran 5m" });
    expect(plan.mode).toBe("window");
    if (plan.mode !== "window") return;
    expect(plan.startTime).toBe(0);
    expect(plan.stopTime).toBe(0.005);
    expect(runPlanHorizon(plan)).toBe(0.005);
    expect(plan.sampleBudget).toBe(DEFAULT_SAMPLE_BUDGET);
    expect(plan.origin).toEqual({
      source: "authored-tran",
      authored: { startTime: 0, stopTime: 0.005, steps: 240, directive: ".tran 5m" },
    });
    expect(isWindowEditedFromAuthored(plan)).toBe(false);
  });

  it("carries .tran Tstart as the window's left edge", () => {
    const plan = windowPlanFromAuthoredTran({ stopTime: 0.01, startTime: 0.002, steps: 500 });
    expect(plan.startTime).toBe(0.002);
    expect(plan.stopTime).toBe(0.01);
  });

  it("keeps the authored bounds when the user edits the window, and can hand them back", () => {
    const authored = windowPlanFromAuthoredTran(
      { stopTime: 0.005, steps: 240 },
      { directive: ".tran 5m" },
    );
    const edited = withWindowBounds(authored, { stopTime: 0.02 });
    expect(edited.stopTime).toBe(0.02);
    expect(edited.origin.source).toBe("user");
    expect(isWindowEditedFromAuthored(edited)).toBe(true);
    // Provenance survives the edit, so the UI can offer the file's own value back.
    expect(edited.origin.authored?.stopTime).toBe(0.005);

    const reverted = revertWindowToAuthored(edited);
    expect(reverted.stopTime).toBe(0.005);
    expect(reverted.origin.source).toBe("authored-tran");
    expect(isWindowEditedFromAuthored(reverted)).toBe(false);
  });

  it("treats a degenerate .tran as no window at all rather than a zero-length run", () => {
    expect(defaultRunPlan({ stopTime: 0 }).mode).toBe("live");
    expect(defaultRunPlan({ stopTime: Number.NaN }).mode).toBe("live");
  });

  it("carries the requested rate on either mode", () => {
    expect(liveRunPlan({ targetRate: 0.25 }).targetRate).toBe(0.25);
    expect(
      windowPlanFromAuthoredTran({ stopTime: 1 }, { targetRate: 0.1 }).targetRate,
    ).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------

describe("stop reasons are a closed, exhaustive union", () => {
  const sample: Record<StopReasonKind, StopReason> = {
    "user-stopped": userStopped(),
    "left-simulator": leftSimulator(),
    "circuit-edited": circuitEdited(),
    "sample-budget": { kind: "sample-budget", atCircuitTime: 0.004, budget: 2_000_000 },
    "horizon-reached": { kind: "horizon-reached", atCircuitTime: 0.005 },
    "diverged": { kind: "diverged", atCircuitTime: 0.001, detail: "timestep too small" },
  };

  it("covers every declared kind", () => {
    expect(Object.keys(sample).sort()).toEqual([...STOP_REASON_KINDS].sort());
  });

  it("describes each kind distinctly and never blankly", () => {
    const sentences = STOP_REASON_KINDS.map((kind) => describeStopReason(sample[kind]));
    for (const sentence of sentences) expect(sentence.trim().length).toBeGreaterThan(0);
    expect(new Set(sentences).size).toBe(STOP_REASON_KINDS.length);
  });

  it("says at what circuit time the truncating stops happened", () => {
    expect(describeStopReason(sample["sample-budget"])).toContain("4 ms");
    expect(describeStopReason(sample["sample-budget"])).toContain("2,000,000");
    expect(describeStopReason(sample["horizon-reached"])).toContain("5 ms");
    expect(describeStopReason(sample.diverged)).toContain("timestep too small");
  });

  it("separates finishing from being cut short", () => {
    expect(isCompletionStop(sample["horizon-reached"])).toBe(true);
    expect(isCompletionStop(sample["sample-budget"])).toBe(false);
    expect(isCompletionStop(sample["user-stopped"])).toBe(false);
  });
});

describe("evaluateStopReason", () => {
  const plan = windowPlanFromAuthoredTran({ stopTime: 0.005, steps: 240 });

  it("returns null while the run is legitimately still going", () => {
    expect(
      evaluateStopReason({ plan, samplesSolved: 100, solvedCircuitTime: 0.001 }),
    ).toBeNull();
  });

  it("fires the horizon when the authored window is reached", () => {
    expect(
      evaluateStopReason({ plan, samplesSolved: 100, solvedCircuitTime: 0.005 }),
    ).toEqual({ kind: "horizon-reached", atCircuitTime: 0.005 });
  });

  it("fires the sample budget, recording the circuit time it fired at", () => {
    const capped = { ...plan, sampleBudget: 500 };
    expect(
      evaluateStopReason({ plan: capped, samplesSolved: 500, solvedCircuitTime: 0.0031 }),
    ).toEqual({ kind: "sample-budget", atCircuitTime: 0.0031, budget: 500 });
  });

  it("calls a completed run finished, not truncated, when both bounds land together", () => {
    const capped = { ...plan, sampleBudget: 500 };
    const reason = evaluateStopReason({
      plan: capped,
      samplesSolved: 500,
      solvedCircuitTime: 0.005,
    });
    expect(reason?.kind).toBe("horizon-reached");
  });

  it("lets divergence outrank the bookkeeping, whose counters it invalidates", () => {
    const reason = evaluateStopReason({
      plan,
      samplesSolved: 10_000_000,
      solvedCircuitTime: 0.005,
      diverged: { atCircuitTime: 0.0009, detail: "no convergence" },
    });
    expect(reason).toEqual({
      kind: "diverged",
      atCircuitTime: 0.0009,
      detail: "no convergence",
    });
  });

  it("never fires a horizon on an indefinite LIVE run", () => {
    const live = liveRunPlan();
    expect(
      evaluateStopReason({ plan: live, samplesSolved: 1e6, solvedCircuitTime: 1e9 }),
    ).toBeNull();
  });
});

describe("a stopped run never renders identically to a running one", () => {
  const running: LiveRunStatus = {
    phase: "running",
    solvedCircuitTime: 0.004,
    rate: rateReport(1, 1),
  };

  it("labels running, idle and stopped differently at the same circuit time", () => {
    const stopped: LiveRunStatus = {
      phase: "stopped",
      solvedCircuitTime: 0.004,
      reason: userStopped(),
    };
    expect(isRunning(running)).toBe(true);
    expect(isRunning(stopped)).toBe(false);
    const labels = [runStatusLabel({ phase: "idle" }), runStatusLabel(running), runStatusLabel(stopped)];
    expect(new Set(labels).size).toBe(3);
  });

  it("distinguishes every stop reason in the label a user actually sees", () => {
    const labels = STOP_REASON_KINDS.map((kind) => {
      const reason: StopReason =
        kind === "sample-budget"
          ? { kind, atCircuitTime: 0.004, budget: 10 }
          : kind === "horizon-reached"
            ? { kind, atCircuitTime: 0.004 }
            : kind === "diverged"
              ? { kind, atCircuitTime: 0.004, detail: "gmin stepping failed" }
              : { kind };
      return runStatusLabel({ phase: "stopped", solvedCircuitTime: 0.004, reason });
    });
    expect(new Set(labels).size).toBe(STOP_REASON_KINDS.length);
    expect(labels.every((label) => label !== runStatusLabel(running))).toBe(true);
  });

  it("says it is measuring rather than printing the requested rate as fact", () => {
    const label = runStatusLabel({
      phase: "running",
      solvedCircuitTime: 0.004,
      rate: rateReport(2, null),
    });
    expect(label).toMatch(/measuring/i);
    expect(label).not.toContain("2×");
  });

  it("flags a shortfall in the running label itself", () => {
    const label = runStatusLabel({
      phase: "running",
      solvedCircuitTime: 0.004,
      rate: rateReport(1, 0.25),
    });
    expect(label).toContain("0.25×");
    expect(label).toMatch(/slower than requested/i);
  });
});

describe("formatSeconds", () => {
  it("uses engineering units so a stop reason reads like an instrument", () => {
    expect(formatSeconds(0)).toBe("0 s");
    expect(formatSeconds(1.5)).toBe("1.5 s");
    expect(formatSeconds(0.005)).toBe("5 ms");
    expect(formatSeconds(1e-6)).toBe("1 µs");
    expect(formatSeconds(2.5e-9)).toBe("2.5 ns");
    expect(formatSeconds(Number.NaN)).toBe("—");
  });
});
