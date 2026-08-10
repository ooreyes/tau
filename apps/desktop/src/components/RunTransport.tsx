import { Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EngineeringInput } from "./EngineeringInput";
import { formatEngineering, parseQuantity } from "../simulation/quantity";
import {
  DEFAULT_SAMPLE_BUDGET,
  describeStopReason,
  displayRate,
  formatSeconds,
  isWindowEditedFromAuthored,
  liveRunPlan,
  revertWindowToAuthored,
  runPlanHorizon,
  shouldWarnRateShortfall,
  withWindowBounds,
  type LiveRunPlan,
  type LiveRunStatus,
  type RateReport,
  type RunPlan,
  type WindowRunPlan,
} from "../simulation/liveRun";

/**
 * The run transport: one control that starts and stops the circuit, and a
 * visible choice between running it continuously and running a fixed span of
 * circuit time.
 *
 * ## Why this is a control and not a directive
 *
 * Omar's words are the spec: "When the user clicks run it should be like if the
 * circuit was just built and they plugged it in. It shouldn't be bounded by a
 * time interval it should be like a live circuit." And, on whether `.tran`
 * should decide it: "the .tran directives are confusing i rather there be an UI
 * that allows me to select either running something live continuously or just
 * emphasizing a certain time window."
 *
 * So the mode is never an invisible consequence of whether the document happens
 * to carry a `.tran` line. An authored `.tran` *pre-selects* WINDOW at that
 * duration — an imported LTspice file must still reproduce what LTspice shows,
 * and quietly overriding it with a continuous run is exactly the silent
 * substitution AGENTS.md forbids — but it arrives here as an ordinary editable
 * number with its provenance stated next to it, and one click puts it back.
 *
 * ## Why it is purely presentational
 *
 * Props in, callbacks out: no store, no Tauri, no effects. Two surfaces want
 * this cluster (the schematic's editor toolbar and the simulator), and a
 * component that reaches for global state can only ever live in one of them.
 * All run-model decisions — what a plan is, what a stop reason means, what a
 * measured rate is allowed to claim — belong to `simulation/liveRun.ts` and are
 * imported, never re-derived here. There is deliberately no second notion of
 * "run mode" in this file.
 */

/**
 * The accessible names this component owns.
 *
 * `shellContract.ts` is the source of truth for shell landmark names and is
 * owned by another unit, so these live here until the wiring unit promotes the
 * ones that become shell surfaces. Every name below was checked against the
 * names already in use, because "Live", "Run" and "Stop" are all overloaded in
 * this app and a duplicate accessible name is a bug for anyone driving the UI
 * by name:
 *
 * - `"Run simulation"` — `Toolbar.tsx` header Run, `ShellPanels.tsx` editor
 *   toolbar play, and `SHELL_CONTROLS.transportRun`.
 * - `"Stop simulation"` — `ShellPanels.tsx` editor toolbar stop and
 *   `drawer/ResultsDrawer.tsx`.
 * - `"Stop"` — `SimulationPanel.tsx`'s run-overlay button and
 *   `AssistantPanel.tsx`'s cancel.
 * - `SHELL.liveControls` = `"Live controls"` — the hand-operable switches on
 *   the canvas, a completely unrelated feature. Nothing here is named "Live"
 *   on its own for that reason; the mode option's visible word is "Live" and
 *   its accessible name qualifies it.
 * - `"Start"` / `"Stop"` field labels in `AnalysisSetupForms.tsx` are
 *   `DC start` / `DC stop` / `Step stop` / `Noise stop frequency`, so the
 *   window bound names below are prefixed with "Run window".
 * - `"Editor mode"` (`Toolbar.tsx`) and `"Analysis modes"`
 *   (`AnalysisModeRail.tsx`) are the other two mode pickers; this one is
 *   "Run mode".
 *
 * Each accessible name contains its own visible label (WCAG 2.5.3), so voice
 * control users can say what they can see.
 */
