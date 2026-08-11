import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  LIVE_ENGINE_STOP_REASONS,
  LIVE_NOT_AVAILABLE_MESSAGE,
  alterLiveSpice,
  classifyLiveFailure,
  describeEngineDecimation,
  describeLiveFailure,
  engineRetention,
  haltLiveSpice,
  isBudgetExhausted,
  isDivergence,
  isUserStop,
  liveAlterableInstances,
  liveChunkFromSlice,
  liveSpiceStatus,
  liveVectorSpellings,
  resolveLiveInstance,
  resolveLiveVectorNames,
  startLiveSession,
  startLiveSpice,
  stopReasonFromEngine,
  type LiveFrame,
  type LiveInstanceName,
  type LiveRunOutcome,
  type LiveSlicePayload,
  type LiveStartResponse,
  type LiveTelemetry,
} from "./nativeLive";
import { POLL_INTERVAL_MS, describeStopReason, rateReport } from "../simulation/liveRun";
import { LiveSampleRing } from "../simulation/liveRun";
import { buildSpiceDeck } from "./spiceNetlist";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

// ── fixtures ────────────────────────────────────────────────────────────────

const telemetry = (over: Partial<LiveTelemetry> = {}): LiveTelemetry => ({
  running: true,
  wallSeconds: 0.1,
  solvedSamples: 512,
  vectorCount: 2,
  scalars: 1024,
  scalarBudget: 32_000_000,
  pointsPerSecond: 500_000,
  deliveredSamples: 512,
  decimatedSamples: 0,
  stride: 1,
  stopReason: null,
  stopDetail: null,
  engineLog: [],
  ...over,
});

const startResponse = (over: Partial<LiveStartResponse> = {}): LiveStartResponse => ({
  plot: "tran1",
  vectors: ["time", "v(out)"],
  libraryPath: "/bundle/libngspice.dylib",
  telemetry: telemetry(),
  ...over,
});

const slicePayload = (
  times: number[],
  values: number[],
  over: Partial<LiveSlicePayload> = {},
): LiveSlicePayload => ({
  names: ["time", "v(out)"],
  columns: [times, values],
  from: 0,
  cursor: times.length,
  stride: 1,
  skew: 0,
  telemetry: telemetry(),
  ...over,
});

const enableNativeRuntime = () => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

/** Route each Tauri command to its own answer, so a test that cares about one
 *  command does not have to order `mockResolvedValueOnce` across the others. */
