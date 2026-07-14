// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SimulationPanel } from "./SimulationPanel";
import { visibleTransientTraces } from "../simulation/visibleTraces";
import {
  defaultDcSetup,
  defaultNoiseSetup,
  defaultStepSetupUi,
  defaultTfSetup,
} from "../simulation/analysisSetup";
import { useSchematic } from "../store/useSchematic";

/**
 * §11 Unit C5 — the simulator tab must NOT carry its own primary Run button;
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
    onStep: vi.fn(),
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
// under load — the 5s default flakes; these are render-once assertions.
describe("SimulationPanel — no redundant Run button (§11 Unit C5)", { timeout: 20_000 }, () => {
  it("renders no Run button in the transient pane, only the status strip", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /run transient/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^run/i })).toBeNull();
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

  it("keeps the refine control as a subtle secondary rerun affordance", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Refine transient resolution" }));
    expect(handlers.onStep).toHaveBeenCalledTimes(1);
  });
});

describe("SimulationPanel — dashboard status strip (§11 Unit C6)", { timeout: 20_000 }, () => {
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

  it("goes to the danger Error state and points at the Errors panel on failure", () => {
    const failed = {
      ok: false,
      title: "Transient",
      message: "singular matrix at t=0",
      warnings: [],
    } as import("../simulation/linearTransient").AnalysisResult;
    renderPanel({ result: failed });
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("Error");
    expect(strip.textContent).toContain("details in the Errors panel");
    expect(strip.classList.contains("plotter-status--error")).toBe(true);
  });

  it("stays Idle with a pointer at the toolbar Run before anything has run", () => {
    renderPanel();
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("Idle");
    expect(strip.textContent).toContain("press Run in the toolbar");
    expect(strip.classList.contains("plotter-status--idle")).toBe(true);
  });
});

describe("SimulationPanel — component telemetry (§11 Unit D)", { timeout: 20_000 }, () => {
  const measuredResult = {
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
  } as import("../simulation/linearTransient").AnalysisResult;

  it("shows V/I/P and provides a keyboard-operable component focus control", () => {
    renderPanel({ result: measuredResult });
    expect(screen.getByRole("heading", { name: "Component measurements" })).toBeTruthy();
    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getByText("Power")).toBeTruthy();
    expect(screen.getByText("Choose signals on the circuit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select R1" }));
    expect(useSchematic.getState().selectedId).toBe("r1");
  });
});

describe("visibleTransientTraces — node names and probes are the plot authority", () => {
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

describe("SimulationPanel — advanced settings disclosure (§11 Unit C7)", { timeout: 20_000 }, () => {
  it("hides the STOP/STEPS/resolution controls behind a closed-by-default disclosure", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Toggle advanced simulation settings" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("STOP")).toBeNull();
    expect(screen.queryByText("STEPS")).toBeNull();
    expect(screen.queryByText("Tau automatically chooses simulation settings unless overridden.")).toBeNull();
  });

  it("reveals the dials and the auto-settings helper text when opened", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Toggle advanced simulation settings" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("STOP")).toBeTruthy();
    expect(screen.getByText("STEPS")).toBeTruthy();
    expect(
      screen.getByText("Tau automatically chooses simulation settings unless overridden."),
    ).toBeTruthy();
  });

  it("shows the AUTO badge while resolution is auto-derived, with no reset control", () => {
    renderPanel({ optionsAuto: true, onResetOptions: vi.fn() });
    expect(screen.getByText("AUTO")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced simulation settings" }));
    expect(screen.queryByRole("button", { name: "Reset to auto" })).toBeNull();
  });

  it("offers Reset to auto once the user has overridden the resolution", () => {
    const onResetOptions = vi.fn();
    renderPanel({ optionsAuto: false, onResetOptions });
    expect(screen.queryByText("AUTO")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle advanced simulation settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to auto" }));
    expect(onResetOptions).toHaveBeenCalledTimes(1);
  });
});
