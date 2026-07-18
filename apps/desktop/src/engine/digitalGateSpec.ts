import { parseQuantity } from "../simulation/quantity";

/**
 * LTspice idealized digital A-devices (`Digital\*.asy`), modelled behaviorally.
 *
 * LTspice's A-device pin contract (verified against the installed 17.2.4
 * `lib/sym/Digital` library): SpiceOrder 1-5 are inputs, 6 is the COMPLEMENTARY
 * output `_Q`, 7 is the true output `Q`, 8 is the `com` reference. There is no
 * INV function — `inv.asy` is a BUF exposing only the complementary output pin,
 * and `schmtinv.asy` is a SCHMITT likewise. So the function set reduces to
 * {buf, and, or, xor, schmitt}, and inversion falls out of *which output pin*
 * a line drives. Floating inputs are ignored (LTspice semantics).
 *
 * Emission is a B-source per connected output using ngspice's ternary — the
 * same live-verified idiom as engine/comparatorSpec.ts. Boolean `&&`/`||`,
 * `==`, and `abs()` in B expressions are all live-verified in ngspice-46.
 * The flip-flop (DFLOP) is stateful and cannot be a B-source; it emits an
 * XSPICE d_dff between explicit adc/dac bridges (also live-verified — the
 * AUTO bridge's default thresholds sit above LTspice's 0..1 V logic levels,
 * so explicit bridges at Vt/Vlow/Vhigh are required, not optional).
 */
export type DigitalGateFn = "buf" | "and" | "or" | "xor" | "schmitt";

export interface DigitalGateSpec {
  fn: DigitalGateFn;
  /** Output level for logic true (LTspice default 1 V). */
  vhigh: number;
  /** Output level for logic false (LTspice default 0 V). */
  vlow: number;
  /** Input threshold. Defaults to the midpoint of vhigh/vlow. */
  vt: number;
  /** Schmitt hysteresis half-width around vt (trip points vt±vhys). */
  vhys: number;
  /** Propagation delay (seconds). Carried for the d_dff; B-gates ignore it. */
  td: number;
}

/** LTspice symbol leaf → gate function + whether the single output is `_Q`. */
const FN_ALIASES: Record<string, { fn: DigitalGateFn }> = {
  buf: { fn: "buf" },
  buf1: { fn: "buf" },
  inv: { fn: "buf" },
  and: { fn: "and" },
  or: { fn: "or" },
  xor: { fn: "xor" },
  schmitt: { fn: "schmitt" },
  schmtbuf: { fn: "schmitt" },
  schmtinv: { fn: "schmitt" },
};

const KEY_ALIASES: Record<string, keyof Omit<DigitalGateSpec, "fn">> = {
  vhigh: "vhigh",
  vlow: "vlow",
  vt: "vt",
  vhys: "vhys",
  td: "td",
};

/**
 * Parse a digital gate's value string: a leading function token (`and`, `inv`,
 * `schmtbuf`, …) followed by optional LTspice A-device `key=value` params
 * (`Vhigh=5 Vlow=0 Vt=2.5 Vhys=0.5 Td=10n`, case-insensitive, SI suffixes).
 * Unknown tokens are ignored so a partial spec still yields a usable gate.
 * Defaults are LTspice's: vhigh=1, vlow=0, vt=midpoint, vhys=0.
 */
export function parseDigitalGate(value: string): DigitalGateSpec {
  const tokens = (value ?? "").trim().split(/[\s,]+/).filter(Boolean);
  let fn: DigitalGateFn = "buf";
  let vhigh = 1;
  let vlow = 0;
  let vt: number | null = null;
  let vhys = 0;
  let td = 0;

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = KEY_ALIASES[token.slice(0, eq).toLowerCase()];
      if (!key) continue;
      const parsed = tryQuantity(token.slice(eq + 1));
      if (parsed === null) continue;
      if (key === "vhigh") vhigh = parsed;
      else if (key === "vlow") vlow = parsed;
      else if (key === "vt") vt = parsed;
      else if (key === "vhys") vhys = parsed;
      else td = parsed;
      continue;
    }
    const alias = FN_ALIASES[token.toLowerCase()];
    if (alias) fn = alias.fn;
  }

  return {
    fn,
    vhigh,
    vlow,
    vt: vt ?? (vhigh + vlow) / 2,
    vhys: Math.abs(vhys),
    td: Math.abs(td),
  };
}

/** Node assignments for a gate instance. Only *connected* pins are present —
 *  imported symbols carry pin overrides for exactly the pins the `.asy` has,
 *  and LTspice ignores floating gate inputs. `com` is the input/output voltage
 *  reference; omit it (or pass "0") when grounded. */
export interface DigitalGateNodes {
  ins: string[];
  q?: string;
  qbar?: string;
  com?: string;
}

/**
 * Build the B-source deck lines for a combinational/Schmitt gate. One line per
 * connected output: `q` gets `cond ? vhigh : vlow`, `qbar` the swap. All input
 * comparisons and both outputs are referenced to `com` when present.
 *
 * The Schmitt trigger uses the self-referential output-state idiom from
 * comparatorSpec (live-verified): the trip point is vt+vhys when the output is
 * low and vt−vhys when high. Its state is read back from whichever output
 * exists (q preferred; from qbar the sense inverts).
 */
