/**
 * The typed frontend half of Tau's persistent, free-running ngspice session.
 *
 * `nativeSpice.ts` is this module's sibling and the pattern to match: one
 * request, one answer, `invoke` reached only inside a Tauri webview. What is
 * different here is that a live run is not a request/response at all. It is a
 * subprocess that keeps solving whether or not anyone asks, and the only way to
 * see it is to keep asking. That difference is the whole reason this file
 * exists rather than another function in `nativeSpice.ts`, and it is why almost
 * everything below is about *pacing and truthfulness* rather than about
 * converting vectors.
 *
 * ## Measured facts this bridge answers to
 *
 * From the same spike `simulation/liveRun.ts` documents, and from
 * `src-tauri/src/live_spice.rs`: the engine produces ~500k points/s, falling to
 * ~300k while it is being polled; a stop takes 10-13 ms to land and that
 * latency is structural, not a tuning problem; the worst single tail poll cost
 * 5.1 ms. Two consequences are load-bearing here.
 *
 * First, **the reader is part of the writer's cost.** Polling is not free
 * observation — it takes the engine's realloc lock and costs the solver a fifth
 * of its throughput. So a poll that is still outstanding when the next tick
 * fires must be SKIPPED, never queued behind it: a stacked poll makes the
 * reader slower, which makes the writer slower, which makes the reader later
 * still, and the run spirals into a queue of frames describing a past nobody
 * asked about any more. {@link LiveSpiceSession} skips, and counts the skips.
 *
 * Second, **the frame budget throws solved points away.** The child decimates
 * (`stride`) to keep a frame small and reports exactly how many points it never
 * handed over (`decimatedSamples`). That loss is retention loss, and AGENTS.md
 * treats presenting the remainder as the whole run as a contract violation
 * rather than a rough edge. {@link engineRetention} is how that fact travels
 * with every slice, and {@link describeEngineDecimation} is the sentence the UI
 * owes the engineer when it is non-zero.
 *
 * ## Vocabulary
 *
 * `simulation/liveRun.ts` already owns the words for a live run — {@link
 * StopReason}, {@link LiveSampleRing}, {@link AchievedRateEstimator}, {@link
 * RateReport}. This module maps the engine's payloads onto those and defines no
 * second set of names for the same ideas. Where the engine knows something
 * liveRun has no word for, that is stated as an absence (a `null`
 * {@link StopReason} alongside the engine's own reason and sentence) rather
 * than papered over with the nearest-looking variant — see
 * {@link stopReasonFromEngine}.
 *
 * ## Nothing here is wired in
 *
 * No React, no store, no timers beyond the one the session owns and cleans up.
 * A later unit connects {@link startLiveSpice} to Run.
 */

import { invoke } from "@tauri-apps/api/core";
import { isNativeSpiceRuntime } from "./nativeSpice";
import {
  AchievedRateEstimator,
  POLL_INTERVAL_MS,
  rateReport,
  type RateReport,
  type StopReason,
} from "../simulation/liveRun";

// ---------------------------------------------------------------------------
// Wire types — the exact shapes `src-tauri/src/live_spice.rs` serialises
// ---------------------------------------------------------------------------

/**
 * Why the engine is no longer solving, as ngspice's own host reports it.
 *
 * These are `LiveStopReason` in `live_spice.rs`, serialised kebab-case. They are
 * repeated here rather than approximated because the distinction between them
 * is the point: a run that ended because Tau's retention budget bit must never
 * be reportable as the engineer having pressed Stop.
 */
export type LiveEngineStopReason =
  | "halted-by-user"
  | "analysis-complete"
  | "sample-budget"
  | "non-finite"
  | "requested-stop-time"
  | "idle-timeout"
  | "engine-error";

/** Every variant, so a test can assert exhaustiveness instead of hoping. */
export const LIVE_ENGINE_STOP_REASONS: readonly LiveEngineStopReason[] = [
  "halted-by-user",
  "analysis-complete",
  "sample-budget",
  "non-finite",
  "requested-stop-time",
  "idle-timeout",
  "engine-error",
];

/** `LiveTelemetry` in `live_spice.rs`. Every field is the engine's measurement,
 *  never Tau's estimate of it. */
