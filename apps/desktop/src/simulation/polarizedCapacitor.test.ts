import { describe, expect, it } from "vitest";
import {
  POLARIZED_CAPACITOR_NEGATIVE_PIN,
  POLARIZED_CAPACITOR_POSITIVE_PIN,
  describeReverseBias,
  inspectReverseBias,
  reverseBiasAdvisory,
  reverseBiasThresholdVolts,
} from "./polarizedCapacitor";

describe("polarized capacitor sign convention", () => {
  it("names the marked terminal as the positive pin", () => {
    // Locked against schematic/pins.ts, which labels `a` "+" and `b` "−", and
    // against spiceNetlist.ts, which emits `C<name> node(a) node(b)`.
    expect(POLARIZED_CAPACITOR_POSITIVE_PIN).toBe("a");
    expect(POLARIZED_CAPACITOR_NEGATIVE_PIN).toBe("b");
  });
});

describe("reverseBiasThresholdVolts", () => {
  it("floors at 1 mV for a small-signal waveform", () => {
    expect(reverseBiasThresholdVolts([0, 0.2, -0.0005])).toBe(1e-3);
  });

  it("scales with the waveform so a high rail does not trip on convergence residue", () => {
    // ngspice converges a 12 V node to reltol*|v| = 12 mV, so the difference of
    // two such nodes carries millivolt-scale residue that is not a reversal.
    expect(reverseBiasThresholdVolts([12, 12, -0.008])).toBeCloseTo(12e-3, 12);
  });

  it("ignores non-finite samples when sizing the threshold", () => {
    expect(reverseBiasThresholdVolts([Number.NaN, Infinity, 5])).toBeCloseTo(5e-3, 12);
  });
});

describe("inspectReverseBias", () => {
  it("returns null for a correctly oriented part", () => {
    expect(inspectReverseBias([0, 1, 2], [0, 2.5, 5])).toBeNull();
  });

  it("returns null for an empty or all-non-finite waveform", () => {
    expect(inspectReverseBias([], [])).toBeNull();
    expect(inspectReverseBias([0, 1], [Number.NaN, Number.NaN])).toBeNull();
  });

  it("ignores numerical noise just below the threshold and reports just above it", () => {
    // Threshold here is the 1 mV floor: peak magnitude 0.5 V gives a relative
    // term of 0.5 mV, which loses to the absolute floor.
    expect(inspectReverseBias([0, 1, 2], [0.5, -0.0009, 0.5])).toBeNull();
    const tripped = inspectReverseBias([0, 1, 2], [0.5, -0.0011, 0.5]);
    expect(tripped?.peakReverseVolts).toBeCloseTo(-0.0011, 12);
  });

  it("calls a run that ends backwards sustained", () => {
    const finding = inspectReverseBias([0, 1, 2], [-4.2, -4.2, -4.2]);
    expect(finding).toMatchObject({ phase: "sustained", peakReverseVolts: -4.2, episodes: 1 });
    expect(finding!.reverseSeconds).toBeCloseTo(2, 12);
    expect(finding!.windowSeconds).toBeCloseTo(2, 12);
  });

  it("separates a startup reversal that clears from one that persists", () => {
    // Same peak, different fact: this one recovers and never returns.
    const finding = inspectReverseBias([0, 1, 2, 3], [-4.2, -4.2, 1, 1]);
    expect(finding?.phase).toBe("settling");
    expect(finding?.episodes).toBe(1);
  });

  it("interpolates the threshold crossing instead of quantising to a whole step", () => {
    // Threshold is 1 mV; the segment from (1, -1 V) to (2, +1 V) crosses it a
    // hair before its midpoint, so the reversal lasts 1.4995 s and not the
    // whole 1 s step either way.
    const finding = inspectReverseBias([0, 1, 2], [-1, -1, 1]);
    expect(finding?.phase).toBe("settling");
    expect(finding!.reverseSeconds).toBeCloseTo(1.4995, 6);
  });

  it("calls a reversal that starts mid-run intermittent, not startup", () => {
    const finding = inspectReverseBias([0, 1, 2, 3, 4], [5, 5, -2, 5, 5]);
    expect(finding?.phase).toBe("intermittent");
    expect(finding?.episodes).toBe(1);
  });

  it("counts the separate intervals of an AC swing", () => {
    const times = Array.from({ length: 401 }, (_, i) => i / 400);
    const values = times.map((time) => 3 * Math.sin(2 * Math.PI * 2 * time));
    const finding = inspectReverseBias(times, values);
    expect(finding?.phase).toBe("intermittent");
    expect(finding?.episodes).toBe(2);
    expect(finding!.peakReverseVolts).toBeCloseTo(-3, 2);
    // Half of a whole number of cycles, minus the sliver inside the threshold.
    expect(finding!.reverseSeconds).toBeCloseTo(0.5, 2);
  });
});

describe("describeReverseBias", () => {
  it("names the part, the voltage, and the consequence for a sustained reversal", () => {
    const advisory = reverseBiasAdvisory("C3", [0, 1, 2], [-4.2, -4.2, -4.2]);
    expect(advisory).toEqual({
      kind: "reverse-biased-electrolytic",
      severity: "warning",
      title: "Reverse-biased electrolytic · sustained",
      message: "C3: reverse-biased to -4.2 V and still reverse-biased when the run ends. An electrolytic conducts and degrades when its positive terminal is the lower one. Swap the part or the wiring so the terminal marked + sits at the higher potential.",
    });
  });

  it("says the startup case recovers and reports how long it lasted", () => {
    const advisory = reverseBiasAdvisory("C1", [0, 1e-3, 2e-3, 3e-3], [-4.2, -4.2, 1, 1]);
    expect(advisory?.title).toBe("Reverse-biased electrolytic · during settling");
    expect(advisory?.message).toMatch(/^C1: reverse-biased to -4\.2 V for the first 1\.8\d* ms of the run, then recovers\./);
    expect(advisory?.message).toContain("milder than a steady one");
  });

  it("reports the interval count for an intermittent reversal", () => {
    const advisory = reverseBiasAdvisory("C2", [0, 1, 2, 3, 4, 5], [5, -2, 5, -2, 5, 5]);
    expect(advisory?.title).toBe("Reverse-biased electrolytic · intermittent");
    expect(advisory?.message).toContain("over 2 separate intervals");
    expect(advisory?.message).toContain("of the 5 s run");
  });

  it("keeps the shipped voice free of exclamation marks and em-dashes", () => {
    const messages = ([
      [0, 1, 2],
      [0, 1e-3, 2e-3],
    ] as const).flatMap((times) => [
      reverseBiasAdvisory("C1", times, [-4.2, -4.2, -4.2]),
      reverseBiasAdvisory("C1", times, [-4.2, 1, 1]),
      reverseBiasAdvisory("C1", times, [5, -2, 5]),
    ]);
    for (const advisory of messages) {
      expect(advisory).not.toBeNull();
      expect(`${advisory!.title} ${advisory!.message}`).not.toMatch(/[!—]/);
    }
  });

  it("describes a finding handed to it directly", () => {
    const finding = inspectReverseBias([0, 1], [-1, -1]);
    expect(describeReverseBias("C9", finding!).message).toContain("C9: reverse-biased to -1 V");
  });
});
