import { describe, it, expect } from "vitest";
import { parseIcValue, stripIcSpec, icSpecDeckText } from "./icSpec";

describe("parseIcValue", () => {
  it("returns null when there is no IC", () => {
    expect(parseIcValue("100p")).toBeNull();
    expect(parseIcValue("")).toBeNull();
  });

  it("extracts the IC token preserving SI suffixes", () => {
    expect(parseIcValue("100p IC=1")).toBe("1");
    expect(parseIcValue("1u IC=2.5")).toBe("2.5");
    expect(parseIcValue("10m IC=500m")).toBe("500m");
  });

  it("tolerates spaces around the equals sign and is case-insensitive", () => {
    expect(parseIcValue("100p ic = 3")).toBe("3");
    expect(parseIcValue("100p IC= -2")).toBe("-2");
  });
});

describe("stripIcSpec", () => {
  it("removes the IC chunk leaving the value", () => {
    expect(stripIcSpec("100p IC=1")).toBe("100p");
    expect(stripIcSpec("1u IC=2.5")).toBe("1u");
  });

  it("is a trimming no-op without an IC spec", () => {
    expect(stripIcSpec("  100p ")).toBe("100p");
  });
});

describe("icSpecDeckText", () => {
  it("emits a leading-space IC token", () => {
    expect(icSpecDeckText("100p IC=1")).toBe(" IC=1");
  });
  it("emits nothing without an IC", () => {
    expect(icSpecDeckText("100p")).toBe("");
  });
});
