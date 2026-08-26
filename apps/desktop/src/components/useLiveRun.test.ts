// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { act, cleanup, renderHook } from "@testing-library/react";

import { resolveStopReason, useLiveRun, type LiveChannelRequest } from "./useLiveRun";
import type { LiveEnded, LiveEngineStopReason, LiveTelemetry } from "../engine/nativeLive";
import { stopReasonFromEngine } from "../engine/nativeLive";
import { POLL_INTERVAL_MS } from "../simulation/liveRun";

/**
 * The one decision this hook makes that the modules underneath it could not.
 *
 * `LiveSpiceSession.stop()` already answers from the halt's own final telemetry
 * rather than assuming it was obeyed, so the engine's reason is trustworthy.
 * What the engine cannot know is *why* Tau asked: leaving the simulator and
 * pressing Stop are the same `bg_halt` down there. That gap, and only that gap,
 * is what `resolveStopReason` fills — and the requirement it has to keep is the
 * one that is easy to break by accident: a run that ended on its own must never
 * come back wearing the label of whatever Tau happened to ask for afterwards.
 */

const telemetryFor = (stopReason: LiveEngineStopReason): LiveTelemetry => ({
  running: false,
  wallSeconds: 1.5,
  solvedSamples: 4096,
  vectorCount: 3,
  scalars: 12_288,
  scalarBudget: 12_288,
  pointsPerSecond: 480_000,
  deliveredSamples: 4096,
  decimatedSamples: 0,
  stride: 1,
  stopReason,
  stopDetail: `engine says: ${stopReason}`,
  engineLog: [],
});

function endedWith(stopReason: LiveEngineStopReason): LiveEnded {
  const telemetry = telemetryFor(stopReason);
  const solvedCircuitTime = 3.25e-3;
  return {
    engineReason: stopReason,
    reason: stopReasonFromEngine(telemetry, solvedCircuitTime),
    detail: telemetry.stopDetail!,
    telemetry,
    retention: {
      deliveredSamples: telemetry.deliveredSamples,
      decimatedSamples: 0,
      stride: 1,
      skew: 0,
      isWholeRun: true,
    },
    solvedCircuitTime,
  };
}

describe("resolveStopReason", () => {
  it("keeps the engine's own reason whenever the run ended by itself", () => {
    // Every one of these arrives while a Stop may already be in flight — the
    // halt takes 10-13 ms to land — so the intent is deliberately non-null here
    // to prove it loses.
    // 4096 samples, not the 12,288 scalars this case used to assert: the
    // telemetry's ceiling is 12,288 solved VALUES across 3 vectors, and the
    // field is rendered by `describeStopReason` as a sample count. The old
    // number locked in a unit error at this boundary.
    expect(resolveStopReason(endedWith("sample-budget"), "user")).toMatchObject({
      kind: "sample-budget",
      budget: 4096,
    });
    expect(resolveStopReason(endedWith("non-finite"), "left-simulator")).toMatchObject({
      kind: "diverged",
    });
    expect(resolveStopReason(endedWith("analysis-complete"), "user")).toMatchObject({
      kind: "horizon-reached",
    });
    expect(resolveStopReason(endedWith("requested-stop-time"), "circuit-edited")).toMatchObject({
      kind: "horizon-reached",
    });
  });

  it("supplies Tau's more specific intent only for a halt it asked for", () => {
    expect(resolveStopReason(endedWith("halted-by-user"), "user")).toEqual({ kind: "user-stopped" });
    expect(resolveStopReason(endedWith("halted-by-user"), "left-simulator")).toEqual({
      kind: "left-simulator",
    });
    expect(resolveStopReason(endedWith("halted-by-user"), "circuit-edited")).toEqual({
      kind: "circuit-edited",
    });
  });

  /**
   * A halt with no recorded intent is still a halt somebody asked for — the
   * engine does not stop itself that way — so `user-stopped` is a statement of
   * fact, not a guess.
   */
  it("still says a user stopped it when no intent was recorded", () => {
    expect(resolveStopReason(endedWith("halted-by-user"), null)).toEqual({ kind: "user-stopped" });
  });

  /**
   * `idle-timeout` and `engine-error` are the two the model has no faithful word
   * for, and `stopReasonFromEngine` says so with a null. Passing that through is
   * the honest answer: the caller shows the engine's own sentence instead of
   * classifying a missing code model as a divergence.
   */
  it("passes through the absence of a word rather than inventing one", () => {
    expect(resolveStopReason(endedWith("idle-timeout"), "user")).toBeNull();
    expect(resolveStopReason(endedWith("engine-error"), "left-simulator")).toBeNull();
  });
});

// ── the run has to survive its own first poll ───────────────────────────────

/**
 * What the bundled libngspice actually latches for a transient run of this
 * repo's own `LIVE_RC_DECK` (`live_spice.rs`): bare node names, the time axis,
 * and a `#branch` per voltage source. Adding `.save v(out) v(in)` does not
 * change it.
 *
 * This list is the whole reason the cases below exist. The app asks for
 * `v(out)` — that is what `liveScopeChannelRequests` emits and what every other
 * plot in Tau calls the net — and `poll_live_spice` resolves names by equality
 * against the list above, so the two vocabularies never met. Nothing in the
 * suite noticed, because every fixture in it was written in the app's spelling
 * on both sides of the boundary.
 */
