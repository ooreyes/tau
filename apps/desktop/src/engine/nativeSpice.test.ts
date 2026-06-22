import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  isNativeSpiceRuntime,
  runNativeAcSweep,
  runNativeOperatingPoint,
  runNativeTransient,
} from "./nativeSpice";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

const component = (
  kind: SchematicComponent["kind"],
  id: string,
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

/** A physical RC topology: V1 -> R1 -> C1 -> ground. */
const rcSchematic = () => ({
  components: [
    component("vsource", "v1", "V1", "5", 0, 32),
    component("resistor", "r1", "R1", "1k", 96, 0),
    component("capacitor", "c1", "C1", "1u", 224, 0),
    component("ground", "g1", "", "", 0, 64),
    component("ground", "g2", "", "", 256, 0),
  ],
  wires: [
    wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
    wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
  ],
});

const nativeResult = (vectors: { name: string; real: number[]; imaginary: number[] | null }[], messages: string[] = []) => ({
  plot: "tran1",
  vectors,
  messages,
  libraryPath: "/bundle/libngspice.dylib",
});

const enableNativeRuntime = () => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

describe("native ngspice adapter", () => {
  it("does not invoke Tauri from browser development", async () => {
    expect(isNativeSpiceRuntime()).toBe(false);

    await expect(runNativeTransient(rcSchematic(), { stopTime: 0.002, steps: 200 })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends a generated transient deck and converts node vectors into plotted traces", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001, 0.002], imaginary: null },
      { name: "V(N001)", real: [5, 5, 5], imaginary: null },
      { name: "v(n002)", real: [0, 3.2, 4.3], imaginary: null },
    ], ["note: operating normally", "Warning: internal timestep reduced"]));

    const result = await runNativeTransient(rcSchematic(), { stopTime: 0.002, steps: 200 });

    expect(invoke).toHaveBeenCalledWith("simulate_spice", {
      request: { netlist: expect.stringContaining(".tran 0.00001 0.002") },
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.times).toEqual([0, 0.001, 0.002]);
    expect(result.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "N001", label: "V(V1.R1)", values: [5, 5, 5] }),
      expect.objectContaining({ id: "N002", label: "V(R1.C1)", values: [0, 3.2, 4.3] }),
    ]));
    expect(result.warnings).toEqual(["Warning: internal timestep reduced"]);
  });

  it("returns all finite operating-point voltages, including a 0 V non-ground net", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v(n001)", real: [5], imaginary: null },
      { name: "v(n002)", real: [0], imaginary: null },
    ]));

    const result = await runNativeOperatingPoint(rcSchematic());

    expect(result).toEqual({
      ok: true,
      nets: [
        { id: "N001", label: "V(V1.R1)", voltage: 5 },
        { id: "N002", label: "V(R1.C1)", voltage: 0 },
      ],
      warnings: [],
    });
  });

  it("converts complex AC vectors to magnitude and phase without losing zero values", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "frequency", real: [10, 100], imaginary: null },
      { name: "v(n001)", real: [1, 0], imaginary: [0, 0] },
      { name: "v(n002)", real: [0, 0], imaginary: [1, 0] },
    ]));

    const result = await runNativeAcSweep(rcSchematic(), {
      startHz: 10,
      stopHz: 100,
      pointsPerDecade: 10,
    });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(result.freqs).toEqual([10, 100]);
    expect(result.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "N001", magDb: [0, -300], phaseDeg: [0, 0] }),
      expect.objectContaining({ id: "N002", magDb: [0, -300], phaseDeg: [90, 0] }),
    ]));
  });

  it("surfaces malformed native output instead of presenting an empty simulation as valid", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001], imaginary: null },
      { name: "v(n001)", real: [5], imaginary: null },
    ]));

    await expect(runNativeTransient(rcSchematic(), { stopTime: 0.001, steps: 100 }))
      .rejects.toThrow(/no node-voltage traces/i);
  });
});
