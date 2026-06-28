import { describe, it, expect } from "vitest";
import { parseAcSpec, stripAcSpec, acSpecDeckText } from "./acSpec";

describe("parseAcSpec", () => {
  it("returns null when there is no AC keyword", () => {
    expect(parseAcSpec("SINE(0 1 1)")).toBeNull();
    expect(parseAcSpec("5")).toBeNull();
    expect(parseAcSpec("")).toBeNull();
    expect(parseAcSpec("PULSE(0 5 0 1n 1n 1u 2u)")).toBeNull();
  });

  it("extracts magnitude after a transient function (the Draft1/Draft2 case)", () => {
    expect(parseAcSpec("SINE(0 1 1) AC 1")).toEqual({ mag: 1, phase: 0 });
  });

  it("extracts magnitude from a bare AC spec", () => {
    expect(parseAcSpec("AC 1")).toEqual({ mag: 1, phase: 0 });
    expect(parseAcSpec("5 AC 2")).toEqual({ mag: 2, phase: 0 });
  });

  it("resolves SI-suffixed magnitudes", () => {
    expect(parseAcSpec("AC 1m")).toEqual({ mag: 1e-3, phase: 0 });
    expect(parseAcSpec("SINE(0 1 1k) AC 10m")).toEqual({ mag: 1e-2, phase: 0 });
  });

  it("captures an optional numeric phase", () => {
    expect(parseAcSpec("AC 1 90")).toEqual({ mag: 1, phase: 90 });
    expect(parseAcSpec("AC 2 -45")).toEqual({ mag: 2, phase: -45 });
  });

  it("does not mistake a trailing non-numeric SpiceLine token for the phase", () => {
    expect(parseAcSpec("AC 1 Rser=0.1")).toEqual({ mag: 1, phase: 0 });
  });

  it("is case-insensitive on the AC keyword", () => {
    expect(parseAcSpec("sine(0 1 1) ac 1")).toEqual({ mag: 1, phase: 0 });
  });
});

describe("stripAcSpec", () => {
  it("removes the AC chunk leaving the transient function", () => {
    expect(stripAcSpec("SINE(0 1 1) AC 1")).toBe("SINE(0 1 1)");
    expect(stripAcSpec("SINE(0 1 1k) AC 10m")).toBe("SINE(0 1 1k)");
  });

  it("removes the AC chunk leaving a DC level", () => {
    expect(stripAcSpec("5 AC 2")).toBe("5");
    expect(stripAcSpec("AC 1")).toBe("");
  });

  it("removes magnitude and phase together", () => {
    expect(stripAcSpec("SINE(0 1 1) AC 1 90")).toBe("SINE(0 1 1)");
  });

  it("is a trimming no-op when there is no AC spec", () => {
    expect(stripAcSpec("  SINE(0 1 1)  ")).toBe("SINE(0 1 1)");
    expect(stripAcSpec("5")).toBe("5");
  });
});

describe("acSpecDeckText", () => {
  it("emits a leading-space AC token for ngspice", () => {
    expect(acSpecDeckText("SINE(0 1 1) AC 1")).toBe(" AC 1");
    expect(acSpecDeckText("AC 2 90")).toBe(" AC 2 90");
  });

  it("emits nothing without an AC spec", () => {
    expect(acSpecDeckText("SINE(0 1 1)")).toBe("");
    expect(acSpecDeckText("5")).toBe("");
  });
});
