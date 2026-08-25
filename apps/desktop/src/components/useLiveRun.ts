import { useCallback, useEffect, useRef, useState } from "react";

import {
  LIVE_TIME_VECTOR,
  describeLiveFailure,
  resolveLiveVectorNames,
  startLiveSession,
  type LiveEnded,
  type LiveFrame,
  type LiveRetention,
  type LiveRunOutcome,
  type LiveSpiceSession,
} from "../engine/nativeLive";
import {
  LiveActuationQueue,
  describeLiveActuationOutcome,
  type ActuableComponent,
  type LiveActuationTarget,
} from "../simulation/liveActuation";
import {
  LiveSampleRing,
  circuitEdited,
  defaultRunPlan,
  followingWindow,
  leftSimulator,
  liveRunPlan,
  runPlanHorizon,
  userStopped,
  type AuthoredTran,
  type LiveRunPlan,
  type LiveRunStatus,
  type RunPlan,
  type StopReason,
  type TimeWindow,
  type WindowRunPlan,
} from "../simulation/liveRun";
import { DEFAULT_LIVE_SPAN_SECONDS, type LiveScopeChannel } from "./LiveScopePane";

/**
 * The one place that owns a running circuit: the plan the transport is showing,
 * the engine session behind it, the ring the scope draws from, and the reason
 * the run ended.
 *
 * ## Why this is a hook and not code in App.tsx
 *
 * Everything it coordinates already exists and is tested — `simulation/liveRun.ts`
 * owns the model, `engine/nativeLive.ts` owns the bridge and its poll cadence,
 * `simulation/liveActuation.ts` owns operating a running circuit. What was
 * missing was a single owner for the *lifecycle*: exactly one session at a time,
 * a ring whose channel count matches the vectors the engine actually latched, a
 * status that is throttled to a rate a human can read, and one place where "the
 * run ended" is turned into a reason. Spread across App.tsx those five facts
 * would live in five refs, and the failure mode is a poll loop that outlives the
 * view it was drawing into.
 *
 * ## Two rules this hook exists to keep
 *
 * **Nothing is fast-forwarded and nothing is invented.** The ring, the rate
 * report and the retention numbers come straight from the frame; this file adds
 * no smoothing, no interpolation and no fallback to a requested value.
 *
 * **A stop keeps the engine's reason unless the engine could not have known it.**
 * `LiveSpiceSession.stop()` answers from the halt's own telemetry, so a run that
 * had already hit its sample budget reports the budget even though a Stop
 * arrived afterwards. The one thing the engine genuinely cannot know is *why*
 * Tau asked it to halt — leaving the simulator and pressing Stop are the same
 * `bg_halt` down there — so that, and only that, is supplied from this side.
 * See {@link resolveStopReason}.
 */

/** How often the run's own status may re-render the app.
 *
 *  The engine is polled every 20 ms and the scope redraws from the ring on its
 *  own animation frame, so App does not have to re-render to keep the trace
 *  moving. What re-renders here is the *sentence* next to the transport, and
 *  fifty updates a second of a number nobody can read that fast would re-render
 *  the whole workspace fifty times a second for nothing. Ten is already faster
 *  than the eye resolves changing digits. */
export const LIVE_STATUS_INTERVAL_MS = 100;

/** Why Tau asked the engine to stop. The engine records only that it was asked. */
export type LiveStopIntent = "user" | "left-simulator" | "circuit-edited";

const INTENT_REASON: Record<LiveStopIntent, () => StopReason> = {
  user: userStopped,
  "left-simulator": leftSimulator,
  "circuit-edited": circuitEdited,
};

/**
 * The reason to show for a finished run.
 *
 * The engine's own reason wins whenever the run ended of its own accord — a
 * sample budget, a divergence, reaching the horizon. Requirement 8 of this unit
 * is that a budget stop is never reportable as a user Stop, and this is where
 * that is enforced: only `halted-by-user`, which means "you asked and nothing
 * else had happened", is allowed to take Tau's more specific intent.
 *
 * A `null` reason is a real answer, not a gap: `stopReasonFromEngine` returns it
 * for `idle-timeout` and `engine-error`, which `StopReason` has no faithful word
 * for. The caller shows {@link LiveEnded.detail} — the engine's own sentence —
 * rather than reaching for the nearest-looking variant.
 */
export function resolveStopReason(ended: LiveEnded, intent: LiveStopIntent | null): StopReason | null {
  if (ended.engineReason !== "halted-by-user") return ended.reason;
  return (intent ? INTENT_REASON[intent]() : userStopped());
}

/** One plotted signal, as the caller knows it before a run exists. */
export interface LiveChannelRequest {
  /** ngspice vector name, e.g. `v(n001)`. Must be one the deck publishes. */
  vector: string;
  label: string;
  unit?: string;
  componentId?: string;
  powerRole?: "positive" | "negative" | "current";
  hidden?: boolean;
}