const LATCHED_RC_VECTORS = ["in", "out", "time", "v1#branch"];

const RC_DECK = [
  "tau live rc",
  "V1 in 0 SIN(0 1 1k)",
  "R1 in out 1k",
  "C1 out 0 100n",
  ".tran 10u 600",
  ".end",
].join("\n");

const runningTelemetry = (over: Partial<LiveTelemetry> = {}): LiveTelemetry => ({
  running: true,
  wallSeconds: 0.02,
  solvedSamples: 64,
  vectorCount: 4,
  scalars: 256,
  scalarBudget: 32_000_000,
  pointsPerSecond: 500_000,
  deliveredSamples: 64,
  decimatedSamples: 0,
  stride: 1,
  stopReason: null,
  stopDetail: null,
  engineLog: [],
  ...over,
});

interface FakeEngine {
  starts: number;
  halts: number;
  /** Every poll's requested name list, exactly as it went over the wire. */
  polls: string[][];
  energised: boolean;
}

/**
 * The engine host's two behaviours that turned a naming mismatch into a dead
 * feature, and no more than those.
 *
 * `resolve_names` refuses the WHOLE frame over a single unknown name, and the
 * host holds Tau's single live lease until the run is halted — so a session
 * dropped locally without a halt makes every later Run fail with "A live
 * simulation is already running." Both are reproduced here, because a mock that
 * answered any name and never held a lease is precisely the mock that let this
 * ship.
 */
function installFakeEngine(latched: readonly string[] = LATCHED_RC_VECTORS): FakeEngine {
  const engine: FakeEngine = { starts: 0, halts: 0, polls: [], energised: false };
  let solved = 0;
  invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "start_live_spice") {
      if (engine.energised) {
        return Promise.reject("A live simulation is already running. Stop it before starting another.");
      }
      engine.energised = true;
      engine.starts += 1;
      solved = 0;
      return Promise.resolve({
        plot: "tran1",
        vectors: [...latched],
        libraryPath: "/bundle/libngspice.dylib",
        telemetry: runningTelemetry(),
      });
    }
    if (command === "poll_live_spice") {
      if (!engine.energised) return Promise.reject("This live ngspice worker has no circuit energised.");
      const requested = (args as { request: { names: string[] } }).request.names;
      engine.polls.push([...requested]);
      const names: string[] = [];
      for (const name of requested) {
        const hit = latched.find((known) => known.toLowerCase() === name.toLowerCase());
        if (hit === undefined) return Promise.reject(`"${name}" is not a vector this live run publishes.`);
        names.push(hit);
      }
      solved += 2;
      const times = [(solved - 1) * 1e-5, solved * 1e-5];
      return Promise.resolve({
        names,
        columns: names.map((name) => (name === "time" ? times : [0.1, 0.2])),
        from: solved - 2,
        cursor: solved,
        stride: 1,
        skew: 0,
        telemetry: runningTelemetry({ solvedSamples: solved, deliveredSamples: solved }),
      });
    }
    if (command === "halt_live_spice") {
      engine.halts += 1;
      engine.energised = false;
      return Promise.resolve(
        runningTelemetry({ running: false, stopReason: "halted-by-user", stopDetail: "Stopped by the engineer." }),
      );
    }
    return Promise.reject(`no mock for ${command}`);
  });
  return engine;
}

const channel = (vector: string, label: string): LiveChannelRequest => ({ vector, label, unit: "V" });

function mountRun() {
  const notices: string[] = [];
  const view = renderHook(() => useLiveRun({ authoredTran: null, onNotice: (message) => notices.push(message) }));
  return { notices, view };
}

