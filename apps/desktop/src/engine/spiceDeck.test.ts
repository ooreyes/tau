/**
 * Structural validation of the generated ngspice decks.
 *
 * These tests cross-check that buildSpiceDeck emits decks the real engine
 * accepts: ground numbered 0, sequential N00x nodes, exactly one analysis card,
 * a trailing .end, models only when needed, and no un-evaluated arithmetic in
 * value fields. (The real-ngspice acceptance of these decks is exercised by the
 * Rust FFI test in src-tauri/src/spice.rs.)
 */

import { describe, expect, it } from "vitest";
import { buildSpiceDeck, type SpiceAnalysis } from "./spiceNetlist";
import type { SchematicComponent, SchematicWire } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;
const mk = (
  kind: SchematicComponent["kind"],
  x: number,
  y: number,
  value: string,
  label: string,
  rotation: SchematicComponent["rotation"] = 0,
): SchematicComponent => ({ id: uid(kind), kind, x, y, rotation, value, label });

const R = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("resistor", x, y, v, l, rot);
const Cap = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("capacitor", x, y, v, l, rot);
const Lind = (x: number, y: number, v: string, l: string, rot: SchematicComponent["rotation"] = 0) =>
  mk("inductor", x, y, v, l, rot);
const Vdc = (x: number, y: number, v: string, l = "V1") => mk("vsource", x, y, v, l);
const Vac = (x: number, y: number, v: string, l = "V1") => mk("vac", x, y, v, l);
const GND = (x: number, y: number) => mk("ground", x, y, "", "");
const W = (...points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

/** Structural invariants every emitted deck must satisfy. */
function expectValidDeck(netlist: string, analysisCard: RegExp) {
  const lines = netlist.split("\n");
  // First line is a title (ngspice treats line 1 as a comment).
  expect(lines[0].length).toBeGreaterThan(0);
  // Exactly one .end and it is the last line.
  const endLines = lines.filter((l) => l.trim().toLowerCase() === ".end");
  expect(endLines.length).toBe(1);
  expect(lines[lines.length - 1].trim().toLowerCase()).toBe(".end");
  // Exactly one analysis card.
  const analysisLines = lines.filter((l) => analysisCard.test(l));
  expect(analysisLines.length).toBe(1);
  // No instance line references a bare-arithmetic value field like "10000/2".
  for (const line of lines) {
    if (/^[RLCVIDQMEK]/i.test(line)) {
      expect(line, `value-field arithmetic leaked: ${line}`).not.toMatch(/\s\d+(\.\d+)?\/\d+(\s|$)/);
    }
  }
  // Ground is always node 0 and never renamed to an N-node.
  expect(netlist).toMatch(/(^|\s)0(\s|$)/m);
}

// ---------------------------------------------------------------------------

describe("deck structure — RC transient", () => {
  const comps = [
    Vdc(0, 32, "5"),
    R(96, 0, "1k", "R1"),
    Cap(224, 0, "1u", "C1"),
    GND(0, 64),
    GND(256, 0),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 }), W({ x: 128, y: 0 }, { x: 192, y: 0 })];

  it("emits sequential nodes, ground = 0, one .tran card, trailing .end", () => {
    const deck = buildSpiceDeck({ components: comps, wires }, { kind: "tran", stopTime: 5e-3, steps: 500 });
    expectValidDeck(deck.netlist, /^\.tran\s/);
    expect(deck.netlist).toContain("V1 n001 0 DC 5");
    expect(deck.netlist).toContain("R1 n001 n002 1000");
    expect(deck.netlist).toContain("C1 n002 0 0.000001");
    expect(deck.netlist).toContain(".tran 0.00001 0.005");
  });
});

describe("deck structure — operating point", () => {
  it("emits a single .op card", () => {
    const deck = buildSpiceDeck(
      { components: [Vdc(0, 32, "5"), R(96, 0, "1k", "R1"), GND(0, 64), GND(128, 0)], wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })] },
      { kind: "op" },
    );
    expectValidDeck(deck.netlist, /^\.op$/);
  });
});

describe("deck structure — coupled inductors (K)", () => {
  it("emits a transformer's K coupling directive into the deck (Transformer.asc)", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          Vdc(0, 32, "5"),
          Lind(96, 0, "1m", "L1"),
          Lind(224, 0, "1m", "L2"),
          GND(0, 64),
          GND(256, 0),
        ],
        wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })],
        directives: ["K1 L1 L2 1"],
      },
      { kind: "op" },
    );
    // The coupling line passes through verbatim so ngspice couples the windings.
    expect(deck.netlist).toMatch(/^K1 L1 L2 1$/m);
    expectValidDeck(deck.netlist, /^\.op$/);
  });
});

