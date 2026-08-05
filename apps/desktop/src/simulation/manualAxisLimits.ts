/**
 * Manual Y-axis limits for scope panes (Bode magnitude first).
 * Empty / invalid input stays on autorange; valid pairs swap if inverted.
 */

export type ManualAxisLimits = { yMin: number; yMax: number };

export type ManualYLimitsResult =
  | { ok: true; limits: ManualAxisLimits }
  | { ok: false; error: string };

/**
 * Parse a Y min/max pair from plain numeric text (dB or linear magnitude).
 * Engineering suffixes are not required — Bode Y is usually typed as −40 / 20.
 */
export function parseManualYLimits(yMinText: string, yMaxText: string): ManualYLimitsResult {
  const loRaw = yMinText.trim();
  const hiRaw = yMaxText.trim();
  if (!loRaw || !hiRaw) {
    return { ok: false, error: "Enter both Y min and Y max." };
  }
  const lo = Number(loRaw);
  const hi = Number(hiRaw);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { ok: false, error: "Y limits must be finite numbers." };
  }
  if (lo === hi) {
    return { ok: false, error: "Y min and Y max must differ." };
  }
  return { ok: true, limits: { yMin: Math.min(lo, hi), yMax: Math.max(lo, hi) } };
}

/** Overlay manual Y on an autoranged viewport; null keeps auto. */
export function applyManualYToDomain<T extends { yMin: number; yMax: number }>(
  auto: T,
  manual: ManualAxisLimits | null,
): T {
  if (!manual) return auto;
  return { ...auto, yMin: manual.yMin, yMax: manual.yMax };
}
