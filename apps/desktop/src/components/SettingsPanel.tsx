/**
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
