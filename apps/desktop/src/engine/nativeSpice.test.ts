import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  cancelNativeSpice,
  isNativeSpiceRuntime,
  runNativeAcSweep,
  runNativeDcSweep,
  runNativeOperatingPoint,
  runNativeTransient,
} from "./nativeSpice";
import type { NetLabel, PinOverride, SchematicComponent, SchematicWire } from "../schematic/types";

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

/** A deliberately direct LED drive used to verify retained device current. */
const directLedSchematic = () => ({
  components: [
    component("vsource", "v2", "V2", "5", 0, 32),
    { ...component("led", "d2", "D2", "LED", 128, 32), rotation: 90 as const },
    component("ground", "g1", "", "", 0, 64),
    component("ground", "g2", "", "", 128, 64),
  ],
  wires: [wire("w1", [{ x: 0, y: 0 }, { x: 128, y: 0 }])],
});

/** The RC chain plus a second independent source, for nested `.dc` legs. */
const twoSourceSchematic = () => ({
  ...rcSchematic(),
  components: [
    ...rcSchematic().components,
    component("vsource", "v2", "V2", "1", 384, 32),
    component("ground", "g3", "", "", 384, 64),
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

  it("cancels only through the native worker runtime", async () => {
    await expect(cancelNativeSpice()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    enableNativeRuntime();
    invoke.mockResolvedValueOnce(true);
    await expect(cancelNativeSpice()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("cancel_spice");
  });

  it("sends a generated transient deck and converts node vectors into plotted traces", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001, 0.002], imaginary: null },
      { name: "V(N001)", real: [5, 5, 5], imaginary: null },
      { name: "v(n002)", real: [0, 3.2, 4.3], imaginary: null },
    ], [
      "note: operating normally",
      "Warning: internal timestep reduced",
      "stderr Warning : IC on non-existent node - out, ignored",
    ]));

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
    expect(result.warnings).toEqual([
      "internal timestep reduced",
      "Ignored initial voltage for missing node “out”.",
    ]);
  });

  it("retains an explicit ngspice diode current vector for component telemetry", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001, 0.002], imaginary: null },
      { name: "v(n001)", real: [5, 5, 5], imaginary: null },
      { name: "v2#branch", real: [-0.315, -0.315, -0.315], imaginary: null },
      { name: "@d2[id]", real: [0.315, 0.315, 0.315], imaginary: null },
    ]));

    const result = await runNativeTransient(directLedSchematic(), { stopTime: 0.002, steps: 200 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(result.currents).toEqual(expect.arrayContaining([
      { ref: "V2", label: "I(V2)", values: [-0.315, -0.315, -0.315] },
      { ref: "D2", label: "I(D2)", values: [0.315, 0.315, 0.315] },
    ]));
  });

  it("returns all finite operating-point voltages, with GND prepended at 0 V", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v(n001)", real: [5], imaginary: null },
      { name: "v(n002)", real: [0], imaginary: null },
    ]));

    const result = await runNativeOperatingPoint(rcSchematic());

    // GND is always prepended at 0 V to match the TS solver's OperatingPointResult shape.
    expect(result).toEqual({
      ok: true,
      nets: [
        { id: "0", label: "GND", voltage: 0 },
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

  it("surfaces ngspice's real startup error when no transient time vector exists", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([], ["Error: unknown device A1", "analysis aborted"]));

    await expect(runNativeTransient(rcSchematic(), { stopTime: 0.001, steps: 100 }))
      .rejects.toThrow(/unknown device A1.*analysis aborted/i);
  });

  it("sweeps DC on ngspice, reading the axis off the source-typed scale vector", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v-sweep", real: [0, 1, 2], imaginary: null },
      { name: "v(n001)", real: [0, 1, 2], imaginary: null },
      { name: "v(n002)", real: [0, 0.5, 1], imaginary: null },
    ]));

    const result = await runNativeDcSweep(rcSchematic(), { source: "V1", start: 0, stop: 2, step: 1 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(invoke.mock.calls[0][1].request.netlist).toMatch(/^\.dc V1 0 2 1$/m);
    expect(result.source).toBe("V1");
    expect(result.sweep).toEqual([0, 1, 2]);
    expect(result.nets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "N001", voltages: [0, 1, 2], ground: false }),
      expect.objectContaining({ id: "N002", voltages: [0, 0.5, 1], ground: false }),
      expect.objectContaining({ id: "0", label: "GND", voltages: [0, 0, 0], ground: true }),
    ]));
  });

  it("splits a nested DC run back into one curve per outer value", async () => {
    enableNativeRuntime();
    // ngspice returns a nested sweep as one flat inner-major run: three inner
    // points per leg, three legs, so the axis repeats 0,1,2 three times.
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v-sweep", real: [0, 1, 2, 0, 1, 2, 0, 1, 2], imaginary: null },
      { name: "v(n001)", real: [0, 1, 2, 3, 4, 5, 6, 7, 8], imaginary: null },
    ]));

    const result = await runNativeDcSweep(twoSourceSchematic(), {
      source: "V1", start: 0, stop: 2, step: 1,
      source2: "V2", start2: 0, stop2: 4, step2: 2,
    });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(invoke.mock.calls[0][1].request.netlist).toMatch(/^\.dc V1 0 2 1 V2 0 4 2$/m);
    // The shared X axis is one leg, not the concatenated run.
    expect(result.sweep).toEqual([0, 1, 2]);
    expect(result.nets).toEqual([
      expect.objectContaining({ label: "V(V1.R1) (V2=0)", voltages: [0, 1, 2] }),
      expect.objectContaining({ label: "V(V1.R1) (V2=2)", voltages: [3, 4, 5] }),
      expect.objectContaining({ label: "V(V1.R1) (V2=4)", voltages: [6, 7, 8] }),
    ]);
  });

  it("rejects an unsweepable DC source before spending a native round trip", async () => {
    enableNativeRuntime();

    await expect(runNativeDcSweep(rcSchematic(), { source: "V9", start: 0, stop: 1, step: 0.1 }))
      .rejects.toThrow(/"V9" not found/i);
    await expect(runNativeDcSweep(rcSchematic(), { source: "R1", start: 0, stop: 1, step: 0.1 }))
      .rejects.toThrow(/not an independent source/i);
    // A nested sweep that would fan out past the curve cap is refused here too,
    // because ngspice itself has no such limit.
    await expect(runNativeDcSweep(twoSourceSchematic(), {
      source: "V1", start: 0, stop: 1, step: 0.1,
      source2: "V2", start2: 0, stop2: 1000, step2: 1,
    })).rejects.toThrow(/max 64/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a DC result with no sweep axis rather than plotting against nothing", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v(n001)", real: [0, 1, 2], imaginary: null },
    ]));

    await expect(runNativeDcSweep(rcSchematic(), { source: "V1", start: 0, stop: 2, step: 1 }))
      .rejects.toThrow(/no DC sweep axis/i);
  });

  it("fails fast with actionable copy when a subcircuit has no imported definition", async () => {
    enableNativeRuntime();
    const pinOverride: PinOverride[] = [
      { id: "p1", label: "+", x: 0, y: 0 },
      { id: "p2", label: "-", x: 0, y: 80 },
    ];
    const schematic = {
      components: [{ ...component("subckt", "u1", "U1", "LT1001", 0, 0), pinOverride }],
      wires: [] as SchematicWire[],
      netLabels: [{ id: "f1", x: 0, y: 80, text: "0" }] as NetLabel[],
    };

    await expect(runNativeTransient(schematic, { stopTime: 0.001, steps: 100 }))
      .rejects.toThrow(/No imported library defines the subcircuit "LT1001"/);
    // The precise name is known before the deck is handed off, so no native
    // round trip is spent on an error the user cannot act on.
    expect(invoke).not.toHaveBeenCalled();
  });
});
