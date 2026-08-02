import { parseQuantity } from "../simulation/quantity";

export interface PhaseDetectorSpec {
  iout: number;
  vhigh: number;
  vlow: number;
  ref: number;
}

/** Parameters used by LTspice's type-3/4 PHASEDET charge-pump PFD. */
export function parsePhaseDetector(value: string): PhaseDetectorSpec {
  let iout = 10e-6;
  let vhigh = 1;
  let vlow = 0;
  let ref: number | null = null;
  for (const token of value.trim().split(/[\s,]+/)) {
    const match = /^(iout|vhigh|vlow|ref)=(.+)$/i.exec(token);
    if (!match) continue;
    const parsed = parseQuantity(match[2]);
    if (match[1].toLowerCase() === "iout") iout = Number(parsed.toPrecision(12));
    else if (match[1].toLowerCase() === "vhigh") vhigh = parsed;
    else if (match[1].toLowerCase() === "vlow") vlow = parsed;
    else ref = parsed;
  }
  if (!Number.isFinite(iout) || iout <= 0) throw new Error("PHASEDET Iout must be positive.");
  return { iout, vhigh, vlow, ref: ref ?? (vhigh + vlow) / 2 };
}

/**
 * Build a standard two-DFF phase/frequency detector and current-pump output.
 * Rising A sets UP, rising B sets DOWN, and both asserted resets the pair.
 */
export function phaseDetectorDeckLines(
  base: string,
  nodes: { a: string; b: string; q: string; com: string },
  spec: PhaseDetectorSpec,
): string[] {
  const b = base.toLowerCase();
  const band = Math.max(Math.abs(spec.vhigh - spec.vlow) * 1e-3, 1e-9);
  const inLow = Number((spec.ref - band).toPrecision(12));
  const inHigh = Number((spec.ref + band).toPrecision(12));
  return [
    `B_${base}_AIN ${b}_ain 0 V=V(${nodes.a},${nodes.com})`,
    `B_${base}_BIN ${b}_bin 0 V=V(${nodes.b},${nodes.com})`,
    `V_${base}_ONE ${b}_one 0 1`,
    `.model ${b}_adc adc_bridge(in_low=${inLow} in_high=${inHigh})`,
    `A_${b}_adc [${b}_ain ${b}_bin ${b}_one 0] [${b}_da ${b}_db ${b}_done ${b}_dzero] ${b}_adc`,
    `.model ${b}_dff d_dff(ic=0 clk_delay=1e-9 set_delay=1e-9 reset_delay=1e-9 rise_delay=1e-9 fall_delay=1e-9)`,
    `A_${b}_up ${b}_done ${b}_da ${b}_dzero ${b}_dreset ${b}_dup ${b}_dunq ${b}_dff`,
    `A_${b}_down ${b}_done ${b}_db ${b}_dzero ${b}_dreset ${b}_ddown ${b}_ddnq ${b}_dff`,
    `.model ${b}_and d_and(rise_delay=1e-9 fall_delay=1e-9)`,
    `A_${b}_and [${b}_dup ${b}_ddown] ${b}_dreset ${b}_and`,
    `.model ${b}_dac dac_bridge(out_low=0 out_high=1 t_rise=1e-9 t_fall=1e-9)`,
    `A_${b}_dac [${b}_dup ${b}_ddown] [${b}_aup ${b}_adown] ${b}_dac`,
    `B_${base}_PUMP ${nodes.q} ${nodes.com} I=${spec.iout}*(V(${b}_adown)-V(${b}_aup))`,
  ];
}
