import type { DigitalGateSpec } from "./digitalGateSpec";

/**
 * LTspice `SpecialFunctions\sample` (A-device SAMPLEHOLD), modelled as a real
 * behavioral track-and-hold: B-source buffers around ideal-switch + hold-cap
 * stages. Two operating modes, matching LTspice's documented semantics (and
 * the Educational/SampleAndHold.asc annotations):
 *
 *  - **S/H mode** (S/H pin wired): the output follows V(in+,in−) while S/H is
 *    above the logic threshold and holds the last value when it falls below.
 *    One switch+cap stage.
 *  - **CLK mode** (CLK pin wired): the input is latched at each RISING edge of
 *    CLK. Realized as a master–slave pair — stage 1 tracks while CLK is low,
 *    stage 2 tracks stage 1 while CLK is high — so the output is a clean
 *    staircase of edge samples. A one-shot window was rejected: the transient
 *    solver steps straight over a ~100 ns control pulse, whereas the
 *    master–slave stages only ever switch on (breakpoint-resolved) clock
 *    crossings. Live-verified against hand-computed sine samples to 4 digits.
 *
 * With BOTH control pins wired, S/H mode wins (documented limitation — the
 * corpus and LTspice's own example drive exactly one). With NEITHER wired the
 * device degrades to a unity-gain follower.
 *
 * The logic threshold is `spec.vt` (LTspice default 0.5 V), sensed relative to
 * `com` when wired; the output is likewise referenced to `com`. `vhigh`/`vlow`
 * don't shape the (analog) output and are ignored, as is `td`.
 */
export interface SampleHoldNodes {
  /** Non-inverting analog input (in+). */
  inp?: string;
  /** Inverting analog input (in−); the sampled quantity is V(in+) − V(in−). */
  inn?: string;
  /** Rising-edge sample clock. */
  clk?: string;
  /** Track-while-high / hold-while-low control. */
  sh?: string;
  out?: string;
  com?: string;
}

/** Hold capacitance (F). With RON = 1 Ω the track time-constant is 1 ns; with
 *  ROFF = 1e12 Ω the hold droop time-constant is 1000 s. */
const C_HOLD = "1n";
const SWITCH_MODEL = "sw(vt=0.5 vh=0.2 ron=1 roff=1e12)";

/**
 * Build the deck lines for one sample-and-hold instance. Internal nodes and
 * the switch model are namespaced by the lowercased instance base. Returns []
 * when the output pin is unconnected (the device then drives nothing).
 */
export function sampleHoldDeckLines(
  base: string,
  nodes: SampleHoldNodes,
  spec: DigitalGateSpec,
): string[] {
  if (!nodes.out) return [];
  const b = base.toLowerCase();
  const com = nodes.com && nodes.com !== "0" ? nodes.com : null;
  // Control pins are sensed relative to com (same convention as digitalGate).
  const ctl = (n: string) => (com ? `V(${n},${com})` : `V(${n})`);
  // Sampled quantity: V(in+) − V(in−), each term dropping out when unwired.
  const vin = nodes.inp
    ? nodes.inn
      ? `V(${nodes.inp},${nodes.inn})`
      : `V(${nodes.inp})`
    : nodes.inn
      ? `-V(${nodes.inn})`
      : "0";
  const outLine = (held: string) =>
    `B_${b}_out ${nodes.out} 0 ` + (com ? `V=${held}+V(${com})` : `V=${held}`);

  if (nodes.sh) {
    // Track-and-hold: one switch, closed while S/H is above threshold.
    return [
      `B_${b}_in ${b}_s 0 V=${vin}`,
      `B_${b}_ctl ${b}_ctl 0 V=(${ctl(nodes.sh)}>${spec.vt}) ? 1 : 0`,
      `S_${b} ${b}_s ${b}_h ${b}_ctl 0 ${b}_sw`,
      `.model ${b}_sw ${SWITCH_MODEL}`,
      `C_${b}_h ${b}_h 0 ${C_HOLD}`,
      outLine(`V(${b}_h)`),
    ];
  }

  if (nodes.clk) {
    // Edge sampler: master tracks while CLK low, slave tracks the (buffered)
    // master while CLK high — so the slave latches the input value present at
    // the rising edge. The mid buffer prevents charge-sharing between caps.
    return [
      `B_${b}_in ${b}_s 0 V=${vin}`,
      `B_${b}_c1 ${b}_c1 0 V=(${ctl(nodes.clk)}<${spec.vt}) ? 1 : 0`,
      `S_${b}_1 ${b}_s ${b}_h1 ${b}_c1 0 ${b}_sw`,
      `.model ${b}_sw ${SWITCH_MODEL}`,
      `C_${b}_1 ${b}_h1 0 ${C_HOLD}`,
      `B_${b}_m ${b}_m 0 V=V(${b}_h1)`,
      `B_${b}_c2 ${b}_c2 0 V=(${ctl(nodes.clk)}>${spec.vt}) ? 1 : 0`,
      `S_${b}_2 ${b}_m ${b}_h2 ${b}_c2 0 ${b}_sw`,
      `C_${b}_2 ${b}_h2 0 ${C_HOLD}`,
      outLine(`V(${b}_h2)`),
    ];
  }

  // No control pin wired: a unity-gain follower.
  return [outLine(vin)];
}
