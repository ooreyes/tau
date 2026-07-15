/**
 * Opt-in live smoke test for the local MLX stack. It is skipped unless
 * TAU_LIVE_MLX=1 because it needs a running loopback server:
 *
 *   mlx_lm.server --model Qwen/Qwen3-4B-MLX-4bit --host 127.0.0.1 --port 8080
 *   TAU_LIVE_MLX=1 pnpm -C apps/desktop vitest run src/lib/localMlxAssistant.live.test.ts
 *
 * Unlike localMlxAssistant.test.ts (mocked transport), this proves the real
 * model emits a build_tau_circuit call that survives Tau's strict compiler.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../simulation/linearTransient";
import { runOperatingPoint } from "../simulation/operatingPoint";
import { EMPTY_SCOPE } from "../simulation/paramScope";
import { LocalMlxAssistant } from "./localMlxAssistant";

const live = process.env.TAU_LIVE_MLX === "1";

/** Minimal real-shaped transient result so the live model can exercise the
 *  read-only inspect_simulation_signal round-trip end to end. */
function dividerAnalysis(): AnalysisResult {
  return {
    ok: true,
    title: "Transient",
    times: [0, 0.001, 0.002, 0.003, 0.004],
    traces: [{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [0, 2.1, 3.1, 3.33, 3.33] }],
    currents: [],
    stats: { netCount: 2, componentCount: 3, sampleCount: 5, stopTime: 0.004, stepSize: 0.001 },
    warnings: [],
    circuit: { nets: [], components: [], groundNetId: "0", warnings: [] },
  };
}

describe.runIf(live)("localMlxAssistant (live server)", () => {
  it(
    "compiles a voltage divider request into one valid create action",
    { timeout: 240_000 },
    async () => {
      const assistant = new LocalMlxAssistant({ model: "qwen3-4b-4bit" });
      const reply = await assistant.complete({
        contextText: "The schematic is empty. No simulation has been run.",
        history: [{
          role: "user",
          content: "Make a voltage divider with a 5V DC input and resistor values of 1k and 2k. Include a .op analysis.",
        }],
        allowCurrentApply: false,
      });

      expect(reply.actions).toHaveLength(1);
      const action = reply.actions[0];
      expect(action.type).toBe("create_asc");
      expect(action.source).toMatch(/^Version 4/);

      const resistors = action.document.components.filter((c) => c.kind === "resistor");
      const sources = action.document.components.filter((c) => c.kind === "vsource");
      expect(resistors).toHaveLength(2);
      expect(sources).toHaveLength(1);
      const values = resistors.map((r) => r.value.toLowerCase().replace(/\s/g, ""));
      expect(values).toContain("1k");
      expect(values).toContain("2k");

      // The plan must not merely parse — it must simulate as a real divider.
      const op = runOperatingPoint({
        components: action.document.components,
        wires: action.document.wires,
        netLabels: action.document.netLabels,
        params: EMPTY_SCOPE,
      });
      expect(op.ok).toBe(true);
      if (!op.ok) return;
      const voltages = op.nets.map((net) => net.voltage);
      expect(voltages.some((v) => Math.abs(v - 5) < 1e-6)).toBe(true);
      expect(voltages.some((v) => Math.abs(v - 10 / 3) < 1e-3)).toBe(true);
    },
  );

  it(
    "answers a waveform question through the live inspect_simulation_signal round-trip",
    { timeout: 240_000 },
    async () => {
      const assistant = new LocalMlxAssistant({ model: "qwen3-4b-4bit" });
      const reply = await assistant.complete({
        contextText: "A voltage divider (V1 5V, R1 1k, R2 2k, output net out) was simulated with .tran 4m. "
          + "The waveform summary omits exact values; use the inspection tool for exact figures.",
        history: [{
          role: "user",
          content: "What exact final value does V(out) settle at in the transient result?",
        }],
        allowCurrentApply: false,
        operationContext: { analysis: dividerAnalysis(), params: EMPTY_SCOPE },
      });

      expect(reply.actions).toHaveLength(0);
      expect(reply.text).toMatch(/3\.3/);
    },
  );

  it(
    "asks a clarifying question instead of building from an underspecified request",
    { timeout: 240_000 },
    async () => {
      const assistant = new LocalMlxAssistant({ model: "qwen3-4b-4bit" });
      const reply = await assistant.complete({
        contextText: "The current circuit is empty. No simulation has been run.",
        history: [{ role: "user", content: "build me a voltage source" }],
        allowCurrentApply: false,
      });
      expect(reply.actions).toHaveLength(0);
      // A follow-up may be phrased imperatively ("Please specify …"), so
      // accept any request for missing details, not only literal questions.
      expect(reply.text).toMatch(/\?|specify|provide|clarify|what|which/i);
    },
  );
});
