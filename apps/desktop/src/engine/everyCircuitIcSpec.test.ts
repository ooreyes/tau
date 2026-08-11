import { describe, expect, it } from "vitest";
import { sevenSegDeckLines } from "./everyCircuitIcSpec";

describe("seven-segment electrical deck", () => {
  it("emits directional LED segments with a finite series load", () => {
    const lines = sevenSegDeckLines("U1", { a: "n_a", com: "0", polarity: "cathode" });
    expect(lines).toEqual([
      "D_u1_a n_a u1_a_led TAU_7SEG_LED",
      "R_u1_a u1_a_led 0 220",
    ]);
    expect(lines.join("\n")).not.toContain("1G");
  });

  it("reverses the diode direction for a common-anode part", () => {
    const lines = sevenSegDeckLines("U1", { a: "n_a", com: "vcc", polarity: "polarity=anode" });
    expect(lines).toEqual([
      "D_u1_a vcc u1_a_led TAU_7SEG_LED",
      "R_u1_a u1_a_led n_a 220",
    ]);
  });

  it("uses the same bare-anode normalization as the renderer", () => {
    const lines = sevenSegDeckLines("U1", { a: "n_a", com: "vcc", polarity: "anode" });
    expect(lines[0]).toBe("D_u1_a vcc u1_a_led TAU_7SEG_LED");
    expect(lines[1]).toBe("R_u1_a u1_a_led n_a 220");
  });
});
