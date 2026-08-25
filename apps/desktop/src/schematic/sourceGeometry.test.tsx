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
import {
  SOURCE_CURRENT_ARROW_SEGMENTS,
  SOURCE_CURRENT_PULSE_SEGMENTS,
  SOURCE_VOLTAGE_PULSE_SEGMENTS,
  sourceGroupClearance,
  sourcePolaritySegments,
  sourceSegmentCircleClearance,
  sourceSegmentsPath,
} from "./sourceArtworkGeometry";
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

  it.each([
    {
      label: "DC voltage source",
      kind: "vsource" as const,
      value: "5",
      expectedPath: "M -4 -7 L 4 -7 M 0 -11 L 0 -3",
    },
    {
      label: "sine voltage source",
      kind: "vsource" as const,
      value: "SINE(0 1 1k)",
      expectedPath: "M 4 -7 L 12 -7 M 8 -11 L 8 -3",
    },
    {
      label: "pulse voltage source",
      kind: "vpulse" as const,
      value: undefined,
      expectedPath: "M 4 -7 L 12 -7 M 8 -11 L 8 -3",
    },
  ])("renders a true + mark for $label", ({ kind, value, expectedPath }) => {
    const markup = renderToStaticMarkup(<svg><ComponentSymbol kind={kind} value={value} /></svg>);
    const positivePath = markup.match(/<path[^>]*data-polarity-mark="positive"[^>]*d="([^"]+)"/)?.[1];
    expect(positivePath).toBe(expectedPath);
    expect(positivePath).not.toContain("L 12 -7 L 8 -3");
  });

  it("keeps pulse voltage artwork clear of polarity marks at both stroke weights", () => {
    const marks = sourcePolaritySegments(8);
    const centerlineClearance = sourceGroupClearance(SOURCE_VOLTAGE_PULSE_SEGMENTS, [
      ...marks.positive,
      ...marks.negative,
    ]);
    expect(centerlineClearance).toBeCloseTo(Math.sqrt(29), 6);
    expect(centerlineClearance).toBeGreaterThanOrEqual(5);
    expect(centerlineClearance - 1.55).toBeGreaterThan(0);
    expect(centerlineClearance - 2.35).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(<svg><ComponentSymbol kind="vpulse" /></svg>);
    expect(markup).toContain(sourceSegmentsPath(SOURCE_VOLTAGE_PULSE_SEGMENTS));
  });

  it("keeps current pulse artwork inside its circle and clear of the arrow", () => {
    const centerlineClearance = sourceGroupClearance(SOURCE_CURRENT_PULSE_SEGMENTS, SOURCE_CURRENT_ARROW_SEGMENTS);
    expect(centerlineClearance).toBe(4);
    expect(centerlineClearance).toBeGreaterThanOrEqual(4);
    expect(centerlineClearance - 1.55).toBeGreaterThan(0);
    expect(centerlineClearance - 2.35).toBeGreaterThan(0);
    const normalGap = Math.min(
      ...SOURCE_CURRENT_PULSE_SEGMENTS.map((segment) =>
        sourceSegmentCircleClearance(segment, SOURCE_CIRCLE_R, 1.55),
      ),
    );
    const selectedGap = Math.min(
      ...SOURCE_CURRENT_PULSE_SEGMENTS.map((segment) =>
        sourceSegmentCircleClearance(segment, SOURCE_CIRCLE_R, 2.35),
      ),
    );
    expect(normalGap).toBeCloseTo(2.048, 3);
    expect(selectedGap).toBeCloseTo(1.248, 3);
    expect(selectedGap).toBeGreaterThan(0);
  });

  it("keeps every voltage-pulse segment clear of its circle at both stroke weights", () => {
    const normalGap = Math.min(
      ...SOURCE_VOLTAGE_PULSE_SEGMENTS.map((segment) =>
        sourceSegmentCircleClearance(segment, SOURCE_CIRCLE_R, 1.55),
      ),
    );
    const selectedGap = Math.min(
      ...SOURCE_VOLTAGE_PULSE_SEGMENTS.map((segment) =>
        sourceSegmentCircleClearance(segment, SOURCE_CIRCLE_R, 2.35),
      ),
    );
    expect(normalGap).toBeCloseTo(2.27, 2);
    expect(selectedGap).toBeCloseTo(1.47, 2);
    expect(selectedGap).toBeGreaterThan(0);
  });

  it("keeps contiguous pulse and current-arrow paths intact in rendered artwork", () => {
    const voltageMarkup = renderToStaticMarkup(<svg><ComponentSymbol kind="vpulse" /></svg>);
    expect(voltageMarkup).toContain(`d="${sourceSegmentsPath(SOURCE_VOLTAGE_PULSE_SEGMENTS)}"`);

    const currentMarkup = renderToStaticMarkup(
      <svg><ComponentSymbol kind="isource" value="PULSE(0 1m 0 1n 1n 5u 10u)" /></svg>,
    );
    expect(currentMarkup).toContain(`d="${sourceSegmentsPath(SOURCE_CURRENT_PULSE_SEGMENTS)}"`);
    expect(currentMarkup).toContain(`d="${sourceSegmentsPath(SOURCE_CURRENT_ARROW_SEGMENTS.slice(0, 1))}"`);
    expect(currentMarkup).toContain(`d="${sourceSegmentsPath(SOURCE_CURRENT_ARROW_SEGMENTS.slice(1))}"`);
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
