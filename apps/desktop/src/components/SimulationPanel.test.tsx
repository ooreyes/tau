// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SimulationPanel, StepPlot, WaveformPlot } from "./SimulationPanel";
import { visibleTransientTraces } from "../simulation/visibleTraces";
import {
  defaultDcSetup,
  defaultNoiseSetup,
  defaultStepSetupUi,
  defaultTfSetup,
} from "../simulation/analysisSetup";
import { useSchematic } from "../store/useSchematic";
import { formatEngineering } from "../simulation/quantity";
import { defaultLayout } from "./plotPanes";

/**
 * the simulator tab must NOT carry its own primary Run button;
 * the single primary Run lives in the top toolbar. In-panel, selecting an
 * analysis tab IS the run gesture (all seven tabs, TRAN included).
 */

afterEach(() => cleanup());

beforeEach(() => {
  useSchematic.setState({
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    tool: { mode: "select" },
    probes: [],
    netLabels: [],
    directives: [],
    past: [],
    future: [],
  });
});

function renderPanel(overrides: Partial<Parameters<typeof SimulationPanel>[0]> = {}) {
  const handlers = {
    onRun: vi.fn(),
    onRunOperatingPoint: vi.fn(),
    onRunAcSweep: vi.fn(),
    onRunDcSweep: vi.fn(),
    onRunTf: vi.fn(),
    onRunNoise: vi.fn(),
    onRunStep: vi.fn(),
    onStop: vi.fn(),
    onClose: vi.fn(),
    onOptionsChange: vi.fn(),
    onDcSetupChange: vi.fn(),
    onTfSetupChange: vi.fn(),
    onNoiseSetupChange: vi.fn(),
    onStepSetupUiChange: vi.fn(),
  };
  render(
    <SimulationPanel
      result={null}
      opResult={null}
      acResult={null}
      dcResult={null}
      tfResult={null}
      noiseResult={null}
      stepResult={null}
      acStepFamily={null}
      dcStepFamily={null}
      measurements={[]}
      fourier={[]}
      acMeasurements={[]}
      dcMeasurements={[]}
      noiseMeasurements={[]}
      options={{ stopTime: 0.006, steps: 240 }}
      isRunning={false}
      runProgress={null}
      dcSetup={defaultDcSetup([])}
      tfSetup={defaultTfSetup([])}
      noiseSetup={defaultNoiseSetup([])}
      stepSetupUi={defaultStepSetupUi([])}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

// First render of the full panel is slow when the suite collects in parallel
// under load - the 5s default flakes; these are render-once assertions.
describe("SimulationPanel - no redundant Run button", { timeout: 20_000 }, () => {
  it("opens on the analysis authored by the circuit without firing a second run", () => {
    const handlers = renderPanel({ circuitTitle: "filter.asc", preferredMode: "ac" });
    expect(screen.getByRole("tab", { name: "AC sweep (.ac)" }).getAttribute("aria-selected")).toBe("true");
    expect(handlers.onRunAcSweep).not.toHaveBeenCalled();
  });

  it("renders no Run button in the transient pane, only the status strip", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /run transient/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^run/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize graphs" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Idle");
  });

  it("shows Running in the status strip while a simulation is in flight", () => {
    renderPanel({ isRunning: true });
    expect(screen.getByRole("status").textContent).toContain("Running");
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });

  it("treats TRAN tab selection as the run gesture, like every other tab", () => {
    const handlers = renderPanel();
    // Radix TabsTrigger activates on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    expect(handlers.onRunOperatingPoint).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Transient analysis (.tran)" }), { button: 0 });
    expect(handlers.onRun).toHaveBeenCalledTimes(1);
  });

  it("preserves the last result while moving between analysis modes", () => {
    const okResult = {
      ok: true,
      title: "Transient",
      times: [0, 0.003, 0.006],
      traces: [],
      currents: [],
      stats: { netCount: 4, componentCount: 6, sampleCount: 241, stopTime: 0.006, stepSize: 0.000025 },
      warnings: [],
      circuit: {} as never,
    } as import("../simulation/linearTransient").AnalysisResult;
    renderPanel({ result: okResult });

    expect(screen.getByRole("status").textContent).toContain("241 samples");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    expect(screen.getByRole("status").textContent).toContain("No analysis yet");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Transient analysis (.tran)" }), { button: 0 });
    expect(screen.getByRole("status").textContent).toContain("241 samples");
  });

  it("uses explicit waveform-detail choices instead of an opaque refine action", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.queryByRole("button", { name: "Refine transient resolution" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use precision waveform detail" }));
    expect(handlers.onOptionsChange).toHaveBeenLastCalledWith({ stopTime: 0.006, steps: 480 });
  });
});

describe("SimulationPanel - dashboard status strip", { timeout: 20_000 }, () => {
  const okResult = {
    ok: true,
    title: "Transient",
    times: [0, 0.003, 0.006],
    traces: [],
    currents: [],
    stats: { netCount: 4, componentCount: 6, sampleCount: 241, stopTime: 0.006, stepSize: 0.000025 },
    warnings: [],
    circuit: {} as never,
  } as import("../simulation/linearTransient").AnalysisResult;

  it("shows Complete with last-run figures after a successful transient", () => {
    renderPanel({ result: okResult });
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("Complete");
    expect(strip.textContent).toContain("6 ms");
    expect(strip.textContent).toContain("241 samples");
    expect(strip.textContent).toContain("4 nets");
    expect(strip.textContent).toContain("6 parts");
    expect(strip.classList.contains("plotter-status--complete")).toBe(true);
  });

  it("goes to the danger Error state and surfaces the failure message inline", () => {
    const failed = {
      ok: false,
      title: "Transient",
      message: "singular matrix at t=0",
      details: "stderr: singular matrix at node n001",
      warnings: [],
    } as import("../simulation/linearTransient").AnalysisResult;
    renderPanel({ result: failed });
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("Error");
    expect(strip.textContent).toContain("details below");
    expect(strip.classList.contains("plotter-status--error")).toBe(true);
    // The pointer must not dangle: the failed run's own message renders in
    // the scope area (the footer that used to carry it is gone).
    expect(screen.getByRole("alert").textContent).toContain("singular matrix at t=0");
    expect(screen.getByText("Technical details").closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText(/stderr: singular matrix/)).toBeTruthy();
  });

  it("stays Idle with a pointer at the toolbar Run before anything has run", () => {
    renderPanel();
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("Idle");
    expect(strip.textContent).toContain("press Run");
    expect(strip.classList.contains("plotter-status--idle")).toBe(true);
  });

  it("uses success semantics for the operating-point ground check", () => {
    renderPanel({ opResult: { ok: true, nets: [{ id: "0", label: "0", voltage: 0 }], warnings: [] } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });

    expect(screen.getByText("GROUND").closest(".metric")?.classList.contains("green")).toBe(true);
    expect(screen.getByText("GROUND").closest(".metric")?.classList.contains("cyan")).toBe(false);
  });
});

// The `.op` table drew node voltages only and never touched `result.branches`,
// so even the TS solver's own source/inductor currents had never reached this
// table on either engine - a value computed by both engines but never
// rendered. These assert on the visible DC CURRENT text itself, not just on
// data being present, so a regression that stops rendering it (but keeps
// computing it) is still caught.
describe("SimulationPanel - OpTable DC CURRENT table", { timeout: 20_000 }, () => {
  it("renders a branch's label and formatted current in a DC CURRENT table", () => {
    renderPanel({
      opResult: {
        ok: true,
        nets: [{ id: "0", label: "GND", voltage: 0 }, { id: "n001", label: "V(N001)", voltage: 5 }],
        branches: [{ id: "q1", label: "I(Q1)", current: 0.0055 }],
        warnings: [],
      },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });

    expect(screen.getByText("DC CURRENT")).toBeTruthy();
    expect(screen.getByText("I(Q1)")).toBeTruthy();
    expect(screen.getByText(formatEngineering(0.0055, "A", 3))).toBeTruthy();
  });

  it("renders a row per terminal for a part that reports more than one", () => {
    // A BJT's three currents share one component id, so the table used to key
    // every row by `branch.id` alone. All three must be visible with their own
    // values - the emitter's sign in particular, since it is the entry that
    // would have displaced the collector under a lookup keyed by part.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderPanel({
        opResult: {
          ok: true,
          nets: [{ id: "0", label: "GND", voltage: 0 }, { id: "n001", label: "V(N001)", voltage: 5 }],
          branches: [
            { id: "q1", label: "I(Q1)", current: 0.00095 },
            { id: "q1", label: "Ib(Q1)", current: 0.0000095, terminal: "b" },
            { id: "q1", label: "Ie(Q1)", current: -0.0009595, terminal: "e" },
          ],
          warnings: [],
        },
      });
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });

      expect(screen.getByText("I(Q1)")).toBeTruthy();
      expect(screen.getByText("Ib(Q1)")).toBeTruthy();
      expect(screen.getByText("Ie(Q1)")).toBeTruthy();
      expect(screen.getByText(formatEngineering(0.00095, "A", 3))).toBeTruthy();
      expect(screen.getByText(formatEngineering(0.0000095, "A", 3))).toBeTruthy();
      expect(screen.getByText(formatEngineering(-0.0009595, "A", 3))).toBeTruthy();

      // React renders duplicate keys today and only warns, so the three rows
      // above appear either way - this is what actually holds the row key to
      // one per rendered row. React calls the behaviour unsupported and liable
      // to change, which is the regression being kept out.
      const duplicateKey = errors.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((text) => text.includes("same key"));
      expect(duplicateKey).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("renders no DC CURRENT header when the operating-point result has no branches", () => {
    renderPanel({
      opResult: {
        ok: true,
        nets: [{ id: "0", label: "GND", voltage: 0 }, { id: "n001", label: "V(N001)", voltage: 5 }],
        warnings: [],
      },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });

    expect(screen.queryByText("DC CURRENT")).toBeNull();
  });

  it("renders native device bias parameters and the derived operating region", () => {
    renderPanel({
      opResult: {
        ok: true,
        nets: [{ id: "0", label: "GND", voltage: 0 }],
        devices: [{
          id: "q1",
          label: "Q1",
          region: "forward-active",
          parameters: [
            { name: "VBE", value: 0.7, unit: "V" },
            { name: "GM", value: 0.002, unit: "S" },
          ],
        }],
        warnings: [],
      },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });

    expect(screen.getByLabelText("Device operating points")).toBeTruthy();
    expect(screen.getByText("Q1 · REGION")).toBeTruthy();
    expect(screen.getByText("forward-active")).toBeTruthy();
    expect(screen.getByText("Q1 · VBE")).toBeTruthy();
    expect(screen.getByText("Q1 · GM")).toBeTruthy();
    expect(screen.getByText(formatEngineering(0.002, "S", 4))).toBeTruthy();
  });
});

