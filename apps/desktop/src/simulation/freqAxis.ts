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

/** Convert Bode dB to linear relative magnitude (|V|/|Vref|). */
export function dbToLinearMag(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Autorange Bode magnitude Y under Lin (dB, linear axis) or Log (|V|/|Vref|
 * decades). Ignores floor-silent bins (`db <= -250`).
 */
export function bodeMagYDomain(
  magDbSeries: ReadonlyArray<ReadonlyArray<number>>,
  scale: AxisScale,
): { yMin: number; yMax: number; unit: string } | null {
  let found = false;
  let rawMin = 0;
  let rawMax = 0;
  for (const series of magDbSeries) {
    for (const db of series) {
      if (!Number.isFinite(db) || db <= -250) continue;
      const v = scale === "log" ? dbToLinearMag(db) : db;
      if (scale === "log" && !(v > 0)) continue;
      if (!found) {
        rawMin = v;
        rawMax = v;
        found = true;
      } else {
        rawMin = Math.min(rawMin, v);
        rawMax = Math.max(rawMax, v);
      }
    }
  }
  if (!found) return null;
  if (scale === "log") {
    const lo = 10 ** Math.floor(Math.log10(rawMin));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(rawMax, rawMin * 1.0001)));
    return { yMin: lo > 0 ? lo : rawMin, yMax: hi > lo ? hi : lo * 10, unit: "V/V" };
  }
  const maxDb = Math.ceil(Math.max(rawMax, 0) / 10) * 10;
  const minDb = Math.floor(Math.min(rawMin, maxDb - 10) / 10) * 10;
  return { yMin: minDb, yMax: maxDb, unit: "dB" };
}