export const RUN_TRANSPORT_NAMES = {
  group: "Run transport",
  run: "Run this circuit",
  stop: "Stop this run",
  modeGroup: "Run mode",
  modeLive: "Live: run continuously",
  modeWindow: "Window: run a fixed time span",
  windowStart: "Run window start time",
  windowStop: "Run window stop time",
  restoreAuthored: "Restore the window the file asked for",
} as const;

/**
 * The window a user gets when they pick WINDOW with nothing authored to
 * pre-select it and no previous window to return to.
 *
 * One millisecond, because the solver measures ~500k points/s: a millisecond
 * comes back instantly, so the first bounded run a user asks for *answers*, and
 * they widen it from a result they can see. A one-second default on a switching
 * converter would look like the app had hung, which teaches the wrong thing
 * about a control whose entire purpose is that the user chooses the span.
 */
export const DEFAULT_WINDOW_SECONDS = 1e-3;

/**
 * LIVE is the default. Not a convention — the requirement: "we need the live
 * viewer to be the default". A document that authors a `.tran` overrides it,
 * but that override arrives through the `plan` prop from `defaultRunPlan()`,
 * not by this component guessing.
 */
const DEFAULT_LIVE_PLAN: LiveRunPlan = liveRunPlan();

/**
 * Built as a literal rather than through `windowPlanFromAuthoredTran()`
 * because that helper stamps `origin.source: "authored-tran"` and a non-null
 * `origin.authored`. Borrowing it here would make a window the *user* chose
 * claim it came from the file, and would then offer a "restore" button that
 * restores a fiction. A user-chosen window has no authored provenance, and
 * says so.
 */
const DEFAULT_WINDOW_PLAN: WindowRunPlan = {
  mode: "window",
  startTime: 0,
  stopTime: DEFAULT_WINDOW_SECONDS,
  targetRate: null,
  sampleBudget: DEFAULT_SAMPLE_BUDGET,
  origin: { source: "user", authored: null },
};

export interface RunTransportProps {
  /** The current plan. Defaults to a continuous run — see {@link DEFAULT_LIVE_PLAN}. */
  plan?: RunPlan;
  /** Where the run has got to. Defaults to idle. */
  status?: LiveRunStatus;
  /**
   * The plan selecting LIVE produces. The owner passes the user's previous live
   * plan so a rate choice survives a round trip through WINDOW.
   */
  livePlan?: LiveRunPlan;
  /**
   * The plan selecting WINDOW produces. This component keeps no state, so the
   * owner must hand back the last window (or the document's authored one) for
   * a Live→Window→Live→Window round trip to preserve the user's duration.
   */
  windowPlan?: WindowRunPlan;
  onPlanChange: (plan: RunPlan) => void;
  onRun: () => void;
  onStop: () => void;
  /** Blocks starting a run (no schematic, invalid deck). Never blocks stopping one. */
  disabled?: boolean;
}

/** Circuit-seconds per wall-second, at the precision a readout can be read at. */
function formatRate(rate: number): string {
  return `${Number(rate.toPrecision(3))}`;
}

/**
 * The ACHIEVED rate, or an admission that none has been measured yet.
 *
 * There is deliberately no branch that falls back to the requested rate.
 * `displayRate` returns null until the estimator has seen enough, and a live
 * scope that prints the timebase you asked for while running slower than it is
 * worse than one that says "measuring…" — the slow one is visibly slow. The
 * requested rate appears in exactly one place, inside the shortfall warning,
 * where it is explicitly named as the thing that is *not* being achieved.
 */
function RateTelemetry({ report }: { report: RateReport }) {
  const achieved = displayRate(report);
  return (
    <>
      <p className="m-0 flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
        <span>Measured rate</span>
        <span className="mono-num">
          {achieved === null ? "measuring…" : `${formatRate(achieved)}× circuit s per s`}
        </span>
      </p>
      {shouldWarnRateShortfall(report) && achieved !== null && report.targetRate !== null && (
        <p role="alert" className="m-0 text-[11px] leading-4 text-warning">
          {`Solver cannot keep up — ${formatRate(achieved)}× against the ${formatRate(report.targetRate)}× requested. The trace shows what was solved, not the requested timebase.`}
        </p>
      )}
    </>
  );
}

