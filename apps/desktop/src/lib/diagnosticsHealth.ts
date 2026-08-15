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
import { createPreferenceStore } from "./preferences";

export type DiagnosticsHealth = "ok" | "warning" | "error";

/** The user-visible policy for whether warnings register at all. */
export type DiagnosticsSeverityPolicy = "all" | "errors-only";

export interface DiagnosticsHealthInput {
  /** Rows that mean the deck cannot run (engine failure, fail-closed refusal). */
  errorCount: number;
  /** Rows that are advisory: the deck still runs. */
  warningCount: number;
  /**
   * The run failed even though it produced no listable row.
   *
   * `MergedDiagnostics.hasError` is true whenever the last analysis came back
   * `ok: false`, and an engine can fail with an empty message - so counting
   * error ROWS alone would show a green light over a run that did not complete.
   * Red is defined by consequence, and "the analysis failed" is the consequence
   * whether or not there was prose to print. Optional so a caller that only has
   * two counts (a test, the settings preview) can still ask the question.
   */
  hasError?: boolean;
}

/** The light's colour under the active policy. */
export function diagnosticsHealth(
  input: DiagnosticsHealthInput,
  severityPolicy: DiagnosticsSeverityPolicy = "all",
): DiagnosticsHealth {
  if (input.errorCount > 0 || input.hasError) return "error";
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

/** How many warnings the policy is hiding, so a surface can say so out loud
 *  rather than quietly pretending a schematic is clean. */
export function diagnosticsSuppressedCount(
  input: DiagnosticsHealthInput,
  severityPolicy: DiagnosticsSeverityPolicy = "all",
): number {
  return severityPolicy === "errors-only" ? input.warningCount : 0;
}

/**
 * Accessible name for the toggle, so the colour is never the only signal.
 *
 * Leads with "Diagnostics" because this is one icon button in a rail of icon
 * buttons whose names are all destinations: a name of "2 warnings" says what
 * the state is but not what pressing it does. The state follows, in words, for
 * the reader who cannot separate red from green - and for the tooltip, which is
 * the only place the exact count survives once the badge clamps to "9+".
 */
export function diagnosticsHealthLabel(
  health: DiagnosticsHealth,
  visibleCount: number,
): string {
  if (health === "error") {
    return visibleCount === 1
      ? "Diagnostics: 1 problem, this circuit will not run"
      : visibleCount === 0
        // A failed run with no printable message still owns the red light.
        ? "Diagnostics: this circuit will not run"
        : `Diagnostics: ${visibleCount} problems, this circuit will not run`;
  }
  if (health === "warning") {
    return visibleCount === 1
      ? "Diagnostics: 1 warning, this circuit will still run"
      : `Diagnostics: ${visibleCount} warnings, this circuit will still run`;
  }
  return "Diagnostics: no problems";
}

/* ------------------------------------------------------------------ *
 * The persisted setting
 * ------------------------------------------------------------------ */

export interface DiagnosticsPreferences {
  severityPolicy: DiagnosticsSeverityPolicy;
}

/**
 * Warnings are shown by default, and that is the safer default rather than the
 * tidier one: a hidden warning is a wrong answer the user was never offered a
 * chance to notice. `errors-only` is opt-in.
 */
export const DEFAULT_DIAGNOSTICS_PREFERENCES: DiagnosticsPreferences = {
  severityPolicy: "all",
};

const POLICIES: readonly DiagnosticsSeverityPolicy[] = ["all", "errors-only"];

function isSeverityPolicy(value: unknown): value is DiagnosticsSeverityPolicy {
  return typeof value === "string" && (POLICIES as readonly string[]).includes(value);
}

/**
 * Stored through `createPreferenceStore` rather than by hand, which is the
 * established mechanism in `lib/` (`simulationPreferences`,
 * `assistantPreferences`): a versioned key, a validator that returns `null`
 * instead of throwing on a corrupt blob, and a `use()` binding that re-renders
 * every reader when the value changes - in this window via the store's own
 * event, in another window via `storage`. That last part is what keeps the rail
 * button, the diagnostics window and the Settings control from disagreeing
 * about the policy after the user flips it.
 */
export const diagnosticsPreferences = createPreferenceStore<DiagnosticsPreferences>({
  key: "tau.diagnostics.preferences.v1",
  defaults: DEFAULT_DIAGNOSTICS_PREFERENCES,
  validate: (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const candidate = (raw as { severityPolicy?: unknown }).severityPolicy;
    // An unrecognised policy falls back to showing warnings rather than
    // rejecting the whole blob: the failure mode of a bad value must be "you
    // see too much", never "you silently see less".
    return { severityPolicy: isSeverityPolicy(candidate) ? candidate : "all" };
  },
});

/** Reads the persisted policy once, without subscribing. */
export function loadDiagnosticsSeverityPolicy(): DiagnosticsSeverityPolicy {
  return diagnosticsPreferences.load().severityPolicy;
}

/** Persists the policy and notifies every live reader. */
export function saveDiagnosticsSeverityPolicy(policy: DiagnosticsSeverityPolicy): void {
  diagnosticsPreferences.update({ severityPolicy: policy });
}

/** React binding: the live policy, re-read whenever it changes anywhere. */
export function useDiagnosticsSeverityPolicy(): DiagnosticsSeverityPolicy {
  return diagnosticsPreferences.use().severityPolicy;
}

/** Clears the stored policy and returns to showing warnings - the entry point
 *  `lib/preferenceRegistry.ts` registers for "Reset to defaults". */
export function resetDiagnosticsPreferences(): void {
  diagnosticsPreferences.reset();
}