describe("useLiveRun — the run the engine actually publishes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    invoke.mockReset();
  });

  it("keeps running past the first poll, plotting the nets under Tau's own labels", async () => {
    // The failure this replaces: every channel was judged unpublished, the user
    // was told "2 of 2 traces are not published by this run", a ring with zero
    // channels was built, and 20 ms later the first poll was refused by name —
    // so the transport read "Ready." one frame after Run.
    const engine = installFakeEngine();
    const { notices, view } = mountRun();

    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [channel("v(out)", "V(R1.C1)"), channel("v(in)", "V(V1.R1)")],
      });
    });

    expect(notices).toEqual([]);
    expect(view.result.current.running).toBe(true);
    expect(view.result.current.sampleRevision).toBe(0);
    // The legend keeps the app's vocabulary even though the wire uses ngspice's.
    expect(view.result.current.channels).toEqual([
      { index: 0, label: "V(R1.C1)", unit: "V" },
      { index: 1, label: "V(V1.R1)", unit: "V" },
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });

    expect(engine.polls[0]).toEqual(["time", "out", "in"]);
    expect(view.result.current.message).toBeNull();
    expect(view.result.current.status.phase).toBe("running");
    expect(view.result.current.ring?.length).toBe(6);
    expect(view.result.current.sampleRevision).toBeGreaterThan(0);
    expect(engine.energised).toBe(true);

    await act(async () => {
      view.result.current.stop("user");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(engine.halts).toBe(1);
  });

  it("keeps a grounded power side as metadata without sending v(0) to the engine", async () => {
    const engine = installFakeEngine(["out", "time", "v1#branch"]);
    const { view } = mountRun();

    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [
          { vector: "v1#branch", label: "I(V1)", unit: "A", componentId: "v1", powerRole: "current" },
          { vector: "v(out)", label: "V+(V1)", unit: "V", componentId: "v1", powerRole: "positive", hidden: true },
          { vector: "", label: "V-(V1)", unit: "V", componentId: "v1", powerRole: "negative", hidden: true, powerGround: true },
        ],
      });
    });

    expect(view.result.current.channels).toEqual([
      { index: 0, label: "I(V1)", unit: "A", componentId: "v1", powerRole: "current" },
      { index: 1, label: "V+(V1)", unit: "V", componentId: "v1", powerRole: "positive", hidden: true },
      { index: -1, label: "V-(V1)", unit: "V", componentId: "v1", powerRole: "negative", hidden: true, powerGround: true },
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(engine.polls[0]).toEqual(["time", "v1#branch", "out"]);
    expect(engine.polls[0]).not.toContain("");
    expect(engine.polls[0]).not.toContain("v(0)");

    await act(async () => {
      view.result.current.stop("user");
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("drops one unpublished trace out loud and keeps the rest of the run alive", async () => {
    // Sending a name the run does not publish is fatal, not partial:
    // `resolve_names` refuses the whole frame. Narrowing the poll list to the
    // latched set is what turns a documented drop back into a drop.
    const engine = installFakeEngine();
    const { notices, view } = mountRun();

    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [channel("v(out)", "V(out)"), channel("v(n042)", "V(n042)")],
      });
    });

    expect(notices).toEqual(["1 of 2 traces are not published by this run and are not plotted."]);
    expect(view.result.current.channels).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(engine.polls).toEqual([
      ["time", "out"],
      ["time", "out"],
    ]);
    expect(view.result.current.status.phase).toBe("running");
    expect(view.result.current.ring?.length).toBe(4);

    await act(async () => {
      view.result.current.stop("user");
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("de-energises the circuit when it publishes nothing Tau asked to plot", async () => {
    // Both sides have to converge on stopped. Forgetting the session locally
    // while the host keeps its lease is what made the SECOND Run — and every
    // one after it — fail with "A live simulation is already running."
    const engine = installFakeEngine();
    const { notices, view } = mountRun();

    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [channel("v(n042)", "V(n042)")],
      });
    });

    expect(notices).toEqual(["1 of 1 traces are not published by this run and are not plotted."]);
    expect(engine.halts).toBe(1);
    expect(engine.energised).toBe(false);
    expect(view.result.current.running).toBe(false);
    expect(view.result.current.status.phase).toBe("idle");
    expect(view.result.current.message).toContain("de-energised");

    // The lease is genuinely back: pressing Run again energises a second time.
    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [channel("v(out)", "V(out)")],
      });
    });
    expect(engine.starts).toBe(2);
    expect(view.result.current.running).toBe(true);
    expect(view.result.current.message).toBeNull();

    await act(async () => {
      view.result.current.stop("user");
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("hands the engine's own arithmetic to the user when a retention budget ends the run", async () => {
    // `StopReason` can carry one number and the budget has two units. The host
    // already writes the sentence that reconciles them; until now nothing
    // rendered it, so the status line quoted a scalar count as a sample count.
    const detail =
      "The live run reached Tau's retention budget of 32000000 solved values (8000000 samples across 4 traces) after 12.4 s at 500000 points/s, so the solver was stopped. Nothing already shown was discarded; the run simply ends here.";
    installFakeEngine();
    const { view } = mountRun();
    await act(async () => {
      await view.result.current.start({
        netlist: RC_DECK,
        deck: { netlist: RC_DECK },
        channels: [channel("v(out)", "V(out)")],
      });
    });

    invoke.mockImplementation((command: string) => {
      if (command !== "poll_live_spice") return Promise.reject(`no mock for ${command}`);
      return Promise.resolve({
        names: ["time", "out"],
        columns: [[1e-5, 2e-5], [0.1, 0.2]],
        from: 0,
        cursor: 2,
        stride: 1,
        skew: 0,
        telemetry: runningTelemetry({
          running: false,
          vectorCount: 4,
          scalars: 32_000_000,
          scalarBudget: 32_000_000,
          solvedSamples: 8_000_000,
          stopReason: "sample-budget",
          stopDetail: detail,
        }),
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    const status = view.result.current.status;
    expect(status.phase).toBe("stopped");
    if (status.phase !== "stopped") return;
    // Samples, matching the "(8000000 samples across 4 traces)" the engine
    // itself computed — not the 32,000,000 solved values it was divided from.
    expect(status.reason).toMatchObject({ kind: "sample-budget", budget: 8_000_000 });
    expect(view.result.current.message).toBe(detail);
  });
});