export interface LiveTelemetry {
  running: boolean;
  /** Wall-clock seconds since the background solve was confirmed running. */
  wallSeconds: number;
  /** Solved points the engine has published on its shortest vector. */
  solvedSamples: number;
  vectorCount: number;
  /** `solvedSamples * vectorCount`, the quantity `scalarBudget` bounds. */
  scalars: number;
  scalarBudget: number;
  pointsPerSecond: number;
  /** Solved points handed over across every frame of this run. */
  deliveredSamples: number;
  /** Solved points that existed and were never handed over. Retention loss. */
  decimatedSamples: number;
  stride: number;
  stopReason: LiveEngineStopReason | null;
  /** One sentence naming what happened, written by the engine host to be shown
   *  verbatim. Tau does not paraphrase it. */
  stopDetail: string | null;
  engineLog: string[];
}

/** `LiveStartResponse` in `live_spice.rs`. */
export interface LiveStartResponse {
  plot: string;
  /** Every vector the running plot published, latched once at start. A vector
   *  that appears later is not pollable until the next Run. */
  vectors: string[];
  libraryPath: string;
  telemetry: LiveTelemetry;
}

/** `LiveSlicePayload` in `live_spice.rs`: one frame of the running plot. */
export interface LiveSlicePayload {
  names: string[];
  /** One column per name. Index `i` of every column is the same solved point —
   *  but a column the engine could not read at all comes back empty, so lengths
   *  are not guaranteed equal. {@link liveChunkFromSlice} is what makes them so. */
  columns: number[][];
  from: number;
  cursor: number;
  /** 1 means every solved point in `from..cursor` was delivered. */
  stride: number;
  /** How far apart the longest and shortest published vector lengths were at
   *  the instant of the read — the cost of reading a plot mid-append. */
  skew: number;
  telemetry: LiveTelemetry;
}

// ---------------------------------------------------------------------------
// Instance names for `alter` — safe by construction
// ---------------------------------------------------------------------------

declare const liveInstanceBrand: unique symbol;

/**
 * A designator this deck actually emitted, and the only thing {@link
 * alterLiveSpice} will accept.
 *
 * The brand is not ceremony. An `alter` against a name the deck does not use
 * fails SILENTLY inside ngspice: the command is accepted, the run carries on,
 * the value never changes, and nothing anywhere reports an error. A knob that
 * quietly does nothing is worse than one that refuses. Because the type cannot
 * be spelled outside this module, the only way to obtain one is
 * {@link resolveLiveInstance} / {@link liveAlterableInstances}, both of which
 * read the deck the run was actually started from.
 */
export type LiveInstanceName = string & { readonly [liveInstanceBrand]: true };

/**
 * Every top-level instance designator in a deck, keyed by its lower-cased form.
 *
 * Read off the netlist's own emitted element lines, exactly as
 * `buildSpiceDeck` itself reads them: `deviceCurrentVector(line)` in
 * `spiceNetlist.ts` takes the first token of an emitted line for precisely this
 * reason, with the comment "read off the lines that were actually emitted
 * rather than off the component kind". Nothing here reconstructs `R${label}` —
 * a reconstruction would miss every case the emitter's own
 * `resolveInstanceNames` handles (a prefixed label owning its name outright, a
 * remapped diac going out as `RQ1`, a collision taking a `_2` suffix, a
 * potentiometer emitting two resistors), and a near-miss is the silent failure
 * above.
 *
 * Scoping rules, each with a reason:
 * - line 1 of a SPICE deck is its title, never an element;
 * - `*` is a comment, `.` a directive, `+` a continuation of the line before;
 * - devices declared inside a `.subckt` body are excluded, because their
 *   designator is not what `alter` names at the top level.
 */
export function liveAlterableInstances(deck: { netlist: string }): ReadonlyMap<string, LiveInstanceName> {
  const instances = new Map<string, LiveInstanceName>();
  let subcktDepth = 0;
  const lines = deck.netlist.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    const lowered = line.toLowerCase();
    if (lowered.startsWith(".subckt")) {
      subcktDepth += 1;
      continue;
    }
    if (lowered.startsWith(".ends") || lowered.startsWith(".eom")) {
      subcktDepth = Math.max(0, subcktDepth - 1);
      continue;
    }
    if (line.startsWith("*") || line.startsWith(".") || line.startsWith("+")) continue;
    if (subcktDepth > 0) continue;
    const name = line.split(/\s+/)[0] ?? "";
    if (name === "") continue;
    const key = name.toLowerCase();
    if (!instances.has(key)) instances.set(key, name as LiveInstanceName);
  }
  return instances;
}

