/**
 * SPICE/LTspice numeric suffix semantics — the single value-parsing authority
 * for the engine, importers, and directive readers.
 *
 * Suffixes are CASE-INSENSITIVE, exactly like LTspice: `m` and `M` are BOTH
 * milli, and only `meg` (any case) is mega — the classic `1MHz` = 1 milli
 * gotcha is faithful behavior, not a bug. `mil` = 25.4 µ. Letters after a
 * recognized suffix are ignored as units (`1kHz` → 1e3, `100nF` → 100e-9).
 * Mirrors the expression engine's literal rules (simulation/expr.ts).
 *
 * The UI prefix dropdown (schematic/engineering.ts) stores `Meg` for mega so
 * inspector-authored values carry the same semantics as imported ones.
 */
const PREFIXES: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "µ": 1e-6, // U+00B5 micro sign
  "μ": 1e-6, // U+03BC greek small mu
  m: 1e-3,
  k: 1e3,
  g: 1e9,
  t: 1e12,
};

/** Resolve a value's alpha suffix to its multiplier (LTspice rules), or null
 *  when the leading letter isn't a known SI prefix. */
export function spiceSuffixMultiplier(suffix: string): number | null {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  // Longest known prefixes first so "meg" wins over "m", "mil" over "m".
  if (s.startsWith("meg")) return 1e6;
  if (s.startsWith("mil")) return 25.4e-6;
  return PREFIXES[s[0]] ?? null;
}

export function parseQuantity(input: string, fallbackUnit = ""): number {
  const normalized = input
    .trim()
    .replace(/ohms?|Ω/gi, "")
    .replace(new RegExp(`${fallbackUnit}$`, "i"), "")
    .trim();
  // Accept an LTspice-style trailing decimal point ("10." = 10) as well as a
  // leading one (".5"): the integer/fraction parts are independently optional.
  const match = normalized.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-zA-Zµμ]*)$/i);
  if (!match) throw new Error(`Could not parse value "${input}".`);

  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`Could not parse value "${input}".`);

  const multiplier = spiceSuffixMultiplier(match[2]);
  if (multiplier === null) throw new Error(`Unknown value suffix "${match[2]}" in "${input}".`);
  return value * multiplier;
}

export function formatEngineering(value: number, unit = "", digits = 3): string {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return `0 ${unit}`.trim();
  const safeDigits = Math.max(1, Math.min(100, Math.trunc(digits)));

  const prefixes = [
    { scale: 1e12, suffix: "T" },
    { scale: 1e9, suffix: "G" },
    // "Meg", not "M": a formatted value pasted into a value field or deck must
    // not read back as milli under SPICE suffix rules.
    { scale: 1e6, suffix: "Meg" },
    { scale: 1e3, suffix: "k" },
    { scale: 1, suffix: "" },
    { scale: 1e-3, suffix: "m" },
    { scale: 1e-6, suffix: "µ" },
    { scale: 1e-9, suffix: "n" },
    { scale: 1e-12, suffix: "p" },
    { scale: 1e-15, suffix: "f" },
  ];
  const abs = Math.abs(value);
  const prefix = prefixes.find((entry) => abs >= entry.scale) ?? prefixes[prefixes.length - 1];
  const scaled = value / prefix.scale;
  return `${Number(scaled.toPrecision(safeDigits))} ${prefix.suffix}${unit}`.trim();
}
