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
