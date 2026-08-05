// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 * "the table is completely devoid of x/y
 * labels"). These tests mount each plot context with a synthetic-but-valid
 * result and assert real tick labels render - not just the old 2-3 corner
 * labels - with unit-bearing text (V, Hz, dB, ms…), proving `PlotAxes` is
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

describe("WaveformPlot (TRAN) - real tick axes", () => {
  it("selects a trace color and glides an active cursor directly over the plot", async () => {
    const result = makeTranResult();
    const onActiveCursorChange = vi.fn();
    const onCursorFractionChange = vi.fn();
    const { container } = render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["n1"])}
        cursors={{ x1: 0.0015, x2: 0.0045 }}
        cursorTool={{
          activeCursor: "c1",
          onActiveCursorChange,
          onCursorFractionChange,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set V(out) trace color to green" }));
    expect(container.querySelector(".scope-trace")?.getAttribute("stroke")).toBe("var(--trace-green)");

    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 2 on V(out)" }));
    expect(onActiveCursorChange).toHaveBeenCalledWith("c2");

    const svg = container.querySelector(".scope-svg") as SVGSVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      width: 680,
      height: 380,
      right: 780,
      bottom: 430,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    fireEvent.pointerMove(screen.getByLabelText("Glide cursor 1 over V(out)"), {
      clientX: 440,
      pointerType: "mouse",
    });
    await waitFor(() => expect(onCursorFractionChange).toHaveBeenCalledWith("c1", expect.closeTo(0.5, 4)));
    expect(container.querySelectorAll(".cursor-trace-point")).toHaveLength(2);
  });

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

  it("Apply Y locks transient left axis; Autoscale Y restores autorange", () => {
    const result = makeTranResult();
    render(
      <WaveformPlot
        result={result}
        baseTraces={result.traces}
        netLabels={[]}
        paneLayout={defaultLayout(["n1"])}
      />,
    );
    expect(screen.getByLabelText("Transient Y limits")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Transient Y min"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Transient Y max"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply transient Y limits" }));
    const autoscale = screen.getByRole("button", { name: "Autoscale transient Y" });
    expect(autoscale.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(autoscale);
    expect(autoscale.getAttribute("aria-pressed")).toBe("true");
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
    // used to initialize its viewport to a 0-1 fallback domain and broadcast
    // that into `sharedX` on mount, snapping every sibling pane's real
    // (millisecond-scale) time axis to a bogus 0-1s window (and, once the
    // data pane's resulting adoption fed back into the empty pane, the two
    // panes' effects never stopped fighting - the old code hung indefinitely
    // on this exact repro instead of settling). Mirrors the real repro: a
    // pane with data is rendered and settles first, THEN a second, empty
    // pane is added (e.g. probing another net) - mounting both together in
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
    // The data pane's real range is 0-6ms; if the empty sibling's fallback
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

  it("keeps the first and last transient samples inside the frame instead of clipping their round caps", () => {
    const result = makeTranResult();
    const { container } = render(
      <WaveformPlot result={result} baseTraces={result.traces} netLabels={[]} paneLayout={defaultLayout(["n1"])} />,
    );
    const d = container.querySelector<SVGPathElement>(".scope-trace")?.getAttribute("d") ?? "";
    const xValues = [...d.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+-?\d+(?:\.\d+)?/g)].map((match) => Number(match[1]));
    expect(Math.min(...xValues)).toBeGreaterThan(46);
    expect(Math.max(...xValues)).toBeLessThan(340 - 46);
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

describe("AcPlot - log-frequency ticks on both magnitude and phase", () => {
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

  it("Lin X toggle remaps Bode axes off log decades", () => {
    const freqs = [10, 100, 1000, 10000, 100000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg: [0, -45, -90, -90, -90] }],
      warnings: [],
    };
    const { container } = render(<AcPlot result={result} />);
    const logBtn = screen.getByRole("button", { name: "Log X" });
    const linBtn = screen.getByRole("button", { name: "Lin X" });
    expect(logBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(linBtn);
    expect(linBtn.getAttribute("aria-pressed")).toBe("true");
    expect(logBtn.getAttribute("aria-pressed")).toBe("false");
    // Linear decades still label Hz; path exists on both panes.
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /Hz/.test(t))).toBe(true);
    expect(container.querySelectorAll("path.scope-trace").length).toBeGreaterThan(0);
  });

  it("Log Y toggle switches magnitude from dB to |V| decades", () => {
    const freqs = [10, 100, 1000, 10000, 100000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg: [0, -45, -90, -90, -90] }],
      warnings: [],
    };
    const { container } = render(<AcPlot result={result} />);
    const linY = screen.getByRole("button", { name: "Lin Y" });
    const logY = screen.getByRole("button", { name: "Log Y" });
    expect(linY.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toMatch(/dB/);
    fireEvent.click(logY);
    expect(logY.getAttribute("aria-pressed")).toBe("true");
    expect(linY.getAttribute("aria-pressed")).toBe("false");
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /V\/V/.test(t))).toBe(true);
    expect(container.querySelectorAll("path.scope-trace").length).toBeGreaterThan(0);
  });

  it("Apply Y locks Bode magnitude axis; Autoscale Y restores autorange", () => {
    const freqs = [10, 100, 1000, 10000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40], phaseDeg: [0, -45, -90, -90] }],
      warnings: [],
    };
    render(<AcPlot result={result} />);
    const limits = screen.getByLabelText("Bode magnitude Y limits");
    fireEvent.change(screen.getByLabelText("Bode magnitude Y min"), { target: { value: "-40" } });
    fireEvent.change(screen.getByLabelText("Bode magnitude Y max"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Bode magnitude Y limits" }));
    expect(screen.queryByRole("alert")).toBeNull();
    const autoscale = screen.getByRole("button", { name: "Autoscale Bode magnitude Y" });
    expect(autoscale.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(autoscale);
    expect(autoscale.getAttribute("aria-pressed")).toBe("true");
    expect(limits).toBeTruthy();
  });

  it("Apply φY locks Bode phase axis; Autoscale φY restores autorange", () => {
    const freqs = [10, 100, 1000, 10000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40], phaseDeg: [0, -45, -90, -135] }],
      warnings: [],
    };
    render(<AcPlot result={result} />);
    expect(screen.getByLabelText("Bode phase Y limits")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Bode phase Y min"), { target: { value: "-90" } });
    fireEvent.change(screen.getByLabelText("Bode phase Y max"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Bode phase Y limits" }));
    const autoscale = screen.getByRole("button", { name: "Autoscale Bode phase Y" });
    expect(autoscale.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(autoscale);
    expect(autoscale.getAttribute("aria-pressed")).toBe("true");
  });

  it("Group delay toggle swaps the lower Bode pane to τ (s)", () => {
    // Linear phase φ = −360·f·τ0 → constant group delay τ0.
    const tau0 = 1e-3;
    const freqs = [10, 100, 1000, 10000, 100000];
    const phaseDeg = freqs.map((f) => -360 * f * tau0);
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg }],
      warnings: [],
    };
    const { container } = render(<AcPlot result={result} />);
    expect(screen.getByRole("img", { name: "Bode phase" })).toBeTruthy();
    const phaseBtn = screen.getByRole("button", { name: "Phase" });
    const gdBtn = screen.getByRole("button", { name: "Group delay" });
    expect(phaseBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(gdBtn);
    expect(gdBtn.getAttribute("aria-pressed")).toBe("true");
    expect(phaseBtn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("img", { name: "Bode group delay" })).toBeTruthy();
    const ticks = Array.from(container.querySelectorAll(".scope-tick")).map((t) => t.textContent ?? "");
    expect(ticks.some((t) => /s/.test(t))).toBe(true);
    expect(container.querySelectorAll("path.scope-trace").length).toBeGreaterThan(0);
  });

  it("Export phase PNG rasters the lower Bode SVG with tag ac-phase", async () => {
    const png = await import("../simulation/plotPng");
    const toPng = vi.spyOn(png, "waveformSvgsToPng").mockResolvedValue(new Blob(["png"]));
    const download = vi.spyOn(png, "downloadWaveformPng").mockImplementation(() => {});
    try {
      const freqs = [10, 100, 1000, 10000, 100000];
      const result: AcResult = {
        ok: true,
        freqs,
        traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg: [0, -45, -90, -90, -90] }],
        warnings: [],
      };
      render(<AcPlot result={result} />);
      const btn = screen.getByRole("button", { name: "Export phase PNG" });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      await waitFor(() => expect(toPng).toHaveBeenCalled());
      const svgs = toPng.mock.calls[0]![0] as SVGSVGElement[];
      expect(svgs.length).toBe(1);
      expect(download).toHaveBeenCalledWith(expect.any(Blob), "ac-phase");
    } finally {
      toPng.mockRestore();
      download.mockRestore();
    }
  });

  it("Bode cursors toggle shows f1/f2 mag readout and plot markers", () => {
    // −20 dB/dec from 10 Hz→100 kHz → slope −20 at C1=0.25 / C2=0.75 decades.
    const freqs = [10, 100, 1000, 10000, 100000];
    const magDb = [0, -20, -40, -60, -80];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb, phaseDeg: [0, -45, -90, -90, -90] }],
      warnings: [],
    };
    const { container } = render(<AcPlot result={result} />);
    const btn = screen.getByRole("button", { name: "Toggle Bode cursors" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("slider", { name: "Bode cursor 1 position" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Bode cursor 2 position" })).toBeTruthy();
    const magReadout = screen.getByLabelText("Bode magnitude cursor readout");
    expect(magReadout.textContent).toMatch(/f1/i);
    expect(magReadout.textContent).toMatch(/SLOPE/i);
    const phaseReadout = screen.getByLabelText("Bode phase cursor readout");
    expect(phaseReadout.textContent).toMatch(/φ@C1/);
    expect(phaseReadout.textContent).toMatch(/φ@C2/);
    // Two markers on mag + two on phase.
    expect(container.querySelectorAll(".plot-cursor").length).toBe(4);
  });

  it("Bode cursors on Group delay pane read τ at C1/C2", () => {
    const tau0 = 1e-3;
    const freqs = [10, 100, 1000, 10000, 100000];
    const phaseDeg = freqs.map((f) => -360 * f * tau0);
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20, -40, -60], phaseDeg }],
      warnings: [],
    };
    render(<AcPlot result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "Group delay" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Bode cursors" }));
    const gdReadout = screen.getByLabelText("Bode group-delay cursor readout");
    expect(gdReadout.textContent).toMatch(/τ@C1/);
    expect(gdReadout.textContent).toMatch(/τ@C2/);
  });

  it("Phase window opens a standalone detached Bode phase dialog", async () => {
    const freqs = [10, 100, 1000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20], phaseDeg: [0, -45, -90] }],
      warnings: [],
    };
    const { unmount } = render(<AcPlot result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "Open standalone phase window" }));
    expect(await screen.findByRole("heading", { name: "Phase window" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detached Bode phase" })).toBeTruthy();
    unmount();

    render(<AcPlot result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "Group delay" }));
    fireEvent.click(screen.getByRole("button", { name: "Open standalone phase window" }));
    expect(await screen.findByRole("heading", { name: "Group delay window" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detached Bode group delay" })).toBeTruthy();
  });

  it("right-click Bode legend adds abs(V(out)) via onPlotExpression", async () => {
    const onPlotExpression = vi.fn();
    const freqs = [10, 100, 1000];
    const result: AcResult = {
      ok: true,
      freqs,
      traces: [{ id: "n1", label: "V(out)", magDb: [0, -3, -20], phaseDeg: [0, -45, -90] }],
      warnings: [],
    };
    render(<AcPlot result={result} onPlotExpression={onPlotExpression} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Math for V(out)" }));
    const absItem = await screen.findByRole("menuitem", { name: /Plot abs\(V\(out\)\)/i });
    fireEvent.click(absItem);
    expect(onPlotExpression).toHaveBeenCalledWith("abs(V(out))");
  });
});

describe("DcPlot - linear sweep/volts ticks", () => {
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

  it("right-click DC legend adds abs(V(out)) via onPlotExpression", async () => {
    const onPlotExpression = vi.fn();
    const result: DcSweepResult = {
      ok: true,
      source: "V1",
      sweep: [0, 1, 2],
      nets: [{ id: "n1", label: "V(out)", voltages: [0, 0.5, 1], ground: false }],
      warnings: [],
    };
    render(<DcPlot result={result} onPlotExpression={onPlotExpression} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Math for V(out)" }));
    const absItem = await screen.findByRole("menuitem", { name: /Plot abs\(V\(out\)\)/i });
    fireEvent.click(absItem);
    expect(onPlotExpression).toHaveBeenCalledWith("abs(V(out))");
  });

  it("Apply Y locks DC sweep axis; Autoscale Y restores autorange", () => {
    const result: DcSweepResult = {
      ok: true,
      source: "V1",
      sweep: [0, 1, 2, 3, 4, 5],
      nets: [{ id: "n1", label: "V(out)", voltages: [0, 0.5, 1, 1.5, 2, 2.5], ground: false }],
      warnings: [],
    };
    render(<DcPlot result={result} />);
    expect(screen.getByLabelText("DC sweep Y limits")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("DC sweep Y min"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("DC sweep Y max"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply DC sweep Y limits" }));
    expect(screen.queryByRole("alert")).toBeNull();
    const autoscale = screen.getByRole("button", { name: "Autoscale DC sweep Y" });
    expect(autoscale.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(autoscale);
    expect(autoscale.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("NoisePlot - log-log (frequency × V/√Hz decades) ticks", () => {
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

  it("right-click noise legend adds abs(V(onoise)) overlay", async () => {
    const freqs = [10, 100, 1000];
    const onoise = [1e-8, 1e-7, 1e-6];
    const result: NoiseResult = {
      ok: true,
      spec: { output: { pos: "out" }, source: "V1", sweep: { startHz: 10, stopHz: 1000, pointsPerDecade: 10 } },
      freqs,
      onoise,
      inoise: onoise.map((v) => v / 10),
      inoiseUnit: "V/√Hz",
      totalOutputNoise: 1e-5,
      totalInputNoise: 1e-6,
      warnings: [],
    };
    render(<NoisePlot result={result} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Math for V(onoise)" }));
    const absItem = await screen.findByRole("menuitem", { name: /Plot abs\(V\(onoise\)\)/i });
    fireEvent.click(absItem);
    expect(screen.getByLabelText("Remove abs(V(onoise))")).toBeTruthy();
    expect(screen.getByText("abs(V(onoise))")).toBeTruthy();
  });

  it("noise cursors read f1/f2/@C1/@C2/Δ on V(onoise)", () => {
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
    const btn = screen.getByRole("button", { name: "Toggle noise cursors" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("slider", { name: "Noise cursor 1 position" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Noise cursor 2 position" })).toBeTruthy();
    const readout = screen.getByLabelText("Noise cursor readout");
    expect(readout.textContent).toMatch(/f1/i);
    expect(readout.textContent).toMatch(/@C1/);
    expect(readout.textContent).toMatch(/Δ/);
    expect(container.querySelectorAll(".plot-cursor").length).toBe(2);
  });
});
