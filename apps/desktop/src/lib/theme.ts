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

/**
 * Fired whenever the stored mode changes, matching the shape every other
 * preference module in `lib/` already uses.
 *
 * This exists because the mode can now change from somewhere other than the
 * control that displays it: "Reset to defaults" calls `resetThemeMode`. A
 * control that seeded its state once from `loadThemeMode` would keep showing
 * Dark over a light app, and - worse - clicking Dark would then be a no-op
 * against its own stale state, leaving no way back without remounting the
 * page. The attribute on <html> is enough to repaint the app; it is not
 * enough to correct a control that is reading its own copy.
 */
export const THEME_CHANGE_EVENT = "tau:theme-changed";

function notifyThemeChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

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
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* quota exceeded or storage disabled - nothing more to do here */
    }
  }
  // Announced even when the write failed: the in-session mode still changed,
  // and a control showing the old one would be wrong either way.
  notifyThemeChanged();
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

/** Reads the persisted preference and applies it in one call. Called by
 *  main.tsx:21 before the first render so there is no flash of the wrong
 *  theme on launch. An explicit Light/Dark choice applies immediately on
 *  startup, and "System" also works with zero JavaScript via the App.css
 *  media query. */
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

/** Clears the persisted preference and re-applies the shipped default
 *  (Light, per DEFAULT_THEME_MODE) so `data-theme` on <html> does not
 *  linger on whatever was set before the reset - see the "Reset to
 *  defaults" contract in Settings. */
export function resetThemeMode(): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* quota exceeded or storage disabled - still apply the default below */
    }
  }
  applyThemeMode(DEFAULT_THEME_MODE);
  notifyThemeChanged();
}
