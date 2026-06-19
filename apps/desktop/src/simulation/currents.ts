import type { AnalysisResult } from "./linearTransient";
import { parseQuantity } from "./quantity";

type OkResult = Extract<AnalysisResult, { ok: true }>;

/** Build netId -> voltage samples; ground and untraced nets read as 0 V. */
function tracesById(result: OkResult): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const t of result.traces) m.set(t.id, t.values);
  return m;
}

function netVoltage(traces: Map<string, number[]>, netId: string | undefined, i: number): number {
  if (!netId || netId === "0") return 0;
  const v = traces.get(netId);
  return v ? v[i] ?? 0 : 0;
}

/**
 * Signed current through each two-terminal R/C at sample `i`, in the component's
 * "a" -> "b" convention (positive = conventional current from pin a to pin b).
 *
 * We derive these directly from node voltages: I_R = (Va - Vb) / R and
 * I_C = C dV/dt. Branches we can't get from node voltages alone (sources,
 * inductors, active devices) are omitted here; the canvas attributes wire flow
 * from the adjacent R/C pin, which carries the same series current in practice.
 */
export function componentCurrents(result: OkResult, i: number): Map<string, number> {
  const traces = tracesById(result);
  const dt = result.stats.stepSize || 1;
  const out = new Map<string, number>();

  for (const { component, pins } of result.circuit.components) {
    if (component.kind === "resistor") {
      let r: number;
      try {
        r = parseQuantity(component.value, "Ω");
      } catch {
        continue;
      }
      if (!(r > 0)) continue;
      const va = netVoltage(traces, pins.a, i);
      const vb = netVoltage(traces, pins.b, i);
      out.set(component.id, (va - vb) / r);
    } else if (component.kind === "capacitor") {
      let c: number;
      try {
        c = parseQuantity(component.value, "F");
      } catch {
        continue;
      }
      if (!(c > 0) || i === 0) {
        out.set(component.id, 0);
        continue;
      }
      const now = netVoltage(traces, pins.a, i) - netVoltage(traces, pins.b, i);
      const prev = netVoltage(traces, pins.a, i - 1) - netVoltage(traces, pins.b, i - 1);
      out.set(component.id, (c * (now - prev)) / dt);
    }
  }
  return out;
}

/** Largest |current| over the run (sampled), used to normalize animation speed. */
export function peakCurrent(result: OkResult): number {
  let peak = 0;
  const stride = Math.max(1, Math.floor(result.times.length / 60));
  for (let i = 0; i < result.times.length; i += stride) {
    for (const v of componentCurrents(result, i).values()) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  return peak;
}
