import { describe, expect, it } from "vitest";
import { getComponentPins, getLocalPins, transformPoint } from "./pins";
import type { SchematicComponent } from "./types";

describe("getComponentPins", () => {
  it("derives pins from kind geometry + rotation when no override is present", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 100, y: 50, rotation: 0,
    };
    const pins = getComponentPins(r);
    expect(pins.map((p) => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: "a", x: 68, y: 50 },
      { id: "b", x: 132, y: 50 },
    ]);
  });

  it("rotates derived pins about the component origin", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 0, y: 0, rotation: 90,
    };
    // (-32,0) and (32,0) rotate 90° → (0,-32) and (0,32).
    expect(getComponentPins(r).map((p) => ({ x: p.x, y: p.y }))).toEqual([
      { x: 0, y: -32 },
      { x: 0, y: 32 },
    ]);
  });

  it("uses pinOverride world positions verbatim, ignoring kind geometry", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 999, y: 999, rotation: 90,
      pinOverride: [
        { id: "a", label: "A", x: 320, y: 208 },
        { id: "b", label: "B", x: 240, y: 208 },
      ],
    };
    const pins = getComponentPins(r);
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: "a", x: 320, y: 208 },
      { id: "b", x: 240, y: 208 },
    ]);
    // Identity metadata still flows from the component.
    expect(pins[0].componentId).toBe("r1");
    expect(pins[0].kind).toBe("resistor");
  });

  it("falls back to kind geometry when pinOverride is empty", () => {
    const r: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 0, y: 0, rotation: 0,
      pinOverride: [],
    };
    expect(getComponentPins(r)).toHaveLength(2);
    expect(getComponentPins(r)[0].x).toBe(-32);
  });

  it("mirrors an asymmetric part's pins across the vertical axis", () => {
    // Opamp: in+ (-32,16), in- (-32,-16), out (32,0). Mirror flips x → -x, so
    // the inputs move to the right and the output to the left.
    const op: SchematicComponent = {
      id: "u1", kind: "opamp", label: "U1", value: "", x: 0, y: 0, rotation: 0, mirrored: true,
    };
    const pins = getComponentPins(op);
    const by = Object.fromEntries(pins.map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(by["in+"]).toEqual({ x: 32, y: 16 });
    expect(by["in-"]).toEqual({ x: 32, y: -16 });
    expect(by["out"]).toEqual({ x: -32, y: 0 });
    // The vertical supply pins lie on the axis, so mirror leaves them put.
    expect(by["v+"]).toEqual({ x: 0, y: -32 });
  });

  it("applies mirror BEFORE rotation (matches LTspice M* orientations)", () => {
    // Opamp out (32,0): mirror → (-32,0), then rotate 90° → (0,-32).
    const op: SchematicComponent = {
      id: "u1", kind: "opamp", label: "U1", value: "", x: 10, y: 20, rotation: 90, mirrored: true,
    };
    const out = getComponentPins(op).find((p) => p.id === "out")!;
    expect({ x: out.x, y: out.y }).toEqual({ x: 10 + 0, y: 20 + -32 });
  });
});

describe("transformPoint", () => {
  it("is the identity at rotation 0 with no mirror", () => {
    expect(transformPoint({ x: 5, y: -7 }, 0, false)).toEqual({ x: 5, y: -7 });
  });

  it("flips x then rotates clockwise", () => {
    // (4, 1) mirrored → (-4, 1), rotate 90° → (-1, -4).
    expect(transformPoint({ x: 4, y: 1 }, 90, true)).toEqual({ x: -1, y: -4 });
  });

  it("mirror twice (toggle) returns the original geometry", () => {
    const p = { x: 3, y: 9 };
    const once = transformPoint(p, 0, true);
    expect(transformPoint(once, 0, true)).toEqual(p);
  });
});

