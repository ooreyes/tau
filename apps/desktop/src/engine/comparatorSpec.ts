import { parseQuantity } from "../simulation/quantity";

/**
 * A comparator's defined output levels (and optional hysteresis), parsed from a
 * component value string. Unlike an op-amp - whose ideal gain-1e6 model is only
 * valid inside a feedback loop - a comparator runs *open loop*, so its output
 * must clamp to explicit logic/rail levels instead of saturating to ~1e7 V.
 * (See LTspice parity .md : this is the class-d_starter.asc blocker.)
 */
export interface ComparatorSpec {
  /** Output voltage when V(in+) > V(in-). */
  vhigh: number;
  /** Output voltage when V(in+) < V(in-). */
  vlow: number;
  /**
   * Input hysteresis half-width (volts). 0 = ideal (threshold at in+ = in-).
   * When > 0 the switch threshold shifts ±vhyst depending on the current output
   * state, giving a Schmitt-trigger characteristic.
   */
  vhyst: number;
}

export const DEFAULT_COMPARATOR: ComparatorSpec = { vhigh: 1, vlow: 0, vhyst: 0 };

const KEY_ALIASES: Record<string, keyof ComparatorSpec> = {
  vhigh: "vhigh",
  vh: "vhigh",
  high: "vhigh",
  vlow: "vlow",
  vl: "vlow",
  low: "vlow",
  vhyst: "vhyst",
  hyst: "vhyst",
  vhys: "vhyst",
};

/**
 * Parse a comparator value string into explicit output levels. Accepts, in
 * order of precedence:
 *   - empty / "ideal" / "comparator" → defaults (high=1, low=0, no hysteresis)
 *   - key=value tokens: `Vhigh=5 Vlow=0 Vhyst=0.1` (case-insensitive, aliases vh/vl/hyst)
 *   - bare positional numbers: `5 0 0.1` → vhigh=5, vlow=0, vhyst=0.1
 * Tokens may be separated by whitespace, commas, or slashes. SI suffixes are
 * honored (`3.3`, `1m`). Any unparseable token is ignored so a partial spec
 * still yields a usable comparator rather than throwing on a stray word.
 */
export function parseComparator(value: string): ComparatorSpec {
  const spec: ComparatorSpec = { ...DEFAULT_COMPARATOR };
  const trimmed = (value ?? "").trim();
  if (!trimmed || /^(ideal|comparator|comp)$/i.test(trimmed)) return spec;

  const tokens = trimmed.split(/[\s,/]+/).filter(Boolean);
  const positional: number[] = [];
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = KEY_ALIASES[token.slice(0, eq).toLowerCase()];
      if (!key) continue;
      const parsed = tryQuantity(token.slice(eq + 1));
      if (parsed !== null) spec[key] = parsed;
      continue;
    }
    const parsed = tryQuantity(token);
    if (parsed !== null) positional.push(parsed);
  }

  // Fill any level NOT already set by an explicit key from the positional list,
  // in vhigh, vlow, vhyst order.
  const order: (keyof ComparatorSpec)[] = ["vhigh", "vlow", "vhyst"];
  let pi = 0;
  const explicitKeys = new Set(
    tokens
      .map((t) => (t.includes("=") ? KEY_ALIASES[t.slice(0, t.indexOf("=")).toLowerCase()] : undefined))
      .filter((k): k is keyof ComparatorSpec => Boolean(k)),
  );
  for (const key of order) {
    if (explicitKeys.has(key)) continue;
    if (pi < positional.length) spec[key] = positional[pi++];
  }

  spec.vhyst = Math.abs(spec.vhyst);
  return spec;
}

function tryQuantity(text: string): number | null {
  try {
    return parseQuantity(text);
  } catch {
    return null;
  }
}

/**
 * Build the ngspice behavioral-source deck line for a comparator. Emits a single
 * B-source on `out` referenced to ground, using ngspice's native ternary
 * (`cond ? a : b`) operator - LTspice's `if(cond,a,b)` is NOT accepted by
 * ngspice outside compatibility mode (live-verified: ngspice raises "no such
 * function 'if'"), whereas the ternary clamps correctly.
 *
 * Ideal (vhyst = 0): `B<name> out 0 V=(V(in+)-V(in-))>0 ? vhigh : vlow`.
 *
 * With hysteresis the threshold depends on the present output state, read back
 * from V(out) (the standard self-referential idiom): when already high the input
 * must fall below −vhyst to flip low; when already low it must rise above +vhyst
 * to flip high.
 */
export function comparatorDeckLine(
  name: string,
  outNode: string,
  inPlus: string,
  inMinus: string,
  spec: ComparatorSpec,
): string {
  const { vhigh, vlow, vhyst } = spec;
  const diff = `(V(${inPlus})-V(${inMinus}))`;
  if (vhyst <= 0) {
    return `${name} ${outNode} 0 V=${diff}>0 ? ${vhigh} : ${vlow}`;
  }
  const mid = (vhigh + vlow) / 2;
  // When V(out) is on the high side of mid we're in the "high" state.
  const whenHigh = `(${diff}>${-vhyst} ? ${vhigh} : ${vlow})`;
  const whenLow = `(${diff}>${vhyst} ? ${vhigh} : ${vlow})`;
  return `${name} ${outNode} 0 V=V(${outNode})>${mid} ? ${whenHigh} : ${whenLow}`;
}
