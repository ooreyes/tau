const PREFIXES: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "µ": 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  meg: 1e6,
  Meg: 1e6,
  MEG: 1e6,
  g: 1e9,
  G: 1e9,
  t: 1e12,
  T: 1e12,
};

export function parseQuantity(input: string, fallbackUnit = ""): number {
  const normalized = input
    .trim()
    .replace(/ohms?|Ω/gi, "")
    .replace(new RegExp(`${fallbackUnit}$`, "i"), "")
    .trim();
  // Accept an LTspice-style trailing decimal point ("10." = 10) as well as a
  // leading one (".5"): the integer/fraction parts are independently optional.
  const match = normalized.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-zA-Zµ]*)$/i);
  if (!match) throw new Error(`Could not parse value "${input}".`);

  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`Could not parse value "${input}".`);

  const suffix = match[2];
  if (!suffix) return value;
  const exactPrefix = PREFIXES[suffix];
  if (exactPrefix !== undefined) return value * exactPrefix;

  const firstPrefix = PREFIXES[suffix[0]];
  if (firstPrefix !== undefined) return value * firstPrefix;

  throw new Error(`Unknown value suffix "${suffix}" in "${input}".`);
}

export function formatEngineering(value: number, unit = "", digits = 3): string {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return `0 ${unit}`.trim();
  const safeDigits = Math.max(1, Math.min(100, Math.trunc(digits)));

  const prefixes = [
    { scale: 1e12, suffix: "T" },
    { scale: 1e9, suffix: "G" },
    { scale: 1e6, suffix: "M" },
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
