/**
 * The schematic editor's diagnostics strip, moved out of ShellPanels.tsx.
 *
 * Filed under `drawer/` rather than `shell/` because that is where it is
 * going: REDESIGN.md stage 4 folds `BottomPanel`, `TelemetryDock` and the
 * analysis panel's chrome into one bottom drawer with four tabs, and this
 * becomes its Errors tab. Moving it now, with no change to what it renders,
 * keeps that stage's diff about the drawer rather than about relocation.
 *
 * Its `role="region"` and "Simulation diagnostics" accessible name are part
 * of the frozen shell contract and must survive the fold.
 */
import { useEffect, useState } from "react";
import type { RunOutcome } from "../../App";

export function BottomPanel({
  result,
  isRunning = false,
  notices = [],
}: {
  mode?: "schematic" | "simulator";
  /**
   * The last run's outcome, whichever analysis produced it.
   *
   * Typed as the shape all seven share rather than as `AnalysisResult`: this
   * used to take the transient specifically, so a failed AC sweep or noise run
   * left the Errors tab reporting "No issues" next to its own failure. Nothing
   * here ever needed more than `ok`, the message and the warnings.
   */
  result: RunOutcome | null;
  isRunning?: boolean;
  /** Document-level warnings independent of a run (e.g. ASC import warnings -
   *  previously console-only, so "Opened with 2 warning(s)" was a dead end). */
  notices?: string[];
}) {
  // A live run supersedes the previous result's diagnostics. Keeping stale
  // success/error classes during a rerun would contradict the amber Run state.
  const messages = isRunning ? [] : [
    ...(result && !result.ok && result.message ? [result.message] : []),
    ...(result?.warnings ?? []),
    ...notices,
  ];
  const hasIssues = messages.length > 0;
  const hasError = !isRunning && Boolean(result && !result.ok);
  // Import notices must surface even before the first run - "idle" only when
  // there is genuinely nothing to show.
  const isIdle = !isRunning && result === null && !hasIssues;
  const isClean = !isRunning && Boolean(result?.ok) && !hasIssues;
  const issueSignature = messages.join("\u0000");
  const [expanded, setExpanded] = useState(hasIssues);

  // New issues must never remain hidden; returning to all-clear collapses the
  // panel back to its quiet one-line status rather than keeping empty chrome.
  useEffect(() => {
    setExpanded(Boolean(issueSignature));
  }, [issueSignature]);

  const panelExpanded = hasIssues && expanded;

  return (
    <section
      className={`bottom-panel${isRunning ? " is-running" : ""}${hasIssues ? " has-issues" : ""}${hasError ? " has-error" : ""}${hasIssues && !hasError ? " has-warning" : ""}${isClean ? " is-clean" : ""}${isIdle ? " is-idle" : ""}${panelExpanded ? "" : " is-collapsed"}`}
      aria-label="Simulation diagnostics"
    >
      {isRunning || isIdle || isClean ? (
        <div className="bottom-panel-head bottom-panel-head--static">
          <span className="bottom-panel-state" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              {isRunning
                ? <circle cx="6" cy="6" r="3.2" />
                : isIdle
                  ? <path d="M3 6h6" />
                  : <path d="M2.3 6.3 4.8 8.8 9.8 3.5" />}
            </svg>
          </span>
          <span className="bottom-panel-title">Diagnostics</span>
          <span className="bottom-panel-clear" role="status">
            {isRunning ? "Running" : isIdle ? "No analysis yet" : "No issues"}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="bottom-panel-head"
          aria-expanded={panelExpanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <svg className="bottom-panel-chevron" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.2 6 7.8l3.5-3.6" />
          </svg>
          <span className="bottom-panel-state" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              {hasError ? (
                <path d="m4.2 4.2 3.6 3.6m0-3.6L4.2 7.8" />
              ) : (
                <path d="M6 1.8 10.4 10H1.6L6 1.8Zm0 2.9v2.5M6 8.7v.1" />
              )}
            </svg>
          </span>
          <span className="bottom-panel-title">{hasError ? "Errors" : "Warnings"}</span>
          <span
            className={`bottom-panel-count${hasError ? "" : " warnings-only"}`}
            aria-live="polite"
          >
            {messages.length}
          </span>
        </button>
      )}
      {panelExpanded && <div className="bottom-errors">
        {messages.map((message, index) => {
          const isErrorMessage = Boolean(result && !result.ok && index === 0);
          return (
            <div
              key={`${message}-${index}`}
              className={isErrorMessage ? "error" : "warning"}
              role={isErrorMessage ? "alert" : undefined}
            >
              <span className="bottom-error-glyph" aria-hidden="true">
                <svg viewBox="0 0 12 12">
                  {isErrorMessage ? (
                    <path d="m4.2 4.2 3.6 3.6m0-3.6L4.2 7.8" />
                  ) : (
                    <path d="M6 1.8 10.4 10H1.6L6 1.8Zm0 2.9v2.5M6 8.7v.1" />
                  )}
                </svg>
              </span>
              <span className="bottom-error-message">{message}</span>
            </div>
          );
        })}
      </div>}
    </section>
  );
}

/**
 * The ideal model this part will really run, reproducing the deck's own
 * precedence: a `.model` this schematic defines under the same name beats the
 * ideal part, because the user named a card (`spiceNetlist.ts`, the
 * diode/led/zener case, which reads `definedModelNames` from the directives).
 * Returns null whenever the part takes the real path, so the panel can never
 * call something ideal that the engine will not run as ideal.
 */
