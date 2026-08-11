import type { ReactNode } from "react";
import { normalizeSevenSegmentPolarity } from "../../engine/sevenSegmentSpec";

/** The raw segment pins exposed by Tau's seven-segment component. */
export const SEVEN_SEGMENT_SEGMENTS = ["a", "b", "c", "d", "e", "f", "g", "dp"] as const;
export type SevenSegmentSegment = (typeof SEVEN_SEGMENT_SEGMENTS)[number];

/** The seven-segment portion of the display, excluding the decimal point. */
const DIGIT_SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"] as const satisfies readonly SevenSegmentSegment[];

/** Canonical active-segment patterns for decimal digits 0 through 9. */
export const SEVEN_SEGMENT_DIGIT_PATTERNS: Readonly<Record<number, readonly SevenSegmentSegment[]>> = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "d", "e", "g"],
  3: ["a", "b", "c", "d", "g"],
  4: ["b", "c", "f", "g"],
  5: ["a", "c", "d", "f", "g"],
  6: ["a", "c", "d", "e", "f", "g"],
  7: ["a", "b", "c"],
  8: ["a", "b", "c", "d", "e", "f", "g"],
  9: ["a", "b", "c", "d", "f", "g"],
};

export type SevenSegmentDisplayKind = "no-result" | "blank" | "digit" | "invalid";

export interface SevenSegmentDisplayState {
  /** The state is derived from a completed sample, or explicitly unavailable. */
  kind: SevenSegmentDisplayKind;
  /** A number is present only when the complete active pattern is 0–9. */
  digit: number | null;
  /** Active pins, retained even when the pattern is not a decimal digit. */
  activeSegments: readonly SevenSegmentSegment[];
  /** Exact matches are exposed for tests/readers without making up a digit. */
  matchingDigits: readonly number[];
}

export type SevenSegmentNodeVoltages = Partial<Record<SevenSegmentSegment, number>>;

export interface SevenSegmentDecodeOptions {
  /** Voltage difference required to call a pin driven rather than leakage/noise. */
  thresholdVolts?: number;
  /** Explicit polarity is useful for callers with a typed component contract. */
  polarity?: "auto" | "anode" | "cathode";
}

const DEFAULT_SEGMENT_THRESHOLD_VOLTS = 0.5;

/**
 * Read the common-terminal contract from an imported or expert-authored value.
 * A bare seven-segment part is common-cathode for backward compatibility;
 * `polarity=anode` / `common anode` opts into the opposite LED direction.
 */
export function sevenSegmentPolarityFromValue(value: string | undefined): "anode" | "cathode" {
  return normalizeSevenSegmentPolarity(value);
}

function orderedSegments(segments: Iterable<SevenSegmentSegment>): SevenSegmentSegment[] {
  const active = new Set(segments);
  return SEVEN_SEGMENT_SEGMENTS.filter((segment) => active.has(segment));
}

