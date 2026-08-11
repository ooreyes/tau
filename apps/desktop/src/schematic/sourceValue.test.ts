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

  it.each([
    ["vac", "V", "1 1k"],
    ["iac", "A", "2m 5k"],
    ["vpulse", "V", "0 3.3 20k 0.25"],
  ] as const)("round-trips the legacy %s positional spelling", (legacyKind, unit, raw) => {
    const source = decodeIndependentSourceValue(raw, unit, legacyKind);

    expect(encodeIndependentSourceValue(source)).toBe(raw);
    expect(source.legacyKind).toBe(legacyKind);
  });

  it.each([
    ["vac", "V", "DC 2 1 1k AC 3 45 Rser=50"],
    ["iac", "A", "DC 2 2m 5k AC 4 30 load"],
    ["vpulse", "V", "DC 1.2 0 3.3 20k 0.25 AC 2 15 Rser=10"],
  ] as const)("preserves explicit DC, AC, and modifiers for legacy %s", (legacyKind, unit, raw) => {
    const source = decodeIndependentSourceValue(raw, unit, legacyKind);

    expect(source.dcBias).toBe(legacyKind === "vpulse" ? "1.2" : "2");
    expect(source.dcExplicit).toBe(true);
    expect(source.modifiers).toContain(legacyKind === "iac" ? "load" : "Rser");
    expect(encodeIndependentSourceValue(source)).toBe(raw);
  });

  it.each([
    ["vac", "V", "1 1k", ["offset", "2"], ["amplitude", "3"], ["frequency", "4k"]],
    ["iac", "A", "2m 5k", ["offset", "1m"], ["amplitude", "4m"], ["frequency", "8k"]],
    ["vpulse", "V", "0 3.3 20k 0.25", ["low", "1"], ["high", "4"], ["frequency", "10k"], ["duty", "0.75"]],
  ] as const)("edits every legacy %s waveform field without migrating its kind", (legacyKind, unit, raw, ...edits) => {
    let source = decodeIndependentSourceValue(raw, unit, legacyKind);
    for (const [key, value] of edits) source = updateIndependentSourceField(source, key, value);

    expect(source.legacyKind).toBe(legacyKind);
    expect(encodeIndependentSourceValue(source)).toContain(
      legacyKind === "vpulse" ? "0.75" : edits[edits.length - 1]![1],
    );
  });

  it.each([
    ["vac", "V", "DC 2 0 1 1k", "pulse"],
    ["iac", "A", "DC 2 0 1m 1k", "pulse"],
    ["vpulse", "V", "DC 2 0 3.3 20k 0.25", "sine"],
  ] as const)("switches legacy %s to a unified waveform without losing DC bias", (legacyKind, unit, raw, mode) => {
    const switched = changeIndependentSourceMode(
      decodeIndependentSourceValue(raw, unit, legacyKind),
      mode,
    );

    expect(switched.legacyKind).toBeUndefined();
    expect(switched.dcBias).toBe("2");
    expect(switched.dcExplicit).toBe(true);
    expect(encodeIndependentSourceValue(switched)).toMatch(/^DC 2 (?:PULSE|SINE)\(/);
  });
});