/**
 * The deck's own designator for a name the user or the UI is holding, or `null`
 * when this deck has no such instance. `null` is the whole point: a refusal the
 * caller must handle is the only alternative to a knob that silently does
 * nothing.
 */
export function resolveLiveInstance(deck: { netlist: string }, requested: string): LiveInstanceName | null {
  return liveAlterableInstances(deck).get(requested.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Named failures
// ---------------------------------------------------------------------------

/** Shown when there is no native engine at all — `pnpm dev:web`. */
export const LIVE_NOT_AVAILABLE_MESSAGE =
  "Live simulation needs Tau's bundled ngspice engine, which only the desktop app has. Browser development can still edit and plot, but not energise a circuit.";

/**
 * Every way this bridge can fail, as a closed union of named outcomes.
 *
 * Not thrown strings. A caller has to be able to tell "the bounded path is
 * holding the engine" (wait, or stop the other run) from "the worker died"
 * (the run is gone, say so and offer Run again) from "this build has no
 * engine" (never offer Run at all), and a `catch (error)` over three sentences
 * of prose cannot.
 */
export type LiveFailure =
  /** No Tauri runtime: `pnpm dev:web`. Not an error, a capability absence. */
  | { kind: "not-available"; message: string }
  /** Tau's single ngspice capability is already leased. `holder` says by which
   *  path, because the fix differs: a bounded analysis finishes on its own, a
   *  live run has to be stopped. */
  | { kind: "engine-busy"; holder: "bounded" | "live"; message: string }
  /** The deck, the breakpoint, the code models or the library refused before a
   *  solve ever began. Nothing is running. */
  | { kind: "start-failed"; message: string }
  /** There is no live run to talk to. Distinct from a run that ended for a
   *  reason — that arrives as {@link LiveEnded}, with the reason. */
  | { kind: "not-running"; message: string }
  /** The isolated worker exited, wedged, or stopped answering. The crash
   *  isolation the subprocess buys is only worth anything if this is a named,
   *  reportable outcome rather than an unhandled rejection. */
  | { kind: "worker-died"; message: string }
  /** An `alter` the engine host would not perform. */
  | { kind: "alter-refused"; message: string }
  /** ngspice refused the request itself (an unpublished vector, too many
   *  traces). Kept distinct from `start-failed` so a mid-run refusal is not
   *  reported as a failure to start. */
  | { kind: "engine-refused"; message: string };

export type LiveFailureKind = LiveFailure["kind"];

/** Every kind, so exhaustiveness is a test rather than a hope. */
export const LIVE_FAILURE_KINDS: readonly LiveFailureKind[] = [
  "not-available",
  "engine-busy",
  "start-failed",
  "not-running",
  "worker-died",
  "alter-refused",
  "engine-refused",
];

/** Result of one command. Matches the union shape rather than throwing, per the
 *  named-outcome rule above. */
export type LiveResult<T> = { ok: true; value: T } | { ok: false; failure: LiveFailure };

const notAvailable = <T>(): LiveResult<T> => ({
  ok: false,
  failure: { kind: "not-available", message: LIVE_NOT_AVAILABLE_MESSAGE },
});

/**
 * Fragments of the engine host's own sentences, quoted from `live_spice.rs`.
 *
 * Substrings and not equality on purpose: several of these arrive with worker
 * diagnostics appended (`LiveSession::diagnostics` concatenates stderr and
 * non-frame stdout onto the message), so an exact match would classify a
 * failure correctly only when the worker happened to be silent. Kept as data so
 * drift on the Rust side shows up as one failing test naming the sentence,
 * rather than as an outcome quietly degrading to the fallback.
 */
const BUSY_SENTENCES: readonly { fragment: string; holder: "bounded" | "live" }[] = [
  { fragment: "another native ngspice analysis is already running", holder: "bounded" },
  { fragment: "a live simulation is running. stop it before starting another analysis", holder: "live" },
  { fragment: "a live simulation is already running. stop it before starting another", holder: "live" },
  { fragment: "already has a circuit energised", holder: "live" },
];

const NOT_RUNNING_SENTENCES: readonly string[] = [
  "no live simulation is running",
  "has no circuit energised",
  "no longer solving, so there is nothing to alter",
];

const WORKER_DIED_SENTENCES: readonly string[] = [
  "stopped answering",
  "stopped accepting commands",
  "exited unexpectedly",
  "could not start tau's isolated live ngspice worker",
  "could not locate tau's live ngspice worker executable",
  "was unavailable",
  "returned invalid data",
  "returned an inconsistent response",
  "live ngspice task failed",
  "cannot answer after shutdown",
];

/** Which command asked, so the fallback classification can be honest about it. */
type LiveCommand = "start" | "poll" | "alter" | "halt" | "status";

/** Tauri rejects a command with the Rust `String`; a thrown `Error` is still
 *  possible from the IPC layer itself. Both become one sentence. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Map one engine sentence onto a named failure. Exported so the classification
 *  is testable without a mocked IPC round trip. */
export function classifyLiveFailure(error: unknown, command: LiveCommand): LiveFailure {
  const message = messageOf(error);
  const lowered = message.toLowerCase();
  for (const { fragment, holder } of BUSY_SENTENCES) {
    if (lowered.includes(fragment)) return { kind: "engine-busy", holder, message };
  }
  if (NOT_RUNNING_SENTENCES.some((fragment) => lowered.includes(fragment))) {
    return { kind: "not-running", message };
  }
  if (WORKER_DIED_SENTENCES.some((fragment) => lowered.includes(fragment))) {
    return { kind: "worker-died", message };
  }
  if (command === "start") return { kind: "start-failed", message };
  if (command === "alter") return { kind: "alter-refused", message };
  return { kind: "engine-refused", message };
}

/** The sentence to show. The engine's own words wherever it had any, because
 *  they name the circuit-specific cause and Tau's would not. */
export function describeLiveFailure(failure: LiveFailure): string {
  switch (failure.kind) {
    case "not-available":
      return failure.message;
    case "engine-busy":
      return failure.holder === "bounded"
        ? `${failure.message} Wait for it to finish, or stop it, then run live.`
        : failure.message;
    case "start-failed":
      return `Could not energise the circuit: ${failure.message}`;
    case "not-running":
      return failure.message;
    case "worker-died":
      return `The live simulation engine stopped: ${failure.message}`;
    case "alter-refused":
      return `Tau did not change the circuit: ${failure.message}`;
    case "engine-refused":
      return failure.message;
  }
}

// ---------------------------------------------------------------------------
// Retention honesty
// ---------------------------------------------------------------------------

/**
 * What the engine threw away on the way to the UI.
 *
 * This is a DIFFERENT loss from {@link LiveSampleRing}'s: the ring discards old
 * samples when it wraps, and reports that through `LiveSampleView.isWholeRun` /
 * `discardedSamples`. This one happens upstream of the ring, when a frame's
 * sample budget forces the child to deliver every `stride`-th solved point. The
 * field names deliberately echo the ring's so the two read as the same kind of
 * statement, and both have to be true before a plot may claim to be the run.
 */
export interface LiveRetention {
  /** Solved points handed over across the whole run. */
  deliveredSamples: number;
  /** Solved points that existed and were never handed over. */
  decimatedSamples: number;
  /** 1 means nothing was skipped. */
  stride: number;
  /** Sample-count disagreement between the longest and shortest vector at the
   *  instant of the last read, already trimmed away by the child. */
  skew: number;
  /** True only while every solved point the engine produced has been delivered. */
  isWholeRun: boolean;
}

export function engineRetention(telemetry: LiveTelemetry, skew = 0): LiveRetention {
  return {
    deliveredSamples: telemetry.deliveredSamples,
    decimatedSamples: telemetry.decimatedSamples,
    stride: telemetry.stride,
    skew,
    isWholeRun: telemetry.decimatedSamples === 0,
  };
}

/**
 * The sentence the UI must show once the engine has skipped a point, and `null`
 * while it has not — so the caller renders nothing rather than a reassuring
 * "complete" badge that would eventually become a lie. Same contract as
 * `describeDiscardedHistory` in `simulation/liveRun.ts`, for the upstream loss.
 */
export function describeEngineDecimation(retention: LiveRetention): string | null {
  if (retention.isWholeRun || retention.decimatedSamples === 0) return null;
  const skipped = retention.decimatedSamples.toLocaleString("en-US");
  return `Showing 1 in ${retention.stride} solved points — ${skipped} samples the engine solved were never sent to the plot.`;
}

// ---------------------------------------------------------------------------
// How a live run ends
// ---------------------------------------------------------------------------

/**
 * The engine's stop, in `simulation/liveRun.ts`'s vocabulary — or an explicit
 * `null` where that vocabulary has no faithful word.
 *
 * `idle-timeout` and `engine-error` are the two absences. Neither is a
 * divergence and neither is the user leaving the simulator, and reaching for
 * the nearest-looking {@link StopReason} would state something the engine never
 * said: "solution diverged" for a missing code model is a diagnosis Tau
 * invented. {@link LiveEnded} therefore always carries `engineReason` and the
 * engine's own sentence alongside this, and a `null` here means "show the
 * sentence, do not classify".
 */
export function stopReasonFromEngine(
  telemetry: LiveTelemetry,
  solvedCircuitTime: number,
): StopReason | null {
  switch (telemetry.stopReason) {
    case "halted-by-user":
      return { kind: "user-stopped" };
    // Both of these are a run that reached the end it was given: the deck's own
    // `.tran` stop time, or the caller's `stopAtSeconds`, which the child lands
    // on exactly via `ngSpice_SetBkpt`. Completion, not interruption.
    case "analysis-complete":
    case "requested-stop-time":
      return { kind: "horizon-reached", atCircuitTime: solvedCircuitTime };
    case "sample-budget":
      return {
        kind: "sample-budget",
        atCircuitTime: solvedCircuitTime,
        budget: telemetry.scalarBudget,
      };
    case "non-finite":
      return {
        kind: "diverged",
        atCircuitTime: solvedCircuitTime,
        detail: telemetry.stopDetail ?? "the solver produced a non-finite sample",
      };
    case "idle-timeout":
    case "engine-error":
    case null:
      return null;
  }
}

/** A live run that is over, with the reason it is over. */
export interface LiveEnded {
  /** The engine's own name for it. Always present once a run has stopped. */
  engineReason: LiveEngineStopReason;
  /** liveRun's word for the same thing, or `null` when it has none. */
  reason: StopReason | null;
  /** The engine host's sentence, to be shown verbatim. */
  detail: string;
  telemetry: LiveTelemetry;
  retention: LiveRetention;
  /** Newest circuit time delivered before the run stopped. */
  solvedCircuitTime: number;
}

/** True only for a run the engineer stopped. A budget or divergence stop
 *  answers `false`, which is the distinction requirement 3 exists for. */
export function isUserStop(ended: LiveEnded): boolean {
  return ended.engineReason === "halted-by-user";
}

/** True when Tau's retention budget ended the run rather than the circuit. */
export function isBudgetExhausted(ended: LiveEnded): boolean {
  return ended.engineReason === "sample-budget";
}

/** True when the solver stopped producing numbers. */
export function isDivergence(ended: LiveEnded): boolean {
  return ended.engineReason === "non-finite";
}

/** True when the run reached the end it was asked for. */
export function isLiveCompletion(ended: LiveEnded): boolean {
  return ended.engineReason === "analysis-complete" || ended.engineReason === "requested-stop-time";
}

/** How a live run finished: an end with a reason, or a failure with a name. */
export type LiveRunOutcome =
  | { kind: "ended"; ended: LiveEnded }
  | { kind: "failed"; failure: LiveFailure };

// ---------------------------------------------------------------------------
// One typed wrapper per Tauri command
// ---------------------------------------------------------------------------

/** `LiveStartRequest` in `live_spice.rs`. */
export interface LiveStartOptions {
  /** A complete SPICE deck with a transient card and `.end`, as
   *  `simulate_spice` takes — i.e. `buildSpiceDeck(...).netlist`. */
  netlist: string;
  /** Circuit time to stop on exactly, via `ngSpice_SetBkpt`. Omitted means the
   *  deck's own `.tran` end time is the only horizon. */
  stopAtSeconds?: number | null;
  /** Lower retention ceiling than the engine's own, in scalars. A caller may
   *  ask for less, never for more; the child clamps. */
  scalarBudget?: number;
}

export async function startLiveSpice(options: LiveStartOptions): Promise<LiveResult<LiveStartResponse>> {
  if (!isNativeSpiceRuntime()) return notAvailable();
  try {
    const value = await invoke<LiveStartResponse>("start_live_spice", {
      request: {
        netlist: options.netlist,
        ...(options.stopAtSeconds === undefined ? {} : { stopAtSeconds: options.stopAtSeconds }),
        ...(options.scalarBudget === undefined ? {} : { scalarBudget: options.scalarBudget }),
      },
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: classifyLiveFailure(error, "start") };
  }
}

export interface LivePollOptions {
  /** Vectors to deliver. Empty or omitted means every latched vector, capped by
   *  the child at 64. */
  names?: readonly string[];
  /** Samples per vector this frame. The child defaults to 2048 and clamps. */
  maxSamples?: number;
}

export async function pollLiveSpice(options: LivePollOptions = {}): Promise<LiveResult<LiveSlicePayload>> {
  if (!isNativeSpiceRuntime()) return notAvailable();
  try {
    const value = await invoke<LiveSlicePayload>("poll_live_spice", {
      request: {
        names: options.names ? [...options.names] : [],
        ...(options.maxSamples === undefined ? {} : { maxSamples: options.maxSamples }),
      },
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: classifyLiveFailure(error, "poll") };
  }
}

/** `LiveAlterRequest` in `live_spice.rs`, with the instance narrowed to one the
 *  deck emitted. See {@link LiveInstanceName} for why that is a type and not a
 *  comment. */
export interface LiveAlterOptions {
  instance: LiveInstanceName;
  /** Omitted alters the instance's default value (`alter r2 = 3k`). */
  parameter?: string;
  /** SPICE notation (`3k`, `1.5`, `100n`, `-2.5e-3`). The engine host validates
   *  this against a grammar narrow enough that no command separator survives —
   *  `ngSpice_Command` is the whole interpreter, so a value is untrusted input. */
  value: string;
}

export async function alterLiveSpice(options: LiveAlterOptions): Promise<LiveResult<LiveTelemetry>> {
  if (!isNativeSpiceRuntime()) return notAvailable();
  try {
    const value = await invoke<LiveTelemetry>("alter_live_spice", {
      request: {
        instance: options.instance,
        ...(options.parameter === undefined ? {} : { parameter: options.parameter }),
        value: options.value,
      },
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: classifyLiveFailure(error, "alter") };
  }
}

/** Stop the solver. Answers with the run's FINAL telemetry, which is where the
 *  real stop reason lives — a run that had already hit its budget answers
 *  `sample-budget`, not `halted-by-user`. */
export async function haltLiveSpice(): Promise<LiveResult<LiveTelemetry>> {
  if (!isNativeSpiceRuntime()) return notAvailable();
  try {
    const value = await invoke<LiveTelemetry>("halt_live_spice");
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: classifyLiveFailure(error, "halt") };
  }
}

/** Telemetry without taking a frame. `null` means no live run has ever started
 *  in this session — distinct from a stopped one, which still answers. */
export async function liveSpiceStatus(): Promise<LiveResult<LiveTelemetry | null>> {
  if (!isNativeSpiceRuntime()) return notAvailable();
  try {
    const value = await invoke<LiveTelemetry | null>("live_spice_status");
    return { ok: true, value: value ?? null };
  } catch (error) {
    return { ok: false, failure: classifyLiveFailure(error, "status") };
  }
}

// ---------------------------------------------------------------------------
// Slice → ring buffer
// ---------------------------------------------------------------------------

/** ngspice's name for a transient plot's own time axis. */
export const LIVE_TIME_VECTOR = "time";

/**
 * One frame, reshaped into what {@link LiveSampleRing.pushChunk} takes.
 *
 * Two things are load-bearing. The time axis is pulled out by name rather than
 * by position, because the child returns the caller's requested order and a
 * caller is free to ask for the axis last. And every column is trimmed to the
 * shortest, because a column the engine could not read comes back EMPTY while
 * its siblings are full: `pushChunk` throws on a length mismatch, and a throw
 * inside a poll tick would kill the run over a vector nobody was plotting.
 * `trimmedSamples` says how many points that cost, so the trim is reported
 * rather than absorbed.
 */
export interface LiveChunk {
  times: number[];
  channels: number[][];
  channelNames: string[];
  /** Samples dropped to square the columns off. Normally 0. */
  trimmedSamples: number;
}

export function liveChunkFromSlice(slice: LiveSlicePayload): LiveChunk | null {
  const timeIndex = slice.names.findIndex((name) => name.trim().toLowerCase() === LIVE_TIME_VECTOR);
  if (timeIndex < 0) return null;
  const times = slice.columns[timeIndex] ?? [];
  const channelNames: string[] = [];
  const rawChannels: number[][] = [];
  slice.names.forEach((name, index) => {
    if (index === timeIndex) return;
    channelNames.push(name);
    rawChannels.push(slice.columns[index] ?? []);
  });
  const shortest = [times, ...rawChannels].reduce((min, column) => Math.min(min, column.length), times.length);
  const longest = [times, ...rawChannels].reduce((max, column) => Math.max(max, column.length), 0);
  return {
    times: times.length === shortest ? times : times.slice(0, shortest),
    channels: rawChannels.map((column) => (column.length === shortest ? column : column.slice(0, shortest))),
    channelNames,
    trimmedSamples: longest - shortest,
  };
}

/** Newest circuit time in a frame, or `null` for an empty one. */
export function latestSliceTime(slice: LiveSlicePayload): number | null {
  const chunk = liveChunkFromSlice(slice);
  if (!chunk || chunk.times.length === 0) return null;
  return chunk.times[chunk.times.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/** What a caller is told, per frame. The retention facts travel WITH the
 *  samples so a consumer cannot obtain one without the other. */
export interface LiveFrame {
  slice: LiveSlicePayload;
  chunk: LiveChunk | null;
  retention: LiveRetention;
  /** Measured, or `{ source: "unknown" }` until enough has been seen. Never the
   *  target dressed up as a measurement — see `rateReport` in liveRun.ts. */
  rate: RateReport;
  solvedCircuitTime: number | null;
}

export interface LiveSessionOptions extends LiveStartOptions {
  /** Vectors to poll. Omitted means every latched vector, capped by the child. */
  names?: readonly string[];
  maxSamples?: number;
  /** Poll cadence. Defaults to `POLL_INTERVAL_MS` (20 ms) from liveRun.ts,
   *  which is the cadence every measured fact in that module assumes. */
  pollIntervalMs?: number;
  /** Circuit-seconds per wall-second the user asked for, for the rate report.
   *  `null` is free-run. Purely descriptive here: this bridge never paces. */
  targetRate?: number | null;
  onFrame?: (frame: LiveFrame) => void;
  /** Called exactly once, whatever ends the run. */
  onEnd?: (outcome: LiveRunOutcome) => void;
}

export type LiveStartOutcome =
  | { kind: "started"; session: LiveSpiceSession; start: LiveStartResponse }
  | { kind: "failed"; failure: LiveFailure };

/**
 * Owns the poll loop's whole lifecycle: cadence, back-pressure, delivery,
 * termination and timer cleanup.
 *
 * Constructed only by {@link startLiveSpice} — a session exists if and only if
 * the engine confirmed a background solve, so there is no half-started state to
 * represent.
 */
export class LiveSpiceSession {
  readonly plot: string;
  readonly vectors: readonly string[];
  readonly libraryPath: string;

  private readonly options: LiveSessionOptions;
  private readonly estimator = new AchievedRateEstimator();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private finished = false;
  private skipped = 0;
  private lastTelemetry: LiveTelemetry;
  private lastTime = 0;
  /** Retention loss is MONOTONIC: once the engine has skipped a solved point,
   *  no later frame may take that back. Latched here so a final telemetry that
   *  happens to report zero — a retired session answering from a cached
   *  snapshot, say — cannot restore a "this is the whole run" claim the run
   *  already lost. */
  private lostSamples = 0;

  /** @internal — use {@link startLiveSpice}. */
  constructor(start: LiveStartResponse, options: LiveSessionOptions) {
    this.plot = start.plot;
    this.vectors = start.vectors;
    this.libraryPath = start.libraryPath;
    this.options = options;
    this.lastTelemetry = start.telemetry;
    const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  /** Ticks dropped because a poll was still outstanding. Exposed because a
   *  session that is skipping most of its ticks is a real signal about the
   *  machine, and hiding it would make the back-pressure rule unobservable. */
  get skippedTicks(): number {
    return this.skipped;
  }

  /** True from the moment a run ends, by any route. */
  get isFinished(): boolean {
    return this.finished;
  }

  get telemetry(): LiveTelemetry {
    return this.lastTelemetry;
  }

  /**
   * One poll, at most one in flight.
   *
   * The skip is the back-pressure rule, and it is a skip rather than a queue
   * because polling costs the solver throughput (~500k points/s falling to
   * ~300k while polled). A queued poll would arrive late, describing a window
   * the plot has already scrolled past, while having slowed the very run it was
   * trying to observe.
   */
  private async tick(): Promise<void> {
    if (this.finished) return;
    if (this.polling) {
      this.skipped += 1;
      return;
    }
    this.polling = true;
    try {
      const result = await pollLiveSpice({ names: this.options.names, maxSamples: this.options.maxSamples });
      if (this.finished) return;
      if (!result.ok) {
        this.finish({ kind: "failed", failure: result.failure });
        return;
      }
      this.deliver(result.value);
    } finally {
      this.polling = false;
    }
  }

  private deliver(slice: LiveSlicePayload): void {
    const telemetry = slice.telemetry;
    this.lastTelemetry = telemetry;
    const chunk = liveChunkFromSlice(slice);
    const newest = chunk && chunk.times.length > 0 ? chunk.times[chunk.times.length - 1]! : null;
    if (newest !== null) {
      this.lastTime = newest;
      // The engine's own wall clock, not the renderer's: it is the clock the
      // solved points were actually produced against, and it cannot be skewed
      // by a stalled animation frame.
      this.estimator.observe(telemetry.wallSeconds * 1000, newest);
    }
    const retention = this.retentionOf(telemetry, slice.skew);
    this.options.onFrame?.({
      slice,
      chunk,
      retention,
      rate: rateReport(this.options.targetRate ?? null, this.estimator.rate()),
      solvedCircuitTime: newest,
    });
    if (telemetry.stopReason !== null || !telemetry.running) {
      this.finish({ kind: "ended", ended: this.endedFrom(telemetry, retention) });
    }
  }

  private retentionOf(telemetry: LiveTelemetry, skew = 0): LiveRetention {
    this.lostSamples = Math.max(this.lostSamples, telemetry.decimatedSamples);
    const retention = engineRetention(telemetry, skew);
    if (this.lostSamples === retention.decimatedSamples) return retention;
    return { ...retention, decimatedSamples: this.lostSamples, isWholeRun: false };
  }

  private endedFrom(telemetry: LiveTelemetry, retention: LiveRetention): LiveEnded {
    // A stopped run with no named reason should be impossible — the child names
    // every stop — so treat the gap as the engine failing rather than inventing
    // a friendlier one.
    const engineReason = telemetry.stopReason ?? "engine-error";
    return {
      engineReason,
      reason: stopReasonFromEngine(telemetry, this.lastTime),
      detail: telemetry.stopDetail ?? "The live run stopped without saying why.",
      telemetry,
      retention,
      solvedCircuitTime: this.lastTime,
    };
  }

  /**
   * Stop the run.
   *
   * The reason is taken from the telemetry the halt answers with, never assumed
   * to be `halted-by-user`: pressing Stop on a run that already hit its
   * retention budget must report the budget. The engine host keeps a retired
   * session's final telemetry precisely so that answer survives the child being
   * killed.
   */
  async stop(): Promise<LiveRunOutcome> {
    if (this.finished) {
      return { kind: "ended", ended: this.endedFrom(this.lastTelemetry, this.retentionOf(this.lastTelemetry)) };
    }
    // Cleared BEFORE the await: a halt takes 10-13 ms to land and the cadence
    // is 20 ms, so a live timer here would fire one more poll at a session the
    // user has already stopped.
    this.clearTimer();
    const result = await haltLiveSpice();
    const outcome: LiveRunOutcome = result.ok
      ? { kind: "ended", ended: this.endedFrom(result.value, this.retentionOf(result.value)) }
      : { kind: "failed", failure: result.failure };
    this.finish(outcome);
    return outcome;
  }

  /** Turn one knob on the running circuit. The instance must have come from the
   *  deck this run was started with — see {@link resolveLiveInstance}. */
  async alter(options: LiveAlterOptions): Promise<LiveResult<LiveTelemetry>> {
    const result = await alterLiveSpice(options);
    if (result.ok) this.lastTelemetry = result.value;
    return result;
  }

  /** Idempotent: whatever ends the run, `onEnd` fires exactly once and the
   *  timer is gone before it does. */
  private finish(outcome: LiveRunOutcome): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimer();
    if (outcome.kind === "ended") this.lastTelemetry = outcome.ended.telemetry;
    this.options.onEnd?.(outcome);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Energise a circuit and start reading it.
 *
 * Returns a named failure rather than throwing, including outside Tauri, so
 * `pnpm dev:web` degrades to "not available here" instead of an unhandled
 * rejection in a click handler.
 */
export async function startLiveSession(options: LiveSessionOptions): Promise<LiveStartOutcome> {
  const started = await startLiveSpice(options);
  if (!started.ok) return { kind: "failed", failure: started.failure };
  return { kind: "started", session: new LiveSpiceSession(started.value, options), start: started.value };
}
