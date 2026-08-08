import { describe, expect, it } from "vitest";
import { LED_DARK_AMPS, LED_FULL_AMPS, ledBrightness, ledGlowField } from "./ledGlow";

const led = (id: string) => ({ id, kind: "led" });

describe("LED brightness", () => {
  it("is dark below the visible floor and at rest", () => {
    expect(ledBrightness(0)).toBe(0);
    expect(ledBrightness(LED_DARK_AMPS)).toBe(0);
    expect(ledBrightness(LED_DARK_AMPS * 0.9)).toBe(0);
  });

  it("is dark when the part is reverse-biased", () => {
    // A real LED emits nothing backwards, and the solver reports that current
    // as negative. Glowing here would be the clearest possible wrong answer.
    expect(ledBrightness(-1e-3)).toBe(0);
    expect(ledBrightness(-1)).toBe(0);
  });

  it("reaches full brightness at the rated current and clamps beyond it", () => {
    expect(ledBrightness(LED_FULL_AMPS)).toBe(1);
    // 200 mA is not ten times brighter, it is a part being destroyed.
    expect(ledBrightness(0.2)).toBe(1);
  });

  it("rises logarithmically, so a few milliamps already reads as lit", () => {
    const at1mA = ledBrightness(1e-3);
    const at10mA = ledBrightness(10e-3);
    expect(at1mA).toBeGreaterThan(0.4);
    expect(at1mA).toBeLessThan(0.6);
    expect(at10mA).toBeGreaterThan(at1mA);
    // A linear ramp would put 1 mA at 0.05, i.e. invisible. This is the whole
    // reason the scale is logarithmic; pin it so nobody "simplifies" it.
    expect(at1mA).toBeGreaterThan(1e-3 / LED_FULL_AMPS * 4);
  });

  it("is monotonic across the working range", () => {
    let previous = -1;
    for (let decade = -5; decade <= -1; decade += 0.25) {
      const value = ledBrightness(10 ** decade);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("stays dark for a value that is not a real measurement", () => {
    // Neither NaN nor an infinity is something a solver produced, so neither is
    // evidence the part is lit. Dark is the honest answer for both.
    expect(ledBrightness(Number.NaN)).toBe(0);
    expect(ledBrightness(Number.POSITIVE_INFINITY)).toBe(0);
    expect(ledBrightness(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("LED glow field", () => {
  it("draws nothing at all without a result", () => {
    expect(ledGlowField([led("d1")], null).size).toBe(0);
  });

  it("only lights LEDs, never other parts carrying current", () => {
    const currents = new Map([["d1", 10e-3], ["r1", 10e-3], ["q1", 5e-3]]);
    const glow = ledGlowField(
      [led("d1"), { id: "r1", kind: "resistor" }, { id: "q1", kind: "npn" }],
      currents,
    );
    expect([...glow.keys()]).toEqual(["d1"]);
  });

  it("distinguishes solved-and-dark from not-solved", () => {
    // An LED the run did solve, carrying nothing, is present at zero; one the
    // run never reported is absent. Collapsing those would lose the difference
    // between "off" and "unknown".
    const glow = ledGlowField([led("d1"), led("d2")], new Map([["d1", 0]]));
    expect(glow.get("d1")).toBe(0);
    expect(glow.has("d2")).toBe(false);
  });

  it("skips a current the solver could not produce", () => {
    expect(ledGlowField([led("d1")], new Map([["d1", Number.NaN]])).has("d1")).toBe(false);
  });
});
