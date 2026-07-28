import { describe, it, expect } from "vitest";
import { parseAsc, parseAsy, ltspiceTypeToKind, orientationToRotation, transformLtPoint, LTSPICE_PINS, ascToSchematic, importAsc, componentValueFromAttrs, makeSubcircuitResolver, type SubcircuitResolver } from "./ascImport";
import { extractCircuit } from "../schematic/netlist";
import { buildSpiceDeck } from "../engine/spiceNetlist";
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

  it("maps LTspice current-controlled symbols (f/h) to CCCS/CCVS", () => {
    expect(ltspiceTypeToKind("f")).toBe("cccs");
    expect(ltspiceTypeToKind("F2")).toBe("cccs");
    expect(ltspiceTypeToKind("h")).toBe("ccvs");
    expect(ltspiceTypeToKind("h2")).toBe("ccvs");
  });

  it("maps LTspice behavioral source symbols (bv/bi) to bsource", () => {
    expect(ltspiceTypeToKind("bv")).toBe("bsource");
    expect(ltspiceTypeToKind("bi")).toBe("bsource");
    expect(ltspiceTypeToKind("B")).toBe("bsource");
    expect(ltspiceTypeToKind("b2")).toBe("bsource");
  });

  it("maps the LTspice tline symbol to a transmission line", () => {
    expect(ltspiceTypeToKind("tline")).toBe("tline");
    expect(ltspiceTypeToKind("TLINE")).toBe("tline");
  });

  it("maps LTspice JFET symbols (njf/pjf) to njf/pjf kinds", () => {
    expect(ltspiceTypeToKind("njf")).toBe("njf");
    expect(ltspiceTypeToKind("NJF")).toBe("njf");
    expect(ltspiceTypeToKind("pjf")).toBe("pjf");
  });

  it("maps alias symbols to their underlying kind", () => {
    // varactor / SMdiode are diodes; battery is a DC source; RN55upright and
    // UprightPowerResistor are resistors (real PAsystem / corpus symbols).
    expect(ltspiceTypeToKind("varactor")).toBe("diode");
    expect(ltspiceTypeToKind("SMdiode")).toBe("diode");
    expect(ltspiceTypeToKind("Misc\\battery")).toBe("vsource");
    expect(ltspiceTypeToKind("Misc\\signal")).toBe("vsource");
    expect(ltspiceTypeToKind("RN55upright")).toBe("resistor");
    expect(ltspiceTypeToKind("UprightPowerResistor")).toBe("resistor");
  });

  it("treats any opamps/* library symbol as an op-amp", () => {
    expect(ltspiceTypeToKind("opamps\\LT1468")).toBe("opamp");
    expect(ltspiceTypeToKind("Opamps\\AD8675")).toBe("opamp");
  });

  it("returns null for unmapped vendor/library symbols", () => {
    expect(ltspiceTypeToKind("References\\LT1009")).toBeNull();
  });

  it("maps xtal (misc\\xtal) to capacitor", () => {
    // Crystal is imported as a capacitor so the SPICE deck C element is
    // electrically correct; the full resonator model is in the value string.
    expect(ltspiceTypeToKind("misc\\xtal")).toBe("capacitor");
    expect(ltspiceTypeToKind("Misc\\Xtal")).toBe("capacitor");
  });
});