describe("SimulationPanel - component telemetry moved to the always-visible dock", { timeout: 20_000 }, () => {
  // Per-component V/I/P now lives in App.tsx's TelemetryDock (see
  // TelemetryDock.test.tsx), rendered beside the read-only schematic instead
  // of tucked inside this panel's Advanced disclosure. This is a regression
  // guard: the Advanced ▸ Component telemetry group must stay gone.
  it("no longer renders a component measurements group anywhere in the panel", () => {
    renderPanel({
      result: {
        ok: true,
        title: "Transient",
        times: [0, 1, 2],
        traces: [{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [4, 2, 0] }],
        currents: [{ ref: "R1", label: "I(R1)", values: [2, 1, 0] }],
        stats: { netCount: 2, componentCount: 2, sampleCount: 3, stopTime: 2, stepSize: 1 },
        warnings: [],
        circuit: {
          groundNetId: "gnd",
          warnings: [],
          nets: [
            { id: "out", points: [], pins: [], isGround: false, labelCount: 1 },
            { id: "gnd", points: [], pins: [], isGround: true, labelCount: 0 },
          ],
          components: [
            {
              component: { id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "2", label: "R1" },
              pins: { a: "out", b: "gnd" },
            },
          ],
        },
      } as import("../simulation/linearTransient").AnalysisResult,
    });
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.queryByRole("heading", { name: "Component measurements" })).toBeNull();
    expect(screen.queryByText("Component telemetry")).toBeNull();
  });
});

