import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  cancelNativeSpice,
  isNativeSpiceRuntime,
  runNativeAcSweep,
  runNativeDcSweep,
  runNativeNoise,
  runNativeOperatingPoint,
  runNativeTransferFunction,
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
  extraPlots: [],
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

  // The engine reports a plot it could not afford to transfer on the same
  // message channel as its own diagnostics. That channel is screened before
  // anything is shown, so the notice has to clear the screen to exist at all.
  it("shows a dropped secondary result plot as a warning", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult(
      [{ name: "v(n001)", real: [5], imaginary: null }],
      ["Warning: Tau left out this run's secondary result plots noise1 to stay inside its transfer budget."],
    ));

    const result = await runNativeOperatingPoint(rcSchematic());

    expect(result?.warnings).toContain(
      "Tau left out this run's secondary result plots noise1 to stay inside its transfer budget.",
    );
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

// ---------------------------------------------------------------------------
// .tf on ngspice
// ---------------------------------------------------------------------------
//
// The same 1k:1k divider `transferFunction.test.ts` hand-computes, so the two
// engines are checked against one set of numbers: gain 0.5, Rin 2 kΩ,
// Rout 500 Ω. The mocked vector names are exactly what ngspice 46 names them,
// captured from a real run of this deck - the port is spelled into the name,
// which is why the adapter matches them by shape.
const dividerSchematic = () => ({
  components: [
    { ...component("vsource", "v1", "V1", "5", 0, 0), pinOverride: [
      { id: "p", label: "+", x: 0, y: 0 },
      { id: "n", label: "-", x: 0, y: 100 },
    ] as PinOverride[] },
    { ...component("resistor", "r1", "R1", "1k", 0, 0), pinOverride: [
      { id: "a", label: "a", x: 0, y: 0 },
      { id: "b", label: "b", x: 0, y: 50 },
    ] as PinOverride[] },
    { ...component("resistor", "r2", "R2", "1k", 0, 0), pinOverride: [
      { id: "a", label: "a", x: 0, y: 50 },
      { id: "b", label: "b", x: 0, y: 100 },
    ] as PinOverride[] },
    { ...component("ground", "g", "", "", 0, 100), pinOverride: [
      { id: "g", label: "gnd", x: 0, y: 100 },
    ] as PinOverride[] },
  ],
  wires: [] as SchematicWire[],
  netLabels: [
    { id: "lin", x: 0, y: 0, text: "in" },
    { id: "lout", x: 0, y: 50, text: "out" },
  ] as NetLabel[],
});

const tfVectors = (names: { transfer: string; input: string; output?: string }) => [
  { name: names.transfer, real: [0.5], imaginary: null },
  { name: names.input, real: [2000], imaginary: null },
  ...(names.output ? [{ name: names.output, real: [500], imaginary: null }] : []),
];

const deckOf = () => (invoke.mock.calls[0]?.[1] as { request: { netlist: string } }).request.netlist;