export interface LiveStartRequest {
  /** A complete deck with a transient card, i.e. `buildSpiceDeck(...).netlist`. */
  netlist: string;
  /** The deck the run is started from — the only authority on instance names
   *  for {@link LiveRunController.actuate}. */
  deck: { netlist: string };
  channels: readonly LiveChannelRequest[];
}

export interface LiveRunController {
  /** The plan the transport is showing. */
  plan: RunPlan;
  /** The plan selecting LIVE produces, so a round trip keeps the user's choice. */
  livePlan: LiveRunPlan;
  /** The plan selecting WINDOW produces, or `undefined` for the transport's own
   *  default when nothing has been authored and nothing chosen yet. */
  windowPlan: WindowRunPlan | undefined;
  setPlan: (plan: RunPlan) => void;
  status: LiveRunStatus;
  /** True while a live session exists, i.e. Run must read Stop. */
  running: boolean;
  /** Non-null once a run has started; the scope draws from it. */
  ring: LiveSampleRing | null;
  channels: readonly LiveScopeChannel[];
  retention: LiveRetention | null;
  timeWindow: TimeWindow;
  setTimeWindow: (next: TimeWindow) => void;
  /**
   * Bumped once per run, never per frame.
   *
   * The scope's viewport is keyed on this. Keyed on anything that changes while
   * the run is going — the sample count, the newest time — the pane would remount
   * thirty times a second and throw away the zoom the user had just set.
   */
  runKey: number;
  /** The engine's own sentence when a run ended for something `StopReason` has
   *  no word for, or a named bridge failure. `null` when the model's own stop
   *  reason already says it. */
  message: string | null;
  /** Drop the sentence above. Pressing Run is the moment the last run's
   *  explanation stops being about anything the user is looking at. */
  clearMessage: () => void;
  start: (request: LiveStartRequest) => Promise<void>;
  stop: (intent: LiveStopIntent) => void;
  /** Operate one control on the running circuit. `null` when nothing is running. */
  actuate: (component: ActuableComponent, nextValue: string) => LiveActuationTarget | null;
}

export interface UseLiveRunOptions {
  /** The document's authored `.tran`, or `null`. Pre-selects WINDOW at that
   *  duration; `null` leaves LIVE selected, which is the default. */
  authoredTran: AuthoredTran | null;
  /** The directive's own text, so the transport can quote the file. */
  authoredDirective?: string | null;
  /** Sentences worth showing the engineer — an actuation that only half landed,
   *  a refusal. Never used for anything the model's own copy already says. */
  onNotice: (message: string) => void;
}

/** A stable spelling of the authored `.tran`, so re-deriving the plan happens
 *  when the document's request changes and not on every render. */
function authoredKey(tran: AuthoredTran | null, directive: string | null): string {
  if (!tran) return "";
  return `${tran.startTime ?? 0}|${tran.stopTime}|${tran.steps ?? ""}|${directive ?? ""}`;
}

