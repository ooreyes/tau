import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG, PALETTE_SECTIONS, catalogSectionEntries, type CatalogSection } from "./catalog";
import { getLocalPins } from "./pins";
import { CENTERED_SINE_PATH, ComponentSymbol, SYMBOL_BODY, SYMBOL_BOX } from "./symbols";
import { COMPONENT_KINDS } from "./types";

describe("Library catalog contract", () => {
  it("lists every ComponentKind exactly once", () => {
    expect(new Set(CATALOG.map((entry) => entry.kind))).toEqual(new Set(COMPONENT_KINDS));
    expect(CATALOG).toHaveLength(COMPONENT_KINDS.length);
  });

  it("uses EveryCircuit-like palette section order (Sources first, Digital after Analog)", () => {
    expect([...PALETTE_SECTIONS]).toEqual([
      "Sources",
      "Passives",
      "Semiconductors",
      "Analog",
      "Digital",
      "Electromechanical",
      "Markers",
    ]);
    // Every catalog entry uses a known section label.
    for (const entry of CATALOG) {
      expect(PALETTE_SECTIONS.includes(entry.section), entry.kind).toBe(true);
    }
    // Contiguous by section: no Digital/Analog interleave that used to hoist
    // Digital above Semiconductors when sections were derived from Set(CATALOG).
    const seen = new Set<CatalogSection>();
    let prev: CatalogSection | null = null;
    for (const entry of CATALOG) {
      if (entry.section !== prev) {
        expect(seen.has(entry.section), `${entry.kind} reopens ${entry.section}`).toBe(false);
        seen.add(entry.section);
        prev = entry.section;
      }
    }
    expect([...seen]).toEqual([...PALETTE_SECTIONS]);
  });

  it("groups recent EveryCircuit parts under the expected sections", () => {
    const expectSection = (kind: string, section: CatalogSection) => {
      const entry = CATALOG.find((e) => e.kind === kind);
      expect(entry?.section, kind).toBe(section);
    };
    expectSection("polarizedCapacitor", "Passives");
    expectSection("bulb", "Passives");
    expectSection("photodiode", "Semiconductors");
    expectSection("logicConstant", "Digital");
    expectSection("srflop", "Digital");
    expectSection("tflop", "Digital");
    expectSection("jkflop", "Digital");
    expectSection("pushButton", "Electromechanical");
    expectSection("spdt", "Electromechanical");
    expectSection("relay", "Electromechanical");
    expectSection("motor", "Electromechanical");
    expectSection("ctTransformer", "Electromechanical");

    // Electromechanical browse order: switches → actuator → magnetics.
    const electro = catalogSectionEntries("Electromechanical").map((e) => e.kind);
    expect(electro).toEqual([
      "switch",
      "pushButton",
      "spdt",
      "relay",
      "motor",
      "transformer",
      "ctTransformer",
      "tline",
    ]);

    // Digital: constant → gate → latches/flops.
    expect(catalogSectionEntries("Digital").map((e) => e.kind)).toEqual([
      "logicConstant",
      "digitalGate",
      "srflop",
      "dflop",
      "tflop",
      "jkflop",
      "sampleHold",
    ]);
  });

  it("gives every component visible symbol geometry, pins, and finite bounds", () => {
    for (const entry of CATALOG) {
      const markup = renderToStaticMarkup(<svg><ComponentSymbol kind={entry.kind} /></svg>);
      expect(markup, `${entry.kind} drawing`).toMatch(/<(?:path|line|circle|rect|polygon)/);
      expect(getLocalPins(entry.kind).length, `${entry.kind} pins`).toBeGreaterThan(0);
      for (const value of Object.values(SYMBOL_BODY[entry.kind])) {
        expect(Number.isFinite(value), `${entry.kind} body`).toBe(true);
      }
      expect(SYMBOL_BOX[entry.kind].halfW, `${entry.kind} width`).toBeGreaterThan(0);
      expect(SYMBOL_BOX[entry.kind].halfH, `${entry.kind} height`).toBeGreaterThan(0);
    }
  });

  it("uses one horizontally centered sine glyph for every sine-bearing symbol", () => {
    for (const kind of ["vac", "iac", "modulator"] as const) {
      const markup = renderToStaticMarkup(<svg><ComponentSymbol kind={kind} /></svg>);
      expect(markup, `${kind} sine`).toContain(`d="${CENTERED_SINE_PATH}"`);
      expect(markup.match(/data-sine-glyph=/g), `${kind} sine count`).toHaveLength(1);
    }
    const currentSource = renderToStaticMarkup(<svg><ComponentSymbol kind="iac" /></svg>);
    expect(currentSource).toContain('transform="translate(0 -5)"');
  });
});
