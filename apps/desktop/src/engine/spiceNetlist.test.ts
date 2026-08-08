import { describe, expect, it } from "vitest";
import {
  buildSpiceDeck,
  includedFileName,
  nestedXSubcktRefs,
  unresolvedModelMessage,
  transformerWindings,
  unresolvedLibraryWarning,
  unresolvedSubcktMessage,
  laplaceApproximationWarning,
  clampedLoadSourceWarning,
} from "./spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";
import type { NetLabel, PinOverride, SchematicComponent, SchematicWire } from "../schematic/types";
import { CATALOG } from "../schematic/catalog";
import { buildSubcircuitPinOverride } from "../schematic/subcircuitGeometry";

const component = (
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id: label, kind, label, value, x, y, rotation: 0 });

const wire = (id: string, points: { x: number; y: number }[]): SchematicWire => ({ id, points });

describe("buildSpiceDeck", () => {
  it("builds a finite simulation deck for every default Library component", () => {
    for (const [index, entry] of CATALOG.entries()) {
      const placed = component(
        entry.kind,
        entry.kind === "ground" ? "" : `${entry.prefix}${index + 1}`,
        entry.defaultValue,
        128,
        128,
      );
      const grounded = component("ground", "", "", 0, 0);
      const deck = buildSpiceDeck({ components: [grounded, placed], wires: [] }, { kind: "op" });
      expect(deck.netlist, entry.kind).toContain(".op");
      expect(deck.netlist, entry.kind).not.toMatch(/\b(?:NaN|undefined|Infinity)\b/);
    }
  });

  it("emits a named vendor op-amp as its exact attached five-pin subcircuit", () => {
    const vendor: SchematicComponent = {
      ...component("opamp", "U1", "OP07 LT1001", 0, 0),
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001",
        extras: { Value2: "LT1001" },
      },
      pinOverride: [
        { id: "in+", label: "In+", x: 0, y: 0 },
        { id: "in-", label: "In-", x: 0, y: 16 },
        { id: "out", label: "OUT", x: 64, y: 8 },
        { id: "v+", label: "V+", x: 32, y: -16 },
        { id: "v-", label: "V-", x: 32, y: 32 },
      ],
    };
    const netLabels: NetLabel[] = [
      { id: "p", x: 0, y: 0, text: "inp" },
      { id: "m", x: 0, y: 16, text: "inm" },
      { id: "vp", x: 32, y: -16, text: "vdd" },
      { id: "vm", x: 32, y: 32, text: "0" },
      { id: "o", x: 64, y: 8, text: "out" },
    ];
    const userModelLibraries = [
      ".subckt LT1001 plus minus vplus vminus output\nE1 output 0 plus minus 10\n.ends LT1001",
    ];

    const deck = buildSpiceDeck(
      { components: [vendor], wires: [], netLabels, userModelLibraries },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".subckt LT1001 plus minus vplus vminus output");
    expect(deck.netlist).toMatch(/^XU1 inp inm vdd 0 out LT1001$/m);
    expect(deck.netlist).not.toMatch(/^[BE]_U1\b/m);
  });

  it("refuses a named vendor op-amp when its exact model is missing or has the wrong interface", () => {
    const vendor: SchematicComponent = {
      ...component("opamp", "U1", "LT1001", 0, 0),
      ltSymbolType: "Opamps\\LT1001",
    };
    const grounded: NetLabel[] = [{ id: "g", x: 0, y: 0, text: "0" }];
    expect(() => buildSpiceDeck({ components: [vendor], wires: [], netLabels: grounded }, { kind: "op" }))
      .toThrow(/Simulation refused: U1 \(LT1001\).*no document definition or attached Model Library.*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck({
      components: [vendor],
      wires: [],
      netLabels: grounded,
      userModelLibraries: [".subckt LT1001 1 2 3 4 5 6 7\nR1 1 2 1k\n.ends LT1001"],
    }, { kind: "op" })).toThrow(/exposes 7 terminals instead of the required five/);
  });

  it("refuses vendor OTA noise whose frequency law cannot be preserved", () => {
    const vendor: SchematicComponent = {
      ...component("opamp", "U1", "AMP", 0, 0),
      ltSymbolType: "Opamps\\AMP",
    };
    const model = [
      ".subckt AMP 1 2 3 4 5",
      "A1 1 2 0 0 0 0 5 0 OTA g=1m en={2n*sqrt(freq)} Vhigh=1e308 Vlow=-1e308",
      ".ends AMP",
    ].join("\n");
    expect(() => buildSpiceDeck({
      components: [vendor],
      wires: [],
      netLabels: [{ id: "g", x: 0, y: 0, text: "0" }],
      userModelLibraries: [model],
    }, {
      kind: "noise",
      output: { node: "out" },
      source: "V1",
      startHz: 10,
      stopHz: 1e6,
      pointsPerDecade: 20,
    })).toThrow(/frequency-dependent.*will not flatten.*No approximate or partial circuit was run/i);
  });

  it("normalizes an inline document vendor subcircuit once before using it", () => {
    const vendor: SchematicComponent = {
      ...component("opamp", "U1", "LT1001", 0, 0),
      ltSymbolType: "Opamps\\LT1001",
    };
    const directives = [[
      ".subckt LT1001 1 2 3 4 5",
      "C1 1 2 1p Rpar=1G",
      "I1 3 4 10u load",
      ".ends LT1001",
    ].join("\n")];
    const deck = buildSpiceDeck({
      components: [vendor],
      wires: [],
      directives,
      netLabels: [{ id: "g", x: 0, y: 0, text: "0" }],
    }, { kind: "op" });
    expect(deck.netlist.match(/^\.subckt LT1001\b/gm)).toHaveLength(1);
    expect(deck.netlist).toContain("R__tau_rpar_LT1001_C1 1 2 1G");
    expect(deck.netlist).toContain("B__tau_load_I1 3 4 I={(10u)*");
    expect(deck.netlist).not.toMatch(/\bRpar=/i);
    expect(deck.netlist).not.toMatch(/^I1\s+3\s+4\s+10u\s+load$/mi);
  });

  it("emits an ngspice transient deck for a grounded RC circuit", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "1u", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.005, steps: 500 });

    expect(deck.netlist).toContain("V1 n001 0 DC 5");
    expect(deck.netlist).toContain("R1 n001 n002 1000");
    expect(deck.netlist).toContain("C1 n002 0 0.000001");
    expect(deck.netlist).toContain(".tran 0.00001 0.005");
    expect(deck.netlist).toMatch(/\.end$/);
    // Default options line is present when the document carries none.
    expect(deck.netlist).toContain(".options gmin=1e-12 reltol=1e-4 abstol=1e-12 vntol=1e-7");
  });

  it("evaluates LTspice brace arithmetic even when it references no .param", () => {
    const components = [
      component("vsource", "V1", "{3.3/2}", 0, 32),
      component("resistor", "R1", "{5.1Meg+120K}", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });

    expect(deck.netlist).toContain("V1 n001 0 DC 1.65");
    expect(deck.netlist).toContain("R1 n001 0 5220000");
    expect(deck.netlist).not.toContain("{");
  });

  it("emits LTspice charge-defined capacitors as native ngspice Q expressions", () => {
    const components = [
      component("vsource", "V1", "PULSE(0 1 0 1n 1n 5u 10u)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "Q=100p*x*sin(2*pi*2K*time)+1p*V(out) IC=0", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];

    const deck = buildSpiceDeck(
      { components, wires, netLabels: [{ id: "out", x: 192, y: 0, text: "out" }] },
      { kind: "tran", stopTime: 20e-6, steps: 200 },
    );

    expect(deck.netlist).toContain("C1 out 0 Q='100p*(V(out,0))*sin(2*pi*2K*time)+1p*V(out)' IC=0");
    expect(deck.netlist).not.toContain("needs a valid F value");
  });

  it("preserves an LTspice negative capacitor exactly through Q(V)=C*V", () => {
    const components = [
      component("vsource", "V1", "AC 1", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "-159.1549n", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];

    const deck = buildSpiceDeck(
      { components, wires, netLabels: [{ id: "out", x: 192, y: 0, text: "out" }] },
      { kind: "ac", startHz: 100, stopHz: 10_000, pointsPerDecade: 10 },
    );

    expect(deck.netlist).toContain("C1 out 0 Q='(-1.591549e-7)*V(out,0)'");
    expect(deck.netlist).not.toContain("needs a positive F value");
  });

  it("preserves authored transient output-start and maximum-step controls", () => {
    const components = [component("resistor", "R1", "1k", 0, 0), component("ground", "", "", 64, 0)];
    const deck = buildSpiceDeck({ components, wires: [] }, {
      kind: "tran",
      stopTime: 0.001,
      steps: 240,
      startTime: 0.00099,
      maxStep: 1e-8,
      uic: true,
    });
    expect(deck.netlist).toContain(".tran 0.000004166666666666667 0.001 0.00099 1e-8 uic");
  });

  it("emulates LTspice startup by ramping DC sources for 20 µs and using uic", () => {
    const components = [
      component("vsource", "V1", "7", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, {
      kind: "tran", stopTime: 500e-6, steps: 240, startup: true,
    });
    expect(deck.netlist).toContain("V1 n001 0 DC 7 PWL(0 0 0.00002 7)");
    expect(deck.netlist).toMatch(/\.tran .* uic/);
  });

  it("emits the AC stimulus on an imported V source (SINE + AC spec)", () => {
    // LTspice Draft1: SYMATTR Value SINE(0 1 1) + SYMATTR Value2 AC 1 → one value.
    const components = [
      component("vsource", "V1", "SINE(0 1 1) AC 1", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "ac", startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    // The SIN(...) transient form survives and the AC magnitude is appended.
    expect(deck.netlist).toMatch(/V1 n001 0 DC 0 SIN\(0 1 1\) AC 1/);
  });

  it("emits the AC stimulus on a plain DC V source with an AC spec", () => {
    const components = [
      component("vsource", "V1", "5 AC 2", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toContain("V1 n001 0 DC 5 AC 2");
  });

  it("emits a bundled LTspice standard model when a diode references it by name", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("diode", "D1", "1N4148", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // The real 1N4148 model is emitted and the device line references it by name.
    expect(deck.netlist).toMatch(/^\.model 1N4148 D\(/m);
    expect(deck.netlist).toMatch(/D1 \S+ \S+ 1N4148/);
    // The generic TAU_DIODE is NOT used for this part's device line.
    expect(deck.netlist).not.toMatch(/D1 \S+ \S+ TAU_DIODE/);
  });

  it("maps top-level document ideal D(Ron=/Ilimit=) onto sidiode A-instances", () => {
    // HandsFreePreamp ElectretMic path: on-schematic ideal diode must not stay
    // as Berkeley D (ngspice ignores Ron/Ilimit → waveform miss).
    const components = [
      component("isource", "I1", "1u", 0, 32),
      component("diode", "D2", "ElectretMic", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const directives = [".model ElectretMic D(Ron=1.15K Ilimit=400u)"];
    const ng = buildSpiceDeck({ components, wires, directives }, { kind: "op" });
    expect(ng.netlist).toMatch(/\.model\s+ElectretMic\s+sidiode\(Ron=1\.15K Ilimit=400u\)/i);
    expect(ng.netlist).toMatch(/^A__tau_D2\s+\S+\s+\S+\s+ElectretMic\b/m);
    expect(ng.netlist).not.toMatch(/^D2\s+/m);
    expect(ng.netlist).not.toMatch(/@d2\[id\]/i);
    const lt = buildSpiceDeck(
      { components, wires, directives },
      { kind: "op" },
      { idealDiodeAsSidiode: false },
    );
    expect(lt.netlist).toMatch(/\.model\s+ElectretMic\s+D\(Ron=1\.15K Ilimit=400u\)/i);
    expect(lt.netlist).toMatch(/^D2\s+\S+\s+\S+\s+ElectretMic\b/m);
  });

  it("refuses an unknown diode part name rather than plotting the generic diode", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("diode", "D1", "MYSTERY_PART", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    expect(() => buildSpiceDeck({ components, wires }, { kind: "op" })).toThrow(
      'Simulation refused: D1 names model "MYSTERY_PART", but Tau could not resolve it.',
    );
  });

  it("emits a capacitor IC and adds uic to the transient (Draft10 case)", () => {
    const components = [
      component("capacitor", "C1", "100p IC=1", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 32),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 100 });
    expect(deck.netlist).toMatch(/C1 \S+ \S+ 1e-10 IC=1/);
    expect(deck.netlist).toMatch(/\.tran .* uic/);
  });

  it("expands LTspice capacitor Rser into an explicit series resistor", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "22u Rser=1m", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 1e-3, steps: 100 });
    expect(deck.netlist).toMatch(/^C1\s+\S+\s+tau_c1_esr\s+0\.000022$/m);
    expect(deck.netlist).toMatch(/^RTAU_C1_ESR\s+tau_c1_esr\s+0\s+0\.001$/m);
  });

  it("expands LTspice capacitor Cpar/Rpar across the original terminals (LT1248)", () => {
    // Applications/LT1248 C4: `100p Rser=10K Cpar=10p` — leftover Cpar used to
    // hard-fail as "needs a valid F value" instead of building an exact deck.
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("capacitor", "C4", "100p Rser=10K Cpar=10p", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/^C4\s+\S+\s+tau_c4_esr\s+1e-10$/m);
    expect(deck.netlist).toMatch(/^RTAU_C4_ESR\s+tau_c4_esr\s+0\s+10000$/m);
    expect(deck.netlist).toMatch(/^CTAU_C4_CPAR\s+\S+\s+0\s+1e-11$/m);
    expect(deck.netlist).not.toMatch(/\bCpar=/i);
    expect(deck.netlist).not.toMatch(/\bRser=/i);
  });

  it("strips an LTspice inline ;comment on a voltage source (ADG1519)", () => {
    const components = [
      component("vsource", "V3", "5;PULSE(0 5 0 20n 20n 10u 20u)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/^V3\s+\S+\s+0\s+DC\s+5$/m);
    expect(deck.netlist).not.toMatch(/PULSE/i);
  });

  it("builds a paren-less PWL voltage source (LT8708-1)", () => {
    const components = [
      component("vsource", "V3", "PWL 0 0 +10u 3.3 3m 3.3 +10u 0", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/^V3\s+\S+\s+0\s+DC\s+0\s+PWL\(/m);
  });

  it("keeps Rload+ and Rload- as distinct SPICE instance names (LTC3260)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "Rload+", "1k", 96, 0),
      component("resistor", "Rload-", "2k", 192, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
      component("ground", "", "", 224, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/^Rload_p\s+/m);
    expect(deck.netlist).toMatch(/^Rload_m\s+/m);
  });

  it("expands LTspice voltage-source Rser into an explicit series resistor (NoiseFigure)", () => {
    // Educational NoiseFigure.asc: V1 Value2=AC 1, SpiceLine Rser=1K. ngspice
    // rejects Rser= on V, so the deck must expand it the same way C/L ESR does.
    const components = [
      component("vsource", "V1", "AC 1 Rser=1K", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, {
      kind: "noise",
      output: { node: "n001" },
      source: "V1",
      startHz: 1e3,
      stopHz: 1e5,
      pointsPerDecade: 10,
    });
    expect(deck.netlist).toMatch(/^V1\s+tau_v1_rser\s+0\s+DC\s+0\s+AC\s+1$/m);
    expect(deck.netlist).toMatch(/^RTAU_V1_RSER\s+\S+\s+tau_v1_rser\s+1000$/m);
    expect(deck.netlist).not.toMatch(/\bRser=/i);
  });

  it("expands LTspice inductor Rser without changing the coupled inductor name", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("inductor", "Lp", "200u Rser=10m", 96, 0),
      component("resistor", "R1", "1k", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires, directives: ["K Lp Ls 1"] }, { kind: "tran", stopTime: 1e-3, steps: 100 });
    const inductorLine = deck.netlist.split("\n").find((line) => line.startsWith("Lp "))!;
    expect(inductorLine.split(/\s+/).slice(0, 3)).toEqual(["Lp", "n001", "tau_lp_esr"]);
    expect(Number(inductorLine.split(/\s+/)[3])).toBeCloseTo(200e-6);
    expect(deck.netlist).toMatch(/^RTAU_Lp_ESR\s+tau_lp_esr\s+\S+\s+0\.01$/m);
    expect(deck.netlist).toContain("K Lp Ls 1");
  });

  it("does not add uic when no instance carries an IC", () => {
    const components = [
      component("capacitor", "C1", "100p", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 32),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 100 });
    expect(deck.netlist).not.toMatch(/uic/);
  });

  it("allows a negative resistance (SPICE active element, Draft7's -1k)", () => {
    const components = [
      component("vsource", "V1", "1", 0, 32),
      component("resistor", "R1", "-1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/R1 \S+ \S+ -1000/);
  });

  it("emits a zero-ohm short (LTspice Value 0)", () => {
    const components = [
      component("vsource", "V1", "1", 0, 32),
      component("resistor", "R1", "0", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/R1 \S+ \S+ 0/);
  });

  it("refuses a time-varying PWL resistance", () => {
    const components = [
      component("resistor", "R1", "PWL(0 1k 1m 2k)", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" })).toThrow(
      "Simulation refused: R1 uses a time-varying PWL resistance Tau cannot map exactly. No approximate or partial circuit was run.",
    );
  });

  it("refuses a paren-less PWL resistance", () => {
    const components = [
      component("resistor", "R1", "PWL 0 1k 1m 2k", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" })).toThrow(
      /time-varying PWL resistance/,
    );
  });

  it("omits a zero-valued capacitor (open circuit)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("capacitor", "Ccomp_H", "0p", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).not.toMatch(/^Ccomp_H\b/m);
  });

  it("omits a zero-valued capacitor after param expansion", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("capacitor", "Ccomp_H", "{Ccomp}", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, params: buildParamScope([".param Ccomp=0p"]) },
      { kind: "op" },
    );
    expect(deck.netlist).not.toMatch(/^Ccomp_H\b/m);
  });

  it("refuses a malformed truncated PWL voltage source", () => {
    const components = [
      component("vsource", "V5", "PWL(0 0 10m 0 +100n 3.3", 0, 32),
      component("ground", "", "", 0, 64),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" })).toThrow(
      "Simulation refused: V5 has a malformed PWL waveform. No approximate or partial circuit was run.",
    );
  });

  it("lets a document's .options directive override the default deck options", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".options reltol=1e-3 maxstep=1n"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("reltol=1e-3");
    expect(deck.netlist).not.toContain("reltol=1e-4");
    expect(deck.netlist).toContain("maxstep=1n");
    // Untouched defaults remain.
    expect(deck.netlist).toContain("gmin=1e-12");
  });

  it("emits a document .temp setting into the deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".temp 85"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".temp 85");
    // No .temp line when the document carries none.
    const plain = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(plain.netlist).not.toContain(".temp");
  });

  it("passes .ic/.nodeset through and adds uic to the transient line", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("capacitor", "C1", "1u", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".ic V(out)=2", ".nodeset V(mid)=1"] },
      { kind: "tran", stopTime: 0.005, steps: 500 },
    );
    expect(deck.netlist).toContain(".ic V(out)=2");
    expect(deck.netlist).toContain(".nodeset V(mid)=1");
    expect(deck.netlist).toMatch(/\.tran [\d.e-]+ 0\.005 uic/);
  });

  it("emits domain-matched .meas and .four into the native deck (P1.6)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const directives = [
      ".meas tran peak MAX V(out)",
      ".meas ac gain FIND V(out) AT=1k",
      ".measure Efficiency PARAM PL/PS",
      ".four 1k V(out)",
      ".step param X list 1 2",
    ];
    const tran = buildSpiceDeck(
      { components, wires, directives },
      { kind: "tran", stopTime: 0.001, steps: 100 },
    );
    expect(tran.netlist).toContain(".meas tran peak MAX V(out)");
    expect(tran.netlist).toContain(".measure Efficiency PARAM PL/PS");
    expect(tran.netlist).toContain(".four 1k V(out)");
    expect(tran.netlist).not.toContain(".meas ac gain");
    expect(tran.netlist).not.toContain(".step");
    // Cards sit after the analysis line and before .end.
    const tranIdx = tran.netlist.indexOf(".tran ");
    const measIdx = tran.netlist.indexOf(".meas tran peak");
    const endIdx = tran.netlist.lastIndexOf(".end");
    expect(tranIdx).toBeGreaterThan(-1);
    expect(measIdx).toBeGreaterThan(tranIdx);
    expect(endIdx).toBeGreaterThan(measIdx);

    // Opt-in native-step path only: default decks must stay step-free so the
    // TypeScript re-run loop cannot double-step.
    const nativeStep = buildSpiceDeck(
      { components, wires, directives },
      { kind: "tran", stopTime: 0.001, steps: 100 },
      { emitNativeStep: true },
    );
    expect(nativeStep.netlist).toContain(".step param X list 1 2");
    expect(nativeStep.netlist).toMatch(/\.param\b[\s\S]*\bX=1\b/);
    const stepIdx = nativeStep.netlist.indexOf(".step param X");
    expect(stepIdx).toBeGreaterThan(nativeStep.netlist.indexOf(".tran "));
    expect(stepIdx).toBeLessThan(nativeStep.netlist.indexOf(".meas tran peak"));

    const ac = buildSpiceDeck(
      { components, wires, directives },
      { kind: "ac", startHz: 10, stopHz: 1e6, pointsPerDecade: 10 },
    );
    expect(ac.netlist).toContain(".meas ac gain FIND V(out) AT=1k");
    expect(ac.netlist).not.toContain(".meas tran peak");
    expect(ac.netlist).not.toContain(".four");
  });

  it("leaves unresolved {param} and emits .param/.step for native param sweeps (P1.6)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "{Rload}", 96, 0),
      component("capacitor", "C1", "1u", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const directives = [".param Rfixed=2k", ".step param Rload list 1k 2k"];
    const params = buildParamScope(directives);

    // Default path still bakes braces so the TS re-run loop can inject per value.
    const baked = buildSpiceDeck(
      { components, wires, directives, params },
      { kind: "tran", stopTime: 0.001, steps: 100 },
    );
    expect(baked.netlist).toMatch(/\bR1\b.*\b1000\b/);
    expect(baked.netlist).not.toContain("{Rload}");
    expect(baked.netlist).not.toContain(".step");
    expect(baked.netlist).not.toMatch(/\.param\b/);

    const native = buildSpiceDeck(
      { components, wires, directives, params },
      { kind: "tran", stopTime: 0.001, steps: 100 },
      { emitNativeStep: true },
    );
    expect(native.netlist).toMatch(/\bR1\b[^\n]*\{Rload\}/);
    expect(native.netlist).toMatch(/\.param\b[\s\S]*\bRload=1000\b/);
    expect(native.netlist).toMatch(/\.param\b[\s\S]*\bRfixed=2000\b/);
    expect(native.netlist).toContain(".step param Rload list 1k 2k");
    // Non-stepped braces still bake; fixed params need not appear as braces.
    expect(native.netlist).not.toContain("{Rfixed}");
  });

  it("does not emit .param on a source-only native .step deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const native = buildSpiceDeck(
      { components, wires, directives: [".step V1 list 1 5"] },
      { kind: "tran", stopTime: 0.001, steps: 100 },
      { emitNativeStep: true },
    );
    expect(native.netlist).toContain(".step V1 list 1 5");
    expect(native.netlist).not.toMatch(/\.param\b/);
  });

  it("translates LTspice tc= into ngspice tc1=/tc2= on resistors", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k tc=0.01,1e-6", 96, 0),
      component("resistor", "R2", "2k", 160, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 192, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 160, y: 0 }]),
    ];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".step temp 27 77 50"] },
      { kind: "tran", stopTime: 0.001, steps: 100 },
      { emitNativeStep: true },
    );
    expect(deck.netlist).toMatch(/\bR1\b[^\n]*\b1000\b[^\n]*\btc1=0\.01\b[^\n]*\btc2=1e-6\b/);
    expect(deck.netlist).not.toMatch(/\btc=/);
    expect(deck.netlist).toContain(".step temp 27 77 50");
    // Plain resistor stays magnitude-only.
    expect(deck.netlist).toMatch(/\bR2\b[^\n]*\b2000\b/);
    expect(deck.netlist).not.toMatch(/\bR2\b[^\n]*tc1=/);
  });

  it("strips LTspice noiseless from schematic resistor Value (AD3541R)", () => {
    // Applications/AD3541R R1: `1k noiseless` — flag is not magnitude; ngspice
    // rejects it on the instance line. Keep exact 1k, never silent-sub.
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k noiseless", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 128, y: 0 }]),
    ];
    const deck = buildSpiceDeck(
      { components, wires },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/\bR1\b[^\n]*\b1000\b/);
    expect(deck.netlist).not.toMatch(/noiseless/i);
  });

  it("resolves {param} braces inside emitted .meas lines", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      {
        components,
        wires,
        directives: [".meas tran vat FIND V(out) AT={tprobe}"],
        params: { scope: { tprobe: 0.001 }, funcs: {} },
      },
      { kind: "tran", stopTime: 0.002, steps: 100 },
    );
    expect(deck.netlist).toMatch(/\.meas tran vat FIND V\(out\) AT=0\.001\b/);
    expect(deck.netlist).not.toContain("{tprobe}");
  });

  it("translates LTspice .ic inductor current assignments to ngspice instance IC", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("inductor", "L1", "1m", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      {
        components,
        wires,
        directives: [".ic V(out)=1 I(L1)=250m"],
      },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );

    expect(deck.netlist).toContain(".ic V(out)=1");
    expect(deck.netlist).toMatch(/^L1\s+\S+\s+\S+\s+0\.001 IC=250m$/m);
    expect(deck.netlist).not.toMatch(/^\.ic .*I\(L1\)/mi);
    expect(deck.netlist).toMatch(/\.tran [\d.e-]+ 0\.001 uic/);
  });

  it("warns and drops a stale .ic current target after its inductor is deleted", () => {
    const components = [
      component("vsource", "V2", "5", 0, 32),
      component("resistor", "R2", "1k", 96, 0),
      component("led", "D1", "LED", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".ic V(out)=1", ".ic I(L1)=0"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );

    expect(deck.netlist).toContain(".ic V(out)=1");
    expect(deck.netlist).not.toContain("I(L1)");
    expect(deck.circuit.warnings).toContain("Ignored .ic I(L1)=0 because inductor L1 is not present.");
    expect(deck.netlist).toContain(" uic");
  });

  it("rejects .ic current assignments that name an existing non-inductor", () => {
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      component("ground", "", "", 64, 0),
    ];

    expect(() => buildSpiceDeck(
      { components, wires: [], directives: [".ic I(R1)=0"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    )).toThrow(/\.ic I\(R1\).*inductor.*resistor/i);
  });

  it("omits uic when only a .nodeset (no .ic) is present", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      { components, wires, directives: [".nodeset V(out)=1"] },
      { kind: "tran", stopTime: 0.001, steps: 200 },
    );
    expect(deck.netlist).toContain(".nodeset V(out)=1");
    expect(deck.netlist).not.toContain("uic");
  });

  it("emits an inline SINE function from an LTspice voltage source value", () => {
    const components = [
      component("vsource", "V1", "SINE(0 7.5 1k)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.003, steps: 300 });

    expect(deck.netlist).toContain("V1 n001 0 DC 0 SIN(0 7.5 1000)");
  });

  it("emits a distinct DC operating point before an edited PWL waveform", () => {
    const components = [
      component("vsource", "V1", "DC 3.3 PWL(0 0 1m 5)", 0, 32),
      component("resistor", "R1", "1k", 0, 96),
      component("ground", "", "", 0, 128),
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toMatch(/^V1\s+\S+\s+\S+\s+DC 3\.3 PWL\(0 0 0\.001 5\)$/m);
  });

  it("emits a full LTspice PULSE function and trims its Ncycles slot", () => {
    const components = [
      component("vsource", "V1", "PULSE(-10 10 5u 25u 25u 0u 50u)", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const deck = buildSpiceDeck({ components, wires }, { kind: "tran", stopTime: 0.001, steps: 200 });

    expect(deck.netlist).toContain(
      "V1 n001 0 DC -10 PULSE(-10 10 0.000005 0.000025 0.000025 0 0.00005)",
    );
  });

  it("includes generic nonlinear models and the complete M1 pin order", () => {
    const components = [
      component("nmos", "M1", "NMOS", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toContain(".model TAU_NMOS NMOS");
    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ TAU_NMOS/);
    expect(deck.netlist).toContain(".op");
  });

  it("emits a VDMOS power MOSFET as a 3-terminal device line (no bulk node)", () => {
    // A document `.model … VDMOS(…)` makes the referencing MOSFET a 3-pin VDMOS
    // (ngspice: M nd ng ns model). The bulk node must be dropped - emitting it
    // would reinterpret the bulk as the model's optional thermal node.
    const components = [
      component("nmos", "M1", "IRFZ44N", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)"] },
      { kind: "op" },
    );

    // 3 nodes (d g s) then the model name - no 4th bulk node before IRFZ44N.
    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 IRFZ44N\b/);
    expect(deck.netlist).not.toMatch(/M1 n\d+ n\d+ 0 n\d+ IRFZ44N/);
    // The VDMOS model definition is carried into the deck verbatim.
    expect(deck.netlist).toContain(".model IRFZ44N VDMOS(Vto=4 Kp=20 Rd=20m)");
  });

  it("resolves {param} braces on a passthrough .model line against the document scope", () => {
    // Fc.asc: `.params Cjo=930p …` + `.model DX D(Cjo={Cjo} …)`. LTspice
    // substitutes the global params; ngspice dies with "Undefined parameter
    // [cjo]" if the braces reach the deck (the .param lines are consumed into
    // Tau's scope, never emitted). Unknown names must survive verbatim.
    const components = [
      component("diode", "D1", "DX", 0, 0),
      component("ground", "", "", 0, 32),
    ];
    const directives = [".param Cjo=930p m=.75", ".model DX D(Is=0 Cjo={Cjo} m={m} tt={notdefined})"];
    const deck = buildSpiceDeck(
      { components, wires: [], directives, params: buildParamScope(directives) },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("Cjo=9.3e-10");
    expect(deck.netlist).toContain("m=0.75");
    expect(deck.netlist).toContain("tt={notdefined}");
  });

  it("leaves braces inside a document-defined .subckt body for ngspice's own param scope", () => {
    // A subckt-internal `.param R=10K` shadows nothing at document level; its
    // `{R}` must NOT be substituted (or worse, throw) at deck build.
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      component("ground", "", "", 0, 32),
    ];
    const directives = [
      ".param m=.75",
      ".subckt myblk 1 2\\nR1 1 2 {R}\\n.param R=10K\\n.ends myblk",
    ];
    const deck = buildSpiceDeck(
      { components, wires: [], directives, params: buildParamScope(directives) },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("R1 1 2 {R}");
  });

  it("keeps a non-VDMOS MOSFET on its 4-terminal level-1 line", () => {
    // A `.model … NMOS(…)` definition is a standard 4-terminal MOS, so the bulk
    // node stays on the device line.
    const components = [
      component("nmos", "M1", "MYNMOS", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model MYNMOS NMOS(Vto=1 Kp=2u)"] },
      { kind: "op" },
    );

    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ MYNMOS/);
  });

  it("appends MOSFET instance W/L from the structured value encoding", () => {
    const components = [
      component("nmos", "M1", "NMOS W=20u L=2u", 0, 0),
      component("ground", "", "", 16, 32),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toMatch(/M1 n\d+ n\d+ 0 n\d+ TAU_NMOS W=20u L=2u/);
  });

  it("emits a series resistor for a non-ideal wire with resistance", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
    ];
    const wires = [
      wire("w1", [
        { x: 0, y: 0 },
        { x: 64, y: 0 },
      ]),
    ];
    wires[0].resistance = "10m";

    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/RWIRE1 \S+ \S+ 0\.01/);
  });

  it("rejects an invalid non-ideal wire value instead of silently opening the circuit", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    wires[0].resistance = "banana";
    expect(() => buildSpiceDeck({ components, wires }, { kind: "op" })).toThrow(/wire resistance.*invalid/i);
  });

  it("rejects case and sanitization collisions in SPICE instance names", () => {
    const baseWires = [
      wire("w1", [{ x: -32, y: 0 }, { x: 32, y: 0 }]),
      wire("w2", [{ x: 96, y: 0 }, { x: 160, y: 0 }]),
    ];
    const duplicateCase = [
      component("resistor", "R1", "1k", 0, 0),
      component("resistor", "r1", "2k", 128, 0),
      component("ground", "", "", -64, 0),
    ];
    expect(() => buildSpiceDeck({ components: duplicateCase, wires: baseWires }, { kind: "op" }))
      .toThrow(/duplicate SPICE instance name/i);

    const sanitized = [
      component("resistor", "R 1", "1k", 0, 0),
      component("resistor", "R@1", "2k", 128, 0),
      component("ground", "", "", -64, 0),
    ];
    expect(() => buildSpiceDeck({ components: sanitized, wires: baseWires }, { kind: "op" }))
      .toThrow(/duplicate SPICE instance name/i);
  });

  it("writes a proper AC source and sweep directive", () => {
    const components = [
      component("vac", "V1", "0 2 1k", 0, 32),
      component("ground", "", "", 0, 64),
    ];

    const deck = buildSpiceDeck(
      { components, wires: [] },
      { kind: "ac", startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
    );

    expect(deck.netlist).toContain("V1 n001 0 DC 0 AC 2 SIN(0 2 1000)");
    expect(deck.netlist).toContain(".ac dec 20 10 1000000");
  });

  it("writes a .dc source-sweep directive with a stop-directed increment", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const up = buildSpiceDeck({ components, wires }, { kind: "dc", source: "V1", start: 0, stop: 10, step: 1 });
    expect(up.netlist).toContain(".dc V1 0 10 1");

    // A descending range flips the increment sign so ngspice walks start → stop.
    const down = buildSpiceDeck({ components, wires }, { kind: "dc", source: "V1", start: 10, stop: 0, step: 2 });
    expect(down.netlist).toContain(".dc V1 10 0 -2");
  });

  it("appends a nested outer source to the .dc directive (SPICE inner-first order)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("vsource", "V2", "5", 64, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];

    const nested = buildSpiceDeck({ components, wires }, {
      kind: "dc", source: "V1", start: 0, stop: 5, step: 1,
      source2: "V2", start2: 0, stop2: 10, step2: 2,
    });
    expect(nested.netlist).toContain(".dc V1 0 5 1 V2 0 10 2");
  });

  it("carries a document's own .model/.lib/.subckt definitions into the deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const deck = buildSpiceDeck(
      {
        components,
        wires,
        directives: [
          ".model MyNPN NPN(Bf=250)",
          ".lib /path/std.lib NMOS",
          ".subckt myamp in out\\nR1 in out 1k\\n.ends",
          ".tran 1m", // analysis directive must NOT leak into the deck body
        ],
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".model MyNPN NPN(Bf=250)");
    expect(deck.netlist).toContain(".subckt myamp in out");
    expect(deck.netlist).toContain(".ends");
    // An unresolvable `.lib` is reported, not emitted: the native sanitizer
    // rejects a file-backed card, so passing it through failed the whole deck.
    expect(deck.netlist).not.toContain(".lib /path/std.lib NMOS");
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("/path/std.lib"));
    // The analysis directive is handled by the analysis line, not the body.
    expect(deck.netlist).not.toContain(".tran 1m");
  });

  it("references a semiconductor's own model name when the document defines it", () => {
    const components = [
      component("diode", "D1", "1N4148", 0, 0),
      component("nmos", "M1", "IRF540", 96, 0),
      component("ground", "", "", 16, 32),
    ];
    const deck = buildSpiceDeck(
      { components, wires: [], directives: [".model 1N4148 D(Is=2.5n)", ".model IRF540 NMOS(Vto=4)"] },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/D1 n\d+ n\d+ 1N4148/);
    expect(deck.netlist).toMatch(/M1 (?:n\d+|0) (?:n\d+|0) (?:n\d+|0) (?:n\d+|0) IRF540/);
    // The device lines reference the user models, not the generic starters.
    expect(deck.netlist).not.toMatch(/D1 .*TAU_DIODE/);
    expect(deck.netlist).not.toMatch(/M1 .*TAU_NMOS/);
  });

  it("refuses an undefined named model instead of emitting a generic substitute", () => {
    const components = [
      component("diode", "D1", "XYZ999", 0, 0),
      component("ground", "", "", 16, 32),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" })).toThrow(
      'Simulation refused: D1 names model "XYZ999", but Tau could not resolve it.',
    );
  });

  it("resolves a semiconductor model from a user-supplied vendor library (no inline/bundled model exists)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("diode", "D1", "ACME_D1", 96, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 128, 0),
    ];
    const wires = [wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }])];
    const userModelLibraries = [".model ACME_D1 D(Is=3e-9 N=1.1 Rs=0.4)"];
    const deck = buildSpiceDeck({ components, wires, userModelLibraries }, { kind: "op" });
    // The user library's real model line is inlined and the device references it.
    expect(deck.netlist).toContain(".model ACME_D1 D(Is=3e-9 N=1.1 Rs=0.4)");
    expect(deck.netlist).toMatch(/D1 \S+ \S+ ACME_D1/);
    // The generic TAU_DIODE substitute is NOT used for this part's device line.
    expect(deck.netlist).not.toMatch(/D1 \S+ \S+ TAU_DIODE/);
  });

  it("prefers an attached user library's model over a same-named bundled standard part", () => {
    // Resolution order: inline document .model > attached user library >
    // Tau's bundled standard part, so a user-attached vendor file that
    // redefines a name Tau also bundles wins (LTspice local-definition-wins
    // semantics) instead of being silently shadowed by the bundled model.
    const components = [component("diode", "D1", "1N4148", 0, 0), component("ground", "", "", 16, 32)];
    const userModelLibraries = [".model 1N4148 D(Is=999 N=999)"];
    const deck = buildSpiceDeck({ components, wires: [], userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toMatch(/^\.model 1N4148 D\(Is=999 N=999\)/m);
    expect(deck.netlist).not.toContain("Is=2.52n");
  });

  it("prefers an attached user library's subckt over a same-named bundled subcircuit", () => {
    // Same local-definition-wins rule for subckts: "opamp" is a bundled
    // library subcircuit (Opamps\\opamp.asy → OPAMP_SUB); an attached vendor
    // file that redefines it must win and the bundled body must not appear.
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "opamp",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", [["p1", "1", 0, 0], ["p2", "2", 0, 80], ["p3", "3", 160, 40]])];
    const netLabels = [lbl(0, 80, "0")];
    const userModelLibraries = [".subckt opamp 1 2 3\nR1 1 3 1\n.ends opamp"];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toContain("R1 1 3 1");
    expect(deck.netlist).not.toContain("G1 0 3 2 1");
    expect(deck.netlist.match(/^\.subckt opamp /gm)?.length).toBe(1);
  });

  it("resolves a same-named subckt from the FIRST attached library when two both define it", () => {
    // Deterministic collision resolution across two attachments: the caller
    // always builds `userModelLibraries` in the schematic's attachment order
    // (store/useSchematic.ts's attachModelLibrary appends), and
    // parseUserModelLibraries keeps the first definition it sees - so "first
    // attached" always wins, never an arbitrary iteration order.
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "opamp",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", [["p1", "1", 0, 0], ["p2", "2", 0, 80], ["p3", "3", 160, 40]])];
    const netLabels = [lbl(0, 80, "0")];
    const userModelLibraries = [
      ".subckt opamp 1 2 3\nR1 1 3 111\n.ends opamp",
      ".subckt opamp 1 2 3\nR1 1 3 222\n.ends opamp",
    ];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, userModelLibraries }, { kind: "op" });
    expect(deck.netlist).toContain("R1 1 3 111");
    expect(deck.netlist).not.toContain("R1 1 3 222");
  });

  it("resolves a subckt from a user-supplied vendor library, emitted once even when referenced twice", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value: "VendorBlock",
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [
      sub("U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      sub("U2", [["p1", "+", 160, 0], ["p2", "-", 160, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")]; // establishes the circuit's ground reference
    const userModelLibraries = [".subckt VendorBlock a b\nR1 a b 4.7k\n.ends VendorBlock"];
    const deck = buildSpiceDeck(
      { components: comps, wires: [], netLabels, userModelLibraries },
      { kind: "op" },
    );
    // Both instances reference the block; it is inlined exactly once.
    expect(deck.netlist.match(/^\.subckt VendorBlock /gm)?.length).toBe(1);
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ VendorBlock$/m);
    expect(deck.netlist).toMatch(/^XU2 \S+ \S+ VendorBlock$/m);
    expect(deck.netlist).toContain("R1 a b 4.7k");
    // A fully-resolved deck reports nothing missing.
    expect(deck.unresolvedSubckts).toEqual([]);
  });

  it("emits a menu-selected five-terminal contract in exact SpiceOrder with named overrides", () => {
    const base = component("subckt", "X1", "deadtime dead=300n", 96, 192);
    const pins = buildSubcircuitPinOverride(base, ["vcc", "vee", "pwm", "gp", "gn"]);
    const deck = buildSpiceDeck({
      components: [{ ...base, pinOverride: pins }],
      wires: [],
      netLabels: [{ id: "gnd", x: pins[1].x, y: pins[1].y, text: "0" }],
      userModelLibraries: [`.subckt deadtime vcc vee pwm gp gn params: dead=250n\nRgp gp vee 1k\nRgn gn vee 1k\n.ends deadtime`],
    }, { kind: "op" });

    expect(deck.netlist).toContain(".subckt deadtime vcc vee pwm gp gn params: dead=250n");
    expect(deck.netlist).toMatch(/^X1 \S+ 0 \S+ \S+ \S+ deadtime dead=300n$/m);
    expect(deck.netlist.match(/^\.subckt deadtime /gm)).toHaveLength(1);
  });

  it("reports subckt references with no inline, bundled, or imported definition", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [
      // Two instances of the same missing vendor op-amp (dedup) plus one of a
      // second missing part (sorted). No inline .subckt, not a bundled block,
      // and no user library is attached.
      sub("U1", "LT1001", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      sub("U2", "LT1001", [["p1", "+", 160, 0], ["p2", "-", 160, 80]]),
      sub("U3", "AD8000", [["p1", "+", 320, 0], ["p2", "-", 320, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")]; // ground reference
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual(["AD8000", "LT1001"]);
    // The netlist still emits the X lines; the field is advisory, not a rewrite.
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ LT1001$/m);
    expect(deck.netlist).toMatch(/^XU3 \S+ \S+ AD8000$/m);
  });

  it("does not report a subckt that a document .subckt directive defines inline", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", "MyBlock", [["p1", "a", 0, 0], ["p2", "b", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    const directives = [".subckt MyBlock a b\\nR1 a b 2.2k\\n.ends MyBlock"];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, directives }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ MyBlock$/m);
  });

  it("reports a nested X ref inside an inlined body when that peer is missing", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", "Outer", [["p1", "a", 0, 0], ["p2", "b", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    // Outer is defined; its body calls MissingPeer which is nowhere.
    const directives = [".subckt Outer a b\\nX1 a b MissingPeer\\n.ends Outer"];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, directives }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual(["MissingPeer"]);
    expect(deck.netlist).toMatch(/^XU1 \S+ \S+ Outer$/m);
    expect(deck.netlist).toContain("X1 a b MissingPeer");
  });

  it("emits a nested peer from the user library when an inlined body calls it", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", "Outer", [["p1", "a", 0, 0], ["p2", "b", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    // Only Outer is on the schematic; Peer lives in the attached library and
    // must be pulled in by transitive closure (not only top-level X refs).
    const userModelLibraries = [
      [
        ".subckt Outer a b",
        "Xnest a b Peer",
        ".ends Outer",
        ".subckt Peer c d",
        "R1 c d 1k",
        ".ends Peer",
      ].join("\n"),
    ];
    const deck = buildSpiceDeck(
      { components: comps, wires: [], netLabels, userModelLibraries },
      { kind: "op" },
    );

    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(/^\.subckt Outer /m);
    expect(deck.netlist).toMatch(/^\.subckt Peer /m);
    expect(deck.netlist).toContain("R1 c d 1k");
    expect(deck.netlist.match(/^\.subckt Peer /gm)?.length).toBe(1);
  });

  it("does not flag a nested .subckt defined inside the same inlined body", () => {
    let counter = 0;
    const uid = (p: string) => `${p}-${++counter}`;
    const sub = (label: string, value: string, pins: Array<[string, string, number, number]>): SchematicComponent => ({
      id: uid("subckt"),
      kind: "subckt",
      x: 0,
      y: 0,
      rotation: 0,
      value,
      label,
      pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
    });
    const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });

    const comps = [sub("U1", "Outer", [["p1", "a", 0, 0], ["p2", "b", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    const directives = [
      ".subckt Outer a b\\n.subckt Inner c d\\nR1 c d 1k\\n.ends Inner\\nX1 a b Inner\\n.ends Outer",
    ];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels, directives }, { kind: "op" });

    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toContain("X1 a b Inner");
  });

  it("leaves deck output unchanged when no user model libraries are supplied (regression guard)", () => {
    const components = [
      component("vsource", "V1", "5", 0, 32),
      component("resistor", "R1", "1k", 96, 0),
      component("diode", "D1", "1N4148", 224, 0),
      component("ground", "", "", 0, 64),
      component("ground", "", "", 256, 0),
    ];
    const wires = [
      wire("w1", [{ x: 0, y: 0 }, { x: 64, y: 0 }]),
      wire("w2", [{ x: 128, y: 0 }, { x: 192, y: 0 }]),
    ];
    const withoutField = buildSpiceDeck({ components, wires }, { kind: "op" });
    const withEmptyLibraries = buildSpiceDeck({ components, wires, userModelLibraries: [] }, { kind: "op" });
    expect(withEmptyLibraries.netlist).toBe(withoutField.netlist);
    // Sanity: the bundled standard model still wins with no user library present.
    expect(withoutField.netlist).toMatch(/^\.model 1N4148 D\(/m);
  });

  it("emits a BJT whose Value names a document .subckt as an X instance (UHFpreamp MRF901)", () => {
    const components = [
      component("npn", "Q1", "MRF901", 0, 0),
      component("ground", "", "", -32, 64),
    ];
    const directives = [
      ".subckt MRF901 1 2 3\\nLc 1 4 0.451n\\nQA 4 2 3 QR99\\n.model QR99 NPN(BF=88)\\n.ends MRF901",
    ];
    const deck = buildSpiceDeck({ components, wires: [], directives }, { kind: "op" });
    // LTspice silently netlists a subckt-valued Q as an X with the same C B E
    // node order; a Q line would make ngspice fail with "could not find a
    // valid modelname".
    expect(deck.netlist).toMatch(/^XQ1 n\d+ n\d+ n\d+ MRF901$/m);
    expect(deck.netlist).not.toMatch(/^Q1 /m);
  });

  // ngspice hands back a semiconductor's own current only for a deck that named
  // it. Without these cards a clamp probe on a transistor resolves to nothing.
  describe("device current `.save`", () => {
    const semiconductors = () => [
      component("ground", "", "", -32, 64),
      component("npn", "Q1", "NPN", 0, 0),
      component("diode", "D1", "D", 128, 0),
      component("nmos", "M1", "NMOS", 256, 0),
      component("njf", "J1", "NJF", 384, 0),
      component("resistor", "R1", "1k", 512, 0),
    ];

    it("asks for each semiconductor's own current, and for `all` so the defaults survive", () => {
      const deck = buildSpiceDeck(
        { components: semiconductors(), wires: [] },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      // `all` is the whole safety of this card: a bare `.save` REPLACES
      // ngspice's default set, so without it the run comes back with the device
      // currents and nothing else - no node voltages, no source branches.
      // D1 is a Tau-PLACED diode, so it is ideal and leaves the deck as an
      // XSPICE `A` device with no `@d1[id]` of its own. The deck asks for its
      // series zero-volt ammeter instead, so the part still HAS a current -
      // see engine/idealModels.ts, and the imported case just below.
      expect(deck.netlist).toMatch(
        /^\.save all @q1\[ic\] @q1\[ib\] @q1\[ie\] v__tau_id_d1#branch @m1\[id\] @m1\[ig\] @m1\[is\] @j1\[id\]$/m,
      );
      // Passives have no device vector; their currents are derived from the
      // node voltages instead.
      expect(deck.netlist).not.toContain("@r1");
      // A BJT and a MOSFET each report more than their own current, so each
      // contributes several entries under one component id. The untagged entry
      // is what `I(ref)` means; the tagged ones are extra traces. A two-terminal
      // device, and a JFET, stay a single entry.
      expect(deck.deviceCurrents).toEqual([
        { componentId: "Q1", vector: "@q1[ic]" },
        { componentId: "Q1", vector: "@q1[ib]", terminal: "b" },
        { componentId: "Q1", vector: "@q1[ie]", terminal: "e" },
        { componentId: "D1", vector: "v__tau_id_d1#branch" },
        { componentId: "M1", vector: "@m1[id]" },
        { componentId: "M1", vector: "@m1[ig]", terminal: "g" },
        { componentId: "M1", vector: "@m1[is]", terminal: "s" },
        { componentId: "J1", vector: "@j1[id]" },
      ]);
      // The bulk is deliberately not asked for. A model without a bulk terminal
      // - a VDMOS, which is what an LTspice power MOSFET is - has no `@m1[ib]`,
      // and ngspice answers the card with a zero-length vector instead of an
      // error, so the part would carry an empty trace and nothing would say so.
      expect(deck.netlist).not.toContain("@m1[ib]");
    });

    it("keeps `@d1[id]` for a diode read from an LTspice file, whose model stays real", () => {
      // The mirror of the case above. An imported diode is NOT ideal, so it is
      // still a Berkeley `D` and still reports its own current under the name
      // every existing reader expects. Reverting the provenance test in
      // `idealJunctionModel` would make this pass and the one above fail; both
      // failing at once is the only way to be sure neither side is a tautology.
      const imported = semiconductors().map((part) => (
        part.label === "D1"
          ? { ...part, ltSymbolType: "diode", pinOverride: [
            { id: "a", label: "A", x: 128, y: -32 },
            { id: "k", label: "K", x: 128, y: 32 },
          ] }
          : part
      ));
      const deck = buildSpiceDeck({ components: imported, wires: [] }, { kind: "tran", stopTime: 1e-3, steps: 100 });
      expect(deck.netlist).toContain("@d1[id]");
      expect(deck.netlist).not.toContain("v__tau_id_d1");
      expect(deck.deviceCurrents).toContainEqual({ componentId: "D1", vector: "@d1[id]" });
    });

    it("asks for the same device currents on an `.op` deck as on a transient deck, with node/source content otherwise unchanged", () => {
      // Proven against real ngspice: on an `.op` deck, `.save all @q1[ic] …` is
      // a STRICT SUPERSET of the default vector set - every node voltage and
      // every `#branch` current still comes back, plus the named device
      // currents - so the operating point is the other analysis (besides
      // transient) that can read a semiconductor's own current back.
      const opDeck = buildSpiceDeck({ components: semiconductors(), wires: [] }, { kind: "op" });
      const tranDeck = buildSpiceDeck(
        { components: semiconductors(), wires: [] },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      expect(opDeck.netlist).toMatch(/^\.save all @q1\[ic\].*@q1\[vbe\]/m);
      expect(opDeck.netlist).toContain("@m1[vdsat]");
      expect(opDeck.deviceOperatingPoints).toEqual(expect.arrayContaining([
        { componentId: "Q1", name: "VBE", vector: "@q1[vbe]", unit: "V" },
        { componentId: "Q1", name: "GM", vector: "@q1[gm]", unit: "S" },
        { componentId: "M1", name: "VDSAT", vector: "@m1[vdsat]", unit: "V" },
        { componentId: "M1", name: "GDS", vector: "@m1[gds]", unit: "S" },
      ]));
      expect(opDeck.deviceCurrents).toEqual(tranDeck.deviceCurrents);
      // The `.save` card and the trailing analysis line are the only place an
      // `.op` deck and a `.tran` deck built from the same schematic may
      // differ - every node name, source line, and model line is identical.
      const withoutSaveAndAnalysis = (netlist: string) =>
        netlist.split("\n").filter((line) => !/^(\.save\b|\+ @|\.op$|\.tran\b)/.test(line));
      expect(withoutSaveAndAnalysis(opDeck.netlist)).toEqual(withoutSaveAndAnalysis(tranDeck.netlist));
    });

    it("asks for semiconductor current phasors on AC without OP-only parameters", () => {
      for (const analysis of [{ kind: "ac" as const, startHz: 1, stopHz: 1e3, pointsPerDecade: 10 }]) {
        const deck = buildSpiceDeck({ components: semiconductors(), wires: [] }, analysis);
        expect(deck.netlist, analysis.kind).toMatch(/^\.save all @q1\[ic\].*@j1\[id\]$/m);
        expect(deck.deviceCurrents, analysis.kind).toHaveLength(8);
        expect(deck.deviceOperatingPoints, analysis.kind).toEqual([]);
      }
    });

    it("asks for nothing on a BJT emitted as a subcircuit call, which has no device vector", () => {
      const components = [
        component("npn", "Q1", "MRF901", 0, 0),
        component("ground", "", "", -32, 64),
      ];
      const directives = [".subckt MRF901 1 2 3\\nQA 1 2 3 QR99\\n.model QR99 NPN(BF=88)\\n.ends MRF901"];
      const deck = buildSpiceDeck(
        { components, wires: [], directives },
        { kind: "tran", stopTime: 1e-3, steps: 100 },
      );
      expect(deck.netlist).toMatch(/^XQ1 /m);
      expect(deck.netlist).not.toContain(".save");
      expect(deck.deviceCurrents).toEqual([]);
    });

    it("wraps a long card onto `+` continuations rather than one enormous line", () => {
      const many = [
        component("ground", "", "", -32, 64),
        ...Array.from({ length: 24 }, (_, index) => component("npn", `Q${index + 1}`, "NPN", index * 128, 0)),
      ];
      const deck = buildSpiceDeck({ components: many, wires: [] }, { kind: "tran", stopTime: 1e-3, steps: 100 });
      const card = deck.netlist.split("\n").filter((line) => /^(\.save|\+ @)/.test(line));
      expect(card.length).toBeGreaterThan(1);
      expect(card[0].startsWith(".save all ")).toBe(true);
      expect(card.slice(1).every((line) => line.startsWith("+ "))).toBe(true);
      expect(Math.max(...card.map((line) => line.length))).toBeLessThanOrEqual(120);
      // Every device is still named exactly once across the wrapped card.
      const named = card.join(" ").match(/@q\d+\[ic\]/g) ?? [];
      expect(new Set(named).size).toBe(24);
    });
  });

  it("exports every remaining starter-library symbol to an ngspice primitive", () => {
    const components = [
      component("diode", "D1", "D", 0, 0),
      component("led", "D2", "LED", 96, 0),
      component("zener", "D3", "5V1", 192, 0),
      component("pmos", "M2", "PMOS", 288, 0),
      component("npn", "Q1", "NPN", 384, 0),
      component("pnp", "Q2", "PNP", 480, 0),
      component("opamp", "U1", "Ideal", 576, 0),
      component("potentiometer", "RV1", "10k", 672, 0),
      component("switch", "S1", "closed", 768, 0),
      component("transformer", "T1", "1:2", 864, 0),
      component("ground", "", "", 1024, 0),
    ];

    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });

    expect(deck.netlist).toContain("TAU_DIODE");
    expect(deck.netlist).toContain("TAU_LED");
    expect(deck.netlist).toContain("TAU_ZENER");
    expect(deck.netlist).toContain("TAU_PMOS");
    expect(deck.netlist).toContain("TAU_NPN");
    expect(deck.netlist).toContain("TAU_PNP");
    expect(deck.netlist).toContain("E_U1");
    expect(deck.netlist).toContain("R_RV1_a");
    expect(deck.netlist).toContain("R_S1");
    expect(deck.netlist).toContain("K_T1");
  });

  it("splits the potentiometer track at the wiper fraction instead of always halving it", () => {
    // a/w/b pin offsets from schematic/pins.ts; wire each to its own stub so
    // every pin resolves to a distinct net.
    const wires = [
      wire("wa", [{ x: -32, y: 0 }, { x: -96, y: 0 }]),
      wire("ww", [{ x: 0, y: -32 }, { x: 0, y: -96 }]),
      wire("wb", [{ x: 32, y: 0 }, { x: 96, y: 0 }]),
    ];
    const ground = component("ground", "", "", 0, 64);

    const deck = buildSpiceDeck(
      { components: [component("potentiometer", "RV1", "10k Wiper=0.3", 0, 0), ground], wires },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/^R_RV1_a \S+ \S+ 3000$/m);
    expect(deck.netlist).toMatch(/^R_RV1_b \S+ \S+ 7000$/m);

    // Pre-existing behaviour (no Wiper= token) is unchanged: an even split.
    const evenDeck = buildSpiceDeck(
      { components: [component("potentiometer", "RV1", "10k", 0, 0), ground], wires },
      { kind: "op" },
    );
    expect(evenDeck.netlist).toMatch(/^R_RV1_a \S+ \S+ 5000$/m);
    expect(evenDeck.netlist).toMatch(/^R_RV1_b \S+ \S+ 5000$/m);
  });

  // A switched load: V1 -> S1 -> R1 -> ground, with S1's NC+/NC- pair driven by
  // VC. Reused by the three switch cases below, which differ only in wiring.
  const switchedLoad = (controlled: boolean) => {
    const components = [
      component("vsource", "V1", "5", -128, 32),
      component("ground", "", "", -128, 64),
      component("switch", "S1", "MYSW", 0, 0),
      component("resistor", "R1", "1k", 96, 0),
      component("ground", "", "", 128, 0),
      ...(controlled
        ? [
          component("vsource", "VC", "2", -16, 96),
          component("ground", "", "", -16, 128),
          component("ground", "", "", 16, 32),
        ]
        : []),
    ];
    const wires = [
      wire("w1", [{ x: -128, y: 0 }, { x: -32, y: 0 }]),
      wire("w2", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
      ...(controlled ? [wire("w3", [{ x: -16, y: 32 }, { x: -16, y: 64 }])] : []),
    ];
    return { components, wires, directives: [".model MYSW SW(Ron=1 Roff=1Meg Vt=1)"] };
  };

  it("emits a voltage-controlled switch as an S device driven by its control pair", () => {
    const deck = buildSpiceDeck(switchedLoad(true), { kind: "op" });

    // S <n+> <n-> <control+> <control-> <model> - not a fixed resistance.
    expect(deck.netlist).toMatch(/^S1 \S+ \S+ \S+ \S+ MYSW$/m);
    expect(deck.netlist).not.toMatch(/^R_S1 /m);
    expect(deck.circuit.warnings).toEqual([]);
  });

  it("rewrites continuous negative-Vh SW to a B conductance (ngspice parity)", () => {
    const base = switchedLoad(true);
    const deck = buildSpiceDeck({
      ...base,
      directives: [".model MYSW SW(Ron=1 Roff=1Meg Vt=.5 Vh=-.4)"],
    }, { kind: "tran", stopTime: 0.003, steps: 500 });
    expect(deck.netlist).toMatch(/^B__tau_S1 \S+ \S+ I=/m);
    expect(deck.netlist).not.toMatch(/^S1\b/m);
    expect(deck.netlist).not.toMatch(/\.model\s+MYSW\s+SW\b/i);
  });

  it("reports a model-named switch with no control wiring instead of silently opening it", () => {
    const deck = buildSpiceDeck(switchedLoad(false), { kind: "op" });

    expect(deck.netlist).toMatch(/^R_S1 \S+ \S+ 1e12$/m);
    expect(deck.circuit.warnings.some((w) => w.startsWith("S1 has no control connection"))).toBe(true);
    // The optional control pair must not also surface as extraction noise:
    // assistantActions treats any extraction warning as a fatal rejection.
    expect(deck.circuit.warnings.filter((w) => w.includes("only connected to one pin"))).toEqual([]);
  });

  it("keeps a switch left on Tau's static state a fixed resistance, unwarned", () => {
    const open = { ...switchedLoad(false), components: switchedLoad(false).components };
    open.components[2] = component("switch", "S1", "open", 0, 0);
    expect(buildSpiceDeck(open, { kind: "op" }).netlist).toMatch(/^R_S1 \S+ \S+ 1e12$/m);
    expect(buildSpiceDeck(open, { kind: "op" }).circuit.warnings).toEqual([]);

    const closed = { ...switchedLoad(false), components: switchedLoad(false).components };
    closed.components[2] = component("switch", "S1", "closed", 0, 0);
    expect(buildSpiceDeck(closed, { kind: "op" }).netlist).toMatch(/^R_S1 \S+ \S+ 1m$/m);
    expect(buildSpiceDeck(closed, { kind: "op" }).circuit.warnings).toEqual([]);
  });

  it("refuses a named switch model when the document defines none", () => {
    expect(() => buildSpiceDeck({ ...switchedLoad(true), directives: [] }, { kind: "op" })).toThrow(
      'Simulation refused: S1 names model "MYSW", but Tau could not resolve it.',
    );
  });

  const currentSwitchedLoad = (
    value = "Vsense MYSW",
    directives = [".model MYSW CSW(Ron=.1 Roff=1Meg It=.5m Ih=.1m)"],
    controlKind: SchematicComponent["kind"] = "vsource",
  ) => ({
    components: [
      { ...component("switch", "W1", value, 0, 0), ltSymbolType: "csw",
        pinOverride: [
          { id: "a", label: "+", x: 0, y: 0 },
          { id: "b", label: "-", x: 96, y: 0 },
        ] },
      { ...component(controlKind, "Vsense", controlKind === "resistor" ? "1k" : "0", 192, 0),
        pinOverride: controlKind === "resistor"
          ? [{ id: "a", label: "a", x: 192, y: 0 }, { id: "b", label: "b", x: 192, y: 96 }]
          : [{ id: "p", label: "+", x: 192, y: 0 }, { id: "n", label: "-", x: 192, y: 96 }] },
      { ...component("vsource", "Vload", "5", 0, 0), pinOverride: [
        { id: "p", label: "+", x: 0, y: 0 },
        { id: "n", label: "-", x: 0, y: 96 },
      ] },
      { ...component("resistor", "Rcontrol", "1k", 192, 0), pinOverride: [
        { id: "a", label: "a", x: 192, y: 0 },
        { id: "b", label: "b", x: 192, y: 96 },
      ] },
      component("ground", "", "", 96, 0),
      component("ground", "", "", 0, 96),
      component("ground", "", "", 192, 96),
    ] as SchematicComponent[],
    wires: [] as SchematicWire[],
    directives,
  });

  it("emits an imported LTspice csw as a native W device", () => {
    const deck = buildSpiceDeck(currentSwitchedLoad("Vsense MYSW on"), { kind: "op" });
    expect(deck.netlist).toMatch(/^W1 \S+ 0 Vsense MYSW on$/m);
    expect(deck.netlist).toContain(".model MYSW CSW(Ron=.1 Roff=1Meg It=.5m Ih=.1m)");
    expect(deck.netlist).not.toMatch(/^R_W1 /m);
    expect(deck.circuit.warnings).toEqual([]);
  });

  it("resolves an LTspice ISWITCH model from an attached user library", () => {
    const input = currentSwitchedLoad("Vsense VendorCS", []);
    const deck = buildSpiceDeck({
      ...input,
      userModelLibraries: [".model VendorCS ISWITCH(Ron=.2 Roff=2Meg Ion=3m Ioff=1m)"],
    }, { kind: "op" });
    expect(deck.netlist).toContain(".model VendorCS CSW(RON=.2 ROFF=2Meg IT=0.002 IH=0.001)");
    expect(deck.netlist).toMatch(/^W1 \S+ 0 Vsense VendorCS$/m);
  });

  it("translates a parameterized inline ISWITCH after resolving its thresholds", () => {
    const input = currentSwitchedLoad("Vsense MYSW", [
      ".model MYSW ISWITCH(Ron=.1 Roff=1Meg Ion={ion} Ioff={ioff})",
    ]);
    const deck = buildSpiceDeck({
      ...input,
      params: buildParamScope([".param ion=3m ioff=1m"]),
    }, { kind: "op" });
    expect(deck.netlist).toContain(".model MYSW CSW(RON=.1 ROFF=1Meg IT=0.002 IH=0.001)");
    expect(deck.netlist).toMatch(/^W1 \S+ 0 Vsense MYSW$/m);
  });

  it("resolves a flattened csw's control source inside its own hierarchy scope", () => {
    const input = currentSwitchedLoad();
    input.components[0] = { ...input.components[0], label: "X1.W1" };
    input.components[1] = { ...input.components[1], label: "X1.Vsense" };
    const deck = buildSpiceDeck(input, { kind: "op" });
    expect(deck.netlist).toMatch(/^WX1_W1 \S+ 0 VX1_Vsense MYSW$/m);
  });

  it("atomically refuses a csw whose source identity, model, or value is not provable", () => {
    expect(() => buildSpiceDeck(currentSwitchedLoad("Missing MYSW"), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*voltage source "Missing".*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck(currentSwitchedLoad("Vsense MYSW", undefined, "resistor"), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*"Vsense" is a resistor.*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck(currentSwitchedLoad("Vsense Missing", []), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*model "Missing" was not found.*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck(currentSwitchedLoad("Vsense WRONG", [".model WRONG SW(Ron=1 Roff=1Meg Vt=1)"]), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*model "WRONG" is SW, not CSW.*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck(currentSwitchedLoad("Vsense MYSW", [".model MYSW ISWITCH(Ion=banana Ioff=0)"]), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*could not be translated to an ngspice CSW card.*No approximate or partial circuit was run/);
    expect(() => buildSpiceDeck(currentSwitchedLoad("MYSW"), { kind: "op" }))
      .toThrow(/Simulation refused: W1 \(csw\).*Vsense Model \[on\|off\].*No approximate or partial circuit was run/);
  });

  it("clamps an op-amp with driven supply pins to its rails (Class-D PWM comparator)", () => {
    // U1 at origin: in+(-32,16) in-(-32,-16) out(32,0) v+(0,-32) v-(0,32).
    // VP feeds v+ via a wire, v- is wired to ground - both rails driven, so the
    // deck must emit the rail-clamped B-source with the imported Avol, not the
    // unbounded E-source (which open-loop saturates to ~1e7 V).
    const components = [
      component("opamp", "U1", "Avol=1Meg GBW=10Gig Slew=10Gig", 0, 0),
      component("vsource", "VP", "10", 128, -96),
      component("vsource", "VIN", "1", -96, 48),
      component("resistor", "RL", "1k", 96, 32),
      component("ground", "", "", 0, 32), // on U1.v- → v- is the ground rail
      component("ground", "", "", 128, -64), // VP.n
      component("ground", "", "", -96, 80), // VIN.n
      component("ground", "", "", 128, 32), // RL.b
    ];
    const wires = [
      wire("wvp", [{ x: 0, y: -32 }, { x: 0, y: -128 }, { x: 128, y: -128 }]), // v+ → VP.p
      wire("win", [{ x: -32, y: 16 }, { x: -96, y: 16 }]), // in+ → VIN.p
      wire("wout", [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }]), // out → RL.a
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_U1 \S+ 0 V=\(V\(\S+\)\+V\(0\)\)\/2\+\(V\(\S+\)-V\(0\)\)\/2\*tanh\(1000000\*/);
    expect(deck.netlist).not.toContain("E_U1");
  });

  it("keeps the unbounded ideal op-amp when the supply pins float", () => {
    const components = [
      component("opamp", "U1", "Ideal", 0, 0),
      component("vsource", "VIN", "1", -96, 48),
      component("resistor", "RL", "1k", 96, 32),
      component("ground", "", "", -96, 80),
      component("ground", "", "", 128, 32),
    ];
    const wires = [
      wire("win", [{ x: -32, y: 16 }, { x: -96, y: 16 }]),
      wire("wout", [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toContain("E_U1");
    expect(deck.netlist).toContain("R_U1_out");
    expect(deck.netlist).not.toContain("B_U1");
  });

  it("emits a JFET (J device) with the generic NJF/PJF model", () => {
    // njf J1 at origin: d(16,-32) g(-32,0) s(16,32). Drain on a net, gate+source 0.
    const components = [
      component("njf", "J1", "NJF", 0, 0),
      component("vsource", "V1", "10", 16, -64),  // p=(16,-96), n=(16,-32)=d
      component("ground", "", "", 16, -96),       // V1 p → 0
      component("ground", "", "", -32, 0),        // g → 0
      component("ground", "", "", 16, 32),        // s → 0
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/J1 \S+ 0 0 TAU_NJF/);
    expect(deck.netlist).toContain(".model TAU_NJF NJF(");
  });

  it("emits a bundled JFET standard model when referenced by name (2N3819)", () => {
    const components = [
      component("njf", "J1", "2N3819", 0, 0),
      component("vsource", "V1", "10", 16, -64),
      component("ground", "", "", 16, -96),
      component("ground", "", "", -32, 0),
      component("ground", "", "", 16, 32),
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    // The device line uses the real part name, and its bundled model is emitted.
    expect(deck.netlist).toMatch(/J1 \S+ 0 0 2N3819/);
    expect(deck.netlist).toContain(".model 2N3819 NJF(");
  });

  it("emits an ideal lossless transmission line (T device, 4 nodes + Z0/TD)", () => {
    // tline T1 at origin: a1(-32,-16) a2(-32,16) b1(32,-16) b2(32,16).
    const components = [
      component("tline", "T1", "Td=50n Z0=75", 0, 0),
      component("vsource", "V1", "5", -32, 16),    // p=(-32,-16)=a1, n=(-32,48)
      component("resistor", "R1", "75", 64, -16),  // a=(32,-16)=b1, b=(96,-16)
      component("ground", "", "", -32, 16),        // a2 → 0
      component("ground", "", "", 32, 16),         // b2 → 0
      component("ground", "", "", -32, 48),        // V1 n → 0
      component("ground", "", "", 96, -16),        // R1 b → 0
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "tran", stopTime: 5e-7, steps: 500 });
    // Port-A return (a2) and port-B return (b2) are grounded → nodes 2 and 4 are 0.
    expect(deck.netlist).toMatch(/T1 \S+ 0 \S+ 0 Z0=75 TD=5(\.0+\d*)?e-8/);
  });

  it("emits a digital AND gate as one B-source per connected output", () => {
    // A1 at origin. A gate's input bank follows its value (default 2 inputs -
    // see engine/digitalGateSpec.ts), so `and` exposes in1(-32,-16) and
    // in2(-32,16) with q(32,-16); qbar and com float.
    const components = [
      component("digitalGate", "A1", "and", 0, 0),
      component("vsource", "VA", "1", -128, -96), // p(-128,-128) n(-128,-64)
      component("vsource", "VB", "1", -224, -32), // p(-224,-64) n(-224,0)
      component("resistor", "RL", "1k", 96, -16), // a(64,-16) b(128,-16)
      component("ground", "", "", -128, -64),
      component("ground", "", "", -224, 0),
      component("ground", "", "", 128, -16),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -16 }, { x: -96, y: -16 }, { x: -96, y: -128 }, { x: -128, y: -128 }]),
      wire("w2", [{ x: -32, y: 16 }, { x: -160, y: 16 }, { x: -160, y: -64 }, { x: -224, y: -64 }]),
      wire("w3", [{ x: 32, y: -16 }, { x: 64, y: -16 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // Both driven inputs appear as threshold terms multiplied (AND); only the
    // connected true output emits a line (floating qbar/in3-5 are ignored).
    // Product form (not C-style &&) — LTspice rejects && on B-lines.
    expect(deck.netlist).toMatch(
      /B_A1_Q \S+ 0 V=\(\(V\(\S+\)>0\.5\)\*\(V\(\S+\)>0\.5\)\) \? 1 : 0/,
    );
    expect(deck.netlist).not.toContain("B_A1_QB");
  });

  it("emits a dflop as adc bridge → XSPICE d_dff → dac bridge at its levels", () => {
    // A2 at origin: d(-40,-16) clk(-40,0) q(40,-16); pre/clr/qbar/com float.
    const components = [
      component("dflop", "A2", "Vhigh=5", 0, 0),
      component("vsource", "VD", "1", -128, 16),  // p(-128,-16) n(-128,48)
      component("vsource", "VC", "1", -224, 32),  // p(-224,0) n(-224,64)
      component("resistor", "RL", "1k", 104, -16), // a(72,-16) b(136,-16)
      component("ground", "", "", -128, 48),
      component("ground", "", "", -224, 64),
      component("ground", "", "", 136, -16),
    ];
    const wires = [
      wire("w1", [{ x: -40, y: -16 }, { x: -128, y: -16 }]),
      wire("w2", [{ x: -40, y: 0 }, { x: -224, y: 0 }]),
      wire("w3", [{ x: 40, y: -16 }, { x: 72, y: -16 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    // Unconnected pre/clr tie to analog ground inside the adc bridge vector.
    expect(deck.netlist).toMatch(/A_a2_adc \[\S+ \S+ 0 0\] \[a2_dd a2_dclk a2_dpre a2_dclr\] a2_adc/);
    expect(deck.netlist).toContain(".model a2_adc adc_bridge(in_low=2.495 in_high=2.505)");
    expect(deck.netlist).toContain("A_a2 a2_dd a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_dff");
    expect(deck.netlist).toContain(".model a2_dff d_dff(ic=0");
    // Connected q lands on its net; unconnected qbar on a private node.
    expect(deck.netlist).toMatch(/A_a2_dac \[a2_dq a2_dnq\] \[\S+ a2_qbnc\] a2_dac/);
    expect(deck.netlist).toContain(".model a2_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)");
  });

  it("emits a sample-and-hold as switch + hold cap between B-source buffers", () => {
    // A1 at origin: in+(-32,-32) sh(-32,16) out(32,0); in-/clk/com float →
    // S/H (track-and-hold) mode, single-ended input.
    const components = [
      component("sampleHold", "A1", "", 0, 0),
      component("vsource", "VA", "1", -128, 0),   // p(-128,-32) n(-128,32)
      component("vsource", "VC", "1", -224, 64),  // p(-224,32) n(-224,96)
      component("resistor", "RL", "1k", 96, 0),   // a(64,0) b(128,0)
      component("ground", "", "", -128, 32),
      component("ground", "", "", -224, 96),
      component("ground", "", "", 128, 0),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -32 }, { x: -128, y: -32 }]),
      wire("w2", [{ x: -32, y: 16 }, { x: -160, y: 16 }, { x: -160, y: 32 }, { x: -224, y: 32 }]),
      wire("w3", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_a1_in a1_s 0 V=V\(\S+\)/);
    expect(deck.netlist).toMatch(/B_a1_ctl a1_ctl 0 V=\(V\(\S+\)>0\.5\) \? 1 : 0/);
    expect(deck.netlist).toContain("S_a1 a1_s a1_h a1_ctl 0 a1_sw");
    expect(deck.netlist).toContain(".model a1_sw sw(vt=0.5 vh=0.2 ron=1 roff=1e12)");
    expect(deck.netlist).toContain("C_a1_h a1_h 0 1n");
    expect(deck.netlist).toMatch(/B_a1_out \S+ 0 V=V\(a1_h\)/);
    // No CLK master-slave stages in S/H mode.
    expect(deck.netlist).not.toContain("S_a1_1");
  });

  it("emits a modulator as a buffered XSPICE sine VCO", () => {
    // A1 at origin: fm(-32,-16) out(32,0); am/com float → unit amplitude,
    // ground-referenced. mark/space become the oscillator's freq_array.
    const components = [
      component("modulator", "A1", "mark=2K space=1K", 0, 0),
      component("vsource", "VF", "0.5", -128, 16), // p(-128,-16) n(-128,48)
      component("resistor", "RL", "1k", 96, 0),    // a(64,0) b(128,0)
      component("ground", "", "", -128, 48),
      component("ground", "", "", 128, 0),
    ];
    const wires = [
      wire("w1", [{ x: -32, y: -16 }, { x: -128, y: -16 }]),
      wire("w2", [{ x: 32, y: 0 }, { x: 64, y: 0 }]),
    ];
    const deck = buildSpiceDeck({ components, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/B_a1_fm a1_fm 0 V=V\(\S+\)/);
    expect(deck.netlist).toContain("A_a1 %v(a1_fm) %v(a1_osc) a1_vco");
    expect(deck.netlist).toContain(".model a1_vco sine(cntl_array=[0 1] freq_array=[1000 2000] out_low=-1 out_high=1)");
    // AM unwired → no amplitude factor on the output buffer.
    expect(deck.netlist).toMatch(/B_a1_out \S+ 0 V=V\(a1_osc\)/);
  });

  it("refuses an imported placeholder before emitting any approximate deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 0),        // p(0,-32) n(0,32)
      { ...component("resistor", "Q1", "1Meg", 32, -32), ltSymbolType: "misc\\DIAC" },
      component("resistor", "R1", "1k", 32, 32),    // a(0,32)  b(64,32)  - real R1
      component("ground", "", "", 0, 32),
    ];
    const wires = [wire("w1", [{ x: 64, y: -32 }, { x: 64, y: 32 }])];
    expect(() => buildSpiceDeck({ components, wires }, { kind: "op" }))
      .toThrow(/Simulation refused: Q1 \(misc\\DIAC\).*No approximate or partial circuit was run/);
  });

  it("refuses a preserved foreign symbol before emitting a partial deck", () => {
    const components = [
      component("vsource", "V1", "5", 0, 0),
      component("ground", "", "", 0, 32),
    ];
    expect(() => buildSpiceDeck({
      components,
      wires: [],
      ascForeignSymbols: [{
        type: "PowerProducts\\LTC4449",
        x: 96,
        y: 0,
        orientation: "R0",
        attrs: { InstName: "U1" },
      }],
    }, { kind: "op" })).toThrow(/Simulation refused: U1 \(PowerProducts\\LTC4449\)/);
  });

  it("disambiguates a manufactured name that lands on a refdes a sibling owns", () => {
    // PowerSim sub-blocks pair a resistor `Rb` with a part labeled `B` whose
    // manufactured fallback is also `RB`; the deck used to fail with a
    // duplicate-name error when such a block was opened standalone. The part
    // whose label owns the name keeps it regardless of component order.
    for (const ordered of [true, false]) {
      const pair = [
        component("resistor", "Rb", "1k", 0, 0),
        component("resistor", "B", "2k", 96, 0),
      ];
      const components = [...(ordered ? pair : pair.reverse()), component("ground", "", "", 0, 64)];
      const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
      expect(deck.netlist).toMatch(/^Rb /m);
      expect(deck.netlist).toMatch(/^RB_2 /m);
    }
  });

  it("still rejects two parts that claim the same SPICE instance name", () => {
    const components = [
      component("resistor", "R1", "1k", 0, 0),
      { ...component("resistor", "r1", "2k", 96, 0), id: "r1-dup" },
      component("ground", "", "", 0, 64),
    ];
    expect(() => buildSpiceDeck({ components, wires: [] }, { kind: "op" }))
      .toThrow(/Duplicate SPICE instance name/);
  });
});

describe("unresolvedSubcktMessage", () => {
  it("names a single missing subcircuit and how to supply it", () => {
    const message = unresolvedSubcktMessage(["LT1001"]);
    expect(message).toBe(
      'No imported library defines the subcircuit "LT1001". Attach the vendor model file (.lib or .subckt) that defines it under Model libraries, then run again.',
    );
    // Plain product copy: userFacingErrorMessage must be able to surface it
    // verbatim, so it carries no engine transcript markers or JS-error shapes.
    expect(message).not.toMatch(/stdout|stderr|ngspice|is not a function/i);
  });

  it("lists several missing subcircuits in the plural", () => {
    expect(unresolvedSubcktMessage(["AD8000", "LT1001"])).toBe(
      'No imported library defines these subcircuits: "AD8000", "LT1001". Attach the vendor model files (.lib or .subckt) that define them under Model libraries, then run again.',
    );
  });

  it("caps the enumerated list so the message stays short", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const message = unresolvedSubcktMessage(names);
    expect(message).toContain('"A", "B", "C", "D", "E", "F", and 2 more');
    expect(message).not.toContain('"G"');
  });
});

describe("nestedXSubcktRefs", () => {
  it("returns peer X names and skips locally nested .subckt definitions", () => {
    const block = [
      ".subckt Outer a b",
      ".subckt Inner c d",
      "R1 c d 1k",
      ".ends Inner",
      "X1 a b Inner",
      "X2 a b MissingPeer params: gain=2",
      "X3 a b MissingPeer",
      "* Xskip a b CommentedOut",
      "R2 a b 10",
      ".ends Outer",
    ].join("\n");
    expect(nestedXSubcktRefs(block)).toEqual(["MissingPeer"]);
  });

  it("stops at params: / assignments when reading the subckt name", () => {
    expect(nestedXSubcktRefs(".subckt O a b\nX1 a b Foo bar=1\n.ends O")).toEqual(["Foo"]);
    expect(nestedXSubcktRefs(".subckt O a b\nX1 a b Bar params: x=1\n.ends O")).toEqual(["Bar"]);
  });
});

describe("unresolved named models", () => {
  const grounded = () => component("ground", "", "", 0, 0);

  it("refuses a named vendor part before returning any approximate deck", () => {
    // The trust-destroying case: the deck happily emits a textbook Level=1
    // device under the vendor part's designator. Silence here means the user
    // reads a confident waveform for a device Tau does not have.
    expect(() => buildSpiceDeck(
      { components: [grounded(), component("nmos", "M1", "IRF540", 128, 128)], wires: [] },
      { kind: "op" },
    )).toThrow(
      'Simulation refused: M1 names model "IRF540", but Tau could not resolve it. Attach or select the exact vendor model under Model libraries, or explicitly choose Generic NMOS if an approximation is intentional.',
    );
  });

  it("stays silent for a part left on its Library default value", () => {
    // Placing an NMOS from the Library and not naming a part is not a
    // substitution - warning here would fire on every default-placed device
    // and train the user to ignore the channel that matters.
    const deck = buildSpiceDeck(
      { components: [grounded(), component("nmos", "M1", "NMOS W=10u L=1u", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
  });

  it("applies the editable generic KP/VTO knobs through a per-instance model", () => {
    const deck = buildSpiceDeck(
      { components: [grounded(), component("nmos", "M1", "NMOS W=20u L=2u KP=350u VTO=1.8", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.netlist).toContain(".model TAU_NMOS_M1 NMOS(Level=1 Vto=1.8 Kp=350u Lambda=0.02)");
    expect(deck.netlist).toMatch(/M1 \S+ \S+ \S+ \S+ TAU_NMOS_M1 W=20u L=2u/);
  });

  it("emits the two chooser-visible Class-D parts as exact 3-terminal VDMOS devices", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          grounded(),
          component("pmos", "M1", "RSR015P06", 128, 128),
          component("nmos", "M2", "QS6K1", 256, 128),
        ],
        wires: [],
      },
      { kind: "op" },
    );

    expect(deck.netlist).toMatch(/^\.model RSR015P06 VDMOS\(pchan/m);
    expect(deck.netlist).toMatch(/^\.model QS6K1 VDMOS\(/m);
    expect(deck.netlist.match(/^M1\s+\S+\s+\S+\s+\S+\s+RSR015P06$/m)).toBeTruthy();
    expect(deck.netlist.match(/^M2\s+\S+\s+\S+\s+\S+\s+QS6K1$/m)).toBeTruthy();
    expect(deck.modelSubstitutions).toEqual([]);
  });

  it("stays silent when the document defines the model it names", () => {
    const deck = buildSpiceDeck(
      {
        components: [grounded(), component("nmos", "M1", "MYFET", 128, 128)],
        wires: [],
        directives: [".model MYFET NMOS(Level=1 Vto=2)"],
      },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
    expect(deck.netlist).toContain("MYFET");
  });

  it("names every unresolved part, not just the first", () => {
    // BC847C is deliberately not one of the bundled standard parts; 2N3904 is,
    // and is asserted below to stay silent.
    expect(() => buildSpiceDeck(
      {
        components: [
          grounded(),
          component("nmos", "M1", "IRF540", 128, 128),
          component("npn", "Q1", "BC847C", 256, 128),
        ],
        wires: [],
      },
      { kind: "op" },
    )).toThrow(
      'Simulation refused: M1 names model "IRF540" and Q1 names model "BC847C", but Tau could not resolve them.',
    );
  });

  it("formats a bounded plural refusal with one deliberate-generic escape hatch", () => {
    expect(unresolvedModelMessage([
      { ref: "M1", requested: "IRF540", substituted: "TAU_NMOS" },
      { ref: "Q1", requested: "BC847C", substituted: "TAU_NPN" },
    ])).toBe(
      'Simulation refused: M1 names model "IRF540" and Q1 names model "BC847C", but Tau could not resolve them. Attach or select the exact vendor models under Model libraries, or explicitly choose the matching Generic device if an approximation is intentional.',
    );
  });

  it("stays silent for a part the bundled standard library defines", () => {
    // 2N3904 ships in standardModels.ts, so it resolves for real. Warning on a
    // part Tau actually models would be a false alarm.
    const deck = buildSpiceDeck(
      { components: [grounded(), component("npn", "Q1", "2N3904", 128, 128)], wires: [] },
      { kind: "op" },
    );

    expect(deck.modelSubstitutions).toEqual([]);
    expect(deck.netlist).toContain("2N3904");
  });
});

describe("transformerWindings", () => {
  it("defaults to a 10 mH magnetizing inductance and near-unity coupling", () => {
    expect(transformerWindings("1:1")).toEqual({ primary: 10e-3, secondary: 10e-3, coupling: 0.999 });
  });

  it("derives the secondary from the turns ratio", () => {
    // L2 = L1 * (Ns/Np)^2
    expect(transformerWindings("1:2").secondary).toBeCloseTo(40e-3, 9);
    expect(transformerWindings("2:1").secondary).toBeCloseTo(2.5e-3, 9);
  });

  it("honors explicit L1, L2 and k instead of the hardcoded defaults", () => {
    // Magnetizing and leakage inductance are the two numbers a flyback is
    // designed around; before this they were unreachable.
    const spec = transformerWindings("1:2 L1=2m L2=8m k=0.98");
    expect(spec.primary).toBeCloseTo(2e-3, 9);
    expect(spec.secondary).toBeCloseTo(8e-3, 9);
    expect(spec.coupling).toBeCloseTo(0.98, 9);
  });

  it("keeps the ratio-derived secondary when only L1 is given", () => {
    const spec = transformerWindings("1:3 L1=1m");
    expect(spec.primary).toBeCloseTo(1e-3, 9);
    expect(spec.secondary).toBeCloseTo(9e-3, 9);
  });

  it("refuses a coupling of 1, which makes the coupled pair singular", () => {
    expect(transformerWindings("1:1 k=1").coupling).toBe(0.999);
    expect(transformerWindings("1:1 k=1.5").coupling).toBe(0.999);
  });

  it("emits the parsed values into the deck", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("ground", "", "", 0, 0),
          component("transformer", "T1", "1:2 L1=2m k=0.95", 128, 128),
        ],
        wires: [],
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain("L_T1_p");
    expect(deck.netlist).toMatch(/L_T1_p \S+ \S+ 0\.002/);
    expect(deck.netlist).toMatch(/K_T1 L_T1_p L_T1_s 0\.95/);
  });
});

describe("includedFileName", () => {
  it("takes the path only, dropping a .lib section name", () => {
    expect(includedFileName("mymodels.lib")).toBe("mymodels.lib");
    expect(includedFileName("/path/to/std.lib NMOS")).toBe("/path/to/std.lib");
    expect(includedFileName("  spaced.lib  ")).toBe("spaced.lib");
  });

  it("keeps the spaces inside a quoted path", () => {
    expect(includedFileName('"C:\\my models\\adi.lib"')).toBe("C:\\my models\\adi.lib");
    expect(includedFileName("'my models/adi.lib' TYP")).toBe("my models/adi.lib");
  });
});

describe("unresolvable .include/.lib directives", () => {
  const rc = (directives: string[]) =>
    buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives,
      },
      { kind: "op" },
    );

  // The native sanitizer (src-tauri/src/spice.rs `deck_lines`) rejects every
  // file-backed card, so a passed-through `.include` failed the whole run.
  it("keeps the directive out of the deck so the run is not rejected outright", () => {
    const deck = rc([".include mymodels.lib"]);
    expect(deck.netlist).not.toMatch(/^\.(?:include|lib)\b/m);
    expect(deck.netlist).toContain(".op");
  });

  it("names the file it could not resolve on the warning channel", () => {
    expect(rc([".include mymodels.lib"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("mymodels.lib"),
    );
  });

  it("reports the path alone for the `.inc` alias and a sectioned `.lib`", () => {
    expect(rc([".inc sub/vendor.mod"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("sub/vendor.mod"),
    );
    // The path is reported as the document wrote it, not shortened to a
    // basename - a user looking for the file needs the reference they typed.
    expect(rc([".lib /opt/models/std.lib NMOS"]).circuit.warnings).toContain(
      unresolvedLibraryWarning("/opt/models/std.lib"),
    );
  });

  it("reports each missing file once, however many directives name it", () => {
    const warnings = rc([".include dup.lib", ".inc dup.lib", ".include other.lib"]).circuit.warnings;
    expect(warnings.filter((w) => w.includes("dup.lib"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("other.lib"))).toHaveLength(1);
  });

  // The importer reads a `.include`d file that sits beside the schematic and
  // attaches it, so the same directive that used to be unresolvable now has
  // its text in the deck. Warning about it anyway would contradict the run.
  it("says nothing when the named file is attached as a model library", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives: [".include models/vendor.lib"],
        userModelLibraries: [".subckt VEND 1 2\nR1 1 2 1k\n.ends VEND"],
        userModelLibraryNames: ["vendor.lib"],
      },
      { kind: "op" },
    );
    expect(deck.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
  });

  it("still warns when the attached libraries do not include the named file", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          component("vsource", "V1", "5", 0, 32),
          component("resistor", "R1", "1k", 96, 0),
          component("ground", "", "", 0, 64),
        ],
        wires: [wire("w1", [{ x: 0, y: 0 }, { x: 96, y: 0 }])],
        directives: [".include models/vendor.lib"],
        userModelLibraries: [".subckt OTHER 1 2\nR1 1 2 1k\n.ends OTHER"],
        userModelLibraryNames: ["unrelated.lib"],
      },
      { kind: "op" },
    );
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("models/vendor.lib"));
  });

  it("says nothing when the reference resolves to a bundled library", () => {
    const deck = rc([".include TowTom2.sub"]);
    expect(deck.netlist).toContain(".subckt TowTom2");
    expect(deck.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
  });

  // Dropping the directive must not disturb the `.subckt … .ends` depth
  // tracking that decides whether a `{param}` is substituted here or left for
  // ngspice to resolve against the subcircuit's own scope.
  it("leaves a document-defined subcircuit around it intact", () => {
    const directives = [
      ".param Rload=1k",
      ".subckt buf a b\n.include vendor.lib\nR1 a b {Rload}\n.ends",
      ".model DX D(Is={Rload})",
    ];
    const deck = buildSpiceDeck(
      {
        components: [component("resistor", "R1", "1k", 96, 0), component("ground", "", "", 0, 64)],
        wires: [],
        directives,
        params: buildParamScope(directives),
      },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".subckt buf a b");
    // Inside the block the brace stays for the subcircuit's own scope; the
    // `.model` after `.ends` is back at document scope and gets substituted.
    // Both only hold if dropping the `.include` left the depth count alone.
    expect(deck.netlist).toContain("R1 a b {Rload}");
    expect(deck.netlist).toContain(".model DX D(Is=1000)");
    expect(deck.netlist).not.toMatch(/^\.(?:include|lib)\b/m);
    expect(deck.circuit.warnings).toContain(unresolvedLibraryWarning("vendor.lib"));
  });
});

describe("constructs the engine cannot reproduce are never answered silently", () => {
  const grounded = component("ground", "", "", 0, 0);

  it("names the DC gain a non-rational Laplace source was reduced to", () => {
    const e = component("vcvs", "E1", "Laplace=2*exp(-.001*s)/(1+.001*s)", 128, 128);
    const deck = buildSpiceDeck({ components: [grounded, e], wires: [] }, { kind: "ac", startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    expect(deck.circuit.warnings).toContain(
      laplaceApproximationWarning("E1", "2*exp(-.001*s)/(1+.001*s)", 2),
    );
    expect(deck.circuit.warnings.join(" ")).toMatch(/valid at DC only/);
  });

  it("warns for a current-source Laplace, which has no exact realization at all", () => {
    const g = component("vccs", "G1", "Laplace=10/(1+.001*s)", 128, 128);
    const deck = buildSpiceDeck({ components: [grounded, g], wires: [] }, { kind: "ac", startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    expect(deck.circuit.warnings.some((w) => w.startsWith("G1's Laplace transfer"))).toBe(true);
  });

  it("leaves an exactly realized rational Laplace source unwarned", () => {
    const e = component("vcvs", "E1", "Laplace=10/(1+.001*s)", 128, 128);
    const deck = buildSpiceDeck({ components: [grounded, e], wires: [] }, { kind: "ac", startHz: 1, stopHz: 1e6, pointsPerDecade: 10 });
    expect(deck.circuit.warnings.some((w) => /Laplace transfer/.test(w))).toBe(false);
    expect(deck.netlist).toMatch(/s_xfer/);
  });

  it("reports LTspice's load flag instead of dropping it in silence", () => {
    for (const flag of ["load", "load2"]) {
      const i = component("isource", "I1", `1m ${flag}`, 128, 128);
      const deck = buildSpiceDeck({ components: [grounded, i], wires: [] }, { kind: "op" });
      expect(deck.circuit.warnings).toContain(clampedLoadSourceWarning("I1", flag));
      expect(deck.netlist).toMatch(/^I1 \S+ \S+ DC 0\.001$/m);
    }
  });

  it("does not warn for a current source with no load flag", () => {
    const deck = buildSpiceDeck(
      { components: [grounded, component("isource", "I1", "1m", 128, 128)], wires: [] },
      { kind: "op" },
    );
    expect(deck.circuit.warnings.some((w) => /load/.test(w))).toBe(false);
  });

  it("refuses a Chan magnetic-core inductor instead of substituting linear L", () => {
    const l1 = component(
      "inductor",
      "L1",
      "Hc=16. Bs=.44 Br=.10 A=0.0000251 Lm=0.0198 Lg=0.0006858 N=1000",
      128,
      128,
    );
    expect(() => buildSpiceDeck({ components: [grounded, l1], wires: [] }, { kind: "op" }))
      .toThrow(/Simulation refused: L1 is an LTspice Chan magnetic-core inductor.*No approximate or partial circuit was run/);
  });
});
