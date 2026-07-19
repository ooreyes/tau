import { parseQuantity } from "../simulation/quantity";

/** Characteristic impedance + one-way delay of an ideal lossless line. */
export interface TlineSpec {
  /** Characteristic impedance Z0, ohms. */
  z0: number;
  /** One-way transmission delay TD, seconds. */
  td: number;
}

const DEFAULT_Z0 = 50;
const DEFAULT_TD = 1e-9;

/** parseQuantity throws on unparseable text; a malformed imported value should
 *  fall back to a default, not crash the whole deck build. */
function safeQuantity(text: string, unit: string): number {
  try {
    return parseQuantity(text, unit);
  } catch {
    return NaN;
  }
}

/**
 * Parse an LTspice ideal-lossless-transmission-line value into characteristic
 * impedance and one-way delay. LTspice writes the value as `Td=50n Z0=75`,
 * `Z0=150 Td=30n`, etc. - order-independent `key=value` tokens with SI
 * suffixes. Missing/invalid fields fall back to Z0 = 50 Ω, Td = 1 ns (the
 * ngspice lossless line requires both Z0 and a positive TD).
 */
export function parseTlineSpec(value: string): TlineSpec {
  const text = (value ?? "").trim();
  const z0Match = /\bz0\s*=\s*(\S+)/i.exec(text);
  // Accept LTspice's `Td=` and the SPICE-spelled `TD=`/`delay=`.
  const tdMatch = /\b(?:td|delay)\s*=\s*(\S+)/i.exec(text);
  const z0 = z0Match ? safeQuantity(z0Match[1], "Ohm") : DEFAULT_Z0;
  const td = tdMatch ? safeQuantity(tdMatch[1], "s") : DEFAULT_TD;
  return {
    z0: Number.isFinite(z0) && z0 > 0 ? z0 : DEFAULT_Z0,
    td: Number.isFinite(td) && td > 0 ? td : DEFAULT_TD,
  };
}

/** ngspice lossless-line params for the device line: `Z0=<ohm> TD=<s>`. */
export function tlineDeckParams(value: string): string {
  const { z0, td } = parseTlineSpec(value);
  return `Z0=${z0} TD=${td}`;
}