const respond = (handlers: Partial<Record<string, (args: unknown) => unknown>>) => {
  invoke.mockImplementation((command: string, args: unknown) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject(`no mock for ${command}`);
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const component = (
  kind: SchematicComponent["kind"],
  id: string,
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

/** V1 -> R1 -> C1 -> ground, the same topology `nativeSpice.test.ts` uses. */
const rcSchematic = () => ({
  components: [
    component("vsource", "v1", "V1", "5", 0, 32),
    component("resistor", "r1", "R1", "1k", 96, 0),
    component("capacitor", "c1", "C1", "1u", 224, 0),
    component("ground", "g1", "", "", 0, 64),
    component("ground", "g2", "", "", 256, 0),
  ],
  wires: [
    wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
  ],
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  invoke.mockReset();
});

// ── lifecycle ───────────────────────────────────────────────────────────────

describe("live ngspice bridge — lifecycle", () => {
  it("starts, delivers frames at the poll cadence, and stops with the engine's reason", async () => {
    enableNativeRuntime();
    const startArgs: unknown[] = [];
    const pollArgs: unknown[] = [];
    respond({
      start_live_spice: (args) => {
        startArgs.push(args);
        return startResponse();
      },
      poll_live_spice: (args) => {
        pollArgs.push(args);
        return slicePayload([0, 1e-6, 2e-6], [0, 0.5, 0.9]);
      },
      halt_live_spice: () =>
        telemetry({
          running: false,
          stopReason: "halted-by-user",
          stopDetail: "Stopped by the engineer.",
        }),
    });

    const frames: LiveFrame[] = [];
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({
      netlist: "Tau generated circuit\nR1 in out 1k\n.tran 1u 1m\n.end",
      names: ["time", "v(out)"],
      maxSamples: 2048,
      stopAtSeconds: 0.005,
      onFrame: (frame) => frames.push(frame),
      onEnd: (end) => ends.push(end),
    });

    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    expect(outcome.session.plot).toBe("tran1");
    expect(outcome.session.vectors).toEqual(["time", "v(out)"]);
    // Argument casing across the IPC boundary is the engine's serde contract.
    expect(startArgs[0]).toEqual({
      request: {
        netlist: "Tau generated circuit\nR1 in out 1k\n.tran 1u 1m\n.end",
        stopAtSeconds: 0.005,
      },
    });

    // Nothing is polled before the first tick.
    expect(pollArgs).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(pollArgs).toEqual([{ request: { names: ["time", "v(out)"], maxSamples: 2048 } }]);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.chunk).toMatchObject({
      times: [0, 1e-6, 2e-6],
      channels: [[0, 0.5, 0.9]],
      channelNames: ["v(out)"],
      trimmedSamples: 0,
    });
    expect(frames[0]!.solvedCircuitTime).toBe(2e-6);
    expect(frames[0]!.retention.isWholeRun).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(frames).toHaveLength(3);

    const stopped = await outcome.session.stop();
    if (stopped.kind !== "ended") throw new Error("expected an ended outcome");
    expect(stopped.ended).toMatchObject({
      engineReason: "halted-by-user",
      reason: { kind: "user-stopped" },
    });
    expect(isUserStop(stopped.ended)).toBe(true);
    expect(ends).toHaveLength(1);
    expect(outcome.session.isFinished).toBe(true);
  });

  it("feeds LiveSampleRing without a second sample vocabulary", async () => {
    // The chunk shape is exactly what liveRun's ring takes; this bridge does
    // not define its own buffer.
    const chunk = liveChunkFromSlice(slicePayload([0, 1e-6], [1, 2]))!;
    const ring = new LiveSampleRing({ capacity: 8, channelCount: 1 });
    ring.pushChunk(chunk);
    expect(ring.length).toBe(2);
    expect(ring.snapshot().isWholeRun).toBe(true);
  });
});

// ── back-pressure ───────────────────────────────────────────────────────────

describe("live ngspice bridge — back-pressure", () => {
  it("skips a tick rather than stacking a second poll on an outstanding one", async () => {
    enableNativeRuntime();
    const pending = deferred<LiveSlicePayload>();
    let polls = 0;
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => {
        polls += 1;
        return polls === 1 ? pending.promise : slicePayload([3e-6], [1]);
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });

    const frames: LiveFrame[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onFrame: (frame) => frames.push(frame) });
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(polls).toBe(1);

    // Three more ticks while the first poll is still in flight. A queue here
    // would slow the reader, which slows the writer, which makes the reader
    // later still — so every one of them is dropped.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(polls).toBe(1);
    expect(outcome.session.skippedTicks).toBe(3);
    expect(frames).toHaveLength(0);

    pending.resolve(slicePayload([0, 1e-6], [0, 0.5]));
    await vi.advanceTimersByTimeAsync(0);
    expect(frames).toHaveLength(1);

    // The loop resumes at the cadence once the poll has landed.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(polls).toBe(2);
    expect(outcome.session.skippedTicks).toBe(3);

    await outcome.session.stop();
  });
});

// ── two vocabularies for one node ───────────────────────────────────────────

/**
 * Exactly what the bundled libngspice publishes for this repo's own
 * `LIVE_RC_DECK` (`live_spice.rs`): bare node names, the time axis, and a
 * `#branch` per voltage source. Adding `.save v(out) v(in)` to the deck does
 * not change it. Every case below is written against these strings rather than
 * against a convenient invention, because the invention is what let the naming
 * defect survive a green suite: the fixtures said `v(out)`, the engine says
 * `out`, and nothing in the file ever compared the two.
 */
const LATCHED_RC_VECTORS = ["in", "out", "time", "v1#branch"];

/** ngspice's own refusal, spelled as `resolve_names` in `live_spice.rs` spells
 *  it, so a poll for an unpublished name fails here the way it fails there. */
const rcEngineNames = (requested: readonly string[]): string[] =>
  requested.map((name) => {
    const hit = LATCHED_RC_VECTORS.find((known) => known.toLowerCase() === name.toLowerCase());
    if (hit === undefined) throw `"${name}" is not a vector this live run publishes.`;
    return hit;
  });

