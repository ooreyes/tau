import type { DigitalGateSpec } from "./digitalGateSpec";
import { parseDigitalGate } from "./digitalGateSpec";
import {
  normalizeSevenSegmentPolarity,
  SEVEN_SEGMENT_SERIES_OHMS,
  type SevenSegmentPolarityInput,
} from "./sevenSegmentSpec";

/**
 * EveryCircuit-style integrated / converter blocks owned by Tau.
 *
 * Honest scope: behavioral teaching models (ripple counter, flash-ish ADC,
 * weighted DAC, segment loads, classic 555). Not Analog Devices / LTspice
 * vendor macromodels and not encrypted-library decryption.
 */

export interface CounterNodes {
  clk?: string;
  rst?: string;
  q0?: string;
  q1?: string;
  q2?: string;
  q3?: string;
  com?: string;
}

/**
 * 4-bit async binary ripple counter: four XSPICE `d_tff` with T tied high.
 * Stage 0 clocks from `clk`; each later stage clocks from the previous stage's
 * complementary dig output (rising NQ = falling Q) so the count advances on
 * the falling edges of Q0.. like a classic ripple chain. `rst` → async clear.
 */
export function counterDeckLines(
  base: string,
  nodes: CounterNodes,
  spec: DigitalGateSpec,
): string[] {
  const { vhigh, vlow, vt, td } = spec;
  const b = base.toLowerCase();
  const a = (n: string | undefined) => n ?? "0";
  const bridgeBand = Math.max(Math.abs(vhigh - vlow) * 1e-3, 1e-9);
  const inLow = Number((vt - bridgeBand).toPrecision(12));
  const inHigh = Number((vt + bridgeBand).toPrecision(12));
  const delay = Number(Math.max(td, 1e-9).toPrecision(12));
  // Analog "logic 1" for the shared T input (adc → dig).
  const oneNode = `${b}_tone`;
  const lines: string[] = [
    `B_${b}_tone ${oneNode} 0 V=${vhigh}`,
    `.model ${b}_adc adc_bridge(in_low=${inLow} in_high=${inHigh})`,
    // clk, rst, T=high, pad → dclk / drst / dt / dpre(0)
    `A_${b}_adc [${a(nodes.clk)} ${a(nodes.rst)} ${oneNode} 0] [${b}_dclk ${b}_drst ${b}_dt ${b}_dpre] ${b}_adc`,
    `.model ${b}_tff d_tff(ic=0 clk_delay=${delay} set_delay=${delay} reset_delay=${delay} rise_delay=1e-9 fall_delay=1e-9)`,
  ];
  for (let i = 0; i < 4; i += 1) {
    const clkDig = i === 0 ? `${b}_dclk` : `${b}_dnq${i - 1}`;
    lines.push(
      `A_${b}_${i} ${b}_dt ${clkDig} ${b}_dpre ${b}_drst ${b}_dq${i} ${b}_dnq${i} ${b}_tff`,
    );
  }
  const outs = [nodes.q0, nodes.q1, nodes.q2, nodes.q3].map(
    (n, i) => n ?? `${b}_q${i}nc`,
  );
  lines.push(
    `.model ${b}_dac dac_bridge(out_low=${vlow} out_high=${vhigh} t_rise=1e-8 t_fall=1e-8)`,
    `A_${b}_dac [${b}_dq0 ${b}_dq1 ${b}_dq2 ${b}_dq3] [${outs.join(" ")}] ${b}_dac`,
  );
  return lines;
}

export interface AdcNodes {
  vin?: string;
  vref?: string;
  d0?: string;
  d1?: string;
  d2?: string;
  d3?: string;
  com?: string;
}

/** Parse optional `bits=4 Vhigh=…` / digital-gate style tokens for ADC/DAC. */
export function parseConverterLevels(value: string): DigitalGateSpec {
  return parseDigitalGate(value);
}

/**
 * 4-bit successive-threshold quantizer (binary code).
 * MSB d3 trips at ½·Vref; each next bit uses the residual thresholds
 * ¼ / ⅛ / 1/16 · Vref so the nibble equals floor(Vin/Vref·16) for
 * Vin in [0, Vref]. Levels come from `spec.vhigh`/`vlow` (default 1/0).
 */
