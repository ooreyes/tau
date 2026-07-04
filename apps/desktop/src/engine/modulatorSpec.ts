import { parseQuantity } from "../simulation/quantity";

/**
 * LTspice `SpecialFunctions\modulate` (A-device MODULATOR): a behavioral VCO.
 * The output is a unit sine whose instantaneous frequency is linear in the FM
 * input voltage — `space` Hz at 0 V, `mark` Hz at 1 V — scaled by the AM input
 * voltage (amplitude defaults to 1 V when AM is unwired).
 *
 * Emission is an XSPICE `sine` controlled oscillator (`cntl_array=[0 1]
 * freq_array=[space mark]` is exactly LTspice's linear FM law, and the model
 * extrapolates linearly outside the pair) wrapped in B-source buffers for the
 * com reference and AM scaling. Live-verified in ngspice-46, including the
 * `space=0` entry PLL.asc uses (freq_array accepts 0).
 *
 * `modulate2` (separate SIN + COS outputs) is NOT mapped: XSPICE `sine` has no
 * phase control to derive the cosine output, and the symbol doesn't appear in
 * the acceptance corpus.
 */
export interface ModulatorSpec {
  /** Output frequency (Hz) when the FM input sits at 1 V. */
  mark: number;
  /** Output frequency (Hz) when the FM input sits at 0 V. */
  space: number;
}

/**
 * Parse a modulator value: `mark=<freq> space=<freq>` (case-insensitive, SI
 * suffixes, either order, unknown tokens ignored). Missing fields default to
 * mark=1K/space=0 — the corpus always sets both; the default just keeps a
 * bare native placement usable. Negative frequencies clamp to 0 (the XSPICE
 * oscillator rejects them).
 */
export function parseModulator(value: string): ModulatorSpec {
  let mark = 1000;
  let space = 0;
  for (const token of (value ?? "").trim().split(/[\s,]+/)) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const key = token.slice(0, eq).toLowerCase();
    if (key !== "mark" && key !== "space") continue;
    let parsed: number;
    try {
      parsed = parseQuantity(token.slice(eq + 1));
    } catch {
      continue;
    }
    if (key === "mark") mark = Math.max(0, parsed);
    else space = Math.max(0, parsed);
  }
  return { mark, space };
}

/** Node assignments for one modulator instance (absent pin = unwired). */
export interface ModulatorNodes {
  fm?: string;
  am?: string;
  out?: string;
  com?: string;
}

/**
 * Build the deck lines for one modulator. Internal nodes and the oscillator
 * model are namespaced by the lowercased instance base. Returns [] when the
 * output is unconnected (the device then drives nothing).
 *
 * The FM control is buffered through a B-source so an unwired FM pin (control
 * = 0 → space) and a com-referenced one emit uniformly — the XSPICE input
 * then always reads a well-defined driven node.
 */
export function modulatorDeckLines(
  base: string,
  nodes: ModulatorNodes,
  spec: ModulatorSpec,
): string[] {
  if (!nodes.out) return [];
  const b = base.toLowerCase();
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  const sense = (n: string) => (com ? `V(${n},${com})` : `V(${n})`);
  const fmExpr = nodes.fm ? sense(nodes.fm) : "0";
  const ampl = nodes.am ? `${sense(nodes.am)}*` : "";
  const outExpr = `V=${ampl}V(${b}_osc)` + (com ? `+V(${com})` : "");
  return [
    `B_${b}_fm ${b}_fm 0 V=${fmExpr}`,
    `A_${b} %v(${b}_fm) %v(${b}_osc) ${b}_vco`,
    `.model ${b}_vco sine(cntl_array=[0 1] freq_array=[${spec.space} ${spec.mark}] out_low=-1 out_high=1)`,
    `B_${b}_out ${nodes.out} 0 ${outExpr}`,
  ];
}