describe("live ngspice bridge — the app's vector names against the engine's", () => {
  it("resolves Tau's spelling onto the run's own, and names what has no match", () => {
    const resolution = resolveLiveVectorNames(
      ["time", "v(out)", "v(IN)", "i(V1)", "v(n042)", "v(out,in)"],
      LATCHED_RC_VECTORS,
    );
    expect(resolution.names).toEqual(["time", "out", "in", "v1#branch"]);
    expect(resolution.matched).toEqual([
      { requested: "time", polled: "time" },
      { requested: "v(out)", polled: "out" },
      { requested: "v(IN)", polled: "in" },
      { requested: "i(V1)", polled: "v1#branch" },
    ]);
    // A net this deck has no node for, and a differential probe, which is a
    // computed expression rather than a published vector. Both are reported so
    // the caller can drop them out loud.
    expect(resolution.unpublished).toEqual(["v(n042)", "v(out,in)"]);
  });

  it("prefers the verbatim spelling when the plot really does publish it", () => {
    // Which spelling is right is a property of the plot, not of the request, so
    // a build that publishes the parenthesised form must be polled with it.
    expect(resolveLiveVectorNames(["v(out)"], ["time", "v(out)", "out"]).names).toEqual(["v(out)"]);
    expect(liveVectorSpellings("v(out)")).toEqual(["v(out)", "out"]);
    expect(liveVectorSpellings("i(v1)")).toEqual(["i(v1)", "v1#branch"]);
    expect(liveVectorSpellings("time")).toEqual(["time"]);
  });

  it("polls the engine's spelling, not the app's, from the very first tick", async () => {
    // The whole live feature died here: App asks for `v(n001)`, ngspice latched
    // `n001`, the first poll 20 ms later was refused by name, and the transport
    // read "Ready." one frame after Run.
    enableNativeRuntime();
    const pollArgs: unknown[] = [];
    respond({
      start_live_spice: () => startResponse({ vectors: LATCHED_RC_VECTORS }),
      poll_live_spice: (args) => {
        pollArgs.push(args);
        const names = rcEngineNames((args as { request: { names: string[] } }).request.names);
        return slicePayload([0, 1e-6], [0, 0.5], { names, columns: [[0, 1e-6], [0, 0.5]] });
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });

    const ends: LiveRunOutcome[] = [];
    const frames: LiveFrame[] = [];
    const outcome = await startLiveSession({
      netlist: "deck",
      names: ["time", "v(out)"],
      onFrame: (frame) => frames.push(frame),
      onEnd: (end) => ends.push(end),
    });
    if (outcome.kind !== "started") throw new Error("expected a started session");
    expect(outcome.session.vectorResolution.names).toEqual(["time", "out"]);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(pollArgs[0]).toEqual({ request: { names: ["time", "out"] } });
    expect(ends).toEqual([]);
    expect(frames).toHaveLength(3);
    await outcome.session.stop();
  });

  it("narrows the poll list to what was latched, so one dropped trace is not fatal", async () => {
    // Even with the spelling fixed, sending a name the run does not publish
    // turns a documented, reported drop into a dead run: `resolve_names`
    // refuses the WHOLE frame, not just the offending column.
    enableNativeRuntime();
    const pollArgs: unknown[] = [];
    respond({
      start_live_spice: () => startResponse({ vectors: LATCHED_RC_VECTORS }),
      poll_live_spice: (args) => {
        pollArgs.push(args);
        const names = rcEngineNames((args as { request: { names: string[] } }).request.names);
        return slicePayload([0, 1e-6], [0, 0.5], {
          names,
          columns: [[0, 1e-6], ...names.slice(1).map(() => [0, 0.5])],
        });
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });

    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({
      netlist: "deck",
      names: ["time", "v(out)", "v(nowhere)"],
      onEnd: (end) => ends.push(end),
    });
    if (outcome.kind !== "started") throw new Error("expected a started session");
    expect(outcome.session.vectorResolution.unpublished).toEqual(["v(nowhere)"]);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(pollArgs).toEqual([
      { request: { names: ["time", "out"] } },
      { request: { names: ["time", "out"] } },
    ]);
    expect(ends).toEqual([]);
    await outcome.session.stop();
  });

  it("refuses to widen to the whole plot when nothing asked for is published", async () => {
    // An empty name list means "every latched vector" to the child. Letting a
    // fully unresolved request decay into that would hand back columns for
    // traces nobody asked for, in an order nobody declared.
    enableNativeRuntime();
    let polls = 0;
    let halts = 0;
    respond({
      start_live_spice: () => startResponse({ vectors: LATCHED_RC_VECTORS }),
      poll_live_spice: () => {
        polls += 1;
        return slicePayload([0], [0]);
      },
      halt_live_spice: () => {
        halts += 1;
        return telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." });
      },
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({
      netlist: "deck",
      names: ["v(nowhere)"],
      onEnd: (end) => ends.push(end),
    });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(polls).toBe(0);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ kind: "failed", failure: { kind: "engine-refused" } });
    expect(halts).toBe(1);
  });

  it("stops the solver when a poll fails, instead of stranding the engine's lease", async () => {
    // The engine host holds Tau's single live lease until the run is halted, so
    // a session that forgets a run locally without halting it makes every later
    // Run fail with "A live simulation is already running." One bad frame used
    // to cost the feature for the rest of the session.
    enableNativeRuntime();
    let halts = 0;
    respond({
      start_live_spice: () => startResponse({ vectors: LATCHED_RC_VECTORS }),
      poll_live_spice: () => {
        throw '"v(n001)" is not a vector this live run publishes.';
      },
      halt_live_spice: () => {
        halts += 1;
        return telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." });
      },
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onEnd: (end) => ends.push(end) });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(ends).toMatchObject([{ kind: "failed", failure: { kind: "engine-refused" } }]);
    expect(halts).toBe(1);
    // And exactly once, however long the timers are advanced afterwards.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 20);
    expect(halts).toBe(1);
    expect(ends).toHaveLength(1);
  });
});

// ── the reported rate decays when the solver stalls ─────────────────────────

describe("live ngspice bridge — a stalled solver", () => {
  it("lets the measured rate fall to zero instead of repeating its last good one", async () => {
    // An empty frame is evidence: the engine's own wall clock advanced and no
    // circuit time came with it. Feeding only frames that carried samples left
    // the last measurement on screen as though it were current — true once, and
    // not true now.
    enableNativeRuntime();
    let poll = 0;
    respond({
      start_live_spice: () => startResponse({ vectors: LATCHED_RC_VECTORS }),
      poll_live_spice: () => {
        poll += 1;
        const wallSeconds = poll * (POLL_INTERVAL_MS / 1000);
        // Five frames of real progress, then a solver that stops advancing.
        const moving = poll <= 5;
        const times = moving ? [poll * 1e-3] : [];
        return slicePayload(times, moving ? [1] : [], {
          names: ["time", "out"],
          columns: [times, moving ? [1] : []],
          telemetry: telemetry({ wallSeconds }),
        });
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });

    const frames: LiveFrame[] = [];
    const outcome = await startLiveSession({
      netlist: "deck",
      names: ["time", "v(out)"],
      targetRate: 0.05,
      onFrame: (frame) => frames.push(frame),
    });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    const moving = frames[4]!.rate;
    expect(moving).toEqual(rateReport(0.05, 0.05));
    expect(moving).toMatchObject({ source: "achieved", keepingUp: true });

    // Long enough that the whole smoothing window is stalled frames.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 40);
    const stalled = frames[frames.length - 1]!.rate;
    expect(stalled).toEqual({ source: "achieved", rate: 0, targetRate: 0.05, keepingUp: false });

    await outcome.session.stop();
  });
});

// ── named failures ──────────────────────────────────────────────────────────

describe("live ngspice bridge — named failures", () => {
  it("degrades outside Tauri with a typed 'not available here'", async () => {
    const outcome = await startLiveSession({ netlist: "deck" });
    expect(outcome).toEqual({
      kind: "failed",
      failure: { kind: "not-available", message: LIVE_NOT_AVAILABLE_MESSAGE },
    });
    expect(invoke).not.toHaveBeenCalled();

    // Every command degrades the same way; none of them rejects.
    await expect(startLiveSpice({ netlist: "deck" })).resolves.toMatchObject({ ok: false });
    await expect(haltLiveSpice()).resolves.toMatchObject({ ok: false });
    await expect(liveSpiceStatus()).resolves.toMatchObject({ ok: false });
    await expect(
      alterLiveSpice({ instance: "r1" as LiveInstanceName, value: "3k" }),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "not-available" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("names the bounded path when it is the one holding the engine", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => {
        throw "Another native ngspice analysis is already running.";
      },
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    expect(outcome).toMatchObject({ kind: "failed", failure: { kind: "engine-busy", holder: "bounded" } });
    if (outcome.kind !== "failed") return;
    expect(describeLiveFailure(outcome.failure)).toContain("Wait for it to finish");
  });

  it("names the live path when a second live run is asked for", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => {
        throw "A live simulation is already running. Stop it before starting another.";
      },
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    expect(outcome).toMatchObject({ kind: "failed", failure: { kind: "engine-busy", holder: "live" } });
  });

  it("reports a refused start as start-failed, not as a dead worker", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => {
        throw "ngspice refused a breakpoint at 0.005 s, so Tau cannot guarantee the live run stops on a solved point there.";
      },
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    expect(outcome).toMatchObject({ kind: "failed", failure: { kind: "start-failed" } });
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.message).toContain("refused a breakpoint");
  });

  it("ends the run and stops polling when the isolated worker dies", async () => {
    enableNativeRuntime();
    let polls = 0;
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => {
        polls += 1;
        throw "Tau's live ngspice worker exited unexpectedly. Worker diagnostics: signal 11";
      },
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onEnd: (end) => ends.push(end) });
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(ends).toEqual([
      {
        kind: "failed",
        failure: {
          kind: "worker-died",
          message: "Tau's live ngspice worker exited unexpectedly. Worker diagnostics: signal 11",
        },
      },
    ]);

    // A dead worker must not keep being polled.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    expect(polls).toBe(1);
    expect(ends).toHaveLength(1);
  });

  it("distinguishes 'no run to talk to' from a run that ended for a reason", async () => {
    enableNativeRuntime();
    respond({
      halt_live_spice: () => {
        throw "No live simulation is running.";
      },
    });
    await expect(haltLiveSpice()).resolves.toEqual({
      ok: false,
      failure: { kind: "not-running", message: "No live simulation is running." },
    });
  });

  it("reports a refused knob turn as alter-refused and leaves the run going", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => slicePayload([0], [0]),
      alter_live_spice: () => {
        throw '"1k; shell rm -rf /" is not a SPICE value. Tau accepts a number with an optional engineering suffix, such as 3k, 100n, or -2.5e-3.';
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    const altered = await outcome.session.alter({
      instance: "r1" as LiveInstanceName,
      value: "1k; shell rm -rf /",
    });
    expect(altered).toMatchObject({ ok: false, failure: { kind: "alter-refused" } });
    expect(outcome.session.isFinished).toBe(false);
    await outcome.session.stop();
  });

  it("classifies every engine sentence it is given without falling through by accident", () => {
    expect(classifyLiveFailure("'v(nope)' is not a vector this live run publishes.", "poll")).toEqual({
      kind: "engine-refused",
      message: "'v(nope)' is not a vector this live run publishes.",
    });
    expect(classifyLiveFailure(new Error("Tau's live ngspice task failed: panic"), "poll").kind).toBe(
      "worker-died",
    );
    expect(classifyLiveFailure("This live ngspice worker has no circuit energised.", "poll").kind).toBe(
      "not-running",
    );
    expect(
      classifyLiveFailure("This live run is no longer solving, so there is nothing to alter.", "alter").kind,
    ).toBe("not-running");
  });
});