export function adcDeckLines(
  base: string,
  nodes: AdcNodes,
  spec: DigitalGateSpec,
): string[] {
  if (!nodes.vin || !nodes.vref) return [];
  const { vhigh, vlow } = spec;
  const b = base.toLowerCase();
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  const vin = com ? `V(${nodes.vin},${com})` : `V(${nodes.vin})`;
  const vref = com ? `V(${nodes.vref},${com})` : `V(${nodes.vref})`;
  // Guard tiny Vref so division in residual math stays numerically stable.
  const vr = `max((${vref}),1e-12)`;
  const mid = (vhigh + vlow) / 2;
  // Digitized bits read back from internal drive nodes (before series R).
  const bitHi = (tag: string) => `(V(${b}_${tag}d)>${mid})`;
  const lines: string[] = [];
  // Always emit all four internal bit drives so residual chain is defined even
  // when some digital outs are unconnected.
  const emitBit = (tag: string, cond: string, net: string | undefined) => {
    const drive = com
      ? `V=((${cond}) ? ${vhigh} : ${vlow})+V(${com})`
      : `V=(${cond}) ? ${vhigh} : ${vlow}`;
    lines.push(`B_${b}_${tag} ${b}_${tag}d 0 ${drive}`);
    if (net) lines.push(`R_${b}_${tag} ${b}_${tag}d ${net} 1`);
  };
  emitBit("d3", `(${vin})>(0.5)*(${vr})`, nodes.d3);
  emitBit(
    "d2",
    `(${vin})>((${bitHi("d3")}) ? 0.75 : 0.25)*(${vr})`,
    nodes.d2,
  );
  emitBit(
    "d1",
    `(${vin})>((${bitHi("d3")})*0.5+(${bitHi("d2")})*0.25+0.125)*(${vr})`,
    nodes.d1,
  );
  emitBit(
    "d0",
    `(${vin})>((${bitHi("d3")})*0.5+(${bitHi("d2")})*0.25+(${bitHi("d1")})*0.125+0.0625)*(${vr})`,
    nodes.d0,
  );
  return lines;
}

export interface DacNodes {
  d0?: string;
  d1?: string;
  d2?: string;
  d3?: string;
  vref?: string;
  out?: string;
  com?: string;
}

/**
 * 4-bit binary-weighted DAC: OUT = Vref · Σ (di / 2^(i+1)) with d0 = LSB.
 * Each di is logic-true when V(di,com) > Vt.
 */
export function dacDeckLines(
  base: string,
  nodes: DacNodes,
  spec: DigitalGateSpec,
): string[] {
  if (!nodes.out || !nodes.vref) return [];
  const { vt } = spec;
  const b = base.toLowerCase();
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  const vref = com ? `V(${nodes.vref},${com})` : `V(${nodes.vref})`;
  const dig = (n: string | undefined) => {
    if (!n) return "0";
    return com ? `(V(${n},${com})>${vt})` : `(V(${n})>${vt})`;
  };
  const weight =
    `((${dig(nodes.d0)})/2+(${dig(nodes.d1)})/4+(${dig(nodes.d2)})/8+(${dig(nodes.d3)})/16)`;
  const expr = com
    ? `V=(${vref})*(${weight})+V(${com})`
    : `V=(${vref})*(${weight})`;
  return [
    `B_${b}_out ${b}_od 0 ${expr}`,
    `R_${b}_out ${b}_od ${nodes.out} 1`,
  ];
}

export interface SevenSegNodes {
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  e?: string;
  f?: string;
  g?: string;
  dp?: string;
  com?: string;
  /** LED direction; bare `anode` and canonical forms share one parser. */
  polarity?: SevenSegmentPolarityInput;
}

/**
 * 7-segment display: each segment is a directional LED with a finite series
 * resistor, not a symmetric high-Z resistor. This keeps reverse drive dark
 * and gives ngspice a meaningful electrical load while retaining raw segment
 * pins (there is no hidden BCD decoder).
 */
export function sevenSegDeckLines(base: string, nodes: SevenSegNodes): string[] {
  const b = base.toLowerCase();
  const com = nodes.com ?? "0";
  const polarity = normalizeSevenSegmentPolarity(nodes.polarity);
  const model = "TAU_7SEG_LED";
  const seriesOhms = SEVEN_SEGMENT_SERIES_OHMS;
  const lines: string[] = [];
  const segs: Array<[string, string | undefined]> = [
    ["a", nodes.a],
    ["b", nodes.b],
    ["c", nodes.c],
    ["d", nodes.d],
    ["e", nodes.e],
    ["f", nodes.f],
    ["g", nodes.g],
    ["dp", nodes.dp],
  ];
  for (const [tag, net] of segs) {
    if (!net) continue;
    const ledNode = `${b}_${tag}_led`;
    const diodeAnode = polarity === "anode" ? com : net;
    const diodeCathode = ledNode;
    const resistorEnd = polarity === "anode" ? net : com;
    lines.push(
      `D_${b}_${tag} ${diodeAnode} ${diodeCathode} ${model}`,
      `R_${b}_${tag} ${ledNode} ${resistorEnd} ${seriesOhms}`,
    );
  }
  return lines;
}

/** NE555 pin order for `X… tau_555`. Missing pins float on private nodes. */
export interface Timer555Nodes {
  gnd?: string;
  trig?: string;
  out?: string;
  reset?: string;
  cont?: string;
  thres?: string;
  disch?: string;
  vcc?: string;
}

/** Emit `X… tau_555` with NE555 pin order. `name` is the resolved instance
 *  refdes (may already start with `X`). */
export function timer555InstanceLine(name: string, nodes: Timer555Nodes): string {
  const ref = /^x/i.test(name) ? name : `X${name}`;
  const b = ref.toLowerCase();
  const n = (key: keyof Timer555Nodes, i: number) => nodes[key] ?? `${b}_nc${i}`;
  return (
    `${ref} ${n("gnd", 1)} ${n("trig", 2)} ${n("out", 3)} ${n("reset", 4)} ` +
    `${n("cont", 5)} ${n("thres", 6)} ${n("disch", 7)} ${n("vcc", 8)} tau_555`
  );
}
