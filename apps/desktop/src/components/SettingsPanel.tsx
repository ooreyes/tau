/**
 * Small Settings-sheet controls that are too specific for the generic
 * `settings/controls` primitives: appearance, and the diagnostics severity
 * policy.
 *
 * Appearance control for the Settings sheet - System / Light / Dark
 * (DESIGN_SYSTEM.md section 1). Rendered by GeneralPage.tsx
 * under the "Appearance" section.
 *
 * Reuses the existing `.settings-row` / `.settings-row-copy` / `.mode-toggle`
 * / `.mode-btn` classes already styled in App.css - the same segmented-control
 * look used elsewhere in the toolbar - so it matches the surrounding rows
 * without new CSS.
 *
 * "System" needs no JavaScript: App.css's `prefers-color-scheme` block handles
 * it. This control exists for the explicit override, which main.tsx re-applies
 * at boot via initThemeMode so there is no flash of the wrong theme.
 */
import { useEffect, useState } from "react";

import {
  saveDiagnosticsSeverityPolicy,
  useDiagnosticsSeverityPolicy,
  type DiagnosticsSeverityPolicy,
} from "../lib/diagnosticsHealth";
import {
  THEME_CHANGE_EVENT,
  applyThemeMode,
  saveThemeMode,
  loadThemeMode,
  type ThemeMode,
} from "../lib/theme";

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

export function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>(() => loadThemeMode());

  // Applies on mount too, not just on change - if this control is the first
  // thing in the session to read the persisted preference, the theme should
  // still take effect immediately rather than waiting for the user to
  // reselect it.
  useEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  // The mode can change from outside this control: "Reset to defaults" on the
  // same page calls resetThemeMode. Without this the segmented control would
  // keep showing Dark over a now-light app, and clicking Dark would be a
  // no-op against its own stale state, with no way back short of leaving the
  // page and returning.
  useEffect(() => {
    const onChange = () => setMode(loadThemeMode());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const choose = (next: ThemeMode) => {
    setMode(next);
    saveThemeMode(next);
  };

  const hint =
    mode === "system" ? "Follows macOS" : mode === "light" ? "Default" : "Forced dark";

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">Appearance</span>
        {/* .settings-row-hint truncates rather than wraps, so this has to stay
            short enough to read whole at the sheet's narrowest width. */}
        <span className="settings-row-hint">{hint}</span>
      </div>
      <div className="mode-toggle" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            className={`mode-btn${mode === option.mode ? " active" : ""}`}
            onClick={() => choose(option.mode)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Which severities the diagnostics light and window register (PDF-6 item 6):
 * "The user should be able to select a setting to remove warning and just have
 * red or green."
 *
 * Reuses `ThemeControl`'s segmented control verbatim - same `.settings-row` /
 * `.mode-toggle` / `.mode-btn` classes - because it is the same kind of choice
 * (one of a small closed set) and a second visual idiom for it would only make
 * the sheet look assembled by different people.
 *
 * No local `useState`: `useDiagnosticsSeverityPolicy` is the store's own React
 * binding, so this control cannot go stale against a "Reset to defaults" click
 * or against a change made in another window - the failure mode `ThemeControl`
 * needed a change listener to avoid.
 */
const SEVERITY_OPTIONS: { policy: DiagnosticsSeverityPolicy; label: string }[] = [
  { policy: "all", label: "Warnings" },
  { policy: "errors-only", label: "Errors only" },
];

export function DiagnosticsSeverityControl() {
  const policy = useDiagnosticsSeverityPolicy();

  // Says what each setting DOES to the light rather than restating the label,
  // and names the one rule that is easy to get wrong: red means the circuit
  // will not run, so choosing "Errors only" hides advice, never a blocker.
  const hint = policy === "errors-only"
    ? "Red or green only. Warnings are hidden."
    : "Red will not run, yellow runs with advice, green is clear.";

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">Diagnostics light</span>
        {/* .settings-row-hint truncates rather than wraps, so this has to stay
            short enough to read whole at the sheet's narrowest width. */}
        <span className="settings-row-hint">{hint}</span>
      </div>
      <div className="mode-toggle" role="radiogroup" aria-label="Diagnostics light">
        {SEVERITY_OPTIONS.map((option) => (
          <button
            key={option.policy}
            type="button"
            role="radio"
            aria-checked={policy === option.policy}
            className={`mode-btn${policy === option.policy ? " active" : ""}`}
            onClick={() => saveDiagnosticsSeverityPolicy(option.policy)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
