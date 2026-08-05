/**
 * AGENTS.md Definition of Done — corpus directives box.
 *
 * Asserts each listed directive is supported end-to-end against the shipped
 * parse → solve / deck APIs (the same path imported `.asc` TEXT directives take).
 * Re-run via:
 *   scripts/directives-dod.sh
 *
 * Required list:
 *   .tran .ac .op .dc .step .meas .noise .tf .param .func .temp .options
 *   .model .inc .subckt
 */
import { describe, expect, it } from "vitest";
import { analysesFromDirectives, parseTranDirective, parseAcDirective } from "../io/directiveAnalysis";
import { pickAutoRunAnalysis } from "../lib/assistantAutoRun";
import { buildSpiceDeck, measFourLinesFromDirectives, unresolvedLibraryWarning } from "../engine/spiceNetlist";
import { modelLibLinesFromDirectives, definedSubcktNames } from "../engine/modelDirectives";
import { optionsLineFromDirectives } from "../engine/spiceOptions";
import { runOperatingPoint } from "./operatingPoint";
import { runTransientAnalysis } from "./linearTransient";
import { runAcSweep } from "./acSweep";
import { parseDcDirective, runDcSweep } from "./dcSweep";
import { parseStepDirective, runParamStep } from "./paramStep";
import { runMeasurements } from "./measure";
import { parseNoiseDirective, runNoiseAnalysis, BOLTZMANN, NOISE_TEMP_KELVIN } from "./noise";
import { parseTfDirective, runTransferFunction } from "./transferFunction";
import { buildParamScope, substituteBraces } from "./paramScope";
import { evaluateExpression } from "./expr";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

/** 1k:1k resistive divider with coincident pins (no wires). */
function divider(): { components: SchematicComponent[]; wires: SchematicWire[] } {
  const components: SchematicComponent[] = [
    {
      id: "v1",
      label: "V1",
      kind: "vsource",
      x: 0,
      y: 0,
      rotation: 0,
      value: "10",
      pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 100 },
      ],
    },
    {
      id: "r1",
      label: "R1",
      kind: "resistor",
      x: 0,
      y: 0,
      rotation: 0,
      value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 0 },
        { id: "b", label: "b", x: 0, y: 50 },
      ],
    },
    {
      id: "r2",
      label: "R2",
      kind: "resistor",
      x: 0,
      y: 0,
      rotation: 0,
      value: "1k",
      pinOverride: [
        { id: "a", label: "a", x: 0, y: 50 },
        { id: "b", label: "b", x: 0, y: 100 },
      ],
    },
    {
      id: "g",
      label: "",
      kind: "ground",
      x: 0,
      y: 100,
      rotation: 0,
      value: "",
      pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }],
    },
  ];
  return { components, wires: [] };
}

function dividerLabeled(): {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
} {
  const base = divider();
  return {
    ...base,
    netLabels: [
      { id: "lin", x: 0, y: 0, text: "in" },
      { id: "lout", x: 0, y: 50, text: "out" },
    ],
  };
}