// ── stop reasons: a budget stop is not a user stop ──────────────────────────

describe("live ngspice bridge — stop reasons", () => {
  it("reports an exhausted sample budget as its own outcome, never as a user Stop", async () => {
    enableNativeRuntime();
    const budgetDetail =
      "The live run reached Tau's retention budget of 1024 solved values (512 samples across 2 traces) after 1.0 s at 500 points/s, so the solver was stopped. Nothing already shown was discarded; the run simply ends here.";
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () =>
        slicePayload([0, 1e-6], [0, 1], {
          telemetry: telemetry({
            running: false,
            scalarBudget: 1024,
            stopReason: "sample-budget",
            stopDetail: budgetDetail,
          }),
        }),
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onEnd: (end) => ends.push(end) });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(ends).toHaveLength(1);
    const end = ends[0]!;
    expect(end.kind).toBe("ended");
    if (end.kind !== "ended") return;
    expect(end.ended.engineReason).toBe("sample-budget");
    expect(isBudgetExhausted(end.ended)).toBe(true);
    expect(isUserStop(end.ended)).toBe(false);
    // 512, not the 1024 this case used to assert. That older expectation locked
    // in a unit error: `scalarBudget` counts samples × vectors, and the field it
    // was being copied into is rendered by `describeStopReason` as a SAMPLE
    // count. The detail sentence right below is the arithmetic — 1024 solved
    // values across 2 traces is 512 samples — and the two now agree instead of
    // the status line quoting a number from a different unit.
    expect(end.ended.reason).toEqual({ kind: "sample-budget", atCircuitTime: 1e-6, budget: 512 });
    expect(end.ended.detail).toBe(budgetDetail);
    expect(budgetDetail).toContain("1024 solved values (512 samples across 2 traces)");

    // Pressing Stop afterwards must still say "budget", not "you stopped it".
    const stopped = await outcome.session.stop();
    expect(stopped).toMatchObject({ kind: "ended", ended: { engineReason: "sample-budget" } });
    expect(ends).toHaveLength(1);
  });

  it("takes Stop's reason from the engine, so a budget stop survives the button", async () => {
    // The engine host keeps a retired session's final telemetry precisely so
    // this answer outlives the child; assuming `halted-by-user` here would
    // throw that away.
    enableNativeRuntime();
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => slicePayload([0, 1e-6], [0, 1]),
      halt_live_spice: () =>
        telemetry({
          running: false,
          scalarBudget: 1024,
          stopReason: "sample-budget",
          stopDetail: "The live run reached Tau's retention budget.",
        }),
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    if (outcome.kind !== "started") throw new Error("expected a started session");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    const stopped = await outcome.session.stop();
    expect(stopped).toMatchObject({ kind: "ended", ended: { engineReason: "sample-budget" } });
    if (stopped.kind !== "ended") return;
    expect(isUserStop(stopped.ended)).toBe(false);
    // As above: the halt's telemetry declares a 1024-SCALAR ceiling over 2
    // vectors, so the sample budget the status line may quote is 512. Asserting
    // 1024 here — as this case used to — was asserting that the number survives
    // the trip unchanged, which is exactly the defect.
    expect(stopped.ended.reason).toMatchObject({ kind: "sample-budget", budget: 512 });
  });

  /**
   * The conversion has to hold for the shape that made it visible: a wide run.
   *
   * 25 traces against the engine's own 32,000,000-scalar ceiling is 1.28 M
   * samples, and the old code printed the 32,000,000 as though it were a
   * sample count — a number that was neither the budget, nor the samples
   * produced, nor the plan's declared budget.
   */
  it("states the sample ceiling in samples, not in solved values", () => {
    const wide = telemetry({
      running: false,
      vectorCount: 25,
      solvedSamples: 1_280_000,
      scalars: 32_000_000,
      scalarBudget: 32_000_000,
      stopReason: "sample-budget",
    });
    expect(stopReasonFromEngine(wide, 4e-3)).toEqual({
      kind: "sample-budget",
      atCircuitTime: 4e-3,
      budget: 1_280_000,
    });
    expect(describeStopReason(stopReasonFromEngine(wide, 4e-3)!)).toContain("sample budget of 1,280,000");

    // A telemetry that cannot say how wide it is must not turn the ceiling into
    // a division by zero; the scalar count is then the best available statement
    // and is at least not smaller than the truth.
    expect(
      stopReasonFromEngine(telemetry({ running: false, vectorCount: 0, scalarBudget: 4096, stopReason: "sample-budget" }), 1),
    ).toMatchObject({ budget: 4096 });
  });

  it("carries a non-finite sample through as liveRun's own diverged reason", async () => {
    enableNativeRuntime();
    const detail =
      "Sample 4096 of v(out) was NaN, so Tau stopped the live run there. The solver is no longer producing numbers for this circuit.";
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () =>
        slicePayload([0, 1e-6], [0, 1], {
          telemetry: telemetry({ running: false, stopReason: "non-finite", stopDetail: detail }),
        }),
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onEnd: (end) => ends.push(end) });
    if (outcome.kind !== "started") throw new Error("expected a started session");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    const end = ends[0]!;
    if (end.kind !== "ended") throw new Error("expected an ended outcome");
    expect(isDivergence(end.ended)).toBe(true);
    expect(end.ended.reason).toEqual({ kind: "diverged", atCircuitTime: 1e-6, detail });
  });

  it("admits when liveRun has no word for the engine's reason instead of guessing one", () => {
    // An idle timeout is not a divergence and not the user leaving; a fatal
    // engine condition is neither. Reaching for the nearest-looking StopReason
    // would state something the engine never said.
    for (const reason of ["idle-timeout", "engine-error"] as const) {
      const mapped = stopReasonFromEngine(telemetry({ running: false, stopReason: reason }), 1e-3);
      expect(mapped).toBeNull();
    }
    expect(stopReasonFromEngine(telemetry({ stopReason: "analysis-complete" }), 5e-3)).toEqual({
      kind: "horizon-reached",
      atCircuitTime: 5e-3,
    });
    expect(stopReasonFromEngine(telemetry({ stopReason: "requested-stop-time" }), 5e-3)).toEqual({
      kind: "horizon-reached",
      atCircuitTime: 5e-3,
    });
  });

  it("has a mapping for every stop reason the engine can report", () => {
    for (const reason of LIVE_ENGINE_STOP_REASONS) {
      const mapped = stopReasonFromEngine(
        telemetry({ running: false, stopReason: reason, stopDetail: "detail" }),
        1,
      );
      // `null` is a decision, not a gap: the two absences are asserted above.
      expect(mapped === null || typeof mapped.kind === "string").toBe(true);
    }
    expect(LIVE_ENGINE_STOP_REASONS).toHaveLength(7);
  });
});

