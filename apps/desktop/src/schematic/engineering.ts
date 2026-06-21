/** SI prefixes exposed by the component inspector. `m` and `M` deliberately
 * stay distinct: SPICE uses lowercase milli and uppercase mega. */
export const ENGINEERING_PREFIXES = [
  { value: "f", label: "f" },
  { value: "p", label: "p" },
  { value: "n", label: "n" },
  { value: "u", label: "µ" },
  { value: "m", label: "m" },
  { value: "", label: "" },
  { value: "k", label: "k" },
  { value: "M", label: "M" },
  { value: "G", label: "G" },
  { value: "T", label: "T" },
] as const;

export type EngineeringPrefix = (typeof ENGINEERING_PREFIXES)[number]["value"];

export interface EngineeringParts {
  mantissa: string;
  prefix: EngineeringPrefix;
}

const MANTISSA_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;
const PREFIX_ALIASES: Record<string, EngineeringPrefix> = {
  "": "",
  f: "f",
  p: "p",
  n: "n",
  u: "u",
  "µ": "u",
  m: "m",
  k: "k",
  K: "k",
  M: "M",
  meg: "M",
  Meg: "M",
  MEG: "M",
  g: "G",
  G: "G",
  t: "T",
  T: "T",
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Break a stored SPICE-like value into the numeric part and a selectable prefix. */
export function splitEngineeringValue(value: string, unit = ""): EngineeringParts {
  let normalized = value.trim().replace(/ohms?|Ω/gi, "").trim();
  if (unit && unit !== "Ω") normalized = normalized.replace(new RegExp(`${escapeRegExp(unit)}$`, "i"), "").trim();
  const match = normalized.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)([a-zA-Zµ]*)$/);
  if (!match) return { mantissa: normalized, prefix: "" };
  return { mantissa: match[1], prefix: PREFIX_ALIASES[match[2]] ?? "" };
}

export const isEngineeringMantissa = (value: string) => MANTISSA_RE.test(value.trim()) && Number.isFinite(Number(value));

export const composeEngineeringValue = (mantissa: string, prefix: EngineeringPrefix) => `${mantissa.trim()}${prefix}`;
