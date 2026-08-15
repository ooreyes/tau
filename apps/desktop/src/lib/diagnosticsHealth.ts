/**
 * The diagnostics traffic light (PDF-6 item 6).
 *
 * One authority for "what colour is the `!` button", because three surfaces ask
 * the question - the rail button, the diagnostics window's header, and the
 * settings copy that explains the policy - and a badge that disagrees with the
 * panel it opens is worse than no badge.
 *
 * The colours are defined by consequence, not by counting:
 *
 * - `error`   (red)    - the circuit will NOT run. Reserved for that, exactly as
 *                        the report asks: "Red should only be there if it wont
 *                        run in simulator." A warning storm is never red.
 * - `warning` (yellow) - it will run, but something is worth reading first.
 * - `ok`      (green)  - nothing to report.
 *
 * `severityPolicy` is the user's setting. Under `errors-only` a warning is not
 * promoted and not counted: the light is green or red, never yellow, which is
 * the "remove warning and just have red or green" option in the report.
 */

export type DiagnosticsHealth = "ok" | "warning" | "error";

/** The user-visible policy for whether warnings register at all. */
export type DiagnosticsSeverityPolicy = "all" | "errors-only";

export interface DiagnosticsHealthInput {
  /** Rows that mean the deck cannot run (engine failure, fail-closed refusal). */
  errorCount: number;
  /** Rows that are advisory: the deck still runs. */
  warningCount: number;
}

/** The light's colour under the active policy. */
export function diagnosticsHealth(
  input: DiagnosticsHealthInput,
  severityPolicy: DiagnosticsSeverityPolicy = "all",
): DiagnosticsHealth {
  if (input.errorCount > 0) return "error";
  if (severityPolicy === "errors-only") return "ok";
  return input.warningCount > 0 ? "warning" : "ok";
}

/** How many rows the panel shows under the active policy - the badge number. */
export function diagnosticsVisibleCount(
  input: DiagnosticsHealthInput,
  severityPolicy: DiagnosticsSeverityPolicy = "all",
): number {
  return severityPolicy === "errors-only"
    ? input.errorCount
    : input.errorCount + input.warningCount;
}

/** Accessible name for the toggle, so the colour is never the only signal. */
export function diagnosticsHealthLabel(
  health: DiagnosticsHealth,
  visibleCount: number,
): string {
  if (health === "error") {
    return visibleCount === 1
      ? "1 problem - this circuit will not run"
      : `${visibleCount} problems - this circuit will not run`;
  }
  if (health === "warning") {
    return visibleCount === 1 ? "1 warning" : `${visibleCount} warnings`;
  }
  return "No problems";
}