// ── retention honesty ───────────────────────────────────────────────────────

describe("live ngspice bridge — retention honesty", () => {
  it("propagates discarded history rather than presenting the remainder as the run", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () =>
        slicePayload([0, 3e-6, 6e-6], [0, 1, 2], {
          stride: 3,
          skew: 12,
          telemetry: telemetry({ stride: 3, deliveredSamples: 500, decimatedSamples: 1500 }),
        }),
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });
    const frames: LiveFrame[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onFrame: (frame) => frames.push(frame) });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const retention = frames[0]!.retention;
    expect(retention).toEqual({
      deliveredSamples: 500,
      decimatedSamples: 1500,
      stride: 3,
      skew: 12,
      isWholeRun: false,
    });
    const sentence = describeEngineDecimation(retention);
    expect(sentence).toBe(
      "Showing 500 of 2,000 solved points — 1,500 samples the engine solved were never sent to the plot.",
    );

    // The loss survives into the end of the run, so a stopped plot cannot claim
    // completeness either — note the halt above answers with a telemetry whose
    // own `decimatedSamples` is 0. Retention loss is monotonic: once a solved
    // point has been skipped, no later frame may take that back.
    const stopped = await outcome.session.stop();
    if (stopped.kind !== "ended") throw new Error("expected an ended outcome");
    expect(stopped.ended.retention.isWholeRun).toBe(false);
  });

  it("says nothing while nothing has been discarded", () => {
    expect(describeEngineDecimation(engineRetention(telemetry()))).toBeNull();
    expect(engineRetention(telemetry()).isWholeRun).toBe(true);
  });

  /**
   * The sentence may never pair a per-FRAME ratio with a per-RUN count.
   *
   * This is the state that exposed it: a long run has thrown away millions of
   * points, and the frame that happens to be in hand right now was small
   * enough to be delivered whole (`stride: 1`). The old wording read "Showing
   * 1 in 1 solved points — 4,102,208 samples the engine solved were never sent
   * to the plot", which is a self-contradiction in one line. Delivered and
   * decimated are both cumulative, so the pair can only describe one span.
   */
  it("never contradicts itself by pairing this frame's stride with the run's loss", () => {
    const sentence = describeEngineDecimation({
      deliveredSamples: 2_048_000,
      decimatedSamples: 4_102_208,
      stride: 1,
      skew: 0,
      isWholeRun: false,
    });
    expect(sentence).not.toContain("1 in 1");
    expect(sentence).toBe(
      "Showing 2,048,000 of 6,150,208 solved points — 4,102,208 samples the engine solved were never sent to the plot.",
    );
  });

  it("squares off a ragged frame instead of throwing inside the poll tick", () => {
    // A vector the child could not read comes back empty while its siblings are
    // full; LiveSampleRing.pushChunk throws on a length mismatch, and a throw
    // in a tick would kill the run over a trace nobody was plotting.
    const chunk = liveChunkFromSlice({
      names: ["time", "v(out)", "v(mid)"],
      columns: [[0, 1e-6, 2e-6], [0, 1, 2], []],
      from: 0,
      cursor: 3,
      stride: 1,
      skew: 0,
      telemetry: telemetry(),
    })!;
    expect(chunk.times).toEqual([]);
    expect(chunk.channels).toEqual([[], []]);
    expect(chunk.trimmedSamples).toBe(3);
    expect(() =>
      new LiveSampleRing({ capacity: 4, channelCount: 2 }).pushChunk(chunk),
    ).not.toThrow();
  });

  it("has no chunk for a frame that carries no time axis", () => {
    expect(
      liveChunkFromSlice({
        names: ["v(out)"],
        columns: [[1, 2]],
        from: 0,
        cursor: 2,
        stride: 1,
        skew: 0,
        telemetry: telemetry(),
      }),
    ).toBeNull();
  });
});