/**
 * A seconds value as the text the engineering field wants (`5m`, not `0.005`).
 *
 * `engineeringSpelling` deliberately leaves plain decimals between 1m and 1k
 * alone, which is right for a resistance the user typed and wrong here: a
 * `.tran 5m` imported from LTspice must read back as `5 m`, in the decade the
 * file was written in, not as `0.005`. Digits are increased until the spelling
 * parses back to the same number, so this can shorten a value but never move
 * it — a duration field that quietly rounds is a lie about what will run.
 */
function secondsToFieldText(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  if (seconds === 0) return "0";
  const tolerance = Math.abs(seconds) * 4 * Number.EPSILON;
  for (let digits = 1; digits <= 15; digits += 1) {
    const candidate = formatEngineering(seconds, "", digits).replace(/\s+/g, "");
    try {
      if (Math.abs(parseQuantity(candidate, "s") - seconds) <= tolerance) return candidate;
    } catch {
      break;
    }
  }
  return String(seconds);
}

/** What the document asked for, in the document's own words where we have them. */
function describeAuthored(plan: WindowRunPlan): string | null {
  const authored = plan.origin.authored;
  if (!authored) return null;
  const directive = authored.directive?.trim();
  if (directive) return directive;
  return `.tran ${secondsToFieldText(authored.stopTime)}`;
}

