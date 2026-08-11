/** Shared seven-segment polarity and electrical contract.
 *
 * The renderer, generated ngspice deck, and the lightweight operating-point
 * preview all consume this module. Keeping the spelling normalization here is
 * important for imported `.asc` values: a bare `anode` is an explicit common-
 * anode request, while an omitted/`auto` value retains Tau's historical
 * common-cathode default.
 */

export type SevenSegmentPolarity = "anode" | "cathode";
export type SevenSegmentPolarityInput = SevenSegmentPolarity | "auto" | string | undefined | null;

/** Series resistor emitted by the packaged seven-segment deck. */
export const SEVEN_SEGMENT_SERIES_OHMS = 220;
/** Constant-forward-drop approximation used by the lightweight preview. */
export const SEVEN_SEGMENT_FORWARD_DROP_VOLTS = 2;
/** Off-state leakage keeps an isolated preview matrix numerically solvable. */
export const SEVEN_SEGMENT_OFF_CONDUCTANCE = 1e-12;

/**
 * Normalize imported, authored, and typed polarity values to one electrical
 * direction. `cathode` wins if contradictory prose contains both spellings;
 * this is the safer fail-closed choice for a malformed value. `auto` is
 * intentionally directional rather than an absolute-voltage heuristic.
 */
export function normalizeSevenSegmentPolarity(value: SevenSegmentPolarityInput): SevenSegmentPolarity {
  const text = String(value ?? "").trim().toLowerCase();
  if (/\bcathode\b/.test(text) || /\bcommon[-\s_]*cathode\b/.test(text)) return "cathode";
  if (/\banode\b/.test(text) || /\bcommon[-\s_]*anode\b/.test(text)) return "anode";
  return "cathode";
}

/** The signed junction voltage for the normalized LED direction. */
export function sevenSegmentJunctionVoltage(
  segmentVoltage: number,
  commonVoltage: number,
  polarity: SevenSegmentPolarityInput,
): number {
  const normalized = normalizeSevenSegmentPolarity(polarity);
  return normalized === "anode"
    ? commonVoltage - segmentVoltage
    : segmentVoltage - commonVoltage;
}

/**
 * Piecewise-linear series-LED companion used by the web/native preview. It is
 * directional and has the same 220-ohm finite load as the generated deck:
 * reverse drive contributes only leakage, forward drive contributes
 * (V−Vf)/R. The return values are the classic SPICE Norton companion for a
 * current flowing from `anode` to `cathode`.
 */
export function sevenSegmentBranchCompanion(junctionVoltage: number): {
  conductance: number;
  equivalentCurrent: number;
  current: number;
} {
  if (!Number.isFinite(junctionVoltage) || junctionVoltage <= SEVEN_SEGMENT_FORWARD_DROP_VOLTS) {
    return {
      conductance: SEVEN_SEGMENT_OFF_CONDUCTANCE,
      equivalentCurrent: 0,
      current: 0,
    };
  }
  const conductance = 1 / SEVEN_SEGMENT_SERIES_OHMS;
  const current = (junctionVoltage - SEVEN_SEGMENT_FORWARD_DROP_VOLTS) * conductance;
  return {
    conductance,
    equivalentCurrent: -SEVEN_SEGMENT_FORWARD_DROP_VOLTS * conductance,
    current,
  };
}