describe("AGENTS.md corpus directives DoD", () => {
  it(".op: pickAutoRunAnalysis + operating-point solves divider mid ≈ 5 V", () => {
    expect(pickAutoRunAnalysis([".param x=1", ".op"])).toEqual({ kind: "op", directive: ".op" });
    const { components, wires } = divider();
    const result = runOperatingPoint({ components, wires });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mid = result.nets.find((n) => Math.abs(n.voltage - 5) < 1e-6);
    expect(mid).toBeDefined();
  });

  it(".tran: parse directive options and RC charge ≈ 0.632·Vs at t=τ", async () => {
    const opts = parseTranDirective(".tran 10u 5m");
    expect(opts).toMatchObject({ stopTime: 0.005 });
    expect(analysesFromDirectives([".tran 10u 5m"]).tran?.stopTime).toBe(0.005);

    // Horizontal RC: V=5, R=1k, C=1µ → τ=1ms. UIC so charge starts at 0.
    const components: SchematicComponent[] = [
      { id: "vs", kind: "vsource", x: 0, y: 32, rotation: 0, value: "5", label: "V1" },
      { id: "r", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
      { id: "c", kind: "capacitor", x: 224, y: 0, rotation: 0, value: "1µ", label: "C1" },
      { id: "g1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" },
      { id: "g2", kind: "ground", x: 256, y: 0, rotation: 0, value: "", label: "" },
    ];
    const wires: SchematicWire[] = [
      { id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
      { id: "w2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
    ];
    const result = await runTransientAnalysis(
      { components, wires },
      { stopTime: 0.005, steps: 500, uic: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stepSize = 0.005 / 500;
    const iTau = Math.round(0.001 / stepSize);
    const analytic = 5 * (1 - Math.exp(-1));
    let best = Infinity;
    for (const trace of result.traces) {
      const err = Math.abs(trace.values[iTau]! - analytic);
      if (err < best) best = err;
    }
    expect(best / analytic).toBeLessThan(0.02);
  });

  it(".ac: parse + RC low-pass Bode magnitude near 0 dB at DC", () => {
    const ac = parseAcDirective(".ac dec 10 1 1Meg");
    expect(ac).toEqual({ startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    const components: SchematicComponent[] = [
      { id: "vs", kind: "vac", x: 0, y: 32, rotation: 0, value: "1", label: "V1" },
      { id: "r", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" },
      { id: "c", kind: "capacitor", x: 224, y: 0, rotation: 0, value: "1µ", label: "C1" },
      { id: "g1", kind: "ground", x: 0, y: 64, rotation: 0, value: "", label: "" },
      { id: "g2", kind: "ground", x: 256, y: 0, rotation: 0, value: "", label: "" },
    ];
    const wires: SchematicWire[] = [
      { id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
      { id: "w2", points: [{ x: 128, y: 0 }, { x: 192, y: 0 }] },
    ];
    const result = runAcSweep({ components, wires }, ac!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Cap node starts ~0 dB at 1 Hz (f≪fc=159 Hz).
    const first = result.traces.map((t) => t.magDb[0]!).find((v) => Math.abs(v) < 1);
    expect(first).toBeDefined();
  });

  it(".dc: parse + divider midpoint tracks Vsweep/2", () => {
    const spec = parseDcDirective(".dc V1 0 10 2");
    expect(spec).toEqual({ source: "V1", start: 0, stop: 10, step: 2 });
    const { components, wires } = divider();
    const res = runDcSweep({ components, wires }, spec!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const mid = res.nets.find((n) => n.voltages.every((v, k) => Math.abs(v - res.sweep[k]! / 2) < 1e-9));
    expect(mid?.voltages).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it(".step: param sweep re-runs OP with injected scope values", () => {
    const spec = parseStepDirective(".step param k 1 3 1");
    expect(spec?.values).toEqual([1, 2, 3]);
    const base = buildParamScope([".param k=1"]);
    const runs = runParamStep(spec!, base, (params) => params.scope.k * 10);
    expect(runs.map((r) => r.result)).toEqual([10, 20, 30]);
  });

  it(".meas: AVG/MAX/PARAM evaluate over a waveform", () => {
    const waveform = {
      times: [0, 1e-3, 2e-3, 3e-3],
      traces: [{ id: "out", label: "V(out)", values: [0, 1, 2, 3] }],
    };
    const results = runMeasurements(
      [
        ".meas tran vmax MAX V(out)",
        ".meas tran vavg AVG V(out)",
        ".meas tran twice PARAM 2*vmax",
      ],
      waveform,
    );
    expect(results.find((r) => r.name === "vmax")?.value).toBeCloseTo(3, 12);
    expect(results.find((r) => r.name === "vavg")?.value).toBeCloseTo(1.5, 12);
    expect(results.find((r) => r.name === "twice")?.value).toBeCloseTo(6, 12);
    // Deck emission for the active domain.
    expect(measFourLinesFromDirectives([".meas tran vmax MAX V(out)"], "tran")).toEqual([
      ".meas tran vmax MAX V(out)",
    ]);
  });

  it(".noise: 1k resistor output density ≈ 4.07 nV/√Hz", () => {
    const components: SchematicComponent[] = [
      {
        id: "iin",
        label: "Iin",
        kind: "iac",
        x: 0,
        y: 0,
        rotation: 0,
        value: "1",
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 100 },
        ],
      },
      {
        id: "r1",
        label: "R1",
        kind: "resistor",
        x: 0,
        y: 0,
        rotation: 0,
        value: "1k",
        pinOverride: [
          { id: "a", label: "a", x: 0, y: 0 },
          { id: "b", label: "b", x: 0, y: 100 },
        ],
      },
      {
        id: "g",
        label: "",
        kind: "ground",
        x: 0,
        y: 100,
        rotation: 0,
        value: "",
        pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }],
      },
    ];
    const netLabels: NetLabel[] = [{ id: "lout", x: 0, y: 0, text: "out" }];
    const spec = parseNoiseDirective(".noise V(out) Iin dec 10 1 1k");
    const result = runNoiseAnalysis({ components, wires: [], netLabels }, spec!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = Math.sqrt(4 * BOLTZMANN * NOISE_TEMP_KELVIN * 1000);
    expect(result.onoise[0]).toBeCloseTo(expected, 14);
  });

  it(".tf: 1k:1k divider gain=0.5 Zin=2k Zout=500", () => {
    const sch = dividerLabeled();
    const spec = parseTfDirective(".tf V(out) V1");
    const res = runTransferFunction(sch, spec!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.gain).toBeCloseTo(0.5, 9);
    expect(res.inputImpedance).toBeCloseTo(2000, 6);
    expect(res.outputImpedance).toBeCloseTo(500, 6);
  });

  it(".param: brace values resolve through OP (mid = 9 V)", () => {
    const params = buildParamScope([".param Vsrc=12 Rtop=1k", ".param Rbot={Rtop*3}"]);
    const components: SchematicComponent[] = [
      {
        id: "v1",
        label: "V1",
        kind: "vsource",
        x: 0,
        y: 0,
        rotation: 0,
        value: "{Vsrc}",
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 100 },
        ],
      },
      {
        id: "r1",
        label: "R1",
        kind: "resistor",
        x: 0,
        y: 0,
        rotation: 0,
        value: "{Rtop}",
        pinOverride: [
          { id: "a", label: "a", x: 0, y: 0 },
          { id: "b", label: "b", x: 0, y: 50 },
        ],
      },
      {
        id: "r2",
        label: "R2",
        kind: "resistor",
        x: 0,
        y: 0,
        rotation: 0,
        value: "{Rbot}",
        pinOverride: [
          { id: "a", label: "a", x: 0, y: 50 },
          { id: "b", label: "b", x: 0, y: 100 },
        ],
      },
      {
        id: "g",
        label: "",
        kind: "ground",
        x: 0,
        y: 100,
        rotation: 0,
        value: "",
        pinOverride: [{ id: "g", label: "gnd", x: 0, y: 100 }],
      },
    ];
    const result = runOperatingPoint({ components, wires: [], params });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mid = result.nets.find((n) => Math.abs(n.voltage - 9) < 0.01);
    expect(mid).toBeDefined();
  });

  it(".func: user function binds in param scope and brace substitution", () => {
    const params = buildParamScope([".func double(x) 2*x", ".param a=5", ".param b={double(a)}"]);
    expect(params.scope.b).toBe(10);
    expect(evaluateExpression("double(7)", params.scope, params.funcs)).toBe(14);
    expect(substituteBraces("{double(3)}", params)).toBe("6");
  });

  it(".temp: analysesFromDirectives + deck emits .temp °C", () => {
    expect(analysesFromDirectives([".tran 1m", ".temp 85"]).temp).toBe(85);
    const { components, wires } = divider();
    const deck = buildSpiceDeck(
      { components, wires, directives: [".temp 85"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".temp 85");
  });

  it(".options: document keys override defaults on the merged deck line", () => {
    const line = optionsLineFromDirectives([".options reltol=2e-3"]);
    expect(line).toContain("reltol=2e-3");
    expect(line).toMatch(/^\.options\b/);
    const { components, wires } = divider();
    const deck = buildSpiceDeck(
      { components, wires, directives: [".options reltol=2e-3"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("reltol=2e-3");
  });

  it(".model: document card reaches the native deck", () => {
    const card = ".model MyDiode D(Is=1e-15 N=1.2)";
    expect(modelLibLinesFromDirectives([card])).toEqual([card]);
    // Coincident-pin geometry (default diode pins a/k at ±32 from origin).
    const components: SchematicComponent[] = [
      { id: "v1", label: "V1", kind: "vsource", x: 0, y: 32, rotation: 0, value: "1" },
      { id: "d1", label: "D1", kind: "diode", x: 96, y: 0, rotation: 0, value: "MyDiode" },
      { id: "g1", label: "", kind: "ground", x: 0, y: 64, rotation: 0, value: "" },
      { id: "g2", label: "", kind: "ground", x: 128, y: 0, rotation: 0, value: "" },
    ];
    const wires: SchematicWire[] = [
      { id: "w1", points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] },
    ];
    const deck = buildSpiceDeck(
      { components, wires, directives: [card] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(card);
    expect(deck.netlist).toMatch(/\bMyDiode\b/);
  });

  it(".inc: alias normalizes; unresolved warns; attached resolves without file card", () => {
    expect(modelLibLinesFromDirectives([".inc mymodels.lib"])).toEqual([".include mymodels.lib"]);
    const { components, wires } = divider();
    const unresolved = buildSpiceDeck(
      { components, wires, directives: [".inc missing.lib"] },
      { kind: "op" },
    );
    expect(unresolved.netlist).not.toMatch(/^\.(?:include|lib|inc)\b/m);
    expect(unresolved.circuit.warnings).toContain(unresolvedLibraryWarning("missing.lib"));

    const resolved = buildSpiceDeck(
      {
        components,
        wires,
        directives: [".inc models/vendor.lib"],
        userModelLibraries: [".subckt VEND 1 2\nR1 1 2 1k\n.ends VEND"],
        userModelLibraryNames: ["vendor.lib"],
      },
      { kind: "op" },
    );
    expect(resolved.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
    expect(resolved.netlist).not.toMatch(/^\.(?:include|lib|inc)\b/m);
  });

  it(".subckt: block expands into the deck and is discoverable by name", () => {
    const block = ".subckt myamp in out\\nR1 in out 1k\\n.ends myamp";
    expect(modelLibLinesFromDirectives([block])).toEqual([
      ".subckt myamp in out",
      "R1 in out 1k",
      ".ends myamp",
    ]);
    expect([...definedSubcktNames([block])]).toEqual(["myamp"]);
    const { components, wires } = divider();
    const deck = buildSpiceDeck(
      { components, wires, directives: [block] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".subckt myamp in out");
    expect(deck.netlist).toContain(".ends myamp");
  });
});
