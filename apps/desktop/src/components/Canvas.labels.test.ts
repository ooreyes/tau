import { describe, expect, it } from "vitest";
import { sourceValueLabel } from "./Canvas";

/**
 * §UX fix: the canvas value label used to blindly suffix a catalog "unit"
 * onto the whole value string. For kinds that store several fields in one
 * string (comparator, vpulse — and previously tline), that produced garbled
 * text like "1 0Vhi Vlo" instead of a real per-field format. Each multi-field
 * kind now gets its own formatter built from the same `decodeParams` the
 * inspector uses.
 */
describe("sourceValueLabel", () => {
  it("suffixes a plain single-value kind's unit as before (resistor)", () => {
    expect(sourceValueLabel("resistor", "1k")).toBe("1kΩ");
  });

  it("does not double-suffix a value that already carries its unit", () => {
    expect(sourceValueLabel("resistor", "1kΩ")).toBe("1kΩ");
  });

  it("formats AC sources as 'amplitude @ frequency' (pre-existing bespoke case)", () => {
    expect(sourceValueLabel("vac", "1 1k")).toBe("1V @ 1kHz");
    expect(sourceValueLabel("iac", "5m 2k")).toBe("5mA @ 2kHz");
  });

  it("formats the comparator as high/low volts, not a garbled unit suffix", () => {
    expect(sourceValueLabel("comparator", "1 0")).toBe("1V/0V");
    expect(sourceValueLabel("comparator", "")).toBe("1V/0V"); // default spec
  });

  it("appends hysteresis to the comparator label only when non-zero", () => {
    expect(sourceValueLabel("comparator", "5 0 0.1")).toBe("5V/0V ±0.1V");
    expect(sourceValueLabel("comparator", "Vhigh=3.3 Vlow=0 Vhyst=0")).toBe("3.3V/0V");
  });

  it("formats a pulse source as 'low→high @ frequency', not one unit smeared across four tokens", () => {
    expect(sourceValueLabel("vpulse", "0 5 100k 0.5")).toBe("0V→5V @ 100kHz");
  });

  it("shows the transmission line's key=value spec as raw text (no bogus 'Ω s' unit)", () => {
    expect(sourceValueLabel("tline", "Td=50n Z0=50")).toBe("Td=50n Z0=50");
  });

  it("leaves the op-amp's model value untouched (empty unit, no suffix)", () => {
    expect(sourceValueLabel("opamp", "ideal")).toBe("ideal");
    expect(sourceValueLabel("opamp", "LT1001")).toBe("LT1001");
  });
});