describe("orientationToRotation", () => {
  it("maps R/M orientations to Tau rotations", () => {
    expect(orientationToRotation("R0")).toBe(0);
    expect(orientationToRotation("R90")).toBe(90);
    expect(orientationToRotation("R180")).toBe(180);
    expect(orientationToRotation("R270")).toBe(270);
    expect(orientationToRotation("M90")).toBe(270);
    expect(orientationToRotation("M270")).toBe(90);
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
  // R90 to world (320,208)/(240,208) - verified by hand against the wires below.
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

  it("preserves LTspice current-source polarity through to the deck (logamp I1)", () => {
    // current.asy: "+" = N+ at (0,0) top, "−" at (0,80) bottom, arrow toward
    // "−". LTspice netlists `I1 <top> <bottom>`; Tau's isource emission swaps
    // p/n, so the import must zip "−"→p / "+"→n or every imported source runs
    // backwards (logamp's I1 then starves its log loop and .op hangs).
    const ISRC = `Version 4
SHEET 1 880 680
WIRE 0 -64 0 0
FLAG 0 -144 0
FLAG 0 80 0
SYMBOL current 0 0 R0
SYMATTR InstName I1
SYMATTR Value 1m
SYMBOL res -16 -160 R0
SYMATTR InstName R1
SYMATTR Value 1k`;
    const doc = ascToSchematic(parseAsc(ISRC));
    const i1 = doc.components.find((c) => c.label === "I1");
    const pins = Object.fromEntries((i1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.p).toEqual({ x: 0, y: 80 });
    expect(pins.n).toEqual({ x: 0, y: 0 });
    const deck = buildSpiceDeck(
      { components: doc.components, wires: doc.wires, netLabels: doc.netLabels },
      { kind: "op" },
    );
    // Same node order LTspice's own netlist has: I1 <top net> <bottom=gnd>.
    expect(deck.netlist).toMatch(/^I1 n\d+ 0 DC 0\.001$/m);
  });

  it("imports a behavioral B-source carrying its V=/I= expression and pins", () => {
    // bi (behavioral current) at (160,-656) R0; current pins map to + at (0,0),
    // − at (0,80) → world (160,-656)/(160,-576), matching GFT.asc's wiring.
    const BSRC = `Version 4
SHEET 1 880 680
SYMBOL bi 160 -656 R0
SYMATTR InstName B1
SYMATTR Value I=I(V1)*2`;
    const doc = ascToSchematic(parseAsc(BSRC));
    const b1 = doc.components.find((c) => c.label === "B1");
    expect(b1).toBeDefined();
    expect(b1?.kind).toBe("bsource");
    expect(b1?.value).toBe("I=I(V1)*2");
    const pins = Object.fromEntries((b1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.p).toEqual({ x: 160, y: -656 });
    expect(pins.n).toEqual({ x: 160, y: -576 });
  });

  it("imports a tline carrying its Td/Z0 value and 4 LTspice-accurate pins", () => {
    // tline T2 at (176,320) R0; tline.asy pins (SpiceOrder I1,R1,I2,R2) at
    // (-48,-16)/(-48,16)/(48,-16)/(48,16) → world (128,304)/(128,336)/
    // (224,304)/(224,336).
    const TSRC = `Version 4
SHEET 1 880 680
SYMBOL tline 176 320 R0
SYMATTR InstName T2
SYMATTR Value Td=30n Z0=150`;
    const doc = ascToSchematic(parseAsc(TSRC));
    const t2 = doc.components.find((c) => c.label === "T2");
    expect(t2).toBeDefined();
    expect(t2?.kind).toBe("tline");
    expect(t2?.value).toBe("Td=30n Z0=150");
    const pins = Object.fromEntries((t2?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a1).toEqual({ x: 128, y: 304 });
    expect(pins.a2).toEqual({ x: 128, y: 336 });
    expect(pins.b1).toEqual({ x: 224, y: 304 });
    expect(pins.b2).toEqual({ x: 224, y: 336 });
  });

  it("banks the centered UniversalOpAmp2 input/output pins", () => {
    // UniversalOpAmp2 In+(-32,16)/In-(-32,-16)/OUT(32,0) at (100,100) R0 →
    // world (68,116)/(68,84)/(132,100). No warning (it has banked geometry).
    const O = `Version 4
SHEET 1 880 680
SYMBOL OpAmps\\UniversalOpAmp2 100 100 R0
SYMATTR InstName U1`;
    const doc = ascToSchematic(parseAsc(O));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("opamp");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins["in+"]).toEqual({ x: 68, y: 116 });
    expect(pins["in-"]).toEqual({ x: 68, y: 84 });
    expect(pins.out).toEqual({ x: 132, y: 100 });
    expect(doc.warnings.some((w) => w.includes("U1"))).toBe(false);
  });

  it("banks the offset vendor-opamp pins (LT1001/AD823/opamp2 share one layout)", () => {
    // Offset family In+(-32,80)/In-(-32,48)/OUT(32,64) at (100,100) R0 →
    // world (68,180)/(68,148)/(132,164).
    const O = `Version 4
SHEET 1 880 680
SYMBOL OpAmps\\LT1001 100 100 R0
SYMATTR InstName U1`;
    const doc = ascToSchematic(parseAsc(O));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("opamp");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins["in+"]).toEqual({ x: 68, y: 180 });
    expect(pins["in-"]).toEqual({ x: 68, y: 148 });
    expect(pins.out).toEqual({ x: 132, y: 164 });
    expect(doc.warnings.some((w) => w.includes("U1"))).toBe(false);
  });

  it("banks the sw control pair, so an imported switch can be driven", () => {
    // sw.asy A(0,16)/B(0,96)/NC+(-48,80)/NC-(-48,32) at (100,100) R0 → world
    // (100,116)/(100,196)/(52,180)/(52,132). Dropping NC+/NC- is what made
    // every imported switch simulate as a permanent open circuit.
    const O = `Version 4
SHEET 1 880 680
SYMBOL sw 100 100 R0
SYMATTR InstName S1
SYMATTR Value MYSW`;
    const doc = ascToSchematic(parseAsc(O));
    const s1 = doc.components.find((c) => c.label === "S1");
    expect(s1?.kind).toBe("switch");
    const pins = Object.fromEntries((s1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a).toEqual({ x: 100, y: 116 });
    expect(pins.b).toEqual({ x: 100, y: 196 });
    expect(pins.cp).toEqual({ x: 52, y: 180 });
    expect(pins.cn).toEqual({ x: 52, y: 132 });
  });

  it("keeps the 2-pin csw off sw's bank, so no phantom control pins appear", () => {
    // csw.asy is +(0,0)/-(0,80) with no control pins - its control is a named
    // source. Borrowing sw's 4-pin bank would place two pins on geometry the
    // symbol does not have, where a passing wire could silently attach.
    const O = `Version 4
SHEET 1 880 680
SYMBOL csw 100 100 R0
SYMATTR InstName S2
SYMATTR Value MYSW`;
    const doc = ascToSchematic(parseAsc(O));
    const s2 = doc.components.find((c) => c.label === "S2");
    expect(s2?.kind).toBe("switch");
    const pins = s2?.pinOverride ?? [];
    expect(pins.map((p) => p.id)).toEqual(["a", "b"]);
    expect(pins[0]).toMatchObject({ x: 100, y: 100 });
    expect(pins[1]).toMatchObject({ x: 100, y: 180 });
  });

  it("banks VCVS (e) and VCCS (g) control/output pins to LTspice geometry", () => {
    // e.asy: out +(0,16)/-(0,96), control P(-48,32)/N(-48,80). g.asy reverses
    // output polarity: +(0,96)/-(0,16). Both at (200,200) R0.
    const EG = `Version 4
SHEET 1 880 680
SYMBOL e 200 200 R0
SYMATTR InstName E1
SYMBOL g 200 200 R0
SYMATTR InstName G1`;
    const doc = ascToSchematic(parseAsc(EG));
    const e1 = doc.components.find((c) => c.label === "E1");
    const g1 = doc.components.find((c) => c.label === "G1");
    expect(e1?.kind).toBe("vcvs");
    expect(g1?.kind).toBe("vccs");
    const ep = Object.fromEntries((e1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(ep.cp).toEqual({ x: 152, y: 232 });
    expect(ep.cn).toEqual({ x: 152, y: 280 });
    expect(ep.op).toEqual({ x: 200, y: 216 });
    expect(ep.on).toEqual({ x: 200, y: 296 });
    const gp = Object.fromEntries((g1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(gp.op).toEqual({ x: 200, y: 296 });
    expect(gp.on).toEqual({ x: 200, y: 216 });
    expect(doc.warnings.length).toBe(0);
  });

  it("imports alias symbols with pin-accurate geometry from their .asy banks", () => {
    // varactor D1 (16,0)/(16,64); battery V1 (0,16)/(0,96); RN55upright R1
    // (0,-32)/(0,0); SMdiode D2 (0,-32)/(0,32). All R0 at (100,100).
    const ASRC = `Version 4
SHEET 1 880 680
SYMBOL varactor 100 100 R0
SYMATTR InstName D1
SYMBOL Misc\\battery 200 100 R0
SYMATTR InstName V1
SYMATTR Value 12
SYMBOL RN55upright 300 100 R0
SYMATTR InstName R1
SYMATTR Value 4.7k
SYMBOL SMdiode 400 100 R0
SYMATTR InstName D2`;
    const doc = ascToSchematic(parseAsc(ASRC));
    const byLabel = (l: string) => doc.components.find((c) => c.label === l);
    const pins = (l: string) =>
      Object.fromEntries((byLabel(l)?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(byLabel("D1")?.kind).toBe("diode");
    expect(pins("D1").a).toEqual({ x: 116, y: 100 });
    expect(pins("D1").k).toEqual({ x: 116, y: 164 });
    expect(byLabel("V1")?.kind).toBe("vsource");
    expect(byLabel("V1")?.value).toBe("12");
    expect(pins("V1").p).toEqual({ x: 200, y: 116 });
    expect(byLabel("R1")?.kind).toBe("resistor");
    expect(pins("R1").a).toEqual({ x: 300, y: 68 });
    expect(pins("R1").b).toEqual({ x: 300, y: 100 });
    expect(byLabel("D2")?.kind).toBe("diode");
    expect(pins("D2").a).toEqual({ x: 400, y: 68 });
    expect(pins("D2").k).toEqual({ x: 400, y: 132 });
    // None should warn about a missing Tau equivalent.
    expect(doc.warnings.filter((w) => /no Tau equivalent/i.test(w))).toHaveLength(0);
  });

  it("imports a JFET carrying its model and D/G/S pins", () => {
    // njf J1 at (100,100) R0; njf.asy pins D(48,0)/G(0,64)/S(48,96) →
    // world (148,100)/(100,164)/(148,196).
    const JSRC = `Version 4
SHEET 1 880 680
SYMBOL njf 100 100 R0
SYMATTR InstName J1
SYMATTR Value 2N3819`;
    const doc = ascToSchematic(parseAsc(JSRC));
    const j1 = doc.components.find((c) => c.label === "J1");
    expect(j1?.kind).toBe("njf");
    expect(j1?.value).toBe("2N3819");
    const pins = Object.fromEntries((j1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.d).toEqual({ x: 148, y: 100 });
    expect(pins.g).toEqual({ x: 100, y: 164 });
    expect(pins.s).toEqual({ x: 148, y: 196 });
  });

  it("imports a Misc/signal source carrying its SINE + AC stimulus", () => {
    // Draft1.asc: the 'signal' voltage-source variant with a SINE value + AC spec.
    const SIG = `Version 4
SHEET 1 880 680
SYMBOL Misc/signal 80 352 R0
SYMATTR InstName V1
SYMATTR Value SINE(0 1 1)
SYMATTR Value2 AC 1`;
    const doc = ascToSchematic(parseAsc(SIG));
    const v1 = doc.components.find((c) => c.label === "V1");
    expect(v1?.kind).toBe("vsource");
    expect(v1?.value).toBe("SINE(0 1 1) AC 1");
    // Pins from signal.asy +(0,16)/-(0,96) → world (80,368)/(80,448).
    const pins = Object.fromEntries((v1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.p).toEqual({ x: 80, y: 368 });
    expect(pins.n).toEqual({ x: 80, y: 448 });
  });

  it("imports a jumper as a wire net-tie (no component, no warning)", () => {
    // MISC\JUMPER J1 at (656,1296) R0; pins +(-32,64)/-(32,64) → world
    // (624,1360)/(688,1360). LTspice emits no SPICE device for a jumper.
    const JUMP = `Version 4
SHEET 1 880 680
SYMBOL MISC\\JUMPER 656 1296 R0
SYMATTR InstName J1`;
    const doc = ascToSchematic(parseAsc(JUMP));
    expect(doc.components.filter((c) => c.label === "J1")).toHaveLength(0);
    const tie = doc.wires.find(
      (w) =>
        w.points.some((p) => p.x === 624 && p.y === 1360) &&
        w.points.some((p) => p.x === 688 && p.y === 1360),
    );
    expect(tie).toBeDefined();
    expect(doc.warnings.filter((w) => /jumper/i.test(w))).toHaveLength(0);
  });

  it("a tline with no SYMATTR Value adopts LTspice's .asy default (Td=50n Z0=50)", () => {
    const T0 = `Version 4
SHEET 1 880 680
SYMBOL tline 176 208 R0
SYMATTR InstName T1`;
    const doc = ascToSchematic(parseAsc(T0));
    expect(doc.components.find((c) => c.label === "T1")?.value).toBe("Td=50n Z0=50");
  });

  it("flags M* orientations as mirrored so the symbol renders flipped", () => {
    const MSRC = `Version 4
SHEET 1 880 680
SYMBOL nmos 160 160 M0
SYMATTR InstName M1
SYMBOL res 336 192 R0
SYMATTR InstName R1`;
    const doc = ascToSchematic(parseAsc(MSRC));
    const m1 = doc.components.find((c) => c.label === "M1");
    const r1 = doc.components.find((c) => c.label === "R1");
    expect(m1?.mirrored).toBe(true);
    // Non-mirror (R*) orientations leave the flag unset.
    expect(r1?.mirrored).toBeUndefined();
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
    // (d): a real imported circuit's `.param`/`{expr}` round-trip - the
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
    // R1.a meets the vcc wire; R1.b meets the vout wire - net names follow labels.
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
    // The opamp maps to a native kind with banked pins (no warning); the
    // unknown vendor part is skipped entirely (one warning).
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("opamp");
    expect((u1?.pinOverride ?? []).length).toBeGreaterThan(0);
    expect(doc.components.some((c) => c.label === "X1")).toBe(false);
    expect(doc.warnings.some((w) => w.includes("X1"))).toBe(true);
    expect(doc.warnings.some((w) => w.includes("U1"))).toBe(false);
  });

  it("joins a source's Value2 (AC spec) onto its value (Draft1/Draft2 case)", () => {
    // LTspice writes the transient stimulus in Value and the AC stimulus in Value2.
    const SRC2 = `Version 4
SHEET 1 880 680
SYMBOL voltage 80 96 R0
SYMATTR InstName V1
SYMATTR Value SINE(0 1 1)
SYMATTR Value2 AC 1`;
    const doc = ascToSchematic(parseAsc(SRC2));
    const v1 = doc.components.find((c) => c.label === "V1");
    expect(v1?.kind).toBe("vsource");
    expect(v1?.value).toBe("SINE(0 1 1) AC 1");
  });

  it("keeps only Value for non-source kinds (Value2 not appended)", () => {
    const SRC3 = `Version 4
SHEET 1 880 680
SYMBOL res 80 96 R0
SYMATTR InstName R1
SYMATTR Value 100k
SYMATTR Value2 tol=1`;
    const doc = ascToSchematic(parseAsc(SRC3));
    const r1 = doc.components.find((c) => c.label === "R1");
    expect(r1?.value).toBe("100k");
  });
});

describe("componentValueFromAttrs", () => {
  it("appends Value2 and SpiceLine for sources", () => {
    expect(
      componentValueFromAttrs("vsource", { Value: "SINE(0 1 1)", Value2: "AC 1" }),
    ).toBe("SINE(0 1 1) AC 1");
    expect(
      componentValueFromAttrs("isource", { Value: "1", Value2: "AC 1", SpiceLine: "Rser=0.1" }),
    ).toBe("1 AC 1 Rser=0.1");
  });

  it("reassembles a SINE spec split across all four fields (P2.asc I1)", () => {
    // LTspice spreads one transient function over Value/Value2/SpiceLine/SpiceLine2.
    expect(
      componentValueFromAttrs("isource", {
        Value: "SINE(",
        Value2: "0 100u",
        SpiceLine: "5Meg",
        SpiceLine2: "0 0 0 1)",
      }),
    ).toBe("SINE( 0 100u 5Meg 0 0 0 1)");
  });

  it("returns Value alone for non-source kinds and tolerates missing attrs", () => {
    expect(componentValueFromAttrs("resistor", { Value: "100k", Value2: "tol=1" })).toBe("100k");
    expect(componentValueFromAttrs("vsource", {})).toBe("");
    expect(componentValueFromAttrs("vsource", { Value2: "AC 1" })).toBe("AC 1");
  });

  it("appends a C/L initial condition from SpiceLine2 (Draft10 cap)", () => {
    expect(componentValueFromAttrs("capacitor", { Value: "100p", SpiceLine2: "IC=1" })).toBe("100p IC=1");
    expect(componentValueFromAttrs("inductor", { Value: "1m", SpiceLine: "IC=0.5" })).toBe("1m IC=0.5");
    // IC token extracted from Value2 when SpiceLine has only parasitics.
    expect(componentValueFromAttrs("capacitor", { Value: "1u", Value2: "Rser=0.1 IC=2" })).toBe("1u IC=2");
  });

  it("appends xtal resonator params (Rser/Lser/Cpar) from SpiceLine for capacitors", () => {
    // Crystal xtal parts are imported as capacitors; their SpiceLine carries
    // standard ngspice capacitor instance params (Rser, Lser, Cpar).
    expect(componentValueFromAttrs("capacitor", { Value: "1u", SpiceLine: "Rser=0.1" })).toBe("1u Rser=0.1");
    expect(componentValueFromAttrs("capacitor", { Value: "1u", SpiceLine: "Rser=0.1 Cpar=10p" })).toBe("1u Rser=0.1 Cpar=10p");
    // Non-resonator SpiceLine for capacitor (IC only) is not changed.
    expect(componentValueFromAttrs("capacitor", { Value: "1u", SpiceLine: "IC=2" })).toBe("1u IC=2");
  });

  it("keeps only supported passive parasitics from vendor SpiceLine metadata", () => {
    expect(componentValueFromAttrs("capacitor", {
      Value: "330µ",
      SpiceLine: "Irms=1.5 Rser=0.1",
    })).toBe("330µ Rser=0.1");
    expect(componentValueFromAttrs("inductor", {
      Value: "200µ",
      SpiceLine: "Rser=10m Ipk=15",
    })).toBe("200µ Rser=10m");
  });

  it("carries op-amp behavioral params from Value2/SpiceLine (class-d Avol)", () => {
    // class-d_starter.asc U1: no Value, only `Value2 Avol=1Meg GBW=10Gig Slew=10Gig`
    // - must survive import so the deck builder can read Avol (rail clamp).
    expect(
      componentValueFromAttrs("opamp", { Value2: "Avol=1Meg GBW=10Gig Slew=10Gig" }),
    ).toBe("Avol=1Meg GBW=10Gig Slew=10Gig");
    expect(
      componentValueFromAttrs("opamp", { Value: "level.2", Value2: "Avol=2k", SpiceLine: "GBW=1Meg" }),
    ).toBe("level.2 Avol=2k GBW=1Meg");
    expect(componentValueFromAttrs("opamp", {})).toBe("");
  });

  it("normalizes LTspice's empty source sentinel `\"\"` to empty (GFT/S-param)", () => {
    // A source written `Value ""` is a 0 V source, often AC-only via Value2.
    expect(componentValueFromAttrs("vsource", { Value: '""' })).toBe("");
    expect(componentValueFromAttrs("vsource", { Value: '""', Value2: "AC 2" })).toBe("AC 2");
    expect(componentValueFromAttrs("isource", { Value: "''" })).toBe("");
  });
});

describe("parseAsy", () => {
  it("reads BLOCK pins in SpiceOrder with symbol-local positions", () => {
    const asy = `Version 4
SymbolType BLOCK
RECTANGLE Normal 80 96 -112 -96
PIN -112 0 LEFT 8
PINATTR PinName pwm
PINATTR SpiceOrder 1
PIN 80 -64 RIGHT 8
PINATTR PinName gp
PINATTR SpiceOrder 2
PIN -16 -96 TOP 8
PINATTR PinName vcc
PINATTR SpiceOrder 4
PIN 80 64 RIGHT 8
PINATTR PinName gn
PINATTR SpiceOrder 3`;
    const sym = parseAsy(asy);
    expect(sym.symbolType).toBe("BLOCK");
    // Returned sorted by SpiceOrder, regardless of file order.
    expect(sym.pins.map((p) => p.name)).toEqual(["pwm", "gp", "gn", "vcc"]);
    expect(sym.pins[0]).toMatchObject({ name: "pwm", x: -112, y: 0, order: 1 });
    expect(sym.pins[3]).toMatchObject({ name: "vcc", x: -16, y: -96, order: 4 });
  });

  it("reads CELL parameter defaults for hierarchical schematic instances", () => {
    const sym = parseAsy(`Version 4
SymbolType CELL
SYMATTR Value vh=5 vl=0
SYMATTR SpiceLine K=1
PIN 32 0 NONE 8
PINATTR PinName out
PINATTR SpiceOrder 1`);
    expect(sym.symbolType).toBe("CELL");
    expect(sym.attrs).toMatchObject({ Value: "vh=5 vl=0", SpiceLine: "K=1" });
  });
});

describe("ascToSchematic hierarchical subcircuits", () => {
  // A 2-port block "mydiv": a→[R1]→mid→[R2]→b. `mid` is an internal
  // geometry-only net (no port, no label) - used to prove instance isolation.
  const DIV_ASY = `Version 4
SymbolType BLOCK
PIN -32 0 LEFT 8
PINATTR PinName a
PINATTR SpiceOrder 1
PIN 32 0 RIGHT 8
PINATTR PinName b
PINATTR SpiceOrder 2`;
  // res pins (LTSPICE_PINS) are local (16,16)/(16,96). R1@(0,-16)→(16,0)/(16,80);
  // R2@(0,64)→(16,80)/(16,160). The shared (16,80) point is the internal `mid`.
  const DIV_ASC = `Version 4
SHEET 1 100 200
FLAG 16 0 a
FLAG 16 160 b
SYMBOL res 0 -16 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL res 0 64 R0
SYMATTR InstName R2
SYMATTR Value 2k
TEXT 0 50 Left 2 !.tran 1`;

  const resolver: SubcircuitResolver = makeSubcircuitResolver((type) =>
    type.toLowerCase() === "mydiv" ? { asy: DIV_ASY, asc: DIV_ASC } : null,
  );

  // Parent: X1@(200,200). asy pins → a@(168,200), b@(232,200). a wired to a
  // `vin` flag, b wired to ground.
  const PARENT = `Version 4
SHEET 1 880 680
WIRE 100 200 168 200
WIRE 232 200 300 200
FLAG 100 200 vin
FLAG 300 200 0
SYMBOL mydiv 200 200 R0
SYMATTR InstName X1
TEXT 0 400 Left 2 !.op`;

  it("inlines a block's body with instance-prefixed labels", () => {
    const r = importAsc(PARENT, { resolveSubcircuit: resolver });
    expect(r.warnings).toEqual([]);
    const labels = r.components.filter((c) => c.kind === "resistor").map((c) => c.label).sort();
    expect(labels).toEqual(["X1.R1", "X1.R2"]);
  });

  it("drops the body's own directives but keeps the parent's", () => {
    const r = importAsc(PARENT, { resolveSubcircuit: resolver });
    // Parent `.op` kept; the block body's `.tran 1` (for standalone testing) gone.
    expect(r.directives).toEqual([".op"]);
  });

  it("bridges each port to the parent net at the instance's pin position", () => {
    const r = importAsc(PARENT, { resolveSubcircuit: resolver });
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    expect(circuit.groundNetId).not.toBeNull();
    // a→vin, b→ground, plus the internal mid: exactly three nets. Had the ports
    // NOT bridged, a/vin and b/ground would stay split → more than three nets.
    expect(circuit.nets).toHaveLength(3);
    const ground = circuit.nets.find((n) => n.id === circuit.groundNetId)!;
    // The b-port resistor (X1.R2) reaches the parent's ground through the bridge.
    expect(ground.pins.some((p) => p.componentId.includes("X1~"))).toBe(true);
  });

  it("names a bridged port net after the parent's own label, not the synthetic", () => {
    const r = importAsc(PARENT, { resolveSubcircuit: resolver });
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    // The a-port joins the parent's `vin` FLAG; the net should resolve as `vin`
    // (the author's name) so V(vin) probes work - not the `X1:a` synthetic.
    const ids = circuit.nets.map((n) => n.id);
    expect(ids).toContain("vin");
    expect(ids.some((id) => /^x1/i.test(id))).toBe(false);
    // The R1.A pin (body a-port) must actually sit on that `vin` net.
    const vin = circuit.nets.find((n) => n.id === "vin")!;
    expect(vin.pins.some((p) => p.componentLabel === "X1.R1")).toBe(true);
  });

  it("bridges ports through the instance's orientation (rotated block)", () => {
    // X1 placed R90: asy pin a(-32,0)→(0,-32) world (200,168); b(32,0)→(0,32)
    // world (200,232). FLAGs sit on those exact port positions.
    const rotated = `Version 4
SHEET 1 880 680
FLAG 200 168 vin
FLAG 200 232 0
SYMBOL mydiv 200 200 R90
SYMATTR InstName X1`;
    const r = importAsc(rotated, { resolveSubcircuit: resolver });
    expect(r.components.filter((c) => c.kind === "resistor")).toHaveLength(2);
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    // a→vin (named), b→ground, mid internal: three nets, ports correctly bridged
    // despite the rotation.
    expect(circuit.nets.map((n) => n.id)).toContain("vin");
    const vin = circuit.nets.find((n) => n.id === "vin")!;
    expect(vin.pins.some((p) => p.componentId.includes("X1~"))).toBe(true);
    const ground = circuit.nets.find((n) => n.id === circuit.groundNetId)!;
    expect(ground.pins.some((p) => p.componentId.includes("X1~"))).toBe(true);
  });

  it("keeps two instances' internal nets private (no geometric short)", () => {
    const parent2 = `Version 4
SHEET 1 880 680
WIRE 100 200 168 200
WIRE 232 200 300 200
WIRE 100 400 168 400
WIRE 232 400 300 400
FLAG 100 200 vin1
FLAG 300 200 0
FLAG 100 400 vin2
FLAG 300 400 0
SYMBOL mydiv 200 200 R0
SYMATTR InstName X1
SYMBOL mydiv 200 400 R0
SYMATTR InstName X2`;
    const r = importAsc(parent2, { resolveSubcircuit: resolver });
    expect(r.warnings).toEqual([]);
    expect(r.components.filter((c) => c.kind === "resistor")).toHaveLength(4);
    const circuit = extractCircuit(r.components, r.wires, r.netLabels);
    // vin1, vin2, ground, and TWO distinct internal mids → 5 nets. If the two
    // instances' `mid` shorted together, we'd see only 4.
    expect(circuit.nets).toHaveLength(5);
  });

  it("guards against a block that references itself (no infinite recursion)", () => {
    const loopAsy = `Version 4
SymbolType BLOCK
PIN -32 0 LEFT 8
PINATTR PinName a
PINATTR SpiceOrder 1`;
    const loopAsc = `Version 4
SHEET 1 100 100
SYMBOL loop 0 0 R0
SYMATTR InstName X9`;
    const selfResolver = makeSubcircuitResolver((type) =>
      type.toLowerCase() === "loop" ? { asy: loopAsy, asc: loopAsc } : null,
    );
    const parent = `Version 4
SHEET 1 200 200
SYMBOL loop 100 100 R0
SYMATTR InstName X1`;
    // Must terminate; the recursion is cut and the innermost self-ref is skipped.
    const r = importAsc(parent, { resolveSubcircuit: selfResolver });
    expect(r.warnings.some((w) => w.includes("Skipped"))).toBe(true);
  });

  it("leaves an unmapped symbol skipped when no resolver is provided", () => {
    const r = importAsc(PARENT);
    expect(r.warnings.some((w) => w.includes('no Tau equivalent for LTspice symbol "mydiv"'))).toBe(true);
    expect(r.components.filter((c) => c.kind === "resistor")).toHaveLength(0);
  });

  it("flattens CELL schematics with .asy defaults and instance overrides", () => {
    const cellAsy = `Version 4
SymbolType CELL
SYMATTR SpiceLine K=1
PIN 32 0 NONE 8
PINATTR PinName out
PINATTR SpiceOrder 1`;
    const cellAsc = `Version 4
SHEET 1 100 100
FLAG 0 96 0
FLAG 0 16 out
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value {K}`;
    const cellResolver = makeSubcircuitResolver((type) =>
      type.toLowerCase() === "const" ? { asy: cellAsy, asc: cellAsc } : null,
    );
    const parent = `Version 4
SHEET 1 200 200
SYMBOL CONST 100 100 R0
SYMATTR InstName X1
SYMATTR SpiceLine K=7`;
    const result = importAsc(parent, { resolveSubcircuit: cellResolver });
    expect(result.warnings).toEqual([]);
    expect(result.components.find((component) => component.label === "X1.V1")?.value).toBe("7");
  });
});

describe("analog placeholder symbols (xtal, diac, triac, varistor)", () => {
  it("maps misc\\xtal to capacitor with pin-accurate geometry from xtal.asy", () => {
    // xtal.asy (Misc/): PIN A(16,0) SpiceOrder 1, PIN B(16,64) SpiceOrder 2.
    // Placed at (200,200) R90: A → R90(16,0) = (0,16) → world (200,216);
    // B → R90(16,64) = (-64,16) → world (136,216).
    const src = `Version 4
SHEET 1 880 680
SYMBOL misc\\xtal 200 200 R90
SYMATTR InstName Y1
SYMATTR Value 2p
SYMATTR SpiceLine Rser=45 Lser=1026u Cpar=10p`;
    const doc = ascToSchematic(parseAsc(src));
    const y1 = doc.components.find((c) => c.label === "Y1");
    expect(y1?.kind).toBe("capacitor");
    expect(y1?.value).toBe("2p Rser=45 Lser=1026u Cpar=10p");
    const pins = Object.fromEntries((y1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a).toEqual({ x: 200, y: 216 });
    expect(pins.b).toEqual({ x: 136, y: 216 });
    // No warning (xtal has banked pin geometry).
    expect(doc.warnings.filter((w) => /Y1|xtal/i.test(w))).toHaveLength(0);
  });

  it("imports misc\\xtal without SpiceLine as a plain capacitor value", () => {
    const src = `Version 4
SHEET 1 880 680
SYMBOL misc\\xtal 100 100 R0
SYMATTR InstName Y2
SYMATTR Value 0.1p`;
    const doc = ascToSchematic(parseAsc(src));
    const y2 = doc.components.find((c) => c.label === "Y2");
    expect(y2?.kind).toBe("capacitor");
    expect(y2?.value).toBe("0.1p");
    expect(doc.warnings.filter((w) => /Y2|xtal/i.test(w))).toHaveLength(0);
  });

  it("maps misc\\DIAC to resistor placeholder with pin-accurate geometry", () => {
    // DIAC.asy (Misc/): PIN +(32,0) SpiceOrder 1, PIN -(32,64) SpiceOrder 2.
    // Placed at (320,176) R90: +(32,0) → R90(32,0)=(0,32) → world (320,208);
    // -(32,64) → R90(32,64)=(-64,32) → world (256,208).
    const src = `Version 4
SHEET 1 880 680
SYMBOL misc\\DIAC 320 176 R90
SYMATTR InstName Q1
SYMATTR Value2 VK=30`;
    const doc = ascToSchematic(parseAsc(src));
    const q1 = doc.components.find((c) => c.label === "Q1");
    expect(q1?.kind).toBe("resistor");
    const pins = Object.fromEntries((q1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a).toEqual({ x: 320, y: 208 });
    expect(pins.b).toEqual({ x: 256, y: 208 });
    // Emits an import note, NOT a warning.
    expect(doc.warnings.filter((w) => /Q1|diac/i.test(w))).toHaveLength(0);
    expect(doc.notes.some((n) => /Q1|diac/i.test(n))).toBe(true);
    // The diac carries only `Value2 VK=30` (breakover V, no Ohm) → placeholder
    // gets a neutral high-Z resting resistance so the deck builds (regression:
    // an empty value used to crash deck-build with "needs a valid Ohm value").
    expect(q1?.value).toBe("1Meg");
  });

  it("maps misc\\TRIAC to npn placeholder with MT2/G/MT1 pin geometry", () => {
    // TRIAC.asy (Misc/): MT2(32,0)/G(-16,64)/MT1(32,64). Placed at (336,144) R0.
    // world: MT2(368,144), G(320,208), MT1(368,208).
    const src = `Version 4
SHEET 1 880 680
SYMBOL misc\\TRIAC 336 144 R0
SYMATTR InstName U1`;
    const doc = ascToSchematic(parseAsc(src));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("npn");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    // c ← MT2, b ← G, e ← MT1
    expect(pins.c).toEqual({ x: 368, y: 144 });
    expect(pins.b).toEqual({ x: 320, y: 208 });
    expect(pins.e).toEqual({ x: 368, y: 208 });
    expect(doc.warnings.filter((w) => /U1|triac/i.test(w))).toHaveLength(0);
    expect(doc.notes.some((n) => /U1|triac/i.test(n))).toBe(true);
  });

  it("maps SpecialFunctions\\varistor to resistor placeholder with primary terminal geometry", () => {
    // varistor.asy (SpecialFunctions/): invin(-32,48)/noninvin(-32,80). R0 at (1328,416).
    // world: invin(1296,464), noninvin(1296,496).
    const src = `Version 4
SHEET 1 1700 736
SYMBOL SPECIALFUNCTIONS\\VARISTOR 1328 416 R0
SYMATTR InstName A1
SYMATTR Value Rclamp=1`;
    const doc = ascToSchematic(parseAsc(src));
    const a1 = doc.components.find((c) => c.label === "A1");
    expect(a1?.kind).toBe("resistor");
    const pins = Object.fromEntries((a1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.a).toEqual({ x: 1296, y: 464 });
    expect(pins.b).toEqual({ x: 1296, y: 496 });
    expect(doc.warnings.filter((w) => /A1|varistor/i.test(w))).toHaveLength(0);
    expect(doc.notes.some((n) => /A1|varistor/i.test(n))).toBe(true);
    // The raw `Rclamp=1` value is an A-device param the resistor emitter can't
    // parse - the placeholder gets a neutral high-Z resting resistance instead
    // (regression: `Rclamp=1` used to reach the deck as a bad Ohm value and
    // crash deck-build). 1Meg ≈ open, matching a varistor below its clamp V.
    expect(a1?.value).toBe("1Meg");
  });

  it("ltspiceTypeToKind maps diac/triac/varistor to their placeholder kinds", () => {
    expect(ltspiceTypeToKind("misc\\DIAC")).toBe("resistor");
    expect(ltspiceTypeToKind("misc\\TRIAC")).toBe("npn");
    expect(ltspiceTypeToKind("SPECIALFUNCTIONS\\VARISTOR")).toBe("resistor");
  });
});

describe("digital A-device symbols (Digital\\*)", () => {
  it("ltspiceTypeToKind requires the Digital\\ path prefix", () => {
    expect(ltspiceTypeToKind("DIGITAL\\AND")).toBe("digitalGate");
    expect(ltspiceTypeToKind("Digital\\inv")).toBe("digitalGate");
    expect(ltspiceTypeToKind("digital\\schmtbuf")).toBe("digitalGate");
    expect(ltspiceTypeToKind("Digital\\dflop")).toBe("dflop");
    // Bare leafs are too generic to claim globally.
    expect(ltspiceTypeToKind("and")).toBeNull();
    expect(ltspiceTypeToKind("inv")).toBeNull();
    // Unmodelled Digital parts still fall through to the skip path.
    expect(ltspiceTypeToKind("Digital\\counter")).toBeNull();
    expect(ltspiceTypeToKind("Digital\\srflop")).toBeNull();
  });

  it("imports DIGITAL\\AND with the full 8-slot pin bank and the fn in the value", () => {
    // and.asy: a..e(-32,{32,48,64,80,96}), _Q(32,80), Q(32,48), com(-16,96).
    // R0 at (1904,208) - 160.asc's A1.
    const src = `Version 4
SHEET 1 880 680
SYMBOL DIGITAL\\AND 1904 208 R0
SYMATTR InstName A1`;
    const doc = ascToSchematic(parseAsc(src));
    const a1 = doc.components.find((c) => c.label === "A1");
    expect(a1?.kind).toBe("digitalGate");
    expect(a1?.value).toBe("and");
    const pins = Object.fromEntries((a1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.in1).toEqual({ x: 1872, y: 240 });
    expect(pins.in5).toEqual({ x: 1872, y: 304 });
    expect(pins.q).toEqual({ x: 1936, y: 256 });
    expect(pins.qbar).toEqual({ x: 1936, y: 288 });
    expect(pins.com).toEqual({ x: 1888, y: 304 });
    expect(doc.warnings.filter((w) => /A1/i.test(w))).toHaveLength(0);
  });

  it("imports DIGITAL\\INV with only its .asy pin subset (in1/qbar/com)", () => {
    // inv.asy: in(0,64), _Q(64,64), com(0,80). R0 at (1776,224) - 160.asc's A6.
    const src = `Version 4
SHEET 1 880 680
SYMBOL DIGITAL\\INV 1776 224 R0
SYMATTR InstName A6`;
    const doc = ascToSchematic(parseAsc(src));
    const a6 = doc.components.find((c) => c.label === "A6");
    expect(a6?.kind).toBe("digitalGate");
    expect(a6?.value).toBe("inv");
    const ids = (a6?.pinOverride ?? []).map((p) => p.id).sort();
    expect(ids).toEqual(["com", "in1", "qbar"]); // no q, no in2..in5
    const pins = Object.fromEntries((a6?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.in1).toEqual({ x: 1776, y: 288 });
    expect(pins.qbar).toEqual({ x: 1840, y: 288 });
    expect(pins.com).toEqual({ x: 1776, y: 304 });
    expect(doc.warnings.filter((w) => /A6/i.test(w))).toHaveLength(0);
  });

  it("imports a mirrored Digital\\dflop with params joined from Value/Value2", () => {
    // Electrometer.asc's A1: M0 at (752,320), `Value Vhigh=0 Vlow=-5`,
    // `Value2 Trise=10n`. dflop.asy: D(-80,48) CLK(-80,96) PRE(0,0) CLR(0,144)
    // _Q(96,96) Q(80,48) com(-80,144). M0 mirrors x: (dx,dy) → (-dx,dy).
    const src = `Version 4
SHEET 1 880 680
SYMBOL Digital\\dflop 752 320 M0
SYMATTR InstName A1
SYMATTR Value Vhigh=0 Vlow=-5
SYMATTR Value2 Trise=10n`;
    const doc = ascToSchematic(parseAsc(src));
    const a1 = doc.components.find((c) => c.label === "A1");
    expect(a1?.kind).toBe("dflop");
    expect(a1?.value).toBe("Vhigh=0 Vlow=-5 Trise=10n");
    expect(a1?.mirrored).toBe(true);
    const pins = Object.fromEntries((a1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.d).toEqual({ x: 832, y: 368 });
    expect(pins.clk).toEqual({ x: 832, y: 416 });
    expect(pins.pre).toEqual({ x: 752, y: 320 });
    expect(pins.clr).toEqual({ x: 752, y: 464 });
    expect(pins.q).toEqual({ x: 672, y: 368 });
    expect(pins.qbar).toEqual({ x: 656, y: 416 });
    expect(pins.com).toEqual({ x: 832, y: 464 });
    expect(doc.warnings.filter((w) => /A1/i.test(w))).toHaveLength(0);
  });

  it("imports SpecialFunctions\\sample as a sampleHold with the id-mapped pin bank", () => {
    // sample.asy: in+(-80,-32) in-(-80,0) CLK(-80,32) S/H(-80,64) out(96,16)
    // com(-80,96). R0 at (208,96) - Educational/SampleAndHold.asc's A1. The
    // corpus file writes the path with DOUBLED backslashes; the importer's
    // separator normalization must accept that form.
    const src = `Version 4
SHEET 1 1224 680
SYMBOL SpecialFunctions\\\\sample 208 96 R0
SYMATTR InstName A1`;
    const doc = ascToSchematic(parseAsc(src));
    const a1 = doc.components.find((c) => c.label === "A1");
    expect(a1?.kind).toBe("sampleHold");
    expect(a1?.value).toBe("");
    const pins = Object.fromEntries((a1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins["in+"]).toEqual({ x: 128, y: 64 });
    expect(pins["in-"]).toEqual({ x: 128, y: 96 });
    expect(pins.clk).toEqual({ x: 128, y: 128 });
    expect(pins.sh).toEqual({ x: 128, y: 160 });
    expect(pins.out).toEqual({ x: 304, y: 112 });
    expect(pins.com).toEqual({ x: 128, y: 192 });
    expect(doc.warnings.filter((w) => /A1/i.test(w))).toHaveLength(0);
  });

  it("ltspiceTypeToKind requires the SpecialFunctions\\ path prefix for sample/modulate", () => {
    expect(ltspiceTypeToKind("SpecialFunctions\\sample")).toBe("sampleHold");
    expect(ltspiceTypeToKind("SPECIALFUNCTIONS\\SAMPLE")).toBe("sampleHold");
    expect(ltspiceTypeToKind("SpecialFunctions\\modulate")).toBe("modulator");
    expect(ltspiceTypeToKind("SPECIALFUNCTIONS\\MODULATE")).toBe("modulator");
    // Bare leafs are too generic; other SpecialFunctions (incl. modulate2's
    // SIN/COS variant) stay on the skip path.
    expect(ltspiceTypeToKind("sample")).toBeNull();
    expect(ltspiceTypeToKind("modulate")).toBeNull();
    expect(ltspiceTypeToKind("SpecialFunctions\\modulate2")).toBeNull();
  });

  it("imports SpecialFunctions\\MODULATE as a modulator with the id-mapped pin bank", () => {
    // modulate.asy: FM(0,0) AM(0,64) Q(144,32) com(0,96). R0 at (192,880) is
    // PLL.asc's A1 (uppercase path, doubled backslashes - as the corpus file
    // writes it); M0 at (1056,1056) is its A3 (mirror flips dx). SpiceLine
    // extras must join onto the A-device value.
    const src = `Version 4
SHEET 1 1904 1156
SYMBOL SPECIALFUNCTIONS\\\\MODULATE 192 880 R0
SYMATTR InstName A1
SYMATTR Value mark=1.1K space=.9K
SYMATTR SpiceLine Vhigh=2
SYMBOL SPECIALFUNCTIONS\\\\MODULATE 1056 1056 M0
SYMATTR InstName A3
SYMATTR Value mark=2K space=0`;
    const doc = ascToSchematic(parseAsc(src));
    const a1 = doc.components.find((c) => c.label === "A1");
    expect(a1?.kind).toBe("modulator");
    expect(a1?.value).toBe("mark=1.1K space=.9K Vhigh=2");
    const p1 = Object.fromEntries((a1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(p1.fm).toEqual({ x: 192, y: 880 });
    expect(p1.am).toEqual({ x: 192, y: 944 });
    expect(p1.out).toEqual({ x: 336, y: 912 });
    expect(p1.com).toEqual({ x: 192, y: 976 });
    const a3 = doc.components.find((c) => c.label === "A3");
    expect(a3?.kind).toBe("modulator");
    const p3 = Object.fromEntries((a3?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(p3.fm).toEqual({ x: 1056, y: 1056 });
    expect(p3.am).toEqual({ x: 1056, y: 1120 });
    expect(p3.out).toEqual({ x: 912, y: 1088 });
    expect(p3.com).toEqual({ x: 1056, y: 1152 });
    expect(doc.warnings.filter((w) => /A1|A3/i.test(w))).toHaveLength(0);
  });

  it("imports bi2 as a bsource with its flipped pin geometry", () => {
    // bi2.asy (B current source, alt geometry): +(0,80) / -(0,0) - bi's flip.
    const src = `Version 4
SHEET 1 880 680
SYMBOL bi2 100 100 R0
SYMATTR InstName B1
SYMATTR Value I=V(a)*2`;
    const doc = ascToSchematic(parseAsc(src));
    const b1 = doc.components.find((c) => c.label === "B1");
    expect(b1?.kind).toBe("bsource");
    const pins = Object.fromEntries((b1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.p).toEqual({ x: 100, y: 180 });
    expect(pins.n).toEqual({ x: 100, y: 100 });
    expect(doc.warnings.filter((w) => /B1/i.test(w))).toHaveLength(0);
  });
});

describe("library-subcircuit symbols (Prefix X: TowTom2/capmeter/ISO16750-2/ISO7637-2)", () => {
  it("ltspiceTypeToKind maps the four bundled library symbols to subckt", () => {
    expect(ltspiceTypeToKind("MISC\\TOWTOM2")).toBe("subckt");
    expect(ltspiceTypeToKind("capmeter")).toBe("subckt");
    expect(ltspiceTypeToKind("ISO16750-2")).toBe("subckt");
    expect(ltspiceTypeToKind("ISO7637-2")).toBe("subckt");
    // Other library X-symbols are still unmapped (no bundled body).
    expect(ltspiceTypeToKind("POWERPRODUCTS\\LT1184F")).toBeNull();
  });

  it("imports MISC\\TOWTOM2 with SpiceOrder pins p1..p3 and the .asy default name", () => {
    // TowTom2.asy: V1(-32,64) V2(-32,-32) INV(-32,160), Value TowTom2.
    // 1563.asc places it R0 at (2192,1024) with no Value attr.
    const src = `Version 4
SHEET 1 880 680
SYMBOL MISC\\TOWTOM2 2192 1024 R0
SYMATTR InstName U1`;
    const doc = ascToSchematic(parseAsc(src));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("subckt");
    expect(u1?.value).toBe("TowTom2");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y, label: p.label }]));
    expect(pins.p1).toEqual({ x: 2160, y: 1088, label: "V1" });
    expect(pins.p2).toEqual({ x: 2160, y: 992, label: "V2" });
    expect(pins.p3).toEqual({ x: 2160, y: 1184, label: "INV" });
    expect(doc.warnings).toHaveLength(0);
  });

  it("imports capmeter with 5 pins and joins the instance SpiceLine onto the name", () => {
    // Fc.asc's U1: R0 at (2976,-640), SpiceLine current=1m freq=3Meg C=.25µ.
    // capmeter.asy: DUT+(-80,32) DUT-(-80,96) bias(-80,-32) Resistance(288,0)
    // Capacitance(288,64); subckt name is `capometer` (the .asy Value).
    const src = `Version 4
SHEET 1 880 680
SYMBOL capmeter 2976 -640 R0
SYMATTR InstName U1
SYMATTR SpiceLine current=1m freq=3Meg C=.25µ`;
    const doc = ascToSchematic(parseAsc(src));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("subckt");
    expect(u1?.value).toBe("capometer current=1m freq=3Meg C=.25µ");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins.p1).toEqual({ x: 2896, y: -608 }); // DUT+
    expect(pins.p2).toEqual({ x: 2896, y: -544 }); // DUT-
    expect(pins.p3).toEqual({ x: 2896, y: -672 }); // bias
    expect(pins.p4).toEqual({ x: 3264, y: -640 }); // Resistance
    expect(pins.p5).toEqual({ x: 3264, y: -576 }); // Capacitance
    expect(doc.warnings).toHaveLength(0);
  });

  it("ISO symbols default to the .asy SpiceModel and honor an instance override", () => {
    // ISO7637-2_example.asc: U1 has no attrs (→ .asy default Pulse1_12V);
    // U2 selects Pulse1_24V via SYMATTR SpiceModel. Pins +(0,0)/−(0,80).
    const src = `Version 4
SHEET 1 880 680
SYMBOL ISO7637-2 80 -64 R0
SYMATTR InstName U1
SYMBOL ISO7637-2 368 -64 R0
SYMATTR InstName U2
SYMATTR SpiceModel Pulse1_24V`;
    const doc = ascToSchematic(parseAsc(src));
    const u1 = doc.components.find((c) => c.label === "U1");
    const u2 = doc.components.find((c) => c.label === "U2");
    expect(u1?.value).toBe("Pulse1_12V");
    expect(u2?.value).toBe("Pulse1_24V");
    const pins1 = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pins1.p1).toEqual({ x: 80, y: -64 });
    expect(pins1.p2).toEqual({ x: 80, y: 16 });
    expect(doc.warnings).toHaveLength(0);
  });

  it("ISO16750-2 keeps the raw dashed profile name in the value (deck sanitizes)", () => {
    const src = `Version 4
SHEET 1 880 680
SYMBOL ISO16750-2 544 -64 R0
SYMATTR InstName U2
SYMATTR SpiceModel 4-6-3_24V_StartingProfile`;
    const doc = ascToSchematic(parseAsc(src));
    const u2 = doc.components.find((c) => c.label === "U2");
    expect(u2?.kind).toBe("subckt");
    expect(u2?.value).toBe("4-6-3_24V_StartingProfile");
    expect(doc.warnings).toHaveLength(0);
  });

  it("Opamps\\opamp is a subckt (not the behavioral opamp kind) with SpiceOrder pins invin FIRST", () => {
    // opamp.asy: Prefix X onto `.subckt opamp` - SpiceOrder 1=invin(-32,48),
    // 2=noninvin(-32,80), 3=out(32,64). This is the OPPOSITE input order to
    // Tau's opampO role bank; a swap here silently flips feedback polarity.
    // opamp.asc places U1 R0 at (1488,16) with only an InstName.
    expect(ltspiceTypeToKind("OPAMPS\\OPAMP")).toBe("subckt");
    // Vendor parts under Opamps\ still map to the behavioral opamp kind.
    expect(ltspiceTypeToKind("OPAMPS\\LT1001")).toBe("opamp");
    const src = `Version 4
SHEET 1 880 680
SYMBOL OPAMPS\\OPAMP 1488 16 R0
SYMATTR InstName U1`;
    const doc = ascToSchematic(parseAsc(src));
    const u1 = doc.components.find((c) => c.label === "U1");
    expect(u1?.kind).toBe("subckt");
    // Defaults ride the .asy SpiceLine/SpiceLine2 (Aol=100K / GBW=10Meg).
    expect(u1?.value).toBe("opamp Aol=100K GBW=10Meg");
    const pins = Object.fromEntries((u1?.pinOverride ?? []).map((p) => [p.id, { x: p.x, y: p.y, label: p.label }]));
    expect(pins.p1).toEqual({ x: 1456, y: 64, label: "invin" });
    expect(pins.p2).toEqual({ x: 1456, y: 96, label: "noninvin" });
    expect(pins.p3).toEqual({ x: 1520, y: 80, label: "out" });
    expect(doc.warnings).toHaveLength(0);
  });
});
