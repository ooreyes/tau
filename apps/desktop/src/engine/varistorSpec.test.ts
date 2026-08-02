import { describe, expect, it } from "vitest";
import { parseVaristor, varistorDeckLine } from "./varistorSpec";

describe("LTspice voltage-controlled varistor", () => {
  it("parses Rclamp with LTspice units and applies the documented default", () => {
    expect(parseVaristor("VARISTOR")).toEqual({ rclamp: 1 });
    expect(parseVaristor("VARISTOR Rclamp=250m")).toEqual({ rclamp: 0.25 });
    expect(() => parseVaristor("Rclamp=0")).toThrow(/positive resistance/);
  });

  it("emits a symmetric controlled-breakdown current law", () => {
    const line = varistorDeckLine("A1", "ctrlp", "ctrln", "out", "com", { rclamp: 2 });
    expect(line).toContain("V(out,com)>abs(V(ctrlp,ctrln))");
    expect(line).toContain("V(out,com)<-abs(V(ctrlp,ctrln))");
    expect(line).toContain("/2");
  });
});
