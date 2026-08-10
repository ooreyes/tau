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

/*
 * Reserve the traffic lights' corner, but only where they exist.
 *
 * The macOS window uses `titleBarStyle: "Overlay"` so there is one bar
 * instead of two - the native strip that just said "Tau" above a header
 * already saying "tau" is gone. The cost is that the close/minimise/zoom
 * buttons now float over the top-left of our own toolbar, exactly where the
 * brand sits. This marks the document so App.css can inset the toolbar for
 * them; it is deliberately not unconditional, because in a browser there are
 * no traffic lights and the gap would just be a hole.
 */
void (async () => {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    const mac = navigator.userAgent.includes("Mac");
    if (isTauri() && mac) document.documentElement.classList.add("has-overlay-titlebar");
  } catch {
    /* Not a Tauri runtime, so there is nothing to inset for. */
  }
})();

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
