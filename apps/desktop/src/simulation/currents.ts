import type { CurrentTrace } from "./linearTransient";
import type { ExtractedComponent } from "../schematic/netlist";
import { parseQuantity } from "./quantity";

/**
 * Derive resistor/capacitor branch-current waveforms from node-voltage traces,
 * for engine paths (native ngspice) that return node voltages but not every
 * device current. `I_R = (Va - Vb)/R`, `I_C = C dV/dt`, both in SPICE a→b sign
 * convention and keyed by ref-des so `.meas`/plot can resolve `I(R1)`/`I(C1)`.
 * Source/inductor currents are supplied separately by the caller (from the
 * ngspice `#branch` vectors), so they are not derived here.
 */
export function deriveRcCurrents(
  components: ReadonlyArray<ExtractedComponent>,
  nodeVoltages: Map<string, number[]>,
  times: ReadonlyArray<number>,
): CurrentTrace[] {
  const read = (netId: string | undefined, i: number): number => {
    if (!netId || netId === "0") return 0;
    const v = nodeVoltages.get(netId);
    return v ? v[i] ?? 0 : 0;
  };
  const out: CurrentTrace[] = [];
  for (const { component, pins } of components) {
    const ref = component.label;
    if (!ref) continue;
    if (component.kind === "resistor") {
      let r: number;
      try { r = parseQuantity(component.value, "Ω"); } catch { continue; }
      if (!(r > 0)) continue;
      const values = times.map((_, i) => (read(pins.a, i) - read(pins.b, i)) / r);
      out.push({ ref, label: `I(${ref})`, values });
    } else if (component.kind === "capacitor") {
      let c: number;
      try { c = parseQuantity(component.value, "F"); } catch { continue; }
      if (!(c > 0)) continue;
      const values = times.map((_, i) => {
        if (i === 0) return 0;
        const dt = times[i] - times[i - 1];
        if (!(dt > 0)) return 0;
        const now = read(pins.a, i) - read(pins.b, i);
        const prev = read(pins.a, i - 1) - read(pins.b, i - 1);
        return (c * (now - prev)) / dt;
      });
      out.push({ ref, label: `I(${ref})`, values });
    }
  }
  return out;
}
