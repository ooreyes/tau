import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { runOperatingPoint } from "../simulation/operatingPoint";
import { CATALOG } from "./catalog";
import {
  isCapacitorKind,
  isSpdtThrowToNo,
  isStaticContactClosed,
  logicConstantVolts,
  photodiodePhotocurrentAmps,
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
