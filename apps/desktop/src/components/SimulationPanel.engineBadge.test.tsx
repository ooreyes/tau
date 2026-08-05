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
 * A number is only meaningful next to the name of the solver that produced it:
 * ngspice carries full device models, the preview solver answers a strict
 * linear subset, and the same schematic can give different answers on each. The
 * badge must therefore track the DISPLAYED result, not the runtime - switching
 * analysis tabs must re-attribute, and a result with no recorded engine must
 * show nothing rather than imply the native one.
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

const tranResult = {
  ok: true as const,
  title: "Transient",
  times: [0, 0.003, 0.006],
  traces: [],
  currents: [],
  stats: { netCount: 4, componentCount: 6, sampleCount: 3, stopTime: 0.006, stepSize: 0.003 },
  warnings: [],
  circuit: {} as never,
};

const opResult = {
  ok: true as const,
  nets: [{ id: "n1", label: "out", voltage: 2.5 }],
  warnings: [],
};

function renderPanel(overrides: Partial<Parameters<typeof SimulationPanel>[0]> = {}) {
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
      onRun={vi.fn()}
      onRunOperatingPoint={vi.fn()}
      onRunAcSweep={vi.fn()}
      onRunDcSweep={vi.fn()}
      onRunTf={vi.fn()}
      onRunNoise={vi.fn()}
      onRunStep={vi.fn()}
      onStop={vi.fn()}
      onClose={vi.fn()}
      onOptionsChange={vi.fn()}
      onDcSetupChange={vi.fn()}
      onTfSetupChange={vi.fn()}
      onNoiseSetupChange={vi.fn()}
      onStepSetupUiChange={vi.fn()}
      {...overrides}
    />,
  );
}

const badge = () => document.querySelector(".plotter-status-engine");

// First render of the full panel is slow when the suite collects in parallel
// under load - the 5s default flakes; these are render-once assertions.
describe("SimulationPanel - engine attribution badge", { timeout: 20_000 }, () => {
  it("names ngspice on a result the native engine produced", () => {
    renderPanel({ result: { ...tranResult, engine: "ngspice" } });
    expect(badge()?.textContent).toBe("ngspice");
    expect(badge()?.getAttribute("data-engine")).toBe("ngspice");
  });

  it("names the linear preview solver so its subset answer is not read as ngspice", () => {
    renderPanel({ result: { ...tranResult, engine: "preview" } });
    expect(badge()?.textContent).toBe("Linear preview");
    // Styled apart from the native badge: this one is a qualification.
    expect(badge()?.className).toContain("plotter-status-engine--preview");
  });

  it("shows no badge for a result that recorded no engine, rather than assuming one", () => {
    renderPanel({ result: tranResult });
    expect(badge()).toBeNull();
    // The strip itself still rendered - absence is the badge, not the strip.
    expect(screen.getByRole("status").textContent).toContain("Complete");
  });

  it("shows no badge while a run is in flight, when nothing is attributable yet", () => {
    renderPanel({ result: { ...tranResult, engine: "ngspice" }, isRunning: true });
    expect(badge()).toBeNull();
  });

  it("re-attributes when the visible analysis changes, instead of pinning one engine", () => {
    renderPanel({
      result: { ...tranResult, engine: "ngspice" },
      opResult: { ...opResult, engine: "preview" },
    });
    expect(badge()?.textContent).toBe("ngspice");
    // Radix TabsTrigger activates on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    expect(badge()?.textContent).toBe("Linear preview");
  });

  it("attributes a failed run too - which engine rejected the circuit is the point", () => {
    renderPanel({
      preferredMode: "noise",
      noiseResult: { ok: false, message: "no AC source", warnings: [], engine: "ngspice" },
    });
    expect(screen.getByRole("status").textContent).toContain("Error");
    expect(badge()?.textContent).toBe("ngspice");
  });
});
