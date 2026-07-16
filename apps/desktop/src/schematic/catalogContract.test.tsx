import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG } from "./catalog";
import { getLocalPins } from "./pins";
import { CENTERED_SINE_PATH, ComponentSymbol, SYMBOL_BODY, SYMBOL_BOX } from "./symbols";
import { COMPONENT_KINDS } from "./types";

describe("Library catalog contract", () => {
  it("lists every ComponentKind exactly once", () => {
    expect(new Set(CATALOG.map((entry) => entry.kind))).toEqual(new Set(COMPONENT_KINDS));
    expect(CATALOG).toHaveLength(COMPONENT_KINDS.length);
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
