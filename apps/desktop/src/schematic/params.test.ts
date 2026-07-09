import { describe, expect, it } from "vitest";
import { decodeParams, encodeParams } from "./params";

describe("MOSFET param encode/decode", () => {
  it("round-trips model + W/L/KP/VTO", () => {
    const encoded = encodeParams("nmos", {
      model: "NMOS",
      w: "20u",
      l: "2u",
      kp: "50u",
      vto: "0.7",
    });
    expect(encoded).toBe("NMOS W=20u L=2u KP=50u VTO=0.7");
    expect(decodeParams("nmos", encoded)).toEqual({
      model: "NMOS",
      w: "20u",
      l: "2u",
      kp: "50u",
      vto: "0.7",
    });
  });

  it("keeps a bare model name without inventing W/L", () => {
    expect(decodeParams("pmos", "PMOS")).toEqual({
      model: "PMOS",
      w: "",
      l: "",
      kp: "",
      vto: "",
    });
  });

  it("encodes inductor inductance as a single-field value", () => {
    expect(encodeParams("inductor", { l: "10u" })).toBe("10u");
    expect(decodeParams("inductor", "10u")).toEqual({ l: "10u" });
  });
});
