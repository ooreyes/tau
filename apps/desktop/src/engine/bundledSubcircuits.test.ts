/**
 * Bundled LTspice library subcircuits (the `.asy` Prefix X import path) —
 * module API plus buildSpiceDeck integration. The sanitization rules under
 * test were each live-verified against ngspice-46 first: a dash in a subckt
 * name fails the X-line lookup, B-source `Rpar=` and `if()` are rejected, and
 * the Windows-1252 micro sign never parses.
 */

import { describe, expect, it } from "vitest";
import {
  bundledLibraryText,
  bundledSubcircuitBlock,
  bundledSubcircuitNames,
  sanitizeSubcktName,
} from "./bundledSubcircuits";
import { buildSpiceDeck } from "./spiceNetlist";
import type { NetLabel, PinOverride, SchematicComponent, SchematicWire } from "../schematic/types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;

const lbl = (x: number, y: number, text: string): NetLabel => ({ id: uid("flag"), x, y, text });
const W = (...points: { x: number; y: number }[]): SchematicWire => ({ id: uid("w"), points });

/** A subckt instance with explicit world pins (id, label, x, y). */
const sub = (
  value: string,
  label: string,
  pins: Array<[string, string, number, number]>,
): SchematicComponent => ({
  id: uid("subckt"),
  kind: "subckt",
  x: 0,
  y: 0,
  rotation: 0,
  value,
  label,
  pinOverride: pins.map(([id, pinLabel, x, y]): PinOverride => ({ id, label: pinLabel, x, y })),
});

const R = (x: number, y: number, v: string, l: string): SchematicComponent =>
  ({ id: uid("resistor"), kind: "resistor", x, y, rotation: 0, value: v, label: l });

describe("sanitizeSubcktName", () => {
  it("replaces dashes (fatal to ngspice's X-line lookup) with underscores", () => {
    expect(sanitizeSubcktName("4-6-3_12V_StartingProfile")).toBe("4_6_3_12V_StartingProfile");
    expect(sanitizeSubcktName("ISO7637-2")).toBe("ISO7637_2");
  });

  it("leaves already-safe names untouched", () => {
    expect(sanitizeSubcktName("TowTom2")).toBe("TowTom2");
    expect(sanitizeSubcktName("Pulse1_24V")).toBe("Pulse1_24V");
  });

  it("maps every non-word character, not just dashes", () => {
    expect(sanitizeSubcktName("a+b c")).toBe("a_b_c");
  });
});

