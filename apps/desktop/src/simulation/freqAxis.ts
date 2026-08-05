// Frequency-axis mapping for Bode / spectrum plots: log (decades) vs linear.
// Keeps path builders and PlotAxes scale flags in sync from one pure helper.

import type { AxisScale } from "./axisTicks";

/**
 * Map frequency `f` into `[0,1]` across `[xMin,xMax]` under `scale`.
 * Returns `null` when the domain cannot host the mapping (non-positive span,
 * or log scale with a non-positive edge/value).
 */
export function freqToFraction(
  f: number,
  xMin: number,
  xMax: number,
  scale: AxisScale,
): number | null {
  if (!Number.isFinite(f) || !Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax === xMin) {
    return null;
  }
  if (scale === "log") {
    if (!(f > 0) || !(xMin > 0) || !(xMax > 0)) return null;
    const l0 = Math.log10(xMin);
    const l1 = Math.log10(xMax);
    const span = l1 - l0;
    if (span === 0) return null;
    return (Math.log10(f) - l0) / span;
  }
  return (f - xMin) / (xMax - xMin);
}