describe("value-driven terminal banks (mission item 9)", () => {
  const gate = (value: string): SchematicComponent => ({
    id: "a1", kind: "digitalGate", label: "A1", value, x: 0, y: 0, rotation: 0,
  });

  it("gives a placed gate the inputs its value asks for, not a fixed five", () => {
    expect(getComponentPins(gate("and")).map((p) => p.id))
      .toEqual(["in1", "in2", "q"]);
    expect(getComponentPins(gate("or Inputs=4")).map((p) => p.id))
      .toEqual(["in1", "in2", "in3", "in4", "q"]);
    expect(getComponentPins(gate("not")).map((p) => p.id))
      .toEqual(["in1", "q"]);
  });

  it("gives a placed gate ONE output, on the centreline, and no com reference", () => {
    // The reported defect. A logic gate has one output; the second lead was
    // LTspice's complementary pin and the stub off the bottom was the
    // behavioural model's voltage reference, neither of which the function has.
    for (const value of ["and", "nand", "or Inputs=5", "xnor", "not", "schmitt"]) {
      const outputs = getComponentPins(gate(value)).filter((pin) => !pin.id.startsWith("in"));
      expect(outputs.map((pin) => pin.id), value).toEqual(["q"]);
      expect({ x: outputs[0].x, y: outputs[0].y }, value).toEqual({ x: 32, y: 0 });
    }
  });

  it("keeps an imported gate's whole LTspice bank, which is the .asy's own", () => {
    // Only the natively placed gate lost the pair and the reference: an
    // imported symbol carries its source file's real terminals, and wires in
    // that file end on them.
    const imported: SchematicComponent = {
      ...gate("and Inputs=5"),
      pinOverride: [
        { id: "in1", label: "1", x: -32, y: 32 },
        { id: "qbar", label: "Q̅", x: 32, y: 80 },
        { id: "q", label: "Q", x: 32, y: 48 },
        { id: "com", label: "COM", x: -16, y: 96 },
      ],
    };
    expect(getComponentPins(imported).map((p) => p.id)).toEqual(["in1", "qbar", "q", "com"]);
  });

  it("keeps every input terminal on the 16 grid and centred on the body", () => {
    const rows = getComponentPins(gate("and Inputs=5"))
      .filter((pin) => pin.id.startsWith("in"))
      .map((pin) => pin.y);
    expect(rows).toEqual([-32, -16, 0, 16, 32]);
    for (const y of rows) expect(Math.abs(y % 16)).toBe(0);
  });

  it("rotates the resized bank like any other geometry", () => {
    const rotated = getComponentPins({ ...gate("and"), rotation: 90 });
    const by = Object.fromEntries(rotated.map((pin) => [pin.id, { x: pin.x, y: pin.y }]));
    // in1 is local (-32,-16); rotate 90° → (16,-32).
    expect(by.in1).toEqual({ x: 16, y: -32 });
    expect(by.in3).toBeUndefined();
  });

  it("keeps the kind-only lookup as the full dictionary the importer needs", () => {
    // `buildPinOverride` maps an .asy's pin NAMES onto Tau roles through this
    // table, so narrowing it by kind alone would drop in2..in5 from every
    // imported AND and leave a five-input gate wired to one terminal. It also
    // has to keep `qbar` and `com`, which a placed gate no longer exposes:
    // without them an imported inv.asy would lose its only output.
    expect(getLocalPins("digitalGate").map((pin) => pin.id))
      .toEqual(["in1", "in2", "in3", "in4", "in5", "q", "qbar", "com"]);
    // …at LTspice's geometry, which `componentVisualPlacement` least-squares
    // fits an imported body onto. Moving these moves every imported gate.
    const by = Object.fromEntries(getLocalPins("digitalGate").map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(by.q).toEqual({ x: 32, y: -16 });
    expect(by.qbar).toEqual({ x: 32, y: 16 });
    expect(by.com).toEqual({ x: 32, y: 32 });
  });

  it("leaves every other kind's bank independent of its value", () => {
    const resistor: SchematicComponent = {
      id: "r1", kind: "resistor", label: "R1", value: "1k", x: 0, y: 0, rotation: 0,
    };
    expect(getComponentPins(resistor).map((p) => p.id))
      .toEqual(getComponentPins({ ...resistor, value: "10meg" }).map((p) => p.id));
  });
});

describe("P4-13 / P4-15 directed and electromechanical pin contracts", () => {
  it("gives a native SPST only its switched path while preserving an imported control pair", () => {
    const native: SchematicComponent = {
      id: "s1", kind: "switch", label: "S1", value: "open", x: 0, y: 0, rotation: 0,
    };
    expect(getComponentPins(native).map((pin) => pin.id)).toEqual(["a", "b"]);
    expect(getComponentPins({ ...native, value: "MYSW" }).map((pin) => pin.id))
      .toEqual(["a", "b", "cp", "cn"]);
    // The importer still sees LTspice sw.asy's full role dictionary when it
    // builds a pin override, so no existing controlled-switch .asc is changed.
    expect(getLocalPins("switch").map((pin) => pin.id)).toEqual(["a", "b", "cp", "cn"]);
    expect(getComponentPins({
      ...native,
      pinOverride: [
        { id: "a", label: "A", x: -32, y: 0 },
        { id: "b", label: "B", x: 32, y: 0 },
        { id: "cp", label: "NC+", x: -16, y: 32 },
        { id: "cn", label: "NC-", x: 16, y: 32 },
      ],
    }).map((pin) => pin.id)).toEqual(["a", "b", "cp", "cn"]);
  });

  it("keeps SPDT and relay terminals unique and functionally named", () => {
    expect(getLocalPins("spdt").map((pin) => pin.id)).toEqual(["com", "no", "nc"]);
    expect(getLocalPins("relay").map((pin) => ({ id: pin.id, label: pin.label }))).toEqual([
      { id: "a", label: "COM" },
      { id: "b", label: "NO" },
      { id: "cp", label: "COIL+" },
      { id: "cn", label: "COIL-" },
    ]);
  });

  it("carries a diode’s anode/cathode geometry through mirror and rotation", () => {
    const diode: SchematicComponent = {
      id: "d1", kind: "diode", label: "D1", value: "D", x: 100, y: 200, rotation: 90, mirrored: true,
    };
    const byId = Object.fromEntries(getComponentPins(diode).map((pin) => [pin.id, { x: pin.x, y: pin.y }]));
    // Local A (-32, 0) mirrors to (+32, 0), then rotates to (0, +32); K does
    // the opposite. The visible polarity marks ride the same canvas wrapper.
    expect(byId.a).toEqual({ x: 100, y: 232 });
    expect(byId.k).toEqual({ x: 100, y: 168 });
  });
});

describe("digital terminals clear the palette preview (mission item 5)", () => {
  it("keeps every digital pin inside the ±42 × ±40 preview box", () => {
    // The flip-flops' PRE/CLR and every `com` used to sit at |y| = 48 and the
    // 7-segment common at 56, so the palette and inspector cut them off.
    const kinds = [
      "dflop", "srflop", "tflop", "jkflop", "counter", "timer555",
      "adc", "dac", "sevenSeg", "sampleHold", "modulator",
    ] as const;
    for (const kind of kinds) {
      for (const pin of getLocalPins(kind)) {
        expect(Math.abs(pin.x), `${kind}.${pin.id} x`).toBeLessThanOrEqual(42);
        expect(Math.abs(pin.y), `${kind}.${pin.id} y`).toBeLessThanOrEqual(40);
      }
    }
  });
});