describe("bundled block registry", () => {
  it("ships all 31 blocks: opamp + TowTom2 + capometer + 10 ISO7637 pulses + 18 ISO16750 profiles", () => {
    const names = bundledSubcircuitNames();
    expect(names.size).toBe(31);
    expect(names.has("opamp")).toBe(true);
    expect(names.has("towtom2")).toBe(true);
    expect(names.has("capometer")).toBe(true);
    expect(names.has("pulse1_12v")).toBe(true);
    expect(names.has("4_6_3_24v_startingprofile")).toBe(true);
  });

  it("opamp block declares the .asy's Aol/GBW defaults on the .subckt line (X-line params need them declared)", () => {
    const block = bundledSubcircuitBlock("opamp")!;
    // LTspice ships the defaults on Opamps\opamp.asy's SpiceLine attrs, not in
    // opamp.sub itself; ngspice rejects an X-line param the .subckt line does
    // not declare, so the bundle moves them onto the header.
    expect(block).toContain(".subckt opamp 1 2 3 Aol=100K GBW=10Meg");
    // Port semantics: G senses V(2)−V(1) → port 1 is the INVERTING input.
    expect(block).toContain("G1 0 3 2 1 {Aol}");
    expect(block).toContain("C3 3 0 {Aol/GBW/6.28318530717959}");
    expect(bundledLibraryText("opamp.sub")).toContain(".subckt opamp 1 2 3");
  });

  it("resolves a raw LTspice name (dashes intact) case-insensitively", () => {
    const block = bundledSubcircuitBlock("4-6-3_12V_StartingProfile");
    expect(block).not.toBeNull();
    expect(block).toMatch(/^\.subckt 4_6_3_12V_StartingProfile \+ -/);
    expect(block).toMatch(/\.ends 4_6_3_12V_StartingProfile$/);
    expect(bundledSubcircuitBlock("TOWTOM2")).toContain(".subckt TowTom2 1 2 3");
  });

  it("tolerates a value that carries instance params after the name", () => {
    const block = bundledSubcircuitBlock("capometer current=1m freq=3Meg C=.25u");
    expect(block).toContain(".subckt capometer 1 2 3 4 5");
  });

  it("returns null for names we do not ship, and for empty input", () => {
    expect(bundledSubcircuitBlock("LM741")).toBeNull();
    expect(bundledSubcircuitBlock("")).toBeNull();
    expect(bundledSubcircuitBlock("   ")).toBeNull();
  });

  it("capometer text carries none of the ngspice-rejected LTspice forms", () => {
    const block = bundledSubcircuitBlock("capometer")!;
    expect(block).not.toMatch(/\bif\s*\(/i); // if() → ternary
    expect(block).not.toMatch(/\bRpar\s*=/i); // Rpar= → explicit resistor
    expect(block).not.toContain("µ"); // µ → u
    expect(block).toContain("RparB1 2 1 1G");
    expect(block).toContain("? 0 : max(0.,.5*V(im)*{current}");
  });

  it("no bundled block anywhere contains a dashed .subckt/.ends name or a µ", () => {
    for (const name of bundledSubcircuitNames()) {
      const block = bundledSubcircuitBlock(name)!;
      expect(block, name).not.toContain("µ");
      const header = /^\.subckt\s+(\S+)/.exec(block)!;
      expect(header[1], name).not.toContain("-");
    }
  });
});

describe("bundledLibraryText", () => {
  it("matches the file basename case-insensitively, tolerating a path", () => {
    expect(bundledLibraryText("TowTom2.sub")).toContain(".subckt TowTom2");
    expect(bundledLibraryText("towtom2.SUB")).toContain(".subckt TowTom2");
    expect(bundledLibraryText("lib\\sub\\ISO7637-2.lib")).toContain(".subckt Pulse1_12V");
    expect(bundledLibraryText("/opt/lt/lib/sub/iso16750-2.lib")).toContain("StartingProfile");
  });

  it("returns null for files we do not bundle", () => {
    expect(bundledLibraryText("standard.dio")).toBeNull();
    expect(bundledLibraryText("")).toBeNull();
  });
});

describe("deck integration — subckt instances", () => {
  it("emits the X line (SpiceOrder nodes, sanitized name) plus the bundled block once", () => {
    // U1: p1 shared with R1.a via a wire, p2 grounded by a flag.
    const comps = [
      sub("4-6-3_24V_StartingProfile", "U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      R(96, 0, "100", "R1"), // pins a(64,0) b(128,0)
    ];
    const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];
    const netLabels = [lbl(0, 80, "0"), lbl(128, 0, "0")];
    const deck = buildSpiceDeck({ components: comps, wires, netLabels }, { kind: "op" });
    expect(deck.netlist).toMatch(/^XU1 n\d+ 0 4_6_3_24V_StartingProfile$/m);
    const blocks = deck.netlist.match(/^\.subckt 4_6_3_24V_StartingProfile /gm) ?? [];
    expect(blocks.length).toBe(1);
    // The raw dashed name must not survive anywhere in the deck.
    expect(deck.netlist).not.toContain("4-6-3");
  });

  it("emits one block per DISTINCT referenced subckt, deduplicating repeats", () => {
    const comps = [
      sub("Pulse1_12V", "U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
      sub("Pulse1_12V", "U2", [["p1", "+", 160, 0], ["p2", "-", 160, 80]]),
      sub("Pulse1_24V", "U3", [["p1", "+", 320, 0], ["p2", "-", 320, 80]]),
      R(96, 0, "100", "R1"),
    ];
    const wires = [W({ x: 0, y: 0 }, { x: 64, y: 0 })];
    const netLabels = [lbl(0, 80, "0"), lbl(160, 80, "0"), lbl(320, 80, "0"), lbl(128, 0, "0")];
    const deck = buildSpiceDeck({ components: comps, wires, netLabels }, { kind: "op" });
    expect(deck.netlist.match(/^\.subckt Pulse1_12V /gm)?.length).toBe(1);
    expect(deck.netlist.match(/^\.subckt Pulse1_24V /gm)?.length).toBe(1);
    expect(deck.netlist).toMatch(/^XU1 /m);
    expect(deck.netlist).toMatch(/^XU2 /m);
    expect(deck.netlist).toMatch(/^XU3 /m);
  });

  it("normalizes µ to u in the instance-param tail (Fc.asc's capmeter)", () => {
    const comps = [
      sub("capometer current=1m freq=3Meg C=.25µ", "U1", [
        ["p1", "DUT+", 0, 0],
        ["p2", "DUT-", 0, 80],
        ["p3", "bias", -80, -32],
        ["p4", "Resistance", 288, 0],
        ["p5", "Capacitance", 288, 64],
      ]),
    ];
    const netLabels = [lbl(0, 80, "0")];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels }, { kind: "op" });
    expect(deck.netlist).toMatch(/^XU1 n\d+ 0 n\d+ n\d+ n\d+ capometer current=1m freq=3Meg C=\.25u$/m);
    expect(deck.netlist).toContain(".subckt capometer 1 2 3 4 5");
  });

  it("orders X-line nodes numerically (p10 after p9, not alphabetically)", () => {
    const pins: Array<[string, string, number, number]> = [];
    const netLabels: NetLabel[] = [lbl(16, 0, "0")]; // p1 grounded (reference)
    for (let i = 1; i <= 11; i += 1) {
      pins.push([`p${i}`, `${i}`, i * 16, 0]);
      if (i > 1) netLabels.push(lbl(i * 16, 0, `net${String.fromCharCode(96 + i)}`));
    }
    const comps = [sub("mysub", "U1", pins)];
    const deck = buildSpiceDeck({ components: comps, wires: [], netLabels }, { kind: "op" });
    const xline = deck.netlist.split("\n").find((l) => l.startsWith("XU1 "))!;
    expect(xline).toBe("XU1 0 netb netc netd nete netf netg neth neti netj netk mysub");
  });

  it("replaces a `.include` of a bundled library with its text and does not double-emit", () => {
    const comps = [
      sub("TowTom2", "U1", [["p1", "V1", 0, 0], ["p2", "V2", 0, 32], ["p3", "INV", 0, 64]]),
    ];
    const netLabels = [lbl(0, 0, "0"), lbl(0, 32, "a"), lbl(0, 64, "b")];
    const deck = buildSpiceDeck(
      { components: comps, wires: [], netLabels, directives: [".include TowTom2.sub"] },
      { kind: "op" },
    );
    expect(deck.netlist).not.toMatch(/^\.include/m);
    expect(deck.netlist.match(/^\.subckt TowTom2 /gm)?.length).toBe(1);
    expect(deck.netlist).toMatch(/^XU1 0 a b TowTom2$/m);
  });

  it("leaves a non-bundled .include untouched (ngspice may still resolve it)", () => {
    const comps = [
      sub("mystery", "U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")];
    const deck = buildSpiceDeck(
      { components: comps, wires: [], netLabels, directives: [".include mymodels.lib"] },
      { kind: "op" },
    );
    expect(deck.netlist).toContain(".include mymodels.lib");
    // Unknown subckt: X line emitted, no bundled block invented.
    expect(deck.netlist).toMatch(/^XU1 n\d+ 0 mystery$/m);
    expect(deck.netlist).not.toMatch(/^\.subckt/m);
  });

  it("does not emit a bundled block when the document defines the subckt itself", () => {
    const comps = [
      sub("Pulse1_12V", "U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]]),
    ];
    const netLabels = [lbl(0, 80, "0")];
    const deck = buildSpiceDeck(
      {
        components: comps,
        wires: [],
        netLabels,
        directives: [".subckt Pulse1_12V + -\nR1 + - 42\n.ends Pulse1_12V"],
      },
      { kind: "op" },
    );
    // The user's 42 Ω body wins; the bundled EXP/PULSE body must not appear.
    expect(deck.netlist.match(/^\.subckt Pulse1_12V /gim)?.length).toBe(1);
    expect(deck.netlist).toContain("R1 + - 42");
    expect(deck.netlist).not.toContain("EXP(0 {Us/Ri}");
  });

  it("throws a clear error when the value has no subcircuit name", () => {
    const comps = [sub("", "U1", [["p1", "+", 0, 0], ["p2", "-", 0, 80]])];
    const netLabels = [lbl(0, 80, "0")];
    expect(() => buildSpiceDeck({ components: comps, wires: [], netLabels }, { kind: "op" }))
      .toThrow(/needs a subcircuit name/);
  });
});
