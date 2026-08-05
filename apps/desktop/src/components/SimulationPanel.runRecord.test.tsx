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
import {
  RUN_RECORD_HISTORY_KEY,
  RUN_RECORD_KIND,
  loadRunRecordHistory,
  parseRunRecord,
} from "../lib/runRecord";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: () => null,
    get length() { return memory.size; },
  });
  useSchematic.setState({
    components: [{
      id: "r1",
      kind: "resistor",
      label: "R1",
      value: "1k",
      x: 0,
      y: 0,
      rotation: 0,
    }],
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
      circuitTitle="divider.asc"
      preferredMode="op"
      documentSignature="sig-divider"
      circuitFilePath="/tmp/divider.asc"
      result={null}
      opResult={{
        ok: true,
        nets: [{ id: "out", label: "out", voltage: 2.5 }],
        warnings: [],
        engine: "ngspice",
      }}
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

describe("SimulationPanel run records", { timeout: 20_000 }, () => {
  it("remembers a versioned run record when an analysis result settles", () => {
    renderPanel();
    const history = loadRunRecordHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.kind).toBe(RUN_RECORD_KIND);
    expect(history[0]?.circuit.documentSignature).toBe("sig-divider");
    expect(history[0]?.analysis.kind).toBe("op");
    expect(history[0]?.analysis.engine).toBe("ngspice");
    expect(history[0]?.status).toBe("ok");
    expect(memory.get(RUN_RECORD_HISTORY_KEY)).toMatch(/tau\.run\.record\.v1/);
  });

  it("exports a .tau-run.json download that round-trips through parseRunRecord", () => {
    const captured: Blob[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push(blob);
      return "blob:run-record";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Export run record" }));
      expect(captured).toHaveLength(1);
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("exports parseable JSON with machine-readable diagnostics on error", async () => {
    const captured: Blob[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push(blob);
      return "blob:run-record-err";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      renderPanel({
        opResult: {
          ok: false,
          message: "Singular matrix",
          warnings: ["floating node"],
          engine: "ngspice",
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Export run record" }));
      expect(captured).toHaveLength(1);
      const text = await captured[0].text();
      const parsed = parseRunRecord(JSON.parse(text));
      expect(parsed).not.toBeNull();
      expect(parsed?.status).toBe("error");
      expect(parsed?.diagnostics.some((d) => d.code === "sim.error")).toBe(true);
      expect(parsed?.diagnostics.some((d) => d.code === "sim.warning")).toBe(true);
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