describe("deck structure — behavioral B-source", () => {
  // B-source output pin p sits at (0,-32), n at (0,32) for a vertical source.
  const Bsrc = (x: number, y: number, v: string, l = "B1") =>
    mk("bsource", x, y, v, l);

  it("emits a B-voltage source with its expression verbatim", () => {
    const deck = buildSpiceDeck(
      {
        components: [
          Vdc(0, 0, "5", "V1"), // V1 at origin; p at (0,-32), n at (0,32)
          Bsrc(0, 128, "V=2*V(n001)", "B1"), // p at (0,96), n at (0,160)
          R(0, -64, "1k", "R1", 90),
          GND(0, 32),
          GND(0, 160),
        ],
        wires: [
          W({ x: 0, y: -32 }, { x: 0, y: -32 }),
          W({ x: 0, y: 96 }, { x: 0, y: -32 }),
        ],
      },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/^B1 \S+ \S+ V=2\*V\(n001\)$/m);
    expectValidDeck(deck.netlist, /^\.op$/);
  });

  it("normalizes a bare expression to V= and preserves I= current sources", () => {
    const vDeck = buildSpiceDeck(
      { components: [Bsrc(0, 0, "V(n001)*3", "B1"), R(0, -64, "1k", "R1", 90), GND(0, 32)], wires: [] },
      { kind: "op" },
    );
    expect(vDeck.netlist).toMatch(/^B1 \S+ \S+ V=V\(n001\)\*3$/m);

    const iDeck = buildSpiceDeck(
      { components: [Bsrc(0, 0, "I=1m*V(n001)", "B1"), R(0, -64, "1k", "R1", 90), GND(0, 32)], wires: [] },
      { kind: "op" },
    );
    expect(iDeck.netlist).toMatch(/^B1 \S+ \S+ I=1m\*V\(n001\)$/m);
  });
});

describe("deck structure — AC sweep", () => {
  it("emits a DC/AC/SIN source and a single .ac card", () => {
    const deck = buildSpiceDeck(
      { components: [Vac(0, 32, "0 2 1k"), GND(0, 64)], wires: [] },
      { kind: "ac", startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
    );
    expectValidDeck(deck.netlist, /^\.ac\s/);
    expect(deck.netlist).toContain("V1 n001 0 DC 0 AC 2 SIN(0 2 1000)");
    expect(deck.netlist).toContain(".ac dec 20 10 1000000");
  });
});

describe("deck structure — nonlinear models only when used", () => {
  it("omits device models for a purely-passive deck", () => {
    const deck = buildSpiceDeck(
      { components: [Vdc(0, 32, "5"), R(96, 0, "1k", "R1"), GND(0, 64), GND(128, 0)], wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })] },
      { kind: "op" },
    );
    expect(deck.netlist).not.toContain(".model");
  });

  it("includes the matching model for each semiconductor", () => {
    const deck = buildSpiceDeck(
      { components: [mk("npn", 0, 0, "NPN", "Q1"), GND(16, 32)], wires: [] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".model TAU_NPN NPN");
    expect(deck.netlist).toMatch(/Q1 n\d+ n\d+ 0 TAU_NPN/);
  });
});

describe("deck structure — potentiometer half-track resistance is a literal number", () => {
  // Regression: the wiper split must be a precomputed number (e.g. 5000), not
  // an arithmetic expression like "10000/2" that bare-field ngspice rejects.
  const comps = [
    Vdc(0, 32, "5"),
    mk("potentiometer", 96, 0, "10k", "RV1"), // a=(64,0) b=(160,0) w=(96,-32)
    GND(0, 64),
    GND(160, 0),
    GND(96, -32),
  ];
  const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];

  it("splits a 10k pot into two 5000 Ω halves", () => {
    const deck = buildSpiceDeck({ components: comps, wires }, { kind: "op" });
    expect(deck.netlist).toMatch(/R_RV1_a \S+ \S+ 5000/);
    expect(deck.netlist).toMatch(/R_RV1_b \S+ \S+ 5000/);
    expect(deck.netlist).not.toContain("/2");
    expectValidDeck(deck.netlist, /^\.op$/);
  });
});

