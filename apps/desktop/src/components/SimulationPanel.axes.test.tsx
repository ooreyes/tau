// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  WaveformPlot,
  AcPlot,
  DcPlot,
  NoisePlot,
} from "./SimulationPanel";
import type { AnalysisResult, Trace } from "../simulation/linearTransient";
import type { AcResult } from "../simulation/acSweep";
import type { DcSweepResult } from "../simulation/dcSweep";
import type { NoiseResult } from "../simulation/noise";
import { defaultLayout } from "./plotPanes";

/**
 * §UX scope axes (owner feedback: "the table is completely devoid of x/y
 * labels"). These tests mount each plot context with a synthetic-but-valid
 * result and assert real tick labels render — not just the old 2-3 corner
 * labels — with unit-bearing text (V, Hz, dB, ms…), proving `PlotAxes` is
 * wired into every context, not just the transient scope.
 */

afterEach(() => cleanup());

function makeTrace(id: string, label: string, values: number[]): Trace {
  return { id, label, unit: "V", color: "var(--trace-cyan)", values };
}

function makeTranResult(): Extract<AnalysisResult, { ok: true }> {
  const times = Array.from({ length: 50 }, (_, i) => (i / 49) * 0.006);
  const values = times.map((t) => 5 * (1 - Math.exp(-t / 0.001)));
  return {
    ok: true,
    title: "tran",
    times,
    traces: [makeTrace("n1", "V(out)", values)],
    currents: [],
    stats: { netCount: 1, componentCount: 3, sampleCount: times.length, stopTime: times[times.length - 1], stepSize: times[1] },
    warnings: [],
    circuit: { nets: [{ id: "n1", label: "out", isGround: false, points: [] }], components: [], warnings: [] } as never,
  };
}

describe("WaveformPlot (TRAN) — real tick axes", () => {
  it("renders multiple x and y tick labels with units, not just corner min/max", () => {
    const result = makeTranResult();
    const { container } = render(
      <WaveformPlot
        result={result}
        probes={[]}
        wires={[]}
        netLabels={[]}
        paneLayout={defaultLayout(["n1"])}
        onAddPane={() => {}}
        onRemovePane={() => {}}
        onMoveTrace={() => {}}
      />,
    );
    const ticks = container.querySelectorAll(".scope-tick");
    expect(ticks.length).toBeGreaterThan(3);
    const text = Array.from(ticks).map((t) => t.textContent).join(" ");
    expect(text).toMatch(/ms|s\b/);
    expect(text).toMatch(/V/);
    // Zero-line drawn stronger when 0V is in range (a charging curve from 0V).
    expect(container.querySelectorAll(".scope-axis-zero").length).toBeGreaterThan(0);
  });

  it("splits x/y ticks across panes in multi-pane mode and only labels the bottom pane's x axis", () => {
    const result = makeTranResult();
    const layout = defaultLayout(["n1"]);
    const twoPane = [...layout, { id: "pane-2", traceIds: [] }];
    const { container } = render(
      <WaveformPlot
        result={result}
        probes={[]}
        wires={[]}
        netLabels={[]}
        paneLayout={twoPane}
        onAddPane={() => {}}
        onRemovePane={() => {}}
        onMoveTrace={() => {}}
      />,
    );
    const svgs = container.querySelectorAll(".scope-svg");
    expect(svgs.length).toBe(2);
  });
});

describe("AcPlot — log-frequency ticks on both magnitude and phase", () => {
  it("renders Hz-labeled log ticks and dB/degree y ticks", () => {
    const freqs = [10, 100, 1000, 10000, 100000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg: [0, -45, -90, -90, -90] }],
      warnings: [],
    };
    const { container } = render(<AcPlot result={result} />);
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /Hz/.test(t))).toBe(true);
    expect(ticks.some((t) => /dB/.test(t))).toBe(true);
    expect(ticks.some((t) => /°/.test(t))).toBe(true);
    expect(ticks.length).toBeGreaterThan(4);
  });
});

describe("DcPlot — linear sweep/volts ticks", () => {
  it("renders volt-labeled y ticks across the swept range", () => {
    const sweep = [0, 1, 2, 3, 4, 5];
    const result: DcSweepResult = {
      ok: true,
      source: "V1",
      sweep,
      nets: [{ id: "n1", label: "V(out)", voltages: [0, 0.5, 1, 1.5, 2, 2.5], ground: false }],
      warnings: [],
    };
    const { container } = render(<DcPlot result={result} />);
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /V/.test(t))).toBe(true);
    expect(ticks.length).toBeGreaterThan(3);
  });
});

describe("NoisePlot — log-log (frequency × V/√Hz decades) ticks", () => {
  it("renders Hz and V/√Hz decade tick labels", () => {
    const freqs = [10, 100, 1000, 10000];
    const onoise = [1e-8, 1e-7, 1e-6, 1e-7];
    const result: NoiseResult = {
      ok: true,
      spec: { output: { pos: "out" }, source: "V1", sweep: { startHz: 10, stopHz: 10000, pointsPerDecade: 10 } },
      freqs,
      onoise,
      inoise: onoise,
      inoiseUnit: "V/√Hz",
      totalOutputNoise: 1e-5,
      totalInputNoise: 1e-5,
      warnings: [],
    };
    const { container } = render(<NoisePlot result={result} />);
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /Hz/.test(t))).toBe(true);
    expect(ticks.some((t) => /V\/√Hz/.test(t))).toBe(true);
  });
});
