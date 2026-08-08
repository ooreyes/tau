/**
 * Manual Y-axis limits for scope panes.
 *
 * Each edge is independent, and an empty field means "autorange this edge".
 * The previous model demanded both numbers at once and answered a half-filled
 * pair with an error — a failure state the form invented for itself, since
 * "pin the top, let the bottom follow the data" is a perfectly ordinary thing
 * to want on a scope. Independent edges remove the error and are strictly more
 * capable than the all-or-nothing pair.
 */

/** An absent edge autoranges. Both absent is the same as no manual limits. */
export type ManualAxisLimits = { yMin?: number; yMax?: number };

export type ManualYLimitsResult =
  | { ok: true; limits: ManualAxisLimits | null }
  | { ok: false; error: string };

/**
 * Parse a Y min/max pair from plain numeric text (dB or linear magnitude).
 * Engineering suffixes are not required — Bode Y is usually typed as −40 / 20.
 */
export function parseManualYLimits(yMinText: string, yMaxText: string): ManualYLimitsResult {
  const loRaw = yMinText.trim();
  const hiRaw = yMaxText.trim();
  if (!loRaw && !hiRaw) return { ok: true, limits: null };

  const lo = loRaw ? Number(loRaw) : undefined;
  const hi = hiRaw ? Number(hiRaw) : undefined;
  if ((lo !== undefined && !Number.isFinite(lo)) || (hi !== undefined && !Number.isFinite(hi))) {
    return { ok: false, error: "Y limits must be finite numbers." };
  }
  if (lo !== undefined && hi !== undefined) {
    if (lo === hi) return { ok: false, error: "Y min and Y max must differ." };
    // A reversed pair is a typo, not an instruction to flip the axis.
    return { ok: true, limits: { yMin: Math.min(lo, hi), yMax: Math.max(lo, hi) } };
  }
  return { ok: true, limits: { yMin: lo, yMax: hi } };
}

/** Overlay manual Y on an autoranged viewport; an absent edge keeps auto. */
export function applyManualYToDomain<T extends { yMin: number; yMax: number }>(
  auto: T,
  manual: ManualAxisLimits | null,
): T {
  if (!manual) return auto;
  const yMin = manual.yMin ?? auto.yMin;
  const yMax = manual.yMax ?? auto.yMax;
  // One pinned edge can still cross the autoranged one (pin a max below the
  // data's min). Keep the axis ascending so the plot stays drawable.
  if (yMin >= yMax) return auto;
  return { ...auto, yMin, yMax };
}
