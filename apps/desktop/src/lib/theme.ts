/**
 * Theme mode state - System / Light / Dark (DESIGN_SYSTEM.md §1).
 *
 * Light is the product default for first launch (paid-product paper chrome).
 * "System" still needs no JavaScript: App.css's
 * `@media (prefers-color-scheme: light)` block redefines every color token
 * when the OS reports light, and the plain `:root` (no data-theme attribute)
 * stays dark otherwise. This module also owns the EXPLICIT override path -
 * stamping `data-theme="light"` or `data-theme="dark"` on <html> forces one
 * theme regardless of the OS setting, per the cascade documented at the top
 * of the light-theme block in App.css:
 *
 *   :root (dark) -> @media (prefers-color-scheme: light) -> :root[data-theme]
 *
 * An attribute selector always outranks a bare :root, so the data-theme
 * blocks win over the media query in both directions once one is set.
 */

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "tau.ui.theme";
const MODES: readonly ThemeMode[] = ["system", "light", "dark"];
/** First-run / corrupt-storage fallback - Light, not System. */
const DEFAULT_THEME_MODE: ThemeMode = "light";

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** Reads the persisted preference. Falls back to Light if unset,
 *  invalid, or localStorage is unavailable (private browsing, or a test
 *  environment without one installed). */
export function loadThemeMode(): ThemeMode {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_MODE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** Persists the preference. Silently no-ops if storage is unavailable - the
 *  theme still applies for the current session via applyThemeMode, it just
 *  will not survive a reload. */
export function saveThemeMode(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* quota exceeded or storage disabled - nothing more to do here */
  }
}

/** Stamps (or clears) data-theme on the document root so App.css's cascade
 *  picks the right token set. "system" removes the attribute entirely so
 *  the prefers-color-scheme media query drives it; "light"/"dark" force it
 *  regardless of what the OS reports. */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

/** Reads the persisted preference and applies it in one call. Intended to
 *  run once, as early as possible at startup, so there is no flash of the
 *  wrong theme on launch. Nothing currently calls this - wiring it into the
 *  app's boot path (main.tsx or an inline index.html script) is outside
 *  this change's file ownership; see the handoff note in this feature's
 *  report. Until it is wired in, an explicit Light/Dark choice applies as
 *  soon as SettingsPanel.tsx's ThemeControl mounts, and "System" already
 *  works with zero JavaScript via the App.css media query. */
export function initThemeMode(): ThemeMode {
  const mode = loadThemeMode();
  applyThemeMode(mode);
  return mode;
}

/** Persists and applies in one call - the setter Settings UI should use. */
export function setThemeMode(mode: ThemeMode): void {
  saveThemeMode(mode);
  applyThemeMode(mode);
}
