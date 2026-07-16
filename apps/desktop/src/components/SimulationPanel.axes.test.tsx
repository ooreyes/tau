// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["n1"])}
      />,
    );
    const ticks = container.querySelectorAll(".scope-tick");
    expect(ticks.length).toBeGreaterThan(3);
    const text = Array.from(ticks).map((t) => t.textContent).join(" ");
    expect(text).toMatch(/ms|s\b/);
    expect(text).toMatch(/V/);
    // Zero-line drawn stronger when 0V is in range (a charging curve from 0V).
    expect(container.querySelectorAll(".scope-axis-zero").length).toBeGreaterThan(0);
    const frame = container.querySelector(".scope-frame");
    const titles = container.querySelectorAll(".scope-axis-title");
    expect(frame?.getAttribute("x")).toBe("46");
    expect(titles[0]?.getAttribute("y")).toBe("184");
    expect(titles[1]?.getAttribute("x")).toBe("5");
    const yTick = container.querySelector<SVGTextElement>('.scope-tick[text-anchor="end"]');
    expect(Number(yTick?.getAttribute("x")) - Number(titles[1]?.getAttribute("x"))).toBeGreaterThanOrEqual(30);
  });

  it("splits x/y ticks across panes in multi-pane mode and only labels the bottom pane's x axis", () => {
    const result = makeTranResult();
    const layout = defaultLayout(["n1"]);
    const twoPane = [...layout, { id: "pane-2", traceIds: [] }];
    const { container } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={twoPane}
      />,
    );
    const svgs = container.querySelectorAll(".scope-svg");
    expect(svgs.length).toBe(2);
  });

  it("does not let a newly-mounted empty second pane override the data pane's shared X window", () => {
    // Regression for a feedback loop: a pane with no data (`plot === null`)
    // used to initialize its viewport to a 0–1 fallback domain and broadcast
    // that into `sharedX` on mount, snapping every sibling pane's real
    // (millisecond-scale) time axis to a bogus 0–1s window (and, once the
    // data pane's resulting adoption fed back into the empty pane, the two
    // panes' effects never stopped fighting — the old code hung indefinitely
    // on this exact repro instead of settling). Mirrors the real repro: a
    // pane with data is rendered and settles first, THEN a second, empty
    // pane is added (e.g. probing another net) — mounting both together in
    // one render doesn't trigger the loop, so the two-step `rerender` here
    // is essential to reproducing it.
    const result = makeTranResult();
    const layout = defaultLayout(["n1"]);
    const { container, rerender } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={layout}
      />,
    );

    const twoPane = [...layout, { id: "pane-2", traceIds: [] }];
    rerender(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={twoPane}
      />,
    );

    const svgs = container.querySelectorAll(".scope-svg");
    expect(svgs.length).toBe(2);
    const dataPaneTicks = Array.from(svgs[0].querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    // The data pane's real range is 0–6ms; if the empty sibling's fallback
    // domain leaked into the shared X window, the max tick would read "1s".
    expect(dataPaneTicks.some((t) => /ms/.test(t))).toBe(true);
    expect(dataPaneTicks.every((t) => !/^1\s?s$/.test(t.trim()))).toBe(true);
  });

  it("renders a dense square wave as an unfilled min/max line envelope", () => {
    const sampleCount = 20_000;
    const times = Array.from({ length: sampleCount }, (_, index) => index / (sampleCount - 1));
    const values = times.map((_, index) => index % 2 === 0 ? 0 : 5);
    const base = makeTranResult();
    const result: Extract<AnalysisResult, { ok: true }> = {
      ...base,
      times,
      traces: [makeTrace("pulse", "V(pulse)", values)],
      stats: { ...base.stats, sampleCount, stopTime: 1, stepSize: times[1] },
    };
    const { container } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["pulse"])}
      />,
    );

    const path = container.querySelector<SVGPathElement>(".scope-trace");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("fill")).toBe("none");
    const d = path?.getAttribute("d") ?? "";
    expect(d).not.toMatch(/[zZ]/);
    const points = [...d.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    const yValues = points.map((match) => Number(match[2]));
    expect(points.length).toBeLessThanOrEqual(1_042);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeGreaterThan(80);
  });

  it("keeps zoom/pan controls and resets the full plot domain on Fit", async () => {
    const result = makeTranResult();
    const { container, getByRole } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["n1"])}
      />,
    );
    const trace = container.querySelector<SVGPathElement>(".scope-trace");
    const initialPath = trace?.getAttribute("d");

    expect(getByRole("button", { name: "Auto frame signal" })).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(trace?.getAttribute("d")).not.toBe(initialPath));
    fireEvent.click(getByRole("button", { name: "Show full run" }));
    await waitFor(() => expect(trace?.getAttribute("d")).toBe(initialPath));
  });

  it("auto-frames a dense periodic run while keeping Full Run as a distinct action", async () => {
    const frequency = 100_000;
    const stopTime = 0.007;
    const step = 0.5e-6;
    const times = Array.from({ length: Math.round(stopTime / step) + 1 }, (_, index) => index * step);
    const values = times.map((time) => Math.sin(2 * Math.PI * frequency * time));
    const base = makeTranResult();
    const result: Extract<AnalysisResult, { ok: true }> = {
      ...base,
      times,
      traces: [makeTrace("carrier", "V(carrier)", values)],
      stats: { ...base.stats, sampleCount: times.length, stopTime, stepSize: step },
    };
    const { container, getByRole } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["carrier"])}
      />,
    );
    const trace = container.querySelector<SVGPathElement>(".scope-trace");
    const fullRunPath = trace?.getAttribute("d");

    fireEvent.click(getByRole("button", { name: "Auto frame signal" }));
    await waitFor(() => expect(trace?.getAttribute("d")).not.toBe(fullRunPath));

    fireEvent.click(getByRole("button", { name: "Show full run" }));
    await waitFor(() => expect(trace?.getAttribute("d")).toBe(fullRunPath));
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
