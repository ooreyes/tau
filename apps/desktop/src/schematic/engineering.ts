import { formatEngineering, parseQuantity } from "../simulation/quantity";

/** SI prefixes exposed by the component inspector. Follows LTspice suffix
 * semantics (see simulation/quantity.ts, the value-parsing authority):
 * suffixes are case-insensitive, `m` and `M` are BOTH milli, and mega is
 * stored as `Meg` so composed values read back correctly in SPICE decks. */
export const ENGINEERING_PREFIXES = [
  { value: "f", label: "f" },
  { value: "p", label: "p" },
  { value: "n", label: "n" },
  { value: "u", label: "µ" },
  { value: "m", label: "m" },
  { value: "", label: "" },
  { value: "k", label: "k" },
  { value: "Meg", label: "Meg" },
  { value: "G", label: "G" },
  { value: "T", label: "T" },
] as const;

export type EngineeringPrefix = (typeof ENGINEERING_PREFIXES)[number]["value"];

export interface EngineeringParts {
  mantissa: string;
  prefix: EngineeringPrefix;
}

const MANTISSA_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;

const FIRST_LETTER_PREFIX: Record<string, EngineeringPrefix> = {
  f: "f",
  p: "p",
  n: "n",
  u: "u",
  "µ": "u", // U+00B5 micro sign
  "μ": "u", // U+03BC greek small mu
  m: "m",
  k: "k",
  g: "G",
  t: "T",
};

/** Map a raw value suffix to a dropdown prefix under LTspice rules, or null
 * when it isn't representable (unknown letters, or `mil` = 25.4µ which has no
 * dropdown slot). Longest matches first so "meg"/"mil" win over "m". */
function prefixFromSuffix(suffix: string): EngineeringPrefix | null {
  if (!suffix) return "";
  const s = suffix.toLowerCase();
  if (s.startsWith("meg")) return "Meg";
  if (s.startsWith("mil")) return null;
  return FIRST_LETTER_PREFIX[s[0]] ?? null;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Break a stored SPICE-like value into the numeric part and a selectable prefix. */
export function splitEngineeringValue(value: string, unit = ""): EngineeringParts {
  let normalized = value.trim().replace(/ohms?|Ω/gi, "").trim();
  if (unit && unit !== "Ω") normalized = normalized.replace(new RegExp(`${escapeRegExp(unit)}$`, "i"), "").trim();
  const match = normalized.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)([a-zA-Zµμ]*)$/);
  if (!match) return { mantissa: normalized, prefix: "" };
  const prefix = prefixFromSuffix(match[2]);
  // Not representable in the dropdown (e.g. "1mil"): keep the raw text intact
  // rather than silently dropping the suffix and changing the value.
  if (prefix === null) return { mantissa: normalized, prefix: "" };
  return { mantissa: match[1], prefix };
}

export const isEngineeringMantissa = (value: string) => MANTISSA_RE.test(value.trim()) && Number.isFinite(Number(value));

/**
 * True while `value` can still become a valid engineering mantissa by typing
 * more characters. This deliberately accepts edit-in-progress states such as
 * `-`, `1e`, and `1e-`, but rejects alphabetic text immediately.
 */
export function isEngineeringMantissaDraft(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "+" || trimmed === "-") return true;
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d*)?$/i.test(trimmed);
}

/**
 * Keep an unfocused long value legible without changing its represented
 * magnitude. Nine significant digits fit comfortably in the inspector while
 * retaining far more precision than a component's normal tolerance.
 */
export function compactEngineeringMantissa(value: string, maxCharacters = 12): string {
  const trimmed = value.trim();
  if (!isEngineeringMantissa(trimmed) || trimmed.length < maxCharacters) return trimmed;
  const [coefficient, exponent] = Number(trimmed).toExponential(8).split("e");
  const compactCoefficient = coefficient.replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
  return `${compactCoefficient}e${Number(exponent)}`;
}

export const composeEngineeringValue = (mantissa: string, prefix: EngineeringPrefix) => `${mantissa.trim()}${prefix}`;

/** Plain decimals inside this band read fine as written; outside it they stop
 *  being countable at a glance and want a prefix. */
const PLAIN_DECIMAL_FLOOR = 1e-3;
const PLAIN_DECIMAL_CEILING = 1e3;

/**
 * Re-spell a raw value in engineering notation, for DISPLAY only.
 *
 * The inspector shows a value the way it is stored, which is right almost
 * always and wrong at the extremes: a resistance saved as `1000` read "1000 Ω"
 * where the reference standard - and every datasheet - says `1 kΩ`, and a
 * geometry saved as `0.000003` was a digit-counting exercise instead of `3 µm`.
 *
 * Three rules keep this from being a value rewriter wearing a formatter's coat:
 *
 * - **A prefix the author chose is never overruled.** `50n` stays `50n`, even
 *   though `0.05µ` is the same number: they picked the decade they think in.
 * - **A plain decimal from 1m to 1k is left alone.** `0.25` is not improved by
 *   becoming `250m`, and rewriting it would fight the person typing.
 * - **The result must parse back to the same number.** Built on
 *   `formatEngineering`, whose whole job is significant digits, so the loop
 *   asks it for the fewest digits that round-trip and gives up rather than
 *   return a spelling that moved the value. A formatter that quietly rounds a
 *   component value is a lie about what the deck will run. "Same" is to within
 *   a few ulps, not bit-identical: `200 * 1e-9` and `2e-7` are one ulp apart in
 *   IEEE754 and are the same number, while any actual rounding is off by ~1e-3
 *   relative - twelve orders of magnitude outside this window.
 *
 * Returns the SPICE spelling (`3µ`), not a display string: the caller feeds it
 * back through {@link splitEngineeringValue} into the mantissa + prefix picker,
 * so `Meg` matters and a space would not survive.
 */
export function engineeringSpelling(value: string, unit = ""): string {
  const text = value.trim();
  if (!text) return value;
  // An explicit suffix means the author picked the decade. Bare digits (with an
  // optional exponent) are the only thing this re-spells.
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) return value;
  let numeric: number;
  try {
    numeric = parseQuantity(text, unit);
  } catch {
    return value;
  }
  if (!Number.isFinite(numeric) || numeric === 0) return value;
  const magnitude = Math.abs(numeric);
  if (magnitude >= PLAIN_DECIMAL_FLOOR && magnitude < PLAIN_DECIMAL_CEILING) return value;
  const tolerance = magnitude * 4 * Number.EPSILON;
  for (let digits = 1; digits <= 15; digits += 1) {
    const candidate = formatEngineering(numeric, "", digits).replace(/\s+/g, "");
    try {
      if (Math.abs(parseQuantity(candidate) - numeric) <= tolerance) return candidate;
    } catch {
      return value;
    }
  }
  return value;
}
