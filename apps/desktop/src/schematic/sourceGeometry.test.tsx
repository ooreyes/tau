import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getLocalPins } from "./pins";
import {
  ComponentSymbol,
  SOURCE_CIRCLE_R,
  SOURCE_PIN_Y,
  SYMBOL_BODY,
  valueLooksLikeSine,
} from "./symbols";

const SOURCE_KINDS = ["vsource", "vac", "isource", "iac", "vpulse"] as const;

describe("independent source geometry parity", () => {
  it("shares the same pin bank and body box for DC and AC voltage sources", () => {
    const dcPins = getLocalPins("vsource");
    const acPins = getLocalPins("vac");
    expect(dcPins).toEqual(acPins);
    expect(dcPins.map((p) => p.y)).toEqual([-SOURCE_PIN_Y, SOURCE_PIN_Y]);
    expect(SYMBOL_BODY.vsource).toEqual(SYMBOL_BODY.vac);
  });

  it("draws the same circle radius and pin leads for every independent source kind", () => {
    for (const kind of SOURCE_KINDS) {
      const markup = renderToStaticMarkup(<svg><ComponentSymbol kind={kind} /></svg>);
      expect(markup, kind).toContain(`r="${SOURCE_CIRCLE_R}"`);
      expect(markup, `${kind} top lead`).toContain(`y1="-${SOURCE_PIN_Y}"`);
      expect(markup, `${kind} bottom lead`).toContain(`y2="${SOURCE_PIN_Y}"`);
    }
  });

  it("draws a sine glyph for vac and for a vsource whose value is SINE(...)", () => {
    expect(valueLooksLikeSine("SINE(0 1 1k)")).toBe(true);
    expect(valueLooksLikeSine("5")).toBe(false);
    const vac = renderToStaticMarkup(<svg><ComponentSymbol kind="vac" /></svg>);
    const sineDc = renderToStaticMarkup(
      <svg><ComponentSymbol kind="vsource" value="SINE(0 1 1k)" /></svg>,
    );
    const plainDc = renderToStaticMarkup(<svg><ComponentSymbol kind="vsource" value="12" /></svg>);
    expect(vac).toContain("data-sine-glyph");
    expect(sineDc).toContain("data-sine-glyph");
    expect(plainDc).not.toContain("data-sine-glyph");
  });
});
