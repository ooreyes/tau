import { parseQuantity } from "../simulation/quantity";

/**
 * The 4-element (Butterworth–Van Dyke) quartz-crystal model LTspice writes on
 * its `Misc\xtal` symbol: a motional series branch (Lser–Cser–Rser) in parallel
 * with the electrode/case capacitance Cpar.
 *
 *   SYMATTR Value      <Cser>                       (motional capacitance, F)
 *   SYMATTR SpiceLine  Rser=<Ω> Lser=<H> Cpar=<F>   (ESR, motional L, shunt C)
 *
 * ngspice's plain `C` device can't carry these params, so on import the crystal
 * lands as a `capacitor` whose value is the whole `Cser Rser=.. Lser=.. Cpar=..`
 * string; {@link parseCrystal} recognises that string and the deck builder
 * expands it into the real motional branch (see `crystalDeckLines`).
 */
export interface CrystalSpec {
  /** Motional (series) capacitance, F — the symbol's primary Value. */
  cser: number;
  /** Motional inductance, H. */
  lser: number;
  /** Equivalent series resistance (ESR), Ω. */
  rser: number;
  /** Parallel electrode/case capacitance, F. */
  cpar: number;
}

/**
 * Parse an LTspice crystal value string. Returns `null` for a plain capacitor
 * (no `Lser` token), so only genuine crystals get expanded — an
 * ordinary C keeps its single-line emission. A crystal with a malformed/absent
 * numeric field falls back to physically inert defaults (Rser 0, Cpar 0) rather
 * than throwing, matching the placeholder-tolerant spirit of import.
 */
export function parseCrystal(value: string): CrystalSpec | null {
  const text = value.trim();
  if (text === "") return null;
  // Crystal signature: a motional inductance. Ordinary capacitors can also
  // carry Cpar/Rser vendor parasitics, so neither is sufficient on its own.
  if (!/\blser\s*=/i.test(text)) return null;

  const tokens = text.split(/\s+/);
  // The leading bareword (no `=`) is Cser, the motional capacitance.
  const cser = tokens[0] && !tokens[0].includes("=") ? finite(tokens[0], "F") : NaN;
  const key = (name: string, unit: string): number => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(\\S+)`, "i").exec(text);
    return m ? finite(m[1], unit) : NaN;
  };
  const lser = key("Lser", "H");
  const rser = key("Rser", "Ohm");
  const cpar = key("Cpar", "F");

  return {
    cser: Number.isFinite(cser) && cser > 0 ? cser : 1e-12,
    lser: Number.isFinite(lser) && lser > 0 ? lser : 1e-3,
    rser: Number.isFinite(rser) && rser >= 0 ? rser : 0,
    cpar: Number.isFinite(cpar) && cpar >= 0 ? cpar : 0,
  };
}

function finite(token: string, unit: string): number {
  try {
    const v = parseQuantity(token, unit);
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Expand a crystal into its motional branch plus shunt capacitance across the
 * two terminals `a`/`b`. Internal nodes are namespaced by the instance name so
 * two crystals never collide. Rser=0 collapses the resistor (a series 0 Ω is a
 * legal wire but we skip it to keep the deck tight); Cpar=0 drops the shunt.
 *
 *   L<base>  a       <base>_m  Lser
 *   C<base>  <base>_m <base>_r  Cser        (or a→<base>_r when Rser=0)
 *   R<base>  <base>_r b        Rser
 *   C<base>p a        b        Cpar
 */
export function crystalDeckLines(name: string, a: string, b: string, spec: CrystalSpec): string[] {
  const base = name;
  const mid = `${base}_m`;
  const lines: string[] = [`L${base} ${a} ${mid} ${spec.lser}`];
  if (spec.rser > 0) {
    const rNode = `${base}_r`;
    lines.push(`C${base} ${mid} ${rNode} ${spec.cser}`);
    lines.push(`R${base} ${rNode} ${b} ${spec.rser}`);
  } else {
    lines.push(`C${base} ${mid} ${b} ${spec.cser}`);
  }
  if (spec.cpar > 0) lines.push(`C${base}p ${a} ${b} ${spec.cpar}`);
  return lines;
}
