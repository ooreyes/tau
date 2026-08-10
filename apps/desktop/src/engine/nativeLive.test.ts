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
  resolveLiveInstance,
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
import { POLL_INTERVAL_MS } from "../simulation/liveRun";
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
    expect(end.ended.reason).toEqual({ kind: "sample-budget", atCircuitTime: 1e-6, budget: 1024 });
    expect(end.ended.detail).toBe(budgetDetail);

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
    expect(stopped.ended.reason).toMatchObject({ kind: "sample-budget", budget: 1024 });
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
    expect(sentence).toContain("1 in 3");
    expect(sentence).toContain("1,500");

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
