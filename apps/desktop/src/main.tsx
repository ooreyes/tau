import React from "react";
import ReactDOM from "react-dom/client";
// Design-system token/utility layers - loaded before App.css (imported
// by App) so the existing hand-written rules keep final say while panels migrate.
import "./styles/tokens.css";
// Settings is a surface inside this window, not a window of its own.
import "./styles/settings.css";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installDevBridge } from "./lib/devBridge";
import { initThemeMode } from "./lib/theme";
import { hydrateInstalledLtspiceStandardModels } from "./store/useRuntimeModelLibraries";

// Dev-only. Tree-shaken out of production builds by the constant condition, so
// nothing here reaches a shipped bundle.
if (import.meta.env.DEV) installDevBridge();

// Before the first render, so an explicit Light/Dark choice does not flash the
// other theme on launch. "System" needs no JS - App.css's prefers-color-scheme
// block already handles it - but this still runs to clear a stale data-theme.
initThemeMode();

async function boot() {
  // LTspice resolves standard diode/BJT/MOS/JFET names implicitly. Load those
  // exact user-installed databases before the first runnable UI appears so a
  // fast click cannot race into a generic-model refusal.
  await hydrateInstalledLtspiceStandardModels();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

void boot();