export function digitalGateDeckLines(
  base: string,
  nodes: DigitalGateNodes,
  spec: DigitalGateSpec,
): string[] {
  const { fn, vhigh, vlow, vt, vhys } = spec;
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  const vin = (n: string) => (com ? `V(${n},${com})` : `V(${n})`);
  const term = (n: string, threshold: number) => `(${vin(n)}>${threshold})`;
  const ins = nodes.ins;

  let cond: string;
  if (ins.length === 0) {
    cond = "0"; // all inputs floating → logic false (ternary picks vlow)
  } else if (fn === "and") {
    cond = ins.map((n) => term(n, vt)).join("&&");
  } else if (fn === "or") {
    cond = ins.map((n) => term(n, vt)).join("||");
  } else if (fn === "xor") {
    // LTspice XOR is "exactly one input true" (equals classic XOR at 2 inputs).
    cond = `(${ins.map((n) => term(n, vt)).join("+")})==1`;
  } else if (fn === "schmitt" && vhys > 0) {
    // State is read from an output: high state ⇔ V(q) above the level midpoint
    // (or V(qbar) below it). With neither output connected the gate drives
    // nothing, so cond is irrelevant — fall through to the ideal threshold.
    const mid = (vhigh + vlow) / 2;
    const state = nodes.q
      ? `V(${nodes.q})>${mid}`
      : nodes.qbar
        ? `V(${nodes.qbar})<${mid}`
        : null;
    cond = state
      ? `(${state}) ? ${term(ins[0], vt - vhys)} : ${term(ins[0], vt + vhys)}`
      : term(ins[0], vt);
  } else {
    cond = term(ins[0], vt); // buf / ideal schmitt
  }

  // cond must be parenthesized: the Schmitt cond is itself a ternary, and
  // ternary right-associativity would otherwise swallow `? hi : lo` into its
  // false branch (wrong output level whenever vhigh/vlow aren't 1/0).
  const out = (hi: number, lo: number) =>
    com
      ? `V=((${cond}) ? ${hi} : ${lo})+V(${com})`
      : `V=(${cond}) ? ${hi} : ${lo}`;

  const lines: string[] = [];
  if (nodes.q) lines.push(`B_${base}_Q ${nodes.q} 0 ${out(vhigh, vlow)}`);
  if (nodes.qbar) lines.push(`B_${base}_QB ${nodes.qbar} 0 ${out(vlow, vhigh)}`);
  return lines;
}

/** Node assignments for a DFLOP instance (pins per LTspice `dflop.asy`). */
export interface DflopNodes {
  d?: string;
  clk?: string;
  pre?: string;
  clr?: string;
  q?: string;
  qbar?: string;
}

/**
 * Build the XSPICE deck lines for an LTspice DFLOP: an adc_bridge (thresholds
 * at vt) into a d_dff, back out through a dac_bridge (levels vlow/vhigh).
 * Unconnected D/CLK/PRE/CLR tie to analog ground = digital 0 (inactive; d_dff
 * set/reset are active-high). Unconnected outputs land on private nodes.
 * LTspice's TD= maps onto the d_dff's clk/set/reset delays (min 1 ns so the
 * event queue always advances).
 */
export function dflopDeckLines(base: string, nodes: DflopNodes, spec: DigitalGateSpec): string[] {
  const { vhigh, vlow, vt, td } = spec;
  const b = base.toLowerCase();
  const a = (n: string | undefined) => n ?? "0";
  // A non-zero ADC transition band prevents event/analog feedback from
  // chattering at exactly Vt when one DFF output drives the next D input.
  // Keep it tiny (0.1% of the logic swing) so it is numerical hysteresis, not
  // an observable change to the user's logic threshold.
  const bridgeBand = Math.max(Math.abs(vhigh - vlow) * 1e-3, 1e-9);
  const inLow = Number((vt - bridgeBand).toPrecision(12));
  const inHigh = Number((vt + bridgeBand).toPrecision(12));
  // Round away float noise from SI-suffix parsing (100n → 1.0000…001e-7).
  const delay = Number(Math.max(td, 1e-9).toPrecision(12));
  // libngspice's ngSpice_Circ parser resolves XSPICE models in one pass. A
  // forward reference accepted by the CLI batch parser fails in the embedded
  // API with "unable to find definition of model", so every model card must
  // precede the A-device that consumes it.
  return [
    `.model ${b}_adc adc_bridge(in_low=${inLow} in_high=${inHigh})`,
    `A_${b}_adc [${a(nodes.d)} ${a(nodes.clk)} ${a(nodes.pre)} ${a(nodes.clr)}] [${b}_dd ${b}_dclk ${b}_dpre ${b}_dclr] ${b}_adc`,
    `.model ${b}_dff d_dff(ic=0 clk_delay=${delay} set_delay=${delay} reset_delay=${delay} rise_delay=1e-9 fall_delay=1e-9)`,
    `A_${b} ${b}_dd ${b}_dclk ${b}_dpre ${b}_dclr ${b}_dq ${b}_dnq ${b}_dff`,
    // A zero-time DAC edge into even a small capacitive analog load can drive
    // ngspice into a vanishing-timestep loop when several DFFs toggle together.
    // A 10 ns analog edge remains negligible for the intended logic timescale,
    // while giving the transient solver enough room to cross a capacitive load
    // without collapsing below its minimum timestep.
    `.model ${b}_dac dac_bridge(out_low=${vlow} out_high=${vhigh} t_rise=1e-8 t_fall=1e-8)`,
    `A_${b}_dac [${b}_dq ${b}_dnq] [${nodes.q ?? `${b}_qnc`} ${nodes.qbar ?? `${b}_qbnc`}] ${b}_dac`,
  ];
}

function tryQuantity(text: string): number | null {
  try {
    return parseQuantity(text);
  } catch {
    return null;
  }
}
