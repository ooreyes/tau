// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SimulationPanel } from "./SimulationPanel";
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
  it("renders no Run button in the transient pane, only the Ready status pill", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /run transient/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^run/i })).toBeNull();
    const pill = screen.getByRole("status", { name: "" });
    expect(pill.textContent).toBe("Ready");
  });

  it("shows Running in the status pill while a simulation is in flight", () => {
    renderPanel({ isRunning: true });
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("Running");
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });

  it("treats TRAN tab selection as the run gesture, like every other tab", () => {
    const handlers = renderPanel();
    // Radix TabsTrigger activates on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "OP" }), { button: 0 });
    expect(handlers.onRunOperatingPoint).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "TRAN" }), { button: 0 });
    expect(handlers.onRun).toHaveBeenCalledTimes(1);
  });

  it("keeps the refine control as a subtle secondary rerun affordance", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Refine transient resolution" }));
    expect(handlers.onStep).toHaveBeenCalledTimes(1);
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
});