export function RunTransport({
  plan = DEFAULT_LIVE_PLAN,
  status = { phase: "idle" },
  livePlan = DEFAULT_LIVE_PLAN,
  windowPlan = DEFAULT_WINDOW_PLAN,
  onPlanChange,
  onRun,
  onStop,
  disabled = false,
}: RunTransportProps) {
  const running = status.phase === "running";
  const isLive = plan.mode === "live";
  const horizon = runPlanHorizon(plan);

  const selectLive = () => {
    if (plan.mode !== "live") onPlanChange(livePlan);
  };
  const selectWindow = () => {
    if (plan.mode !== "window") onPlanChange(windowPlan);
  };

  const setBound = (key: "startTime" | "stopTime") => (text: string) => {
    if (plan.mode !== "window") return;
    let seconds: number;
    try {
      seconds = parseQuantity(text, "s");
    } catch {
      return;
    }
    if (!Number.isFinite(seconds)) return;
    onPlanChange(withWindowBounds(plan, { [key]: seconds }));
  };

  const authoredText = plan.mode === "window" ? describeAuthored(plan) : null;
  const editedFromAuthored = plan.mode === "window" && isWindowEditedFromAuthored(plan);
  // A window that ends before it starts solves nothing. Say so rather than
  // letting Run produce an empty plot the user has to diagnose.
  const emptyWindow = plan.mode === "window" && !(plan.stopTime > plan.startTime);

  return (
    <div role="group" aria-label={RUN_TRANSPORT_NAMES.group} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {/*
         * ONE control that changes identity, because that is what was asked
         * for: "the Run button should turn into a stop button". Both a live
         * run and a bounded one stop through it — a bounded run is not
         * un-stoppable just because it has an end in sight.
         */}
        {running ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="gap-1.5"
            aria-label={RUN_TRANSPORT_NAMES.stop}
            onClick={onStop}
          >
            <Square size={12} strokeWidth={1.6} fill="currentColor" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 bg-secondary hover:bg-accent"
            aria-label={RUN_TRANSPORT_NAMES.run}
            disabled={disabled}
            onClick={onRun}
          >
            <Play size={12} strokeWidth={1.6} fill="currentColor" aria-hidden="true" />
            Run
          </Button>
        )}

        {/*
         * The same segmented control the appearance picker and the editor-mode
         * toggle use (`.mode-toggle` / `.mode-btn`), so the run mode reads as
         * one of this app's mode choices rather than a new invention.
         *
         * Disabled while a run is in flight: switching mode mid-run would
         * either change what is being solved underneath the user or be quietly
         * ignored until the next run, and both are the kind of invisible
         * behaviour this unit exists to remove. Stop first, then choose.
         */}
        <div className="mode-toggle" role="radiogroup" aria-label={RUN_TRANSPORT_NAMES.modeGroup}>
          <button
            type="button"
            role="radio"
            aria-checked={isLive}
            aria-label={RUN_TRANSPORT_NAMES.modeLive}
            className={`mode-btn${isLive ? " active" : ""}`}
            disabled={running}
            onClick={selectLive}
          >
            Live
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isLive}
            aria-label={RUN_TRANSPORT_NAMES.modeWindow}
            className={`mode-btn${!isLive ? " active" : ""}`}
            disabled={running}
            onClick={selectWindow}
          >
            Window
          </button>
        </div>

        {plan.mode === "window" && (
          /*
           * A real <fieldset disabled>, not a hand-rolled overlay: it disables
           * every control inside it — the mantissa input and the SI-prefix
           * trigger both — through the platform, so a new field added here
           * cannot forget to opt in.
           *
           * The bounds are the model's own `startTime`/`stopTime`, in seconds,
           * through EngineeringInput so "100m", "1" and "1s" parse the way
           * every other value in this app does. The start bound only appears
           * when it is non-zero, which for a hand-made window it never is; it
           * shows up for an imported `.tran` with a Tstart, because a field
           * that came from the document must be visible and editable rather
           * than silently applied.
           */
          <fieldset
            disabled={running}
            className="m-0 flex min-w-0 items-center gap-1.5 border-0 p-0"
          >
            {plan.startTime !== 0 && (
              <>
                <span className="text-[11px] text-muted-foreground">from</span>
                <EngineeringInput
                  label={RUN_TRANSPORT_NAMES.windowStart}
                  unit="s"
                  min={0}
                  value={secondsToFieldText(plan.startTime)}
                  onValueChange={setBound("startTime")}
                />
              </>
            )}
            <span className="text-[11px] text-muted-foreground">
              {plan.startTime === 0 ? "for" : "to"}
            </span>
            <EngineeringInput
              label={RUN_TRANSPORT_NAMES.windowStop}
              unit="s"
              min={0}
              minExclusive
              value={secondsToFieldText(plan.stopTime)}
              onValueChange={setBound("stopTime")}
            />
          </fieldset>
        )}
      </div>

      {/*
       * What pressing Run will actually do, in one sentence, from the model's
       * own horizon rather than from this component's opinion of it.
       */}
      <p className="m-0 text-[11px] leading-4 text-muted-foreground">
        {horizon === null
          ? "Runs continuously, like a circuit on the bench, until you stop it."
          : `Runs to t = ${formatSeconds(horizon)}, then stops.`}
      </p>

      {authoredText && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] leading-4 text-muted-foreground">
          <span>
            {editedFromAuthored
              ? `Edited — this file asked for ${authoredText}.`
              : `From this file's ${authoredText}.`}
          </span>
          {editedFromAuthored && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={RUN_TRANSPORT_NAMES.restoreAuthored}
              onClick={() => {
                if (plan.mode === "window") onPlanChange(revertWindowToAuthored(plan));
              }}
            >
              Restore
            </Button>
          )}
        </div>
      )}

      {emptyWindow && (
        <p role="alert" className="m-0 text-[11px] leading-4 text-destructive">
          This window ends at or before it starts, so there is nothing to solve.
        </p>
      )}

      {/*
       * A stopped run must never look like a running one, so the reason is
       * rendered verbatim from the model's closed union of them — not as a
       * blank plot with the button back to "Run".
       */}
      <p role="status" className="m-0 text-[11px] leading-4 text-muted-foreground">
        {status.phase === "idle" && "Ready."}
        {status.phase === "running" && `Running — t = ${formatSeconds(status.solvedCircuitTime)}.`}
        {status.phase === "stopped" && describeStopReason(status.reason)}
      </p>

      {status.phase === "running" && <RateTelemetry report={status.rate} />}
    </div>
  );
}
