import { describe, expect, it } from "vitest";

import {
  addPwlPoint,
  changeIndependentSourceMode,
  decodeIndependentSourceValue,
  encodeIndependentSourceValue,
  updateIndependentSourceField,
  updatePwlPoint,
} from "./sourceValue";

describe("independent-source value controls", () => {
  it("decodes PWL points, DC operating point, and AC stimulus separately", () => {
    const source = decodeIndependentSourceValue("PWL(0 0 2u 0 +1u 1) AC 2 90", "V");

    expect(source.mode).toBe("pwl");
    expect(source.dcBias).toBe("0");
    expect(source.dcExplicit).toBe(false);
    expect(source.pwlPoints).toEqual([
      { time: "0", level: "0" },
      { time: "2u", level: "0" },
      { time: "+1u", level: "1" },
    ]);
    expect(source.acMagnitude).toBe("2");
    expect(source.acPhase).toBe("90");
  });

  it("edits the operating-point bias without putting PWL syntax in that field", () => {
    const decoded = decodeIndependentSourceValue("PWL(0 0 2u 0 +1u 1)", "V");
    const edited = updateIndependentSourceField(decoded, "dcBias", "3.3");

    expect(encodeIndependentSourceValue(edited)).toBe("DC 3.3 PWL(0 0 2u 0 +1u 1)");
  });

  it("edits and adds PWL rows without exposing function syntax", () => {
    let source = decodeIndependentSourceValue("PWL(0 0 2u 0)", "V");
    source = updatePwlPoint(source, 1, "level", "5");
    source = addPwlPoint(source);
    source = updatePwlPoint(source, 2, "time", "3u");
    source = updatePwlPoint(source, 2, "level", "1");

    expect(encodeIndependentSourceValue(source)).toBe("PWL(0 0 2u 5 3u 1)");
  });

  it("preserves AC stimulus and source modifiers while editing Sine parameters", () => {
    const decoded = decodeIndependentSourceValue(
      "SINE(0 7.5 1k 0 0 90) AC 1 Rser=50",
      "V",
    );
    const edited = updateIndependentSourceField(decoded, "frequency", "2k");

    expect(encodeIndependentSourceValue(edited)).toBe(
      "SINE(0 7.5 2k 0 0 90) AC 1 Rser=50",
    );
  });

  it("switches a DC source to Sine with named defaults and carries its bias", () => {
    const source = changeIndependentSourceMode(
      decodeIndependentSourceValue("5", "A"),
      "sine",
    );

    expect(source.parameters).toMatchObject({ offset: "5", amplitude: "1", frequency: "1k" });
    expect(encodeIndependentSourceValue(source)).toBe("SINE(5 1 1k)");
  });
});
