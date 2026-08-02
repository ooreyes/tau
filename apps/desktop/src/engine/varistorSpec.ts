import { parseQuantity } from "../simulation/quantity";

export interface VaristorSpec {
  rclamp: number;
}

/** LTspice VARISTOR instance parameters. Rclamp defaults to 1 ohm. */
export function parseVaristor(value: string): VaristorSpec {
  let rclamp = 1;
  for (const token of value.trim().split(/[\s,]+/)) {
    const match = /^rclamp=(.+)$/i.exec(token);
    if (!match) continue;
    const parsed = parseQuantity(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("VARISTOR Rclamp must be a positive resistance.");
    }
    rclamp = parsed;
  }
  return { rclamp };
}

/**
 * LTspice's documented four-terminal voltage-controlled varistor: the
 * magnitude of V(control+,control-) is the symmetric breakdown voltage and
 * Rclamp is the slope resistance outside that window.
 */
export function varistorDeckLine(
  base: string,
  controlPositive: string,
  controlNegative: string,
  out: string,
  com: string,
  spec: VaristorSpec,
): string {
  const control = `abs(V(${controlPositive},${controlNegative}))`;
  const output = `V(${out},${com})`;
  return `B_${base}_VAR ${out} ${com} I=(${output}>${control}) ? (${output}-${control})/${spec.rclamp} : ((${output}<-${control}) ? (${output}+${control})/${spec.rclamp} : 0)`;
}