export function useLiveRun({
  authoredTran,
  authoredDirective = null,
  onNotice,
}: UseLiveRunOptions): LiveRunController {
  const [plan, setPlanState] = useState<RunPlan>(() =>
    defaultRunPlan(authoredTran, { directive: authoredDirective }));
  const [livePlan, setLivePlan] = useState<LiveRunPlan>(() =>
    (plan.mode === "live" ? plan : liveRunPlan()));
  const [windowPlan, setWindowPlan] = useState<WindowRunPlan | undefined>(() =>
    (plan.mode === "window" ? plan : undefined));
  const [status, setStatus] = useState<LiveRunStatus>({ phase: "idle" });
  const [ring, setRing] = useState<LiveSampleRing | null>(null);
  const [channels, setChannels] = useState<readonly LiveScopeChannel[]>([]);
  const [retention, setRetention] = useState<LiveRetention | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(() =>
    followingWindow(DEFAULT_LIVE_SPAN_SECONDS));
  const [runKey, setRunKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const sessionRef = useRef<LiveSpiceSession | null>(null);
  const queueRef = useRef<LiveActuationQueue | null>(null);
  const ringRef = useRef<LiveSampleRing | null>(null);
  const intentRef = useRef<LiveStopIntent | null>(null);
  const lastStatusAtRef = useRef(0);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  /**
   * A newly opened document re-states what it wants, and the transport shows it.
   *
   * Guarded on the authored text rather than run unconditionally: without the
   * guard every keystroke in the window field would be overwritten by the
   * document's own duration on the next render, which is the opposite of "an
   * ordinary editable value".
   */
  const authoredSignature = authoredKey(authoredTran, authoredDirective);
  const authoredSignatureRef = useRef(authoredSignature);
  useEffect(() => {
    if (authoredSignatureRef.current === authoredSignature) return;
    authoredSignatureRef.current = authoredSignature;
    const next = defaultRunPlan(authoredTran, { directive: authoredDirective });
    setPlanState(next);
    if (next.mode === "window") setWindowPlan(next);
    else setLivePlan(next);
  }, [authoredSignature, authoredTran, authoredDirective]);

  const setPlan = useCallback((next: RunPlan) => {
    setPlanState(next);
    if (next.mode === "live") setLivePlan(next);
    else setWindowPlan(next);
  }, []);

  const finishSession = useCallback((outcome: LiveRunOutcome) => {
    sessionRef.current = null;
    queueRef.current?.cancelPending();
    queueRef.current = null;
    setRunning(false);
    if (outcome.kind === "failed") {
      // A named bridge failure is not a StopReason and must not be dressed as
      // one. The run is over, the phase goes back to idle, and the engine's own
      // sentence is what the user reads.
      setStatus({ phase: "idle" });
      setMessage(describeLiveFailure(outcome.failure));
      return;
    }
    const reason = resolveStopReason(outcome.ended, intentRef.current);
    intentRef.current = null;
    setRetention(outcome.ended.retention);
    if (reason === null) {
      setStatus({ phase: "idle" });
      setMessage(outcome.ended.detail);
      return;
    }
    setStatus({ phase: "stopped", solvedCircuitTime: outcome.ended.solvedCircuitTime, reason });
    // A stop reason can carry one number, and for a retention budget one number
    // is not the whole truth: the engine enforces a ceiling in solved VALUES and
    // the status line can only say samples. The engine host already writes the
    // sentence that names both ("… 32000000 solved values (1280000 samples
    // across 25 traces) …"), and until now nothing rendered it. Every other
    // reason either says all it knows or would merely repeat the status line, so
    // this is the one that is passed through.
    setMessage(reason.kind === "sample-budget" ? outcome.ended.detail : null);
  }, []);

  const start = useCallback(async (request: LiveStartRequest) => {
    if (sessionRef.current) return;
    setMessage(null);
    intentRef.current = null;
    // So the first frame of this run publishes immediately instead of being
    // swallowed by the previous run's throttle window.
    lastStatusAtRef.current = 0;

    const horizon = runPlanHorizon(plan);
    const requested = request.channels;
    const names = [LIVE_TIME_VECTOR, ...requested.map((channel) => channel.vector)];
    // Optimistic: the engine has not answered yet, so Run must already read
    // Stop or a slow start looks like a dead button.
    setRunning(true);
    setStatus({ phase: "running", solvedCircuitTime: 0, rate: { source: "unknown", targetRate: plan.targetRate } });

    const outcome = await startLiveSession({
      netlist: request.netlist,
      stopAtSeconds: horizon,
      // The engine's ceiling is in scalars (samples × vectors) while the plan's
      // is in samples. A caller may only ask for LESS than the engine's own
      // budget; the child clamps anything larger, so this can never raise it.
      scalarBudget: plan.sampleBudget * Math.max(1, names.length),
      names,
      targetRate: plan.targetRate,
      onFrame: (frame) => deliver(frame),
      onEnd: (result) => finishSession(result),
    });

    if (outcome.kind === "failed") {
      setRunning(false);
      setStatus({ phase: "idle" });
      setMessage(describeLiveFailure(outcome.failure));
      return;
    }

    // Only the vectors the plot actually latched can be polled — one that
    // appears later is not pollable until the next Run — so the ring is sized
    // from what came back, not from what was asked for. A channel the deck did
    // not publish is dropped and said so, never plotted as a flat line.
    //
    // The comparison cannot be a set membership on the requested spelling: this
    // app asks for `v(n001)` because that is what every other plot in Tau calls
    // the net, while a live transient plot latches ngspice's own vector list,
    // which is bare node names plus `time` plus a `name#branch` per source.
    // Compared verbatim, NOTHING ever matched — the user was told all six
    // traces were unpublished, a ring with no channels was built, and the first
    // poll was then refused by name and killed the run one frame after Run.
    // `resolveLiveVectorNames` is what reconciles them, and it is called twice
    // on purpose: the session calls it in its constructor because the poll
    // timer is already ticking and the wire cannot wait for this await to
    // settle, and it is called again here for the plot. That is one pure
    // function over the same two inputs — the names just sent and the vectors
    // this same response latched — so the wire's answer and the plot's cannot
    // drift apart the way two hand-written filters would.
    const unpublished = new Set(
      resolveLiveVectorNames(names, outcome.start.vectors).unpublished.map((name) =>
        name.trim().toLowerCase()),
    );
    const kept = requested.filter((channel) => !unpublished.has(channel.vector.trim().toLowerCase()));
    const dropped = requested.length - kept.length;
    if (dropped > 0) {
      noticeRef.current(
        `${dropped} of ${requested.length} traces are not published by this run and are not plotted.`,
      );
    }

    // Nothing the user asked to see exists in this run, so there is no plot to
    // draw. Leaving the solver energised would burn a core on a blank pane and
    // — because the engine host holds its single live lease until the run is
    // halted — would refuse every subsequent Run with "A live simulation is
    // already running." Stopping here is what keeps this side and the engine's
    // side agreeing about whether a run exists.
    if (kept.length === 0) {
      await outcome.session.stop();
      setRunning(false);
      setStatus({ phase: "idle" });
      setMessage(
        "This run does not publish any of the traces Tau asked to plot, so the circuit was de-energised again.",
      );
      return;
    }

    const nextRing = new LiveSampleRing({ channelCount: kept.length });
    ringRef.current = nextRing;
    setRing(nextRing);
    setChannels(kept.map((channel, index) => ({
      index,
      label: channel.label,
      ...(channel.unit === undefined ? {} : { unit: channel.unit }),
      ...(channel.componentId === undefined ? {} : { componentId: channel.componentId }),
      ...(channel.powerRole === undefined ? {} : { powerRole: channel.powerRole }),
      ...(channel.hidden === undefined ? {} : { hidden: channel.hidden }),
    })));
    setRetention(null);
    setTimeWindow(followingWindow(DEFAULT_LIVE_SPAN_SECONDS));
    setRunKey((key) => key + 1);

    sessionRef.current = outcome.session;
    queueRef.current = new LiveActuationQueue({
      deck: request.deck,
      send: (options) => outcome.session.alter(options),
      onOutcome: (actuation) => {
        const sentence = describeLiveActuationOutcome(actuation);
        if (sentence) noticeRef.current(sentence);
        else if (actuation.kind === "failed") noticeRef.current(describeLiveFailure(actuation.failure));
      },
    });

    /**
     * One frame: the samples into the ring, the truth about them into state.
     *
     * Declared after the session so it can close over the ring this run owns;
     * hoisted as a function declaration so `startLiveSession` above can name it
     * before the session exists. A frame that arrives before the ring does —
     * the child can answer the very first poll inside `startLiveSession`'s own
     * await — is dropped rather than pushed into the previous run's buffer.
     */
    function deliver(frame: LiveFrame) {
      const target = ringRef.current;
      const chunk = frame.chunk;
      if (target && chunk && chunk.times.length > 0 && chunk.channels.length === target.channelCount) {
        try {
          target.pushChunk(chunk);
        } catch (error) {
          // `pushChunk` throws on a non-monotonic frame rather than absorbing
          // it, because the ring's binary search would then answer plausible
          // nonsense. Report it and stop; do not swallow it inside a timer.
          setMessage(
            `The live engine returned samples out of order, so this run was stopped: ${
              error instanceof Error ? error.message : String(error)}`,
          );
          sessionRef.current?.stop().catch(() => {});
          return;
        }
      }
      const now = Date.now();
      if (now - lastStatusAtRef.current < LIVE_STATUS_INTERVAL_MS) return;
      lastStatusAtRef.current = now;
      setRetention(frame.retention);
      setStatus({
        phase: "running",
        solvedCircuitTime: frame.solvedCircuitTime ?? target?.latestTime ?? 0,
        rate: frame.rate,
      });
    }
  }, [finishSession, plan]);

  const clearMessage = useCallback(() => setMessage(null), []);

  const stop = useCallback((intent: LiveStopIntent) => {
    const session = sessionRef.current;
    if (!session) return;
    intentRef.current = intent;
    // `LiveSpiceSession.stop` clears its poll timer BEFORE it awaits the halt,
    // so this call is what guarantees no further frame lands against a view the
    // user has already left. That is why leaving the simulator calls it inline
    // rather than from an effect on `mode`.
    void session.stop();
  }, []);

  const actuate = useCallback((component: ActuableComponent, nextValue: string) => {
    const queue = queueRef.current;
    if (!queue) return null;
    return queue.push(component, nextValue);
  }, []);

  // An unmount is the last chance to stop a solver that would otherwise keep
  // running with nobody reading it.
  useEffect(() => () => {
    sessionRef.current?.stop().catch(() => {});
    sessionRef.current = null;
  }, []);

  return {
    plan,
    livePlan,
    windowPlan,
    setPlan,
    status,
    running,
    ring,
    channels,
    retention,
    timeWindow,
    setTimeWindow,
    runKey,
    message,
    clearMessage,
    start,
    stop,
    actuate,
  };
}
