import { describe, it, expect } from "vitest";
import { EXAMPLE_CIRCUITS } from "./circuits";
import { runTransientAnalysis } from "../simulation/linearTransient";

const OPTIONS = { stopTime: 0.005, steps: 200 };

describe("EXAMPLE_CIRCUITS", () => {
  for (const circuit of EXAMPLE_CIRCUITS) {
    describe(circuit.name, () => {
      it("simulates without error", () => {
        const result = runTransientAnalysis(
          { components: circuit.components, wires: circuit.wires },
          OPTIONS,
        );
        expect(
          result.ok,
          `Circuit "${circuit.name}" failed: ${result.ok ? "" : result.message}`,
        ).toBe(true);
      });

      it("has at least one trace with real variation", () => {
        const result = runTransientAnalysis(
          { components: circuit.components, wires: circuit.wires },
          OPTIONS,
        );

        // This guard should never fire given the test above, but keeps TS happy.
        if (!result.ok) throw new Error(`Circuit "${circuit.name}" failed: ${result.message}`);

        expect(result.traces.length).toBeGreaterThanOrEqual(1);

        if (circuit.id === "divider.v1") {
          // Voltage divider: the mid-node should settle at ~5 V (DC).
          // The circuit has two non-ground nodes (top rail at 10 V, mid at 5 V).
          // Assert that at least one trace has a final value near 5 V.
          const hasMidNode = result.traces.some((trace) => {
            const finalValue = trace.values[trace.values.length - 1];
            return finalValue > 4.5 && finalValue < 5.5;
          });
          expect(
            hasMidNode,
            `Voltage divider: no trace found near 5 V. Traces: ${result.traces
              .map((t) => `${t.label}=${t.values[t.values.length - 1].toFixed(3)} V`)
              .join(", ")}`,
          ).toBe(true);
        } else {
          // All dynamic circuits must have a trace that actually changes.
          const hasVariation = result.traces.some((trace) => {
            const max = Math.max(...trace.values);
            const min = Math.min(...trace.values);
            return max - min > 1e-6;
          });
          expect(
            hasVariation,
            `Circuit "${circuit.name}" traces show no variation (max - min ≤ 1e-6)`,
          ).toBe(true);
        }
      });
    });
  }
});
