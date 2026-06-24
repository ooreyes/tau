import { describe, it, expect } from "vitest";
import { parseAsc, ltspiceTypeToKind, orientationToRotation, transformLtPoint, LTSPICE_PINS } from "./ascImport";

// A representative slice of real LTspice .asc grammar (RC low-pass with a
// pulse source, a directive, a comment, and a drawing primitive).
const SAMPLE = `Version 4
SHEET 1 880 680
WIRE 144 96 80 96
WIRE 304 96 224 96
WIRE 304 144 304 96
WIRE 80 192 80 96
WIRE 304 240 304 224
FLAG 80 192 0
FLAG 304 240 0
FLAG 304 96 vout
SYMBOL res 240 80 R90
WINDOW 0 0 56 VBottom 2
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL cap 288 144 R0
SYMATTR InstName C1
SYMATTR Value 1u
SYMBOL voltage 80 80 R0
WINDOW 123 0 0 Left 0
SYMATTR InstName V1
SYMATTR Value PULSE(0 5 0 1n 1n 1m 2m)
TEXT 72 280 Left 2 !.tran 5m
TEXT 72 320 Left 2 ;RC low-pass demo
LINE Normal 100 300 200 300`;

describe("parseAsc", () => {
  const doc = parseAsc(SAMPLE);

  it("parses the header", () => {
    expect(doc.version).toBe(4);
    expect(doc.sheet).toEqual({ index: 1, width: 880, height: 680 });
  });

  it("parses wires", () => {
    expect(doc.wires).toHaveLength(5);
    expect(doc.wires[0]).toEqual({ x1: 144, y1: 96, x2: 80, y2: 96 });
  });

  it("parses flags incl. ground and named nets", () => {
    expect(doc.flags).toHaveLength(3);
    expect(doc.flags.filter((f) => f.net === "0")).toHaveLength(2);
    expect(doc.flags.find((f) => f.net === "vout")).toEqual({ x: 304, y: 96, net: "vout" });
  });

  it("parses symbols with their SYMATTRs and orientation", () => {
    expect(doc.symbols).toHaveLength(3);
    const r1 = doc.symbols.find((s) => s.attrs.InstName === "R1");
    expect(r1).toBeTruthy();
    expect(r1!.type).toBe("res");
    expect(r1!.orientation).toBe("R90");
    expect(r1!.attrs.Value).toBe("1k");
    const v1 = doc.symbols.find((s) => s.attrs.InstName === "V1");
    expect(v1!.attrs.Value).toBe("PULSE(0 5 0 1n 1n 1m 2m)");
  });

  it("separates directives from comments in TEXT", () => {
    const directives = doc.texts.filter((t) => t.directive);
    const comments = doc.texts.filter((t) => !t.directive);
    expect(directives.map((d) => d.text)).toEqual([".tran 5m"]);
    expect(comments.map((c) => c.text)).toEqual(["RC low-pass demo"]);
  });

  it("captures drawing primitives without choking", () => {
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0].kind).toBe("LINE");
  });

  it("WINDOW lines do not attach as SYMATTRs and are ignored", () => {
    for (const s of doc.symbols) {
      expect(Object.keys(s.attrs).every((k) => !/^\d+$/.test(k))).toBe(true);
    }
  });

  it("never throws on empty or garbage input", () => {
    expect(() => parseAsc("")).not.toThrow();
    expect(parseAsc("").symbols).toEqual([]);
    const junk = parseAsc("not a real file\nWIRE\nSYMBOL\nSYMATTR");
    expect(junk.unknown).toContain("not a real file");
  });

  it("preserves CRLF files", () => {
    expect(parseAsc(SAMPLE.replace(/\n/g, "\r\n")).wires).toHaveLength(5);
  });
});

describe("ltspiceTypeToKind", () => {
  it("maps common built-in symbol types", () => {
    expect(ltspiceTypeToKind("res")).toBe("resistor");
    expect(ltspiceTypeToKind("RES")).toBe("resistor");
    expect(ltspiceTypeToKind("cap")).toBe("capacitor");
    expect(ltspiceTypeToKind("ind")).toBe("inductor");
    expect(ltspiceTypeToKind("voltage")).toBe("vsource");
    expect(ltspiceTypeToKind("current")).toBe("isource");
    expect(ltspiceTypeToKind("diode")).toBe("diode");
    expect(ltspiceTypeToKind("npn")).toBe("npn");
    expect(ltspiceTypeToKind("pnp")).toBe("pnp");
    expect(ltspiceTypeToKind("nmos")).toBe("nmos");
    expect(ltspiceTypeToKind("pmos")).toBe("pmos");
    expect(ltspiceTypeToKind("LED")).toBe("led");
    expect(ltspiceTypeToKind("sw")).toBe("switch");
  });

  it("treats any opamps/* library symbol as an op-amp", () => {
    expect(ltspiceTypeToKind("opamps\\LT1468")).toBe("opamp");
    expect(ltspiceTypeToKind("Opamps\\AD8675")).toBe("opamp");
  });

  it("returns null for unmapped vendor/library symbols", () => {
    expect(ltspiceTypeToKind("References\\LT1009")).toBeNull();
    expect(ltspiceTypeToKind("misc\\xtal")).toBeNull();
  });
});

describe("orientationToRotation", () => {
  it("maps R/M orientations to Tau rotations", () => {
    expect(orientationToRotation("R0")).toBe(0);
    expect(orientationToRotation("R90")).toBe(90);
    expect(orientationToRotation("R180")).toBe(180);
    expect(orientationToRotation("R270")).toBe(270);
    expect(orientationToRotation("M90")).toBe(90);
  });
});

describe("transformLtPoint", () => {
  it("is identity at R0", () => {
    expect(transformLtPoint(16, 96, "R0")).toEqual({ x: 16, y: 96 });
  });
  it("rotates clockwise (Y down)", () => {
    // a point to the right rotates to down at R90
    expect(transformLtPoint(10, 0, "R90")).toEqual({ x: 0, y: 10 });
    expect(transformLtPoint(10, 0, "R180")).toEqual({ x: -10, y: 0 });
    expect(transformLtPoint(10, 0, "R270")).toEqual({ x: 0, y: -10 });
  });
  it("mirrors across the vertical axis for M*", () => {
    expect(transformLtPoint(10, 5, "M0")).toEqual({ x: -10, y: 5 });
  });
  it("composes mirror then rotate consistently", () => {
    // round-trip: applying the same rotation 4 times returns to start
    let p = { x: 7, y: 13 };
    for (let i = 0; i < 4; i += 1) p = transformLtPoint(p.x, p.y, "R90");
    expect(p).toEqual({ x: 7, y: 13 });
  });
});

describe("LTSPICE_PINS", () => {
  it("has correct pin counts for mapped kinds", () => {
    expect(LTSPICE_PINS.res).toHaveLength(2);
    expect(LTSPICE_PINS.npn).toHaveLength(3);
    expect(LTSPICE_PINS.nmos.map((p) => p.name)).toEqual(["D", "G", "S"]);
  });
});