function samePattern(left: readonly SevenSegmentSegment[], right: readonly SevenSegmentSegment[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/**
 * Turn an active raw-pin pattern into a display interpretation.
 *
 * Exact matching is intentional: a shape that is close to a digit is still an
 * invalid shape, and the simulator must not invent a number for it. `dp` is
 * retained in the active pattern but is not part of the digit match, so a
 * decimal point can accompany a valid digit.
 */
export function decodeSevenSegmentPattern(
  activeSegments: Iterable<SevenSegmentSegment>,
  hasResult = true,
): SevenSegmentDisplayState {
  const ordered = orderedSegments(activeSegments);
  if (!hasResult) {
    return {
      kind: "no-result",
      digit: null,
      activeSegments: [],
      matchingDigits: [],
    };
  }

  const digitPattern = ordered.filter((segment): segment is (typeof DIGIT_SEGMENTS)[number] =>
    DIGIT_SEGMENTS.includes(segment as (typeof DIGIT_SEGMENTS)[number]),
  );
  const matchingDigits = Object.entries(SEVEN_SEGMENT_DIGIT_PATTERNS)
    .filter(([, pattern]) => samePattern(digitPattern, pattern))
    .map(([digit]) => Number(digit));

  if (ordered.length === 0) {
    return { kind: "blank", digit: null, activeSegments: ordered, matchingDigits };
  }
  if (matchingDigits.length === 1) {
    return {
      kind: "digit",
      digit: matchingDigits[0],
      activeSegments: ordered,
      matchingDigits,
    };
  }
  return { kind: "invalid", digit: null, activeSegments: ordered, matchingDigits };
}

/**
 * Read segment activity from the actual solved node voltages.
 *
 * A seven-segment symbol exposes `COM`, rather than a separate anode/cathode
 * pin. The default is common-cathode and an explicit `polarity="anode"`
 * selects the reverse LED direction. `auto` is retained for serialized API
 * compatibility but is intentionally directional (cathode), never an
 * absolute-voltage test that would make reverse drive look illuminated.
 */
export function activeSevenSegmentSegments(
  segmentVoltages: SevenSegmentNodeVoltages | null | undefined,
  commonVoltage: number | null | undefined,
  options: SevenSegmentDecodeOptions = {},
): SevenSegmentSegment[] {
  if (!Number.isFinite(commonVoltage)) return [];
  const threshold = Number.isFinite(options.thresholdVolts)
    ? Math.max(0, options.thresholdVolts as number)
    : DEFAULT_SEGMENT_THRESHOLD_VOLTS;
  const polarity = normalizeSevenSegmentPolarity(options.polarity);
  return SEVEN_SEGMENT_SEGMENTS.filter((segment) => {
    const voltage = segmentVoltages?.[segment];
    if (!Number.isFinite(voltage)) return false;
    const delta = (voltage as number) - (commonVoltage as number);
    if (polarity === "cathode") return delta >= threshold;
    if (polarity === "anode") return delta <= -threshold;
    return false;
  });
}

/** Derive the complete render state from a single operating/transient sample. */
export function deriveSevenSegmentDisplayState(
  segmentVoltages: SevenSegmentNodeVoltages | null | undefined,
  commonVoltage: number | null | undefined,
  options: SevenSegmentDecodeOptions = {},
): SevenSegmentDisplayState {
  if (!Number.isFinite(commonVoltage)) return decodeSevenSegmentPattern([], false);
  return decodeSevenSegmentPattern(
    activeSevenSegmentSegments(segmentVoltages, commonVoltage, options),
  );
}

const SEGMENT_PATHS: Readonly<Record<SevenSegmentSegment, string>> = {
  a: "M -6 -22 H 6",
  b: "M 8 -20 V -3",
  c: "M 8 3 V 20",
  d: "M -6 22 H 6",
  e: "M -8 3 V 20",
  f: "M -8 -20 V -3",
  g: "M -6 0 H 6",
  dp: "",
};

function stateDescription(state: SevenSegmentDisplayState): string {
  if (state.kind === "no-result") return "no simulation result";
  if (state.kind === "blank") return "blank";
  if (state.kind === "digit") {
    return `digit ${state.digit}${state.activeSegments.includes("dp") ? " with decimal point" : ""}`;
  }
  return state.activeSegments.length > 0
    ? `driven segments ${state.activeSegments.join(", ").toUpperCase()}`
    : "invalid segment pattern";
}

export function SevenSegmentDisplay({
  state,
  label = "7-segment display",
}: {
  state: SevenSegmentDisplayState;
  label?: string;
}): ReactNode {
  const active = new Set(state.activeSegments);
  const description = `${label}: ${stateDescription(state)}`;
  return (
    <g
      className={`seven-segment-display seven-segment-display--${state.kind}`}
      data-testid="seven-segment-display"
      data-display-status={state.kind}
      data-digit={state.digit === null ? undefined : String(state.digit)}
      role="img"
      aria-label={description}
    >
      <title>{description}</title>
      <rect className="seven-segment-display__face" x={-13} y={-27} width={26} height={54} rx={2} />
      {SEVEN_SEGMENT_SEGMENTS.map((segment) => (
        segment === "dp" ? (
          <circle
            key={segment}
            className={`seven-segment-display__segment${active.has(segment) ? " is-active" : ""}`}
            data-segment={segment}
            cx={12}
            cy={22}
            r={2}
          />
        ) : (
          <path
            key={segment}
            className={`seven-segment-display__segment${active.has(segment) ? " is-active" : ""}`}
            data-segment={segment}
            d={SEGMENT_PATHS[segment]}
          />
        )
      ))}
    </g>
  );
}
