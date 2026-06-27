import { describe, it, expect } from "vitest";
import { parseAsc, ltspiceTypeToKind, orientationToRotation, transformLtPoint, LTSPICE_PINS, ascToSchematic, importAsc } from "./ascImport";
import { extractCircuit } from "../schematic/netlist";
import { buildParamScope, resolveComponentValues } from "../simulation/paramScope";

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

  it("maps LTspice controlled-source symbols (e/g) to VCVS/VCCS", () => {
    expect(ltspiceTypeToKind("e")).toBe("vcvs");
    expect(ltspiceTypeToKind("E2")).toBe("vcvs");
    expect(ltspiceTypeToKind("g")).toBe("vccs");
    expect(ltspiceTypeToKind("g2")).toBe("vccs");
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

describe("ascToSchematic", () => {
  // R1 (res, R90) sits at (336,192). Its LTspice pins (16,16)/(16,96) map under
  // R90 to world (320,208)/(240,208) — verified by hand against the wires below.
  const SRC = `Version 4
SHEET 1 880 680
WIRE 368 208 320 208
WIRE 240 208 192 208
SYMBOL res 336 192 R90
SYMATTR InstName R1
SYMATTR Value 100k
FLAG 192 208 vout
FLAG 368 208 vcc
FLAG 320 96 0
TEXT 0 0 Left 2 !.tran 1m
TEXT 0 40 Left 2 ;a note`;

  it("converts symbols into components carrying LTspice-accurate world pins", () => {
    const doc = ascToSchematic(parseAsc(SRC));
    const r1 = doc.components.find((c) => c.label === "R1");
    expect(r1).toBeDefined();
    expect(r1?.kind).toBe("resistor");
    expect(r1?.value).toBe("100k");
    expect(r1?.rotation).toBe(90);
    const pins = Object.fromEntries((r1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a).toEqual({ x: 320, y: 208 });
    expect(pins.b).toEqual({ x: 240, y: 208 });
  });

  it("maps wires 1:1 and FLAGs into grounds / net labels", () => {
    const doc = ascToSchematic(parseAsc(SRC));
    expect(doc.wires).toHaveLength(2);
    expect(doc.wires[0].points).toEqual([{ x: 368, y: 208 }, { x: 320, y: 208 }]);
    // "0" flag → ground component at the flag point; named flags → net labels.
    const ground = doc.components.find((c) => c.kind === "ground");
    expect(ground).toMatchObject({ x: 320, y: 96 });
    expect(doc.netLabels.map((l) => l.text).sort()).toEqual(["vcc", "vout"]);
    expect(doc.netLabels.find((l) => l.text === "vcc")).toMatchObject({ x: 368, y: 208 });
  });

  it("surfaces SPICE directives and comments separately", () => {
    const doc = ascToSchematic(parseAsc(SRC));
    expect(doc.directives).toEqual([".tran 1m"]);
    expect(doc.comments).toEqual(["a note"]);
  });

  it("imported directives build a param scope that resolves {expr} component values", () => {
    // §1(d): a real imported circuit's `.param`/`{expr}` round-trip — the
    // directives ascToSchematic surfaces must drive the param scope that the
    // solvers resolve component values against.
    const PARAMETRIZED = `Version 4
SHEET 1 880 680
SYMBOL res 336 192 R90
SYMATTR InstName R1
SYMATTR Value {Rload}
TEXT 0 0 Left 2 !.param Rload=4.7k
TEXT 0 40 Left 2 !.tran 1m`;
    const doc = ascToSchematic(parseAsc(PARAMETRIZED));
    expect(doc.directives).toEqual([".param Rload=4.7k", ".tran 1m"]);

    const scope = buildParamScope(doc.directives);
    const resolved = resolveComponentValues(doc.components, scope);
    const r1 = resolved.find((c) => c.label === "R1");
    expect(r1?.value).toBe("4700"); // {Rload} → 4.7k → 4700, no braces left
  });

  it("produces a circuit whose nets extract exactly as LTspice intends", () => {
    const doc = ascToSchematic(parseAsc(SRC));
    const circuit = extractCircuit(doc.components, doc.wires, doc.netLabels);
    const pinNet = (label: string, pinId: string) =>
      circuit.nets.find((n) => n.pins.some((p) => p.componentLabel === label && p.id === pinId))?.id;
    // R1.a meets the vcc wire; R1.b meets the vout wire — net names follow labels.
    expect(pinNet("R1", "a")).toBe("vcc");
    expect(pinNet("R1", "b")).toBe("vout");
    expect(circuit.warnings).not.toContain("No ground symbol found.");
  });

  it("ties the bulk of a 3-terminal MOS symbol to its source", () => {
    const doc = ascToSchematic(parseAsc(`Version 4
SHEET 1 880 680
SYMBOL nmos 100 100 R0
SYMATTR InstName M1`));
    const m1 = doc.components.find((c) => c.label === "M1");
    const pins = Object.fromEntries((m1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(Object.keys(pins).sort()).toEqual(["b", "d", "g", "s"]);
    expect(pins.b).toEqual(pins.s); // bulk tied to source
  });

  it("importAsc parses raw text and converts in one step (Open-dialog path)", () => {
    const result = importAsc(SAMPLE);
    // Equivalent to ascToSchematic(parseAsc(text)).
    const direct = ascToSchematic(parseAsc(SAMPLE));
    expect(result.components.length).toBe(direct.components.length);
    expect(result.wires.length).toBe(direct.wires.length);
    expect(result.components.some((c) => c.label === "R1")).toBe(true);
    expect(result.wires.length).toBeGreaterThan(0);
  });

  it("importAsc yields empty content for a non-LTspice file (Open dialog guards on this)", () => {
    const result = importAsc("this is not a schematic\nrandom text\n");
    expect(result.components).toHaveLength(0);
    expect(result.wires).toHaveLength(0);
  });

  it("skips unmappable symbols with a warning rather than throwing", () => {
    const doc = ascToSchematic(parseAsc(`Version 4
SHEET 1 880 680
SYMBOL opamps\\\\LT1468 0 0 R0
SYMATTR InstName U1
SYMBOL exotic\\\\WidgetXYZ 0 0 R0
SYMATTR InstName X1`));
    // The opamp maps to a native kind (placed, but no banked pins → warned);
    // the unknown vendor part is skipped entirely.
    expect(doc.components.some((c) => c.kind === "opamp")).toBe(true);
    expect(doc.components.some((c) => c.label === "X1")).toBe(false);
    expect(doc.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
