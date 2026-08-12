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
import type { ComponentKind } from "./types";

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

/**
 * P3-01 clause 3: "the symbol and the canvas caption follow the value — keep
 * that true, and pin it." Only `vsource` + sine did. A `vsource` holding
 * `PULSE(...)` drew the DC plus/minus, and an `isource` holding `SINE(...)`
 * drew the DC arrow — the same complaint as the report's, mirrored.
 *
 * Only glyphs that already exist and are already clearance-tested are reused:
 * the `vpulse` pulse train and the `iac` current-sine. PWL / EXP / SFFM have no
 * glyph, and inventing three is a design pass with its own clearance proofs,
 * so they keep the DC drawing and are flagged in docs/handoff/SYMBOLS.md rather
 * than guessed at.
 */
describe("P3-01 a source's artwork follows the waveform in its value", () => {
  const artwork = (kind: ComponentKind, value?: string): string =>
    renderToStaticMarkup(
      <svg>
        <ComponentSymbol kind={kind} value={value} />
      </svg>,
    );

  /** Both pulse trains carry this marker: the voltage one centred, the current
   *  one raised clear of the direction arrow. */
  const PULSE_TRAIN = 'data-pulse-glyph=""';

  it("draws a pulse-valued voltage source as the pulse train, not the DC plus/minus", () => {
    expect(artwork("vsource", "PULSE(0 5 0 1n 1n 5u 10u)")).toContain(PULSE_TRAIN);
    expect(artwork("vsource", "PULSE(0 5 0 1n 1n 5u 10u)")).toBe(artwork("vpulse", "0 5 100k 0.5"));
  });

  it("draws a sine-valued current source as the current sine, not the DC arrow", () => {
    expect(artwork("isource", "SINE(0 1m 1k)")).toContain('data-current-sine=""');
    expect(artwork("isource", "SINE(0 1m 1k)")).toBe(artwork("iac", "1m 1k"));
  });

  it("draws a pulse-valued current source as a pulsed current, keeping the direction arrow", () => {
    const markup = artwork("isource", "PULSE(0 1m 0 1n 1n 5u 10u)");
    expect(markup).toContain(PULSE_TRAIN);
    expect(markup).toContain('data-current-arrow="head"');
  });

  it("follows the waveform through an explicit DC bias and an AC stimulus, as the title and caption already do", () => {
    /*
     * `DC 2 SINE(0 1 1k)` is what an LTspice import routinely arrives holding,
     * and both derived surfaces already call it a sine:
     * `componentDisplayName("vsource", "DC 2 SINE(0 1 1k)")` answers "Sine
     * voltage source" and `sourceValueLabel` answers `Sine · 1 V @ 1k Hz`.
     * The artwork tested `^SINE` against the RAW value, so it drew the DC
     * plus/minus underneath both of them — item 1's drawing-versus-identity
     * disagreement moved onto a different pair of surfaces rather than
     * removed. `AC 1 SINE(...)` is the same case with the other prefix.
     */
    for (const value of ["DC 2 SINE(0 1 1k)", "AC 1 SINE(0 1 1k)", "DC 2 AC 1 SINE(0 1 1k)"]) {
      expect(artwork("vsource", value), value).toContain('data-sine-glyph=""');
    }
    expect(artwork("vsource", "DC 2 PULSE(0 5 0 1n 1n 5u 10u)")).toContain(PULSE_TRAIN);
    expect(artwork("isource", "DC 1m SINE(0 1m 1k)")).toContain('data-current-sine=""');
    // The suffix spelling never broke; pin it so the prefix fix cannot regress it.
    expect(artwork("vsource", "SINE(0 1 1k) AC 1")).toContain('data-sine-glyph=""');
  });

  it("keeps the DC drawing for a plain value and for the waveforms that have no glyph yet", () => {
    const dc = artwork("vsource", "5");
    for (const value of ["PWL(0 0 1m 1)", "EXP(0 1 0 1u 1m 1u)", "SFFM(0 1 1k 1 100)"]) {
      expect(artwork("vsource", value), value).toBe(dc);
    }
    expect(artwork("isource", "PWL(0 0 1m 1m)")).toBe(artwork("isource", "1m"));
  });
});
