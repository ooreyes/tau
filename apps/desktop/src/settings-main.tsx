/**
 * Entry point for the standalone Settings window (`settings.html`).
 *
 * Same origin and same bundle as the schematic window, which is what keeps the
 * app's strict CSP applicable without being relaxed and what lets the two
 * windows share `localStorage` for preference sync.
 *
 * This root deliberately does not boot the schematic app: no model-library
 * hydration, no document store, no simulation engine. Settings is chrome for
 * preferences and credentials, and a second copy of the editor's boot path in
 * another window would be both slow and a source of two-writers bugs.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./App.css";
import "./styles/settings.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SettingsWindow } from "./settings/SettingsWindow";
import { initThemeMode } from "./lib/theme";

// Before first paint, matching main.tsx, so an explicit Light/Dark choice does
// not flash the other theme when the window opens.
initThemeMode();

ReactDOM.createRoot(document.getElementById("settings-root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <SettingsWindow standalone />
    </AppErrorBoundary>
  </React.StrictMode>,
);
