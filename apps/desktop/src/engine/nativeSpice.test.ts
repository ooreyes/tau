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
import { NO_AC_SOURCE_MESSAGE } from "../simulation/acSweep";
import { currentProbeTraces } from "../simulation/currentProbe";
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

const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

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

/** The same divider with an AC stimulus on its source, so an `.ac` sweep has
 *  something to excite it with. */
const acExcitedSchematic = () => ({
  ...rcSchematic(),
  components: rcSchematic().components.map((component) =>
    component.label === "V1" ? { ...component, value: "5 AC 1" } : component),
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

/** A common-emitter stage, wired through net labels. The transistor is the case
 *  that has no `#branch` current of any kind - only the `@q1[ic]` vector the
 *  deck's `.save` card asks for. Pin geometry: npn c=(x+16,y-32) b=(x-32,y)
 *  e=(x+16,y+32). */
const amplifierSchematic = () => ({
  components: [
    component("vsource", "v1", "V1", "5", 100, 300),
    component("resistor", "rb", "Rb", "10k", 250, 400),
    component("resistor", "rc", "Rc", "2k", 250, 200),
    component("npn", "q1", "Q1", "NPN", 500, 300),
  ],
  wires: [],
  netLabels: [
    lbl(100, 268, "vdd"), lbl(218, 200, "vdd"), lbl(218, 400, "vdd"),
    lbl(100, 332, "0"), lbl(516, 332, "0"),
    lbl(282, 400, "base"), lbl(468, 300, "base"),
    lbl(282, 200, "coll"), lbl(516, 268, "coll"),
  ] as NetLabel[],
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

  // ngspice chooses its own timestep, so the samples that come back are not on
  // the grid Tau asked for. A real `.tran 10u 2m` run opens with a 10 ps step
  // while the solver settles, which is what the first interval would report.
  it("reports the average sample interval, not ngspice's tiny opening step", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 1e-11, 0.0005, 0.001, 0.002], imaginary: null },
      { name: "v(n001)", real: [5, 5, 5, 5, 5], imaginary: null },
      { name: "v(n002)", real: [0, 0, 2.1, 3.2, 4.3], imaginary: null },
    ]));

    const result = await runNativeTransient(rcSchematic(), { stopTime: 0.002, steps: 200 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(result.stats.sampleCount).toBe(5);
    expect(result.stats.stopTime).toBe(0.002);
    expect(result.stats.stepSize).toBeCloseTo(0.0005, 12);
  });

  // A run whose output starts late spans only the samples it returned, so the
  // average is taken over that span rather than from zero.
  it("measures the average interval across the returned span, not from zero", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0.001, 0.0011, 0.002], imaginary: null },
      { name: "v(n001)", real: [5, 5, 5], imaginary: null },
      { name: "v(n002)", real: [1, 2, 3], imaginary: null },
    ]));

    const result = await runNativeTransient(rcSchematic(), { stopTime: 0.002, steps: 200 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    expect(result.stats.stepSize).toBeCloseTo(0.0005, 12);
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

  // A transistor has no `#branch` current and is not one of the passives
  // `deriveRcCurrents` reconstructs, so this vector is the only way it gets a
  // current trace at all - and it exists only because the deck asked for it.
  it("gives a transistor a current trace, read under the name its deck saved", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001, 0.002], imaginary: null },
      { name: "v(vdd)", real: [5, 5, 5], imaginary: null },
      { name: "v(coll)", real: [3.2, 3.1, 3.3], imaginary: null },
      { name: "v(base)", real: [0.7, 0.7, 0.7], imaginary: null },
      { name: "@q1[ic]", real: [0.0009, 0.00095, 0.00085], imaginary: null },
    ]));

    const result = await runNativeTransient(amplifierSchematic(), { stopTime: 0.002, steps: 200 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    // Labelled `I(Q1)` like every other current, because that is the spelling
    // `.meas`, plot expressions and the FFT picker all resolve.
    expect(result.currents).toEqual(expect.arrayContaining([
      { ref: "Q1", label: "I(Q1)", values: [0.0009, 0.00095, 0.00085] },
    ]));

    // And it reaches something drawn: a clamp probe dropped on the transistor
    // resolves to a plottable trace. Resolving to nothing was the whole bug -
    // the current existing in the result but never reaching the canvas would
    // be the same bug one step later.
    const traces = currentProbeTraces(result, [{
      id: "p-q1", x: 500, y: 300, color: "var(--trace-red)", componentId: "q1",
    }]);
    expect(traces).toEqual([{
      id: "I(Q1)",
      label: "I(Q1)",
      unit: "A",
      color: "var(--trace-red)",
      values: [0.0009, 0.00095, 0.00085],
    }]);
  });

  it("leaves a transistor without a trace when the run returned no device vector", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "time", real: [0, 0.001, 0.002], imaginary: null },
      { name: "v(vdd)", real: [5, 5, 5], imaginary: null },
      { name: "v(coll)", real: [3.2, 3.1, 3.3], imaginary: null },
    ]));

    const result = await runNativeTransient(amplifierSchematic(), { stopTime: 0.002, steps: 200 });

    expect(result).not.toBeNull();
    if (!result || !result.ok) return;
    // Absent, not zero: a fabricated flat line would read as a real measurement.
    expect(result.currents.some((current) => current.ref === "Q1")).toBe(false);
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

    const result = await runNativeAcSweep(acExcitedSchematic(), {
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

  it("refuses an AC sweep with no AC-excited source instead of plotting the dB floor", async () => {
    enableNativeRuntime();

    // ngspice answers this circuit without complaint, returning every node as
    // exactly 0 + 0j, which would reach the plot as a flat trace at -300 dB.
    const result = await runNativeAcSweep(rcSchematic(), { startHz: 10, stopHz: 100, pointsPerDecade: 10 });

    expect(result).toEqual({ ok: false, message: NO_AC_SOURCE_MESSAGE, warnings: [] });
    // Refused before the round trip, so the engine is never asked at all.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("counts an AC stimulus that only appears once the parameter scope is applied", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "frequency", real: [10, 100], imaginary: null },
      { name: "v(n001)", real: [1, 1], imaginary: [0, 0] },
    ]));

    const parameterized = {
      ...rcSchematic(),
      components: rcSchematic().components.map((component) =>
        component.label === "V1" ? { ...component, value: "5 AC {amp}" } : component),
      params: { scope: { amp: 1 }, funcs: {} },
    };

    const result = await runNativeAcSweep(parameterized, { startHz: 10, stopHz: 100, pointsPerDecade: 10 });

    expect(result?.ok).toBe(true);
    expect(invoke).toHaveBeenCalled();
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

// A `.op` deck now asks ngspice to `.save` a semiconductor's own current
// (spiceNetlist.ts `wantsDeviceCurrents`), so `runNativeOperatingPoint` can
// populate `branches` the same way the transient path populates `currents` -
// through the same `componentCurrentVector` helper, keyed by the deck's own
// record of what it asked for.
describe("native operating point branch currents", () => {
  const opAmplifierVectors = () => [
    { name: "v(vdd)", real: [5], imaginary: null },
    { name: "v(coll)", real: [3.2], imaginary: null },
    { name: "v(base)", real: [0.7], imaginary: null },
    { name: "@q1[ic]", real: [0.00095], imaginary: null },
    { name: "v1#branch", real: [-0.0023], imaginary: null },
  ];

  it("gives a BJT's operating-point current a branch keyed by component id, not refdes", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult(opAmplifierVectors()));

    const result = await runNativeOperatingPoint(amplifierSchematic());

    expect(invoke.mock.calls[0][1].request.netlist).toContain("@q1[ic]");
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    // `id` must be the SchematicComponent id ("q1"), never the refdes ("Q1"):
    // opAnnotations.ts locates a branch's component with
    // `circuit.components.find((c) => c.component.id === branch.id)`, so a
    // refdes here would silently place zero canvas current labels.
    expect(result.branches).toEqual(expect.arrayContaining([
      { id: "q1", label: "I(Q1)", current: 0.00095 },
    ]));
  });

  it("keeps a voltage source's operating-point #branch sign exactly as ngspice reports it", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult(opAmplifierVectors()));

    const result = await runNativeOperatingPoint(amplifierSchematic());

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    // ngspice's `#branch` on an `.op` run is already the raw MNA unknown the
    // `branches` contract (operatingPoint.ts) documents - the negative of the
    // conventional current out of the source's + terminal - so flipping it
    // here would silently disagree with the TS solver's own convention. This
    // is the sign-flip regression guard: a negative reading must stay negative.
    expect(result.branches).toEqual(expect.arrayContaining([
      { id: "v1", label: "I(V1)", current: -0.0023 },
    ]));
  });

  it("omits an operating-point component ngspice returned no current for, instead of reporting zero", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult(opAmplifierVectors()));

    const result = await runNativeOperatingPoint(amplifierSchematic());

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    // Rb/Rc have neither a device vector nor a `#branch` vector, and ngspice
    // returned neither for them here - absent, not a fabricated 0/NaN.
    expect(result.branches?.some((b) => b.id === "rb" || b.id === "rc")).toBe(false);
    expect(result.branches).toHaveLength(2);
  });

  it("returns no `branches` key at all when the run has none, matching the TS solver's optional field", async () => {
    enableNativeRuntime();
    invoke.mockResolvedValueOnce(nativeResult([
      { name: "v(n001)", real: [5], imaginary: null },
      { name: "v(n002)", real: [0], imaginary: null },
    ]));

    const result = await runNativeOperatingPoint(rcSchematic());

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.branches).toBeUndefined();
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
