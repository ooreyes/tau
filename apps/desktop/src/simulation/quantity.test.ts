import { describe, it, expect } from "vitest";
import { parseQuantity, formatEngineering } from "./quantity";

describe("parseQuantity", () => {
  it('parses "1k" as 1000', () => {
    expect(parseQuantity("1k")).toBe(1000);
  });

  it('parses "10u" as 1e-5', () => {
    expect(parseQuantity("10u")).toBeCloseTo(1e-5, 20);
  });

  it('parses "10µ" as 1e-5 (unicode micro)', () => {
    expect(parseQuantity("10µ")).toBeCloseTo(1e-5, 20);
  });

  it('"10u" and "10µ" are equal', () => {
    expect(parseQuantity("10u")).toBe(parseQuantity("10µ"));
  });

  it('parses "4.7n" as 4.7e-9', () => {
    expect(parseQuantity("4.7n")).toBeCloseTo(4.7e-9, 20);
  });

  it('parses "1meg" as 1e6', () => {
    expect(parseQuantity("1meg")).toBe(1e6);
  });

  it('parses "2.2k" as 2200', () => {
    expect(parseQuantity("2.2k")).toBeCloseTo(2200, 10);
  });

  it('parses bare "5" as 5', () => {
    expect(parseQuantity("5")).toBe(5);
  });

  it('parses "1µ" as 1e-6', () => {
    expect(parseQuantity("1µ")).toBeCloseTo(1e-6, 20);
  });

  it('parses "1m" as 1e-3', () => {
    expect(parseQuantity("1m")).toBeCloseTo(1e-3, 20);
  });

  it('parses "1p" as 1e-12', () => {
    expect(parseQuantity("1p")).toBeCloseTo(1e-12, 20);
  });

  it('parses "100" as 100', () => {
    expect(parseQuantity("100")).toBe(100);
  });

  it('parses values with unit suffix stripped (e.g. "1kΩ")', () => {
    expect(parseQuantity("1kΩ", "Ω")).toBeCloseTo(1000, 10);
  });

  it("throws on empty string", () => {
    expect(() => parseQuantity("")).toThrow();
  });

  it("throws on non-numeric input", () => {
    expect(() => parseQuantity("abc")).toThrow();
  });

  it("throws on unknown suffix", () => {
    expect(() => parseQuantity("1z")).toThrow();
  });
});

describe("formatEngineering", () => {
  it('formats 0.001 starting with "1 m"', () => {
    const result = formatEngineering(0.001);
    expect(result).toMatch(/^1(\s?)m/);
  });

  it('formats 1000 starting with "1 k"', () => {
    const result = formatEngineering(1000);
    expect(result).toMatch(/^1(\s?)k/);
  });

  it('formats 1e6 starting with "1 M"', () => {
    const result = formatEngineering(1e6);
    expect(result).toMatch(/^1(\s?)M/);
  });

  it('formats 1e-9 starting with "1 n"', () => {
    const result = formatEngineering(1e-9);
    expect(result).toMatch(/^1(\s?)n/);
  });

  it("formats 0 as '0'", () => {
    expect(formatEngineering(0)).toBe("0");
  });

  it("returns '--' for Infinity", () => {
    expect(formatEngineering(Infinity)).toBe("--");
  });

  it("returns '--' for NaN", () => {
    expect(formatEngineering(NaN)).toBe("--");
  });

  it("appends unit when provided", () => {
    const result = formatEngineering(1000, "Ω");
    expect(result).toContain("Ω");
  });

  it("formats 4700 as roughly 4.7k", () => {
    const result = formatEngineering(4700);
    expect(result).toMatch(/4\.7\s*k/);
  });

  it("clamps invalid precision requests instead of throwing", () => {
    expect(formatEngineering(1000, "Hz", 0)).toBe("1 kHz");
    expect(formatEngineering(1000, "Hz", 101)).toBe("1 kHz");
  });
});