// ── alter targets come from the emitter ─────────────────────────────────────

describe("live ngspice bridge — alter instance names", () => {
  it("takes its instance names from the deck the emitter produced", () => {
    const deck = buildSpiceDeck(rcSchematic(), { kind: "tran", stopTime: 0.002, steps: 200 });
    const instances = liveAlterableInstances(deck);

    expect(resolveLiveInstance(deck, "R1")).toBe("R1");
    expect(resolveLiveInstance(deck, "r1")).toBe("R1");
    expect(resolveLiveInstance(deck, "V1")).toBe("V1");
    expect(resolveLiveInstance(deck, "C1")).toBe("C1");
    // Every resolved name is a token the deck actually emitted.
    for (const name of instances.values()) {
      expect(deck.netlist).toContain(`\n${name} `);
    }
  });

  it("refuses a name the deck does not use, because ngspice would not", () => {
    // `alter r9 = 1k` against an absent instance is accepted by ngspice, the run
    // carries on, the value never changes, and nothing reports an error. The
    // only defence is refusing to produce a target for it.
    const deck = buildSpiceDeck(rcSchematic(), { kind: "tran", stopTime: 0.002, steps: 200 });
    expect(resolveLiveInstance(deck, "R9")).toBeNull();
    expect(resolveLiveInstance(deck, "gnd")).toBeNull();
    expect(resolveLiveInstance(deck, "")).toBeNull();
  });

  it("reads only top-level element lines out of a netlist", () => {
    const instances = liveAlterableInstances({
      netlist: [
        "R1 should be ignored: line one is the title",
        "* a comment",
        ".options reltol=1e-3",
        "V1 in 0 5",
        "R2 in out 1k",
        "+ tc=0.001",
        ".subckt buffer a b",
        "RINNER a b 1k",
        ".ends",
        "XU1 in out buffer",
        "",
        ".tran 1u 1m",
        ".end",
      ].join("\n"),
    });
    expect([...instances.keys()]).toEqual(["v1", "r2", "xu1"]);
    expect(instances.get("rinner")).toBeUndefined();
  });

  it("sends an accepted knob turn across the boundary in the engine's own shape", async () => {
    enableNativeRuntime();
    const args: unknown[] = [];
    respond({
      alter_live_spice: (received) => {
        args.push(received);
        return telemetry();
      },
    });
    const deck = buildSpiceDeck(rcSchematic(), { kind: "tran", stopTime: 0.002, steps: 200 });
    const instance = resolveLiveInstance(deck, "R1")!;
    await expect(alterLiveSpice({ instance, value: "3k" })).resolves.toMatchObject({ ok: true });
    expect(args[0]).toEqual({ request: { instance: "R1", value: "3k" } });

    await alterLiveSpice({ instance, parameter: "temp", value: "85" });
    expect(args[1]).toEqual({ request: { instance: "R1", parameter: "temp", value: "85" } });
  });
});

// ── timer cleanup ───────────────────────────────────────────────────────────

describe("live ngspice bridge — cleanup", () => {
  it("clears its timer on stop so no poll fires after the run is over", async () => {
    enableNativeRuntime();
    let polls = 0;
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => {
        polls += 1;
        return slicePayload([polls * 1e-6], [polls]);
      },
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });
    const outcome = await startLiveSession({ netlist: "deck" });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(polls).toBe(2);

    await outcome.session.stop();
    const afterStop = polls;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 25);
    expect(polls).toBe(afterStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fires onEnd exactly once however many times Stop is pressed", async () => {
    enableNativeRuntime();
    respond({
      start_live_spice: () => startResponse(),
      poll_live_spice: () => slicePayload([1e-6], [1]),
      halt_live_spice: () => telemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped." }),
    });
    const ends: LiveRunOutcome[] = [];
    const outcome = await startLiveSession({ netlist: "deck", onEnd: (end) => ends.push(end) });
    if (outcome.kind !== "started") throw new Error("expected a started session");

    await outcome.session.stop();
    await outcome.session.stop();
    await outcome.session.stop();
    expect(ends).toHaveLength(1);
  });
});