describe("deck structure — node numbering is contiguous from N001", () => {
  // A 3-node chain should produce exactly n001..n003 with no gaps, plus 0.
  const comps = [
    Vdc(0, 32, "12"),
    R(96, 0, "1k", "R1"),
    R(224, 0, "1k", "R2"),
    R(352, 0, "2k", "R3"),
    GND(0, 64),
    GND(384, 0),
  ];
  const wires = [
    W({ x: 0, y: 0 }, { x: 64, y: 0 }),
    W({ x: 128, y: 0 }, { x: 192, y: 0 }),
    W({ x: 256, y: 0 }, { x: 320, y: 0 }),
  ];

  it("uses n001, n002, n003 and ground 0", () => {
    const deck = buildSpiceDeck({ components: comps, wires }, { kind: "op" });
    const nodes = new Set(
      (deck.netlist.match(/n\d{3}/g) ?? []).map((s) => s.toLowerCase()),
    );
    expect(nodes).toEqual(new Set(["n001", "n002", "n003"]));
    expect(deck.netlist).toContain("R3 n003 0 2000");
  });
});

describe("deck structure — isource / iac polarity (n before p)", () => {
  // SPICE convention: I N+ N- value pulls current from N+ (making it negative for
  // positive I).  To match Tau's schematic convention (current exits p, raising V(p)),
  // the deck must emit "I name n p value", i.e., swap the terminal order.
  const Isrc = (x: number, y: number, v: string, l = "I1") =>
    ({ id: `is-${l}`, kind: "isource" as const, x, y, rotation: 0 as const, value: v, label: l });
  const Iac = (x: number, y: number, v: string, l = "I1") =>
    ({ id: `iac-${l}`, kind: "iac" as const, x, y, rotation: 0 as const, value: v, label: l });

  it("isource deck lists n then p (so ngspice agrees V(p) > 0)", () => {
    // isource at (0,32): p=(0,0) = n001, n=(0,64) = ground.
    const deck = buildSpiceDeck(
      { components: [Isrc(0, 32, "1m"), GND(0, 64)], wires: [] },
      { kind: "op" },
    );
    // Must have "0 n001" (n then p) NOT "n001 0" (p then n).
    expect(deck.netlist).toMatch(/^I\S+ 0 n001 DC/m);
  });

  it("iac deck lists n then p for correct polarity", () => {
    // iac at (0,32): p=(0,0) = n001, n=(0,64) = ground.
    const deck = buildSpiceDeck(
      { components: [Iac(0, 32, "1 1k"), GND(0, 64)], wires: [] },
      { kind: "ac", startHz: 10, stopHz: 1e4, pointsPerDecade: 10 },
    );
    expect(deck.netlist).toMatch(/^I\S+ 0 n001 DC/m);
  });
});

describe("deck builder — failure modes", () => {
  it("throws when no ground is present", () => {
    expect(() =>
      buildSpiceDeck({ components: [Vdc(0, 32, "5"), R(96, 0, "1k", "R1")], wires: [] }, { kind: "op" }),
    ).toThrow(/ground/i);
  });

  it("throws for an empty schematic", () => {
    expect(() => buildSpiceDeck({ components: [], wires: [] }, { kind: "op" })).toThrow();
  });

  it("rejects an invalid transient card", () => {
    expect(() =>
      buildSpiceDeck(
        { components: [Vdc(0, 32, "5"), GND(0, 64)], wires: [] },
        { kind: "tran", stopTime: 0, steps: 500 } as SpiceAnalysis,
      ),
    ).toThrow();
  });

  it("rejects an inverted AC sweep range", () => {
    expect(() =>
      buildSpiceDeck(
        { components: [Vac(0, 32, "1 1k"), GND(0, 64)], wires: [] },
        { kind: "ac", startHz: 1e6, stopHz: 10, pointsPerDecade: 10 },
      ),
    ).toThrow();
  });

  it("rejects a zero-ohm resistor (would produce a singular matrix in ngspice)", () => {
    expect(() =>
      buildSpiceDeck(
        { components: [Vdc(0, 32, "5"), R(96, 0, "0", "R1"), GND(0, 64), GND(128, 0)], wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })] },
        { kind: "op" },
      ),
    ).toThrow(/non-zero/i);
  });

  it("rejects a negative capacitance", () => {
    expect(() =>
      buildSpiceDeck(
        { components: [Vdc(0, 32, "5"), Cap(96, 0, "-1u", "C1"), GND(0, 64), GND(128, 0)], wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })] },
        { kind: "op" },
      ),
    ).toThrow(/positive/i);
  });

  it("rejects a non-finite component value (NaN string)", () => {
    // A garbage value string should throw a clear error, not emit NaN into the deck.
    expect(() =>
      buildSpiceDeck(
        { components: [Vdc(0, 32, "5"), R(96, 0, "oops", "R1"), GND(0, 64), GND(128, 0)], wires: [W({ x: 0, y: 0 }, { x: 64, y: 0 })] },
        { kind: "op" },
      ),
    ).toThrow();
  });
});