describe("native transfer function", () => {
  it("sweeps a node output and reads ngspice's three scalars back", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult(tfVectors({
      transfer: "Transfer_function",
      input: "v1#Input_impedance",
      output: "output_impedance_at_V(out)",
    })));

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out" },
      source: "V1",
    });

    expect(deckOf()).toContain(".tf v(out) V1");
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.gain).toBeCloseTo(0.5, 9);
    expect(result.inputImpedance).toBeCloseTo(2000, 6);
    expect(result.outputImpedance).toBeCloseTo(500, 6);
    expect(result.gainLabel).toBe("V(out)/V1");
    expect(result.gainUnit).toBe("");
  });

  it("emits a differential output port as v(pos,neg)", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult(tfVectors({
      transfer: "Transfer_function",
      input: "v1#Input_impedance",
      output: "output_impedance_at_V(out,in)",
    })));

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out", neg: "in" },
      source: "V1",
    });

    expect(deckOf()).toContain(".tf v(out,in) V1");
    expect(result?.ok).toBe(true);
  });

  it("resolves a ground output node to node 0", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult(tfVectors({
      transfer: "Transfer_function",
      input: "v1#Input_impedance",
      output: "output_impedance_at_V(out,0)",
    })));

    await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out", neg: "GND" },
      source: "V1",
    });

    expect(deckOf()).toContain(".tf v(out,0) V1");
  });

  it("reports the branch-current output impedance ngspice names after the device", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult(tfVectors({
      transfer: "Transfer_function",
      input: "v1#Input_impedance",
      output: "v1#Output_impedance",
    })));

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "current", device: "V1" },
      source: "V1",
    });

    expect(deckOf()).toContain(".tf i(V1) V1");
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.outputImpedance).toBeCloseTo(500, 6);
    expect(result.gainUnit).toBe("A/V");
    expect(result.gainLabel).toBe("I(V1)/V1");
  });

  it("says an omitted output impedance is missing instead of reporting it as zero", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult(tfVectors({
      transfer: "Transfer_function",
      input: "v1#Input_impedance",
    })));

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "current", device: "V1" },
      source: "V1",
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.outputImpedance).toBeNaN();
    expect(result.warnings).toContain("Output impedance for an I(...) output is not reported.");
  });

  it("names an unknown output node without paying a native round trip", async () => {
    enableNativeRuntime();

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "nowhere" },
      source: "V1",
    });

    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.message).toMatch(/output node "nowhere" not found/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("names an output device the circuit does not contain", async () => {
    enableNativeRuntime();

    const result = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "current", device: "Vsense" },
      source: "V1",
    });

    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.message).toMatch(/I\(Vsense\) is not a device in the circuit/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a stimulus that is not an independent source", async () => {
    enableNativeRuntime();

    const missing = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out" },
      source: "V9",
    });
    expect(missing?.ok).toBe(false);
    if (missing?.ok !== false) return;
    expect(missing.message).toMatch(/source "V9" not found/i);

    const wrongKind = await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out" },
      source: "R1",
    });
    expect(wrongKind?.ok).toBe(false);
    if (wrongKind?.ok !== false) return;
    expect(wrongKind.message).toMatch(/not an independent source/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to report a transfer function ngspice did not return", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(nativeResult([{ name: "v1#Input_impedance", real: [2000], imaginary: null }]));

    await expect(runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out" },
      source: "V1",
    })).rejects.toThrow(/no transfer function/i);
  });

  it("stays on the TypeScript solver outside a Tauri webview", async () => {
    expect(await runNativeTransferFunction(dividerSchematic(), {
      output: { kind: "voltage", pos: "out" },
      source: "V1",
    })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

// A `.noise` run answers across two plots: ngspice leaves the two integrated
// totals current and puts the spectral density curves, with their own
// frequency scale, in a second plot that only `extraPlots` reaches. Vector
// names and plot split captured from a real run of this deck.
const noiseDividerSchematic = () => ({
  ...dividerSchematic(),
  components: dividerSchematic().components.map((part) =>
    part.id === "v1" ? { ...part, value: "5 AC 1" } : part,
  ),
});

const noiseResult = (options: {
  freqs?: number[];
  onoise?: number[];
  inoise?: number[];
  totals?: { name: string; real: number[]; imaginary: number[] | null }[];
  spectrumNames?: { scale: string; onoise: string; inoise: string };
} = {}) => {
  const freqs = options.freqs ?? [1, 10, 100];
  const names = options.spectrumNames
    ?? { scale: "frequency", onoise: "onoise_spectrum", inoise: "inoise_spectrum" };
  return {
    plot: "noise2",
    vectors: options.totals ?? [
      { name: "inoise_total", real: [4.1e-7], imaginary: null },
      { name: "onoise_total", real: [2.05e-7], imaginary: null },
    ],
    extraPlots: [{
      name: "noise1",
      vectors: [
        { name: names.scale, real: freqs, imaginary: null },
        { name: names.onoise, real: options.onoise ?? freqs.map(() => 9.1e-9), imaginary: null },
        { name: names.inoise, real: options.inoise ?? freqs.map(() => 1.82e-8), imaginary: null },
      ],
    }],
    messages: [] as string[],
    libraryPath: "/bundle/libngspice.dylib",
  };
};

const noiseSpec = (overrides: Partial<Parameters<typeof runNativeNoise>[1]> = {}) => ({
  output: { pos: "out" },
  source: "V1",
  sweep: { startHz: 1, stopHz: 100, pointsPerDecade: 1 },
  ...overrides,
});

describe("native noise analysis", () => {
  it("reads the spectrum out of the secondary plot and the totals out of the current one", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult());

    const result = await runNativeNoise(noiseDividerSchematic(), noiseSpec());

    expect(deckOf()).toContain(".noise v(out) V1 dec 1 1 100");
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.freqs).toEqual([1, 10, 100]);
    expect(result.onoise).toEqual([9.1e-9, 9.1e-9, 9.1e-9]);
    expect(result.inoise).toEqual([1.82e-8, 1.82e-8, 1.82e-8]);
    expect(result.totalOutputNoise).toBeCloseTo(2.05e-7, 12);
    expect(result.totalInputNoise).toBeCloseTo(4.1e-7, 12);
    expect(result.inoiseUnit).toBe("V/√Hz");
  });

  it("emits a differential output port as v(pos,neg)", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult());

    const result = await runNativeNoise(
      noiseDividerSchematic(),
      noiseSpec({ output: { pos: "out", neg: "in" } }),
    );

    expect(deckOf()).toContain(".noise v(out,in) V1 dec 1 1 100");
    expect(result?.ok).toBe(true);
  });

  it("labels a current input's referred noise in amps", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult());
    const schematic = noiseDividerSchematic();
    const withCurrentInput = {
      ...schematic,
      components: schematic.components.map((part) =>
        part.id === "v1" ? { ...part, kind: "isource" as const, label: "I1", value: "0 AC 1" } : part,
      ),
    };

    const result = await runNativeNoise(withCurrentInput, noiseSpec({ source: "I1" }));

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.inoiseUnit).toBe("A/√Hz");
  });

  // ngspice aborts the whole run on a noise input with no AC stimulus, so this
  // has to be caught before the round trip or the user sees an empty result.
  it("names a missing AC amplitude instead of paying a round trip ngspice aborts", async () => {
    enableNativeRuntime();

    const result = await runNativeNoise(dividerSchematic(), noiseSpec());

    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.message).toMatch(/has no AC amplitude/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads an AC amplitude that arrives through a parameter", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult());
    const schematic = noiseDividerSchematic();
    const parameterized = {
      ...schematic,
      components: schematic.components.map((part) =>
        part.id === "v1" ? { ...part, value: "5 AC {amp}" } : part,
      ),
      params: { scope: { amp: 1 }, funcs: {} },
    };

    const result = await runNativeNoise(parameterized, noiseSpec());

    expect(result?.ok).toBe(true);
    expect(invoke).toHaveBeenCalled();
  });

  it("names an unknown output node and a stimulus that is not a source", async () => {
    enableNativeRuntime();

    const badNode = await runNativeNoise(noiseDividerSchematic(), noiseSpec({ output: { pos: "nowhere" } }));
    expect(badNode?.ok).toBe(false);
    if (badNode?.ok !== false) return;
    expect(badNode.message).toMatch(/output node "nowhere" not found/i);

    const wrongKind = await runNativeNoise(noiseDividerSchematic(), noiseSpec({ source: "R1" }));
    expect(wrongKind?.ok).toBe(false);
    if (wrongKind?.ok !== false) return;
    expect(wrongKind.message).toMatch(/not an independent source/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  // The whole reason this path exists: the density curves are unreachable
  // through the current plot, so a run that returned only totals has nothing
  // to draw and must say so rather than report an empty sweep.
  it("refuses a run whose spectral density plot never arrived", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue({ ...noiseResult(), extraPlots: [] });

    await expect(runNativeNoise(noiseDividerSchematic(), noiseSpec()))
      .rejects.toThrow(/no noise spectral density curves/i);
  });

  it("refuses a spectrum whose curve is shorter than its frequency scale", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult({ onoise: [9.1e-9, 9.1e-9] }));

    await expect(runNativeNoise(noiseDividerSchematic(), noiseSpec()))
      .rejects.toThrow(/no noise spectral density curves/i);
  });

  it("refuses to report totals ngspice did not return", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValue(noiseResult({ totals: [{ name: "onoise_total", real: [2.05e-7], imaginary: null }] }));

    await expect(runNativeNoise(noiseDividerSchematic(), noiseSpec()))
      .rejects.toThrow(/no integrated noise totals/i);
  });

  it("stays on the TypeScript solver outside a Tauri webview", async () => {
    expect(await runNativeNoise(noiseDividerSchematic(), noiseSpec())).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
