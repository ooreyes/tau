import { terminalPair } from "./measurementModel";

export { terminalPair as orientedPowerPair };

/** Exact instantaneous power, with current defined positive entering V+. */
export function deriveLivePower(positive: ArrayLike<number>, negative: ArrayLike<number>, current: ArrayLike<number>): number[] {
  const count = Math.min(positive.length, negative.length, current.length);
  return Array.from({ length: count }, (_, index) => {
    const voltage = positive[index]! - negative[index]!;
    const amps = current[index]!;
    return Number.isFinite(voltage) && Number.isFinite(amps) ? voltage * amps : Number.NaN;
  });
}