describe("SimulationPanel - TRAN snap-tiling dashboard grid", { timeout: 20_000 }, () => {
  // Two probed nets so `visibleTransientTraces` (store-driven - SimulationPanel
  // reads probes/wires/netLabels from useSchematic, not props) resolves two
  // plot panes automatically, the scenario the grid's "2+ panes -> half
  // width" default is meant for.
  const twoTraces = [
    { id: "n1", label: "V(n1)", unit: "V" as const, color: "var(--trace-cyan)", values: [0, 1, 2] },
    { id: "n2", label: "V(n2)", unit: "V" as const, color: "var(--trace-green)", values: [2, 1, 0] },
  ];
  const twoNets = [
    { id: "n1", points: [{ x: 0, y: 0 }], pins: [], isGround: false, labelCount: 0 },
    { id: "n2", points: [{ x: 100, y: 0 }], pins: [], isGround: false, labelCount: 0 },
  ];
  const makeResult = (traceCount: 1 | 2): import("../simulation/linearTransient").AnalysisResult => ({
    ok: true,
    title: "Transient",
    times: [0, 1, 2],
    traces: twoTraces.slice(0, traceCount),
    currents: [],
    stats: { netCount: traceCount, componentCount: 0, sampleCount: 3, stopTime: 2, stepSize: 1 },
    warnings: [],
    circuit: {
      groundNetId: null,
      warnings: [],
      nets: twoNets.slice(0, traceCount),
      components: [],
    } as never,
  });
  const twoTraceResult = makeResult(2);

  beforeEach(() => {
    useSchematic.setState({
      probes: [
        { id: "p1", x: 0, y: 0, netId: "n1", color: "var(--trace-cyan)" },
        { id: "p2", x: 100, y: 0, netId: "n2", color: "var(--trace-green)" },
      ],
    });
  });

  it("defaults two-or-more plot panes to half width so they tile two-up", () => {
    renderPanel({ result: twoTraceResult });
    const cards = document.querySelectorAll(".dashboard-card");
    expect(cards).toHaveLength(2);
    expect(Array.from(cards).every((card) => card.classList.contains("dashboard-card--half"))).toBe(true);
  });

  it("toggling a card's width flips its class between half and full", () => {
    renderPanel({ result: twoTraceResult });
    const toggle = screen.getByRole("button", { name: "Widen V(n1) to full width" });
    const card = toggle.closest(".dashboard-card") as HTMLElement;
    expect(card.classList.contains("dashboard-card--half")).toBe(true);

    fireEvent.click(toggle);
    expect(card.classList.contains("dashboard-card--full")).toBe(true);
    expect(screen.getByRole("button", { name: "Narrow V(n1) to half width" })).toBeTruthy();
  });

  it("dragging a card's handle onto another card reorders the grid", () => {
    renderPanel({ result: twoTraceResult });
    const cardsBefore = Array.from(document.querySelectorAll("[data-card-id]")).map((el) => el.getAttribute("data-card-id"));
    expect(cardsBefore).toEqual(["plot:n1", "plot:n2"]);

    const handle = screen.getByRole("button", { name: "Reorder V(n1)" });
    const targetCard = document.querySelector('[data-card-id="plot:n2"]') as HTMLElement;

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(targetCard, { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const cardsAfter = Array.from(document.querySelectorAll("[data-card-id]")).map((el) => el.getAttribute("data-card-id"));
    expect(cardsAfter).toEqual(["plot:n2", "plot:n1"]);
  });

  it("gives a lone plot pane full width by default", () => {
    useSchematic.setState({ probes: [{ id: "p1", x: 0, y: 0, netId: "n1", color: "var(--trace-cyan)" }] });
    renderPanel({ result: makeResult(1) });
    const cards = document.querySelectorAll(".dashboard-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].classList.contains("dashboard-card--full")).toBe(true);
  });
});

describe("visibleTransientTraces - node names and probes are the plot authority", () => {
  const wires = Array.from({ length: 7 }, (_, index) => ({
    id: `w${index + 1}`,
    points: [{ x: index * 20, y: 0 }, { x: index * 20 + 10, y: 0 }],
  }));
  const result = {
    ok: true,
    title: "Transient",
    times: [0, 1],
    traces: Array.from({ length: 7 }, (_, index) => ({
      id: `n${index + 1}`,
      label: `V(n${index + 1})`,
      unit: "V" as const,
      color: `var(--trace-${index + 1})`,
      values: [0, index + 1],
    })),
    currents: [],
    stats: { netCount: 7, componentCount: 0, sampleCount: 2, stopTime: 1, stepSize: 1 },
    warnings: [],
    circuit: {
      groundNetId: null,
      warnings: [],
      nets: Array.from({ length: 7 }, (_, index) => ({
        id: `n${index + 1}`,
        points: [{ x: index * 20, y: 0 }, { x: index * 20 + 10, y: 0 }],
        pins: [],
        isGround: false,
        labelCount: 0,
      })),
      components: [],
    },
  } as Extract<import("../simulation/linearTransient").AnalysisResult, { ok: true }>;

  it("plots a named seventh net and a probed first net, with probe color winning", () => {
    const traces = visibleTransientTraces(
      result,
      [{ id: "p1", x: 0, y: 0, netId: "n1", color: "var(--probe-color)" }],
      wires,
      [{ id: "l7", x: 120, y: 0, text: "output" }],
    );
    expect(traces.map((trace) => trace.id)).toEqual(["n7", "n1"]);
    expect(traces[1].color).toBe("var(--probe-color)");
  });

  it("shows no arbitrary fallback nets when no node is named or probed", () => {
    expect(visibleTransientTraces(result, [], wires, [])).toEqual([]);
  });
});

describe("SimulationPanel - one Advanced disclosure per tab (simplify pass)", { timeout: 20_000 }, () => {
  it("hides duration/detail settings behind a closed-by-default disclosure", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Toggle advanced settings" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("STOP")).toBeNull();
    expect(screen.queryByText("STEPS")).toBeNull();
    expect(screen.queryByText("Tau automatically chooses simulation settings unless overridden.")).toBeNull();
  });

  it("reveals duration, detail, and the simulated-time explanation when opened", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Toggle advanced settings" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Circuit duration")).toBeTruthy();
    expect(screen.getByText("Waveform detail")).toBeTruthy();
    expect(screen.queryByLabelText("STEPS slider")).toBeNull();
    expect(
      screen.getByText("STOP is simulated circuit time, not wall-clock solve time. Unless you override it, Tau sets output point density from the fastest source and reactive time constants."),
    ).toBeTruthy();
  });

  it("shows the AUTOMATIC badge while detail is circuit-derived, with no reset control", () => {
    renderPanel({ optionsAuto: true, onResetOptions: vi.fn() });
    expect(screen.getByText("AUTOMATIC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.queryByRole("button", { name: "Reset to auto" })).toBeNull();
  });

  it("offers automatic settings once the user has overridden the detail", () => {
    const onResetOptions = vi.fn();
    renderPanel({ optionsAuto: false, onResetOptions });
    expect(screen.queryByText("AUTO")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Use automatic settings" }));
    expect(onResetOptions).toHaveBeenCalledTimes(1);
  });

  it("labels imported transient settings as document-authored and resets custom edits back to them", () => {
    const onResetOptions = vi.fn();
    renderPanel({ optionsSource: "document", resetOptionsTarget: "document", onResetOptions });
    expect(screen.getByText("DOCUMENT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.queryByRole("button", { name: "Use document settings" })).toBeNull();
    cleanup();

    renderPanel({ optionsSource: "custom", resetOptionsTarget: "document", onResetOptions });
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Use document settings" }));
    expect(onResetOptions).toHaveBeenCalledTimes(1);
  });

  it("also tucks the AC expression bar and CSV export behind AC's own Advanced disclosure", () => {
    renderPanel();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "AC sweep (.ac)" }), { button: 0 });
    expect(screen.queryByLabelText("Plot AC expression")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.getByLabelText("Plot AC expression")).toBeTruthy();
  });
});

describe("SimulationPanel - engineering-safe transient controls", { timeout: 20_000 }, () => {
  it("keeps unsafe raw output counts out of the primary surface and bounds the expert override", () => {
    useSchematic.setState({
      components: [
        { id: "v1", kind: "vac", label: "V1", value: "1 1Meg", x: 0, y: 0, rotation: 0 },
      ],
    });
    const handlers = renderPanel({ options: { stopTime: 10e-6, steps: 100 } });

    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    expect(screen.queryByLabelText("STEPS slider")).toBeNull();
    fireEvent.click(screen.getByText("Exact output settings"));
    const points = screen.getByLabelText("Exact output points") as HTMLInputElement;
    expect(points.min).toBe("320");
    fireEvent.change(points, { target: { value: "32" } });
    expect(handlers.onOptionsChange).not.toHaveBeenCalled();
  });

  it("accepts long circuit durations in human units and separates them from elapsed solver time", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    fireEvent.change(screen.getByLabelText("Circuit duration unit"), { target: { value: "min" } });
    fireEvent.change(screen.getByLabelText("Circuit duration value"), { target: { value: "3" } });
    expect(handlers.onOptionsChange).toHaveBeenLastCalledWith({ stopTime: 180, steps: 240 });
    // Advanced help and the duration control both say "simulated circuit time"
    // on purpose — assert the control-specific note (and the 3 min → 180 s map).
    expect(
      screen.getByText(/This is simulated circuit time\. A 3 min run models 180 s/i),
    ).toBeTruthy();
  });

  it("reports measured solver elapsed time without presenting it as an estimate", () => {
    const okResult = {
      ok: true, title: "Transient", times: [0, 0.006], traces: [], currents: [],
      stats: { netCount: 1, componentCount: 1, sampleCount: 2, stopTime: 0.006, stepSize: 0.006 },
      warnings: [], circuit: {} as never,
    } as Extract<import("../simulation/linearTransient").AnalysisResult, { ok: true }>;
    renderPanel({ result: okResult, lastRunDurationMs: 1_250 });
    expect(screen.getByRole("status").textContent).toContain("1.25 s elapsed");
  });

  it("opens cursors directly from a trace and keeps exact interval endpoints in sync", () => {
    useSchematic.setState({
      wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] }],
      probes: [{ id: "p1", x: 0, y: 0, netId: "n1", color: "var(--trace-cyan)" }],
    });
    const result = {
      ok: true,
      title: "Transient",
      times: [0, 1, 2],
      traces: [{ id: "n1", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [0, 1, 0] }],
      currents: [],
      stats: { netCount: 1, componentCount: 0, sampleCount: 3, stopTime: 2, stepSize: 1 },
      warnings: [],
      circuit: {
        groundNetId: null,
        warnings: [],
        nets: [{ id: "n1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], pins: [], isGround: false, labelCount: 0 }],
        components: [],
      },
    } as Extract<import("../simulation/linearTransient").AnalysisResult, { ok: true }>;
    renderPanel({ result });

    // Direct line interaction is available beside the trace - engineers do
    // not have to discover a slider hidden under Advanced first.
    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 1 on V(out)" }));
    expect(document.querySelectorAll(".transient-cursor")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    fireEvent.change(screen.getByLabelText("Cursor 1 time SI prefix"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Cursor 1 time"), { target: { value: "1e0" } });
    const firstCursorLine = document.querySelector(".transient-cursor.cursor-1 line");
    expect(Number(firstCursorLine?.getAttribute("x1"))).toBeCloseTo(170, 3);
  });
});

describe("SimulationPanel - run-in-progress overlay (Fix 3)", () => {
  it("is absent when idle", () => {
    renderPanel({ isRunning: false, runProgress: null });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("shows a determinate progressbar and a Stop button wired to onStop when running with a known fraction", () => {
    const handlers = renderPanel({ isRunning: true, runProgress: 0.4 });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("40%")).toBeTruthy();

    const stop = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
  });

  it("shows an indeterminate progressbar (no aria-valuenow) when running with an unknown fraction (native ngspice)", () => {
    renderPanel({ isRunning: true, runProgress: null });
    const bar = screen.getByRole("progressbar");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(screen.getByText("Solving…")).toBeTruthy();
  });
});

describe("SimulationPanel - exportNetlist inlines attached model libraries", { timeout: 20_000 }, () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("resolves a part's model name against an attached vendor library in the exported .cir", async () => {
    // A common-emitter stage whose transistor references a name that only an
    // attached library defines - mirrors useSchematic.test.ts's "user model
    // library attachments" end-to-end case.
    useSchematic.setState({
      components: [
        { id: "V1", kind: "vsource", label: "V1", value: "12", x: 100, y: 300, rotation: 0 },
        { id: "Rb", kind: "resistor", label: "Rb", value: "470k", x: 250, y: 200, rotation: 0 },
        { id: "Rc", kind: "resistor", label: "Rc", value: "1k", x: 350, y: 100, rotation: 0 },
        { id: "Q1", kind: "npn", label: "Q1", value: "MYVENDNPN", x: 500, y: 300, rotation: 0 },
      ],
      wires: [],
      netLabels: [
        { id: "n1", x: 100, y: 268, text: "vcc" }, { id: "n2", x: 218, y: 200, text: "vcc" }, { id: "n3", x: 318, y: 100, text: "vcc" },
        { id: "n4", x: 100, y: 332, text: "0" }, { id: "n5", x: 516, y: 332, text: "0" },
        { id: "n6", x: 282, y: 200, text: "base" }, { id: "n7", x: 468, y: 300, text: "base" },
        { id: "n8", x: 382, y: 100, text: "coll" }, { id: "n9", x: 516, y: 268, text: "coll" },
      ],
      userModelLibraries: [{ name: "vendor.lib", text: ".model MYVENDNPN NPN(Is=1e-14 Bf=73)" }],
    });

    const capturedBlobs: Blob[] = [];
    URL.createObjectURL = ((blob: Blob) => {
      capturedBlobs.push(blob);
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Netlist" }));

    expect(capturedBlobs).toHaveLength(1);
    const netlist = await capturedBlobs[0].text();
    expect(netlist).toMatch(/^\.model\s+MYVENDNPN\s+NPN/im);
    expect(netlist).toMatch(/^Q\w*\s+coll\s+base\s+0\s+MYVENDNPN\b/im);
  });
});

describe("SimulationPanel - Open .plt plot settings", { timeout: 20_000 }, () => {
  const TRANSFORMER2_PLT = `[Transient Analysis]
{
   Npanes: 3
   Active Pane: 1
   {
      traces: 1 {524290,0,"V(out)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,-2.1,0.3,1.5)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Log: 0 0 0
   },
   {
      traces: 1 {268959747,0,"V(in)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,-2.1,0.3,1.5)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Log: 0 0 0
   },
   {
      traces: 1 {268959748,0,"V(mid)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,0,0.1,1)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Log: 0 0 0
   }
}
`;

  it("applies .plt panes as expression traces without Settings thrash", async () => {
    const result = {
      ok: true as const,
      title: "Transient",
      times: [0, 50e-6, 100e-6],
      traces: [
        { id: "n1", label: "V(out)", unit: "V" as const, color: "var(--trace-cyan)", values: [0, 1, 0] },
        { id: "n2", label: "V(in)", unit: "V" as const, color: "var(--trace-green)", values: [1, 1, 1] },
        { id: "n3", label: "V(mid)", unit: "V" as const, color: "var(--trace-cream)", values: [0.5, 0.5, 0.5] },
      ],
      currents: [],
      stats: { netCount: 3, componentCount: 0, sampleCount: 3, stopTime: 100e-6, stepSize: 50e-6 },
      warnings: [],
      circuit: {
        groundNetId: null,
        warnings: [],
        nets: [
          { id: "n1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], pins: [], isGround: false, labelCount: 0 },
          { id: "n2", points: [{ x: 0, y: 32 }, { x: 16, y: 32 }], pins: [], isGround: false, labelCount: 0 },
          { id: "n3", points: [{ x: 0, y: 64 }, { x: 16, y: 64 }], pins: [], isGround: false, labelCount: 0 },
        ],
        components: [],
      },
    };

    renderPanel({ result });
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced settings" }));
    const input = document.querySelector('input[accept=".plt"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File([TRANSFORMER2_PLT], "Transformer2.plt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("button", { name: "Open .plt ✓" })).toBeTruthy();
    // Expression chips from the .plt — plot authority without requiring probes.
    const chips = document.querySelectorAll(".expr-chip");
    const chipText = [...chips].map((el) => el.textContent ?? "");
    expect(chipText.some((t) => t.includes("V(out)"))).toBe(true);
    expect(chipText.some((t) => t.includes("V(in)"))).toBe(true);
    expect(chipText.some((t) => t.includes("V(mid)"))).toBe(true);
  });
});

describe("StepPlot measurements", () => {
  function member(label: string, value: number, measured?: number, times = [0, 1e-3, 2e-3], values = [0, 1, 2]) {
    return {
      label,
      value,
      measurements: measured === undefined ? [] : [{ name: "Efficiency", value: measured }],
      result: {
        ok: true as const,
        title: "Transient",
        circuit: { nets: [{ id: "n1", label: "out", isGround: false, points: [], pins: [], labelCount: 0 }], components: [], groundNetId: null, warnings: [] },
        traces: [{ id: "n1", label: "V(out)", values, unit: "V" as const, color: "var(--trace-cyan)" }],
        times,
        currents: [],
        stats: { netCount: 1, componentCount: 1, sampleCount: times.length, stopTime: times[times.length - 1] ?? 0, stepSize: 1e-3 },
        warnings: [],
      },
    };
  }

  it("renders each member's .meas value beside its exact sweep label", () => {
    render(
      <StepPlot
        result={{
          ok: true,
          spec: { kind: "param", name: "RL", values: [1, 2] },
          members: [member("RL=1", 1, 0.81), member("RL=2", 2, 0.93)],
          warnings: [],
        }}
        probes={[]}
        wires={[]}
      />,
    );
    const table = screen.getByRole("table", { name: "Step measurements" });
    expect(table.textContent).toContain("RL=1");
    expect(table.textContent).toContain("RL=2");
    expect(screen.getAllByText("Efficiency")).toHaveLength(2);
    expect(screen.getByText("810 m")).toBeTruthy();
    expect(screen.getByText("930 m")).toBeTruthy();
  });

  it("exports a long-format CSV that preserves each member's own time grid", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const capturedBlobs: Blob[] = [];
    URL.createObjectURL = ((blob: Blob) => {
      capturedBlobs.push(blob);
      return "blob:mock-step-csv";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      render(
        <StepPlot
          result={{
            ok: true,
            spec: { kind: "param", name: "RL", values: [1, 2] },
            members: [
              member("RL=1", 1, undefined, [0, 1e-3], [0, 1]),
              member("RL=2", 2, undefined, [0, 2e-3, 4e-3], [0, 0.5, 1]),
            ],
            warnings: [],
          }}
          probes={[]}
          wires={[]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
      expect(capturedBlobs).toHaveLength(1);
      const csv = await capturedBlobs[0].text();
      expect(csv).toBe(
        [
          "step,time,V(out)",
          "RL=1,0,0",
          "RL=1,0.001,1",
          "RL=2,0,0",
          "RL=2,0.002,0.5",
          "RL=2,0.004,1",
        ].join("\n"),
      );
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("plots a step-family expression and labels SIGNAL with the expression", () => {
    function memberWithMid(label: string, value: number, out: number[], mid: number[]) {
      const base = member(label, value, undefined, [0, 1e-3], out);
      if (!base.result.ok) throw new Error("expected ok");
      return {
        ...base,
        result: {
          ...base.result,
          traces: [
            ...base.result.traces,
            { id: "n_mid", label: "V(mid)", values: mid, unit: "V" as const, color: "var(--trace-green)" },
          ],
          circuit: {
            ...base.result.circuit,
            nets: [
              ...base.result.circuit.nets,
              { id: "n_mid", label: "mid", isGround: false, points: [], pins: [], labelCount: 0 },
            ],
          },
        },
      };
    }

    render(
      <StepPlot
        result={{
          ok: true,
          spec: { kind: "param", name: "RL", values: [1, 2] },
          members: [
            memberWithMid("RL=1", 1, [2, 4], [1, 1]),
            memberWithMid("RL=2", 2, [3, 5], [1, 2]),
          ],
          warnings: [],
        }}
        probes={[]}
        wires={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Step plot expression"), {
      target: { value: "V(out)-V(mid)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add trace" }));
    expect(screen.getByRole("button", { name: "Plot V(out)-V(mid) across steps" })).toBeTruthy();
    // SIGNAL meter shows the expression (chip also carries the same text).
    const signalMeter = screen.getByText("SIGNAL").parentElement;
    expect(signalMeter?.textContent).toContain("V(out)-V(mid)");
    expect(screen.getByRole("button", { name: "Use probe" })).toBeTruthy();
  });
});

describe("SimulationPanel - trace color choice and cursor seek", () => {
  function twoTraceResult() {
    return {
      ok: true as const,
      title: "Transient",
      // V(out) ramps 0 -> 4 so a target value has exactly one crossing.
      times: [0, 1, 2],
      traces: [
        { id: "n1", label: "V(out)", unit: "V" as const, color: "var(--trace-cyan)", values: [0, 2, 4] },
        { id: "n2", label: "V(in)", unit: "V" as const, color: "var(--trace-green)", values: [5, 5, 5] },
      ],
      currents: [],
      stats: { netCount: 2, componentCount: 0, sampleCount: 3, stopTime: 2, stepSize: 1 },
      warnings: [],
      circuit: {
        groundNetId: null,
        warnings: [],
        nets: [
          { id: "n1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], pins: [], isGround: false, labelCount: 0 },
          { id: "n2", points: [{ x: 0, y: 32 }, { x: 16, y: 32 }], pins: [], isGround: false, labelCount: 0 },
        ],
        components: [],
      },
    } as Extract<import("../simulation/linearTransient").AnalysisResult, { ok: true }>;
  }

  /** Traces are only visible when the schematic actually probes those nets. */
  function seedProbes() {
    // A probe's own color wins over the result's, so these are the colors the
    // legend and palette actually compare against.
    useSchematic.setState({
      wires: [
        { id: "w1", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] },
        { id: "w2", points: [{ x: 0, y: 32 }, { x: 16, y: 32 }] },
      ],
      probes: [
        { id: "p1", x: 0, y: 0, netId: "n1", color: "var(--trace-cyan)" },
        { id: "p2", x: 0, y: 32, netId: "n2", color: "var(--trace-green)" },
      ],
    });
  }

  function renderTwoTracePanel() {
    seedProbes();
    renderPanel({ result: twoTraceResult() });
  }

  function selectOutTrace() {
    fireEvent.click(screen.getByRole("button", { name: "Select V(out) for cursor measurement" }));
  }

  it("marks a preset another trace already uses, without disabling it", () => {
    renderTwoTracePanel();
    selectOutTrace();

    // V(in) is green, so green is a confusing choice for V(out) - say so.
    const green = screen.getByRole("button", {
      name: "Set V(out) trace color to green - already used by V(in)",
    });
    expect(green.className).toContain("taken");
    expect(green.hasAttribute("disabled")).toBe(false);

    // The trace's own color is never reported as taken by someone else.
    const sky = screen.getByRole("button", { name: "Set V(out) trace color to sky" });
    expect(sky.className).not.toContain("taken");
    expect(sky.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers an arbitrary color beyond the six presets and applies it to the trace", () => {
    renderTwoTracePanel();
    selectOutTrace();

    const picker = screen.getByLabelText("Pick a custom color for V(out)") as HTMLInputElement;
    expect(picker.type).toBe("color");
    fireEvent.change(picker, { target: { value: "#ff00aa" } });

    // The legend swatch is the rendered proof the override reached the trace.
    const legendSwatch = screen
      .getByRole("button", { name: "Select V(out) for cursor measurement" })
      .querySelector("i");
    expect(legendSwatch?.getAttribute("style")).toContain("rgb(255, 0, 170)");
  });

  it("moves a cursor to an exact typed time from beside the trace", () => {
    renderTwoTracePanel();
    selectOutTrace();
    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 1 on V(out)" }));

    fireEvent.change(screen.getByLabelText("Move cursor C1 on V(out) to a time SI prefix"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Move cursor C1 on V(out) to a time"), { target: { value: "1e0" } });

    const line = document.querySelector(".transient-cursor.cursor-1 line");
    expect(Number(line?.getAttribute("x1"))).toBeCloseTo(170, 3);
  });

  it("solves for the time at a typed value and reports where it landed", () => {
    renderTwoTracePanel();
    selectOutTrace();
    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 1 on V(out)" }));

    const label = "Move cursor C1 to where V(out) equals a value";
    fireEvent.change(screen.getByLabelText(`${label} SI prefix`), { target: { value: "" } });
    // V(out) is 3 V halfway through the second segment, i.e. t = 1.5 s.
    fireEvent.change(screen.getByLabelText(label), { target: { value: "3e0" } });

    expect(document.querySelector(".trace-seek__note")?.textContent).toContain("1.5");
    const xFromValue = document.querySelector(".transient-cursor.cursor-1 line")?.getAttribute("x1");

    // Solving for a value must land the cursor in exactly the same place as
    // typing the equivalent time. Asserting the equivalence rather than a pixel
    // keeps this honest if the pane's x-domain headroom ever changes.
    fireEvent.change(screen.getByLabelText("Move cursor C1 on V(out) to a time SI prefix"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Move cursor C1 on V(out) to a time"), { target: { value: "1.5e0" } });
    expect(document.querySelector(".transient-cursor.cursor-1 line")?.getAttribute("x1")).toBe(xFromValue);
  });

  it("says plainly when the trace never reaches the typed value", () => {
    renderTwoTracePanel();
    selectOutTrace();
    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 1 on V(out)" }));

    const label = "Move cursor C1 to where V(out) equals a value";
    fireEvent.change(screen.getByLabelText(`${label} SI prefix`), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(label), { target: { value: "99e0" } });

    expect(document.querySelector(".trace-seek__note")?.textContent).toMatch(/never reaches/i);
  });

  it("does not paint idle seek fields as invalid before the user types", () => {
    renderTwoTracePanel();
    selectOutTrace();

    const time = screen.getByRole("textbox", { name: "Move cursor C1 on V(out) to a time" });
    const value = screen.getByRole("textbox", { name: "Move cursor C1 to where V(out) equals a value" });
    expect(time.getAttribute("aria-invalid")).toBe("false");
    expect(value.getAttribute("aria-invalid")).toBe("false");
  });

  it("reads a value off the line on hover, in pan mode, per pane", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      // Matches the 340x190 viewBox so svg units map 1:1 to client pixels.
      left: 0, top: 0, width: 340, height: 190, right: 340, bottom: 190, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    try {
      renderTwoTracePanel();
      // Each trace gets its own pane by default, so there is one hover surface
      // per trace and each reports its own signal.
      const surfaces = document.querySelectorAll(".scope-hover-surface");
      expect(surfaces).toHaveLength(2);

      // x = 170 is the middle of a 340-wide plot padded by 30, i.e. t = 1 s,
      // where the 0 -> 4 ramp is worth 2 V. No cursor was armed first.
      fireEvent.pointerMove(surfaces[0], { clientX: 170, clientY: 95 });
      const chip = document.querySelector(".scope-hover text");
      expect(chip?.textContent).toContain(formatEngineering(2, "V", 3));
      expect(chip?.textContent).toContain(formatEngineering(1, "s", 3));
      // The readout dot sits on the interpolated point, not on a sample.
      expect(document.querySelector(".scope-hover-point")?.getAttribute("cy")).toBe("95");

      fireEvent.pointerLeave(surfaces[0]);
      expect(document.querySelector(".scope-hover")).toBeNull();

      // The flat 5 V trace's own pane reads 5 V at the same x.
      fireEvent.pointerMove(surfaces[1], { clientX: 170, clientY: 95 });
      expect(document.querySelector(".scope-hover text")?.textContent)
        .toContain(formatEngineering(5, "V", 3));
    } finally {
      rect.mockRestore();
    }
  });

  it("retires the hover surface once a cursor is armed, so the two never fight", () => {
    renderTwoTracePanel();
    expect(document.querySelector(".scope-hover-surface")).toBeTruthy();
    selectOutTrace();
    fireEvent.click(screen.getByRole("button", { name: "Glide cursor 1 on V(out)" }));
    expect(document.querySelector(".scope-hover-surface")).toBeNull();
    expect(document.querySelector(".cursor-glide-surface")).toBeTruthy();
  });

  it("names the nearest trace when several share one pane", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 340, height: 190, right: 340, bottom: 190, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    try {
      const result = twoTraceResult();
      // One shared pane so nearest-vertical hover must disambiguate.
      render(
        <WaveformPlot
          result={result}
          baseTraces={result.traces}
          netLabels={[]}
          paneLayout={defaultLayout(["n1", "n2"])}
        />,
      );
      expect(document.querySelectorAll(".scope-hover-surface")).toHaveLength(1);
      // Point near the flat 5 V rail (top of the padded 0..5 domain) so V(in) wins.
      fireEvent.pointerMove(document.querySelector(".scope-hover-surface")!, { clientX: 170, clientY: 40 });
      const chip = document.querySelector(".scope-hover text")?.textContent ?? "";
      expect(chip).toContain("V(in)");
      expect(chip).toContain(formatEngineering(5, "V", 3));
      expect(chip).toContain(formatEngineering(1, "s", 3));
    } finally {
      rect.mockRestore();
    }
  });
});
