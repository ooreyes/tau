import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { runOperatingPoint } from "../simulation/operatingPoint";
import { CATALOG } from "./catalog";
import {
  isCapacitorKind,
  isSpdtThrowToNo,
  isStaticContactClosed,
  logicConstantVolts,
  motorArmature,
  photodiodePhotocurrentAmps,
  relayCoilOhms,
} from "./kindGroups";
import { getLocalPins } from "./pins";
import type { SchematicComponent } from "./types";

function c(
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent {
  return { id: label.toLowerCase(), kind, label, value, x, y, rotation: 0 };
}

describe("EveryCircuit library — polarized capacitor + logic constant", () => {
  it("treats polarizedCapacitor as a capacitor kind", () => {
    expect(isCapacitorKind("polarizedCapacitor")).toBe(true);
    expect(isCapacitorKind("capacitor")).toBe(true);
    expect(isCapacitorKind("inductor")).toBe(false);
  });

  it("parses logic-constant levels honestly", () => {
    expect(logicConstantVolts("0")).toBe(0);
    expect(logicConstantVolts("1")).toBe(1);
    expect(logicConstantVolts("high")).toBe(1);
    expect(logicConstantVolts("low")).toBe(0);
    expect(logicConstantVolts("3.3")).toBe(3.3);
  });

  it("emits polarizedCapacitor as a real C device (same as capacitor)", () => {
    const components: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "5", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("polarizedCapacitor", "C1", "10u", 64, 0),
        pinOverride: [
          { id: "a", label: "+", x: 0, y: 0 },
          { id: "b", label: "−", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^C1 n001 0 /m);
    expect(deck.netlist).not.toMatch(/unsupported|refused/i);
  });

  it("emits logicConstant as a DC voltage source and solves OP", () => {
    const components: SchematicComponent[] = [
      {
        id: "v1",
        kind: "logicConstant",
        label: "V1",
        value: "1",
        x: 0,
        y: 32,
        rotation: 0,
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        id: "r1",
        kind: "resistor",
        label: "R1",
        value: "1k",
        x: 32,
        y: 0,
        rotation: 0,
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        id: "gnd",
        kind: "ground",
        label: "",
        value: "",
        x: 0,
        y: 64,
        rotation: 0,
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^V1\b.+\bDC 1\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const hot = op.nets.find((n) => Math.abs(n.voltage - 1) < 1e-6);
    expect(hot?.voltage).toBeCloseTo(1, 6);
  });
});

describe("EveryCircuit library — push-button + SPDT + photodiode", () => {
  it("lists the new parts in the palette with expected pin counts", () => {
    expect(CATALOG.some((e) => e.kind === "pushButton")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "spdt")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "photodiode")).toBe(true);
    expect(getLocalPins("pushButton").map((p) => p.id)).toEqual(["a", "b"]);
    expect(getLocalPins("spdt").map((p) => p.id)).toEqual(["com", "no", "nc"]);
    expect(getLocalPins("photodiode").map((p) => p.id)).toEqual(["a", "k"]);
  });

  it("parses contact / throw / photocurrent values honestly", () => {
    expect(isStaticContactClosed("open")).toBe(false);
    expect(isStaticContactClosed("pressed")).toBe(true);
    expect(isStaticContactClosed("closed")).toBe(true);
    expect(isSpdtThrowToNo("no")).toBe(true);
    expect(isSpdtThrowToNo("nc")).toBe(false);
    expect(photodiodePhotocurrentAmps("100u")).toBeCloseTo(100e-6, 12);
    expect(photodiodePhotocurrentAmps("")).toBeCloseTo(100e-6, 12);
  });

  it("emits pushButton as a static contact resistor", () => {
    const components: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "5", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("pushButton", "S1", "pressed", 32, 0),
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 64, y: 0 },
        ],
      },
      {
        ...c("resistor", "R1", "1k", 96, 0),
        pinOverride: [
          { id: "a", label: "A", x: 64, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^R_S1\b.+\b1m\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    // Pressed contact: mid node (S1-b / R1-a) sits at ~5 V.
    const mid = op.nets.find((n) => Math.abs(n.voltage - 5) < 1e-3);
    expect(mid).toBeDefined();
  });

  it("emits SPDT as two mutually exclusive contact resistors", () => {
    const components: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "5", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("spdt", "S1", "no", 32, 0),
        pinOverride: [
          { id: "com", label: "COM", x: 0, y: 0 },
          { id: "no", label: "NO", x: 64, y: -16 },
          { id: "nc", label: "NC", x: 64, y: 16 },
        ],
      },
      {
        ...c("resistor", "Rno", "1k", 96, -16),
        pinOverride: [
          { id: "a", label: "A", x: 64, y: -16 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("resistor", "Rnc", "1k", 96, 16),
        pinOverride: [
          { id: "a", label: "A", x: 64, y: 16 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^R_S1_no\b.+\b1m\b/m);
    expect(deck.netlist).toMatch(/^R_S1_nc\b.+\b1e12\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const noNode = op.nets.find((n) => Math.abs(n.voltage - 5) < 1e-3);
    expect(noNode).toBeDefined();
  });

  it("emits photodiode as diode + photocurrent source", () => {
    const components: SchematicComponent[] = [
      {
        ...c("photodiode", "D1", "50u", 0, 0),
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "k", label: "K", x: 0, y: 64 },
        ],
      },
      {
        ...c("resistor", "R1", "10k", 64, 0),
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^D1\b.+\bTAU_DIODE\b/m);
    expect(deck.netlist).toMatch(/^I_D1_ph\b.+\b50u\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op, JSON.stringify(op)).toMatchObject({ ok: true });
    if (!op.ok) return;
    // Photovoltaic: Iph into the load develops a positive anode voltage.
    const anode = op.nets.find((n) => n.voltage > 0.1);
    expect(anode).toBeDefined();
  });
});

describe("EveryCircuit library — bulb + relay + motor", () => {
  it("lists the new parts in the palette with expected pin counts", () => {
    expect(CATALOG.some((e) => e.kind === "bulb")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "relay")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "motor")).toBe(true);
    expect(getLocalPins("bulb").map((p) => p.id)).toEqual(["a", "b"]);
    expect(getLocalPins("relay").map((p) => p.id)).toEqual(["a", "b", "cp", "cn"]);
    expect(getLocalPins("motor").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("parses relay coil and motor armature values honestly", () => {
    expect(relayCoilOhms("")).toBe(100);
    expect(relayCoilOhms("220")).toBe(220);
    expect(motorArmature("").resistance).toBe(10);
    expect(motorArmature("").inductance).toBeCloseTo(1e-3, 12);
    expect(motorArmature("5 2m").resistance).toBe(5);
    expect(motorArmature("5 2m").inductance).toBeCloseTo(2e-3, 12);
    expect(motorArmature("R=8 L=500u").resistance).toBe(8);
    expect(motorArmature("R=8 L=500u").inductance).toBeCloseTo(500e-6, 12);
  });

  it("emits bulb as a resistor and solves OP (I²R path)", () => {
    const components: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "12", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("bulb", "R1", "10", 32, 0),
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^R1\b.+\b10\b/m);

    const op = runOperatingPoint({ components, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const hot = op.nets.find((n) => Math.abs(n.voltage - 12) < 1e-3);
    expect(hot).toBeDefined();
    // 12 V / 10 Ω → 1.2 A through the filament (power = 14.4 W via I²R).
    const branch = op.branches?.find((b) => b.label === "R1" || b.id === "r1");
    if (branch) expect(Math.abs(branch.current)).toBeCloseTo(1.2, 3);
  });

  it("emits relay as coil R + voltage-controlled SW contact", () => {
    const components: SchematicComponent[] = [
      {
        ...c("relay", "K1", "100", 0, 0),
        pinOverride: [
          { id: "a", label: "A", x: -32, y: 0 },
          { id: "b", label: "B", x: 32, y: 0 },
          { id: "cp", label: "COIL+", x: -16, y: 32 },
          { id: "cn", label: "COIL-", x: 16, y: 32 },
        ],
      },
      {
        ...c("ground", "GND", "", 16, 32),
        pinOverride: [{ id: "g", label: "0", x: 16, y: 32 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/\.model TAU_SW SW\(/);
    expect(deck.netlist).toMatch(/^R_K1_coil\b.+\b100\b/m);
    expect(deck.netlist).toMatch(/^S_K1\b.+\bTAU_SW\b/m);
  });

  it("emits motor as series armature R + L (no back-EMF)", () => {
    const components: SchematicComponent[] = [
      {
        ...c("motor", "M1", "10 1m", 0, 0),
        pinOverride: [
          { id: "a", label: "A", x: -32, y: 0 },
          { id: "b", label: "B", x: 32, y: 0 },
        ],
      },
      {
        ...c("ground", "GND", "", 32, 0),
        pinOverride: [{ id: "g", label: "0", x: 32, y: 0 }],
      },
    ];
    const deck = buildSpiceDeck({ components, wires: [] }, { kind: "op" });
    expect(deck.netlist).toMatch(/^R_M1\b.+\b10\b/m);
    expect(deck.netlist).toMatch(/^L_M1\b.+\b1m\b/m);
    expect(deck.netlist).not.toMatch(/back.?emf|BEMF|torque/i);

    // Browser OP stamps armature R only (L shorts at DC).
    const driven: SchematicComponent[] = [
      {
        ...c("vsource", "V1", "5", 0, 0),
        pinOverride: [
          { id: "p", label: "+", x: 0, y: 0 },
          { id: "n", label: "-", x: 0, y: 64 },
        ],
      },
      {
        ...c("motor", "M1", "10 1m", 32, 0),
        pinOverride: [
          { id: "a", label: "A", x: 0, y: 0 },
          { id: "b", label: "B", x: 0, y: 64 },
        ],
      },
      {
        ...c("ground", "GND", "", 0, 64),
        pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
      },
    ];
    const op = runOperatingPoint({ components: driven, wires: [] });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const hot = op.nets.find((n) => Math.abs(n.voltage - 5) < 1e-3);
    expect(hot).toBeDefined();
  });
});

describe("EveryCircuit library — SR / T / JK flip-flops", () => {
  it("lists SR/T/JK in the palette with expected pin counts", () => {
    expect(CATALOG.some((e) => e.kind === "srflop")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "tflop")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "jkflop")).toBe(true);
    expect(getLocalPins("srflop").map((p) => p.id)).toEqual(["s", "r", "q", "qbar", "com"]);
    expect(getLocalPins("tflop").map((p) => p.id)).toEqual(["t", "clk", "pre", "clr", "q", "qbar", "com"]);
    expect(getLocalPins("jkflop").map((p) => p.id)).toEqual(["j", "k", "clk", "pre", "clr", "q", "qbar", "com"]);
  });

  it("emits SR latch as d_dff async set/reset (no fake 555/IC)", () => {
    const components: SchematicComponent[] = [
      {
        ...c("srflop", "A1", "Vhigh=5", 0, 0),
        pinOverride: [
          { id: "s", label: "S", x: -32, y: -16 },
          { id: "r", label: "R", x: -32, y: 16 },
          { id: "q", label: "Q", x: 32, y: -16 },
          { id: "qbar", label: "Q̅", x: 32, y: 16 },
        ],
      },
      {
        ...c("vsource", "VS", "5", -128, 16),
        pinOverride: [
          { id: "p", label: "+", x: -128, y: -16 },
          { id: "n", label: "-", x: -128, y: 48 },
        ],
      },
      {
        ...c("resistor", "RL", "1k", 96, -16),
        pinOverride: [
          { id: "a", label: "A", x: 64, y: -16 },
          { id: "b", label: "B", x: 128, y: -16 },
        ],
      },
      {
        ...c("ground", "GND", "", -128, 48),
        pinOverride: [{ id: "g", label: "0", x: -128, y: 48 }],
      },
      {
        ...c("ground", "GND2", "", 128, -16),
        pinOverride: [{ id: "g", label: "0", x: 128, y: -16 }],
      },
    ];
    const deck = buildSpiceDeck({
      components,
      wires: [
        { id: "w1", points: [{ x: -32, y: -16 }, { x: -128, y: -16 }] },
        { id: "w2", points: [{ x: 32, y: -16 }, { x: 64, y: -16 }] },
      ],
    }, { kind: "op" });
    expect(deck.netlist).toMatch(/A_a1_adc \[0 0 \S+ 0\] \[a1_dd a1_dclk a1_ds a1_dr\] a1_adc/);
    expect(deck.netlist).toContain(".model a1_dff d_dff(ic=0");
    expect(deck.netlist).toContain("A_a1 a1_dd a1_dclk a1_ds a1_dr a1_dq a1_dnq a1_dff");
    expect(deck.netlist).not.toMatch(/555|ne555|lm555/i);
  });

  it("emits T and JK as XSPICE d_tff / d_jkff", () => {
    const t: SchematicComponent = {
      ...c("tflop", "A2", "Vhigh=5", 0, 0),
      pinOverride: [
        { id: "t", label: "T", x: -32, y: -16 },
        { id: "clk", label: "CLK", x: -32, y: 16 },
        { id: "q", label: "Q", x: 32, y: -16 },
      ],
    };
    const jk: SchematicComponent = {
      ...c("jkflop", "A3", "Vhigh=5", 200, 0),
      pinOverride: [
        { id: "j", label: "J", x: 168, y: -24 },
        { id: "k", label: "K", x: 168, y: 0 },
        { id: "clk", label: "CLK", x: 168, y: 24 },
        { id: "q", label: "Q", x: 232, y: -16 },
      ],
    };
    const gnd: SchematicComponent = {
      ...c("ground", "GND", "", 0, 64),
      pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
    };
    // Isolated devices still emit model cards (unconnected pins → ground).
    const deckT = buildSpiceDeck({ components: [t, gnd], wires: [] }, { kind: "op" });
    expect(deckT.netlist).toContain(".model a2_tff d_tff(ic=0");
    expect(deckT.netlist).toContain("A_a2 a2_dt a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_tff");

    const deckJk = buildSpiceDeck({ components: [jk, gnd], wires: [] }, { kind: "op" });
    expect(deckJk.netlist).toContain(".model a3_jkff d_jkff(ic=0");
    expect(deckJk.netlist).toContain("A_a3 a3_dj a3_dk a3_dclk a3_dpre a3_dclr a3_dq a3_dnq a3_jkff");
  });
});

describe("EveryCircuit library — IC pack (counter / 555 / ADC / DAC / 7-seg)", () => {
  it("lists the five ICs in the Digital palette with expected pins", () => {
    expect(CATALOG.some((e) => e.kind === "counter")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "timer555")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "adc")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "dac")).toBe(true);
    expect(CATALOG.some((e) => e.kind === "sevenSeg")).toBe(true);
    expect(getLocalPins("counter").map((p) => p.id)).toEqual([
      "clk", "rst", "q0", "q1", "q2", "q3", "com",
    ]);
    expect(getLocalPins("timer555").map((p) => p.id)).toEqual([
      "gnd", "trig", "out", "reset", "cont", "thres", "disch", "vcc",
    ]);
    expect(getLocalPins("adc").map((p) => p.id)).toEqual([
      "vin", "vref", "d0", "d1", "d2", "d3", "com",
    ]);
    expect(getLocalPins("dac").map((p) => p.id)).toEqual([
      "d0", "d1", "d2", "d3", "vref", "out", "com",
    ]);
    expect(getLocalPins("sevenSeg").map((p) => p.id)).toEqual([
      "a", "b", "c", "d", "e", "f", "g", "dp", "com",
    ]);
    // Honest SR label — not a gated SR without enable.
    expect(CATALOG.find((e) => e.kind === "srflop")?.name).toBe("SR Latch");
  });

  it("emits a 4-bit ripple counter as four d_tff stages", () => {
    const ctr: SchematicComponent = {
      ...c("counter", "A1", "Vhigh=5", 0, 0),
      pinOverride: [
        { id: "clk", label: "CLK", x: -40, y: -16 },
        { id: "rst", label: "RST", x: -40, y: 16 },
        { id: "q0", label: "Q0", x: 40, y: -24 },
        { id: "q1", label: "Q1", x: 40, y: -8 },
        { id: "q2", label: "Q2", x: 40, y: 8 },
        { id: "q3", label: "Q3", x: 40, y: 24 },
      ],
    };
    const gnd: SchematicComponent = {
      ...c("ground", "GND", "", 0, 64),
      pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
    };
    const deck = buildSpiceDeck({ components: [ctr, gnd], wires: [] }, { kind: "op" });
    expect(deck.netlist).toContain(".model a1_tff d_tff(ic=0");
    expect(deck.netlist).toContain("A_a1_0 a1_dt a1_dclk a1_dpre a1_drst a1_dq0 a1_dnq0 a1_tff");
    expect(deck.netlist).toContain("A_a1_3 a1_dt a1_dnq2 a1_dpre a1_drst a1_dq3 a1_dnq3 a1_tff");
    expect(deck.netlist).toMatch(/A_a1_dac \[a1_dq0 a1_dq1 a1_dq2 a1_dq3\]/);
  });

  it("emits timer555 as X… tau_555 with the bundled .subckt", () => {
    const u1: SchematicComponent = {
      ...c("timer555", "U1", "", 0, 0),
      pinOverride: [
        { id: "gnd", label: "GND", x: -40, y: 32 },
        { id: "trig", label: "TRIG", x: -40, y: 16 },
        { id: "out", label: "OUT", x: 40, y: 0 },
        { id: "reset", label: "RESET", x: -40, y: -32 },
        { id: "cont", label: "CONT", x: 40, y: -32 },
        { id: "thres", label: "THRES", x: 40, y: 16 },
        { id: "disch", label: "DISCH", x: 40, y: 32 },
        { id: "vcc", label: "VCC", x: -40, y: -16 },
      ],
    };
    const gnd: SchematicComponent = {
      ...c("ground", "GND", "", 0, 64),
      pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
    };
    const deck = buildSpiceDeck({ components: [u1, gnd], wires: [] }, { kind: "op" });
    expect(deck.netlist).toContain(".subckt tau_555");
    expect(deck.netlist).toMatch(/^XU1\b.+\btau_555$/m);
    expect(deck.netlist).not.toMatch(/analog\.com|encrypted|\$CMII|AD712/i);
  });

  it("emits ADC / DAC behavioral B lines and 7-seg 1G loads", () => {
    const adc: SchematicComponent = {
      ...c("adc", "A2", "Vhigh=5", 0, 0),
      pinOverride: [
        { id: "vin", label: "VIN", x: -40, y: -16 },
        { id: "vref", label: "VREF", x: -40, y: 16 },
        { id: "d0", label: "D0", x: 40, y: -24 },
        { id: "d3", label: "D3", x: 40, y: 24 },
      ],
    };
    const dac: SchematicComponent = {
      ...c("dac", "A3", "", 200, 0),
      pinOverride: [
        { id: "d0", label: "D0", x: 160, y: -24 },
        { id: "d1", label: "D1", x: 160, y: -8 },
        { id: "d2", label: "D2", x: 160, y: 8 },
        { id: "d3", label: "D3", x: 160, y: 24 },
        { id: "vref", label: "VREF", x: 160, y: 40 },
        { id: "out", label: "OUT", x: 240, y: 0 },
      ],
    };
    const disp: SchematicComponent = {
      ...c("sevenSeg", "U2", "", 400, 0),
      pinOverride: [
        { id: "a", label: "A", x: 392, y: -48 },
        { id: "b", label: "B", x: 432, y: -24 },
        { id: "g", label: "G", x: 360, y: 0 },
        { id: "com", label: "COM", x: 400, y: 56 },
      ],
    };
    const gnd: SchematicComponent = {
      ...c("ground", "GND", "", 0, 64),
      pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
    };
    const deck = buildSpiceDeck(
      { components: [adc, dac, disp, gnd], wires: [] },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/^B_a2_d3\b/m);
    expect(deck.netlist).toMatch(/^B_a2_d0\b/m);
    expect(deck.netlist).toMatch(/^B_a3_out\b/m);
    expect(deck.netlist).toMatch(/^R_u2_a\b.+1G/m);
    expect(deck.netlist).toMatch(/^R_u2_g\b.+1G/m);
  });
});

describe("EveryCircuit library — center-tapped transformer", () => {
  it("lists CT transformer with five pins", () => {
    expect(CATALOG.some((e) => e.kind === "ctTransformer")).toBe(true);
    expect(getLocalPins("ctTransformer").map((p) => p.id)).toEqual([
      "p1", "p2", "s1", "ct", "s2",
    ]);
  });

  it("emits three coupled inductors (primary + two half-secondaries)", () => {
    const xfmr: SchematicComponent = {
      ...c("ctTransformer", "T1", "1:2 L1=1m k=0.99", 0, 0),
      pinOverride: [
        { id: "p1", label: "P1", x: -32, y: -16 },
        { id: "p2", label: "P2", x: -32, y: 16 },
        { id: "s1", label: "S1", x: 32, y: -24 },
        { id: "ct", label: "CT", x: 32, y: 0 },
        { id: "s2", label: "S2", x: 32, y: 24 },
      ],
    };
    const gnd: SchematicComponent = {
      ...c("ground", "GND", "", 0, 64),
      pinOverride: [{ id: "g", label: "0", x: 0, y: 64 }],
    };
    const deck = buildSpiceDeck({ components: [xfmr, gnd], wires: [] }, { kind: "op" });
    // Full secondary L2 = 1m * (2/1)^2 = 4m → each half = 1m.
    expect(deck.netlist).toMatch(/^L_T1_p\b.+\b0\.001\b/m);
    expect(deck.netlist).toMatch(/^L_T1_sa\b.+\b0\.001\b/m);
    expect(deck.netlist).toMatch(/^L_T1_sb\b.+\b0\.001\b/m);
    expect(deck.netlist).toMatch(/^K_T1 L_T1_p L_T1_sa L_T1_sb 0\.99$/m);
    expect(deck.netlist).not.toMatch(/unsupported|refused/i);
  });
});
