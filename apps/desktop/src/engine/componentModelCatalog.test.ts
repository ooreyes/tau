import { describe, expect, it } from "vitest";
import { componentModelOptions } from "./componentModelCatalog";

describe("componentModelOptions", () => {
  it("offers only compatible N-channel models and labels every source", () => {
    const options = componentModelOptions("nmos", [
      ".model DOC_N NMOS(Level=1 Vto=1.5)",
    ], [{
      name: "power.lib",
      text: [
        ".model VENDOR_N VDMOS(Vto=2 Kp=5)",
        ".model VENDOR_P VDMOS(pchan Vto=-2 Kp=5)",
        ".model WRONG_BJT NPN(Bf=100)",
      ].join("\n"),
    }]);

    expect(options.map((option) => option.name)).toEqual(expect.arrayContaining([
      "NMOS", "DOC_N", "VENDOR_N", "QS6K1",
    ]));
    expect(options.map((option) => option.name)).not.toEqual(expect.arrayContaining([
      "VENDOR_P", "WRONG_BJT", "RSR015P06",
    ]));
    expect(options.find((option) => option.name === "DOC_N")?.sourceLabel).toBe("This document");
    expect(options.find((option) => option.name === "VENDOR_N")?.sourceLabel).toBe("power.lib");
    expect(options.find((option) => option.name === "QS6K1")?.source).toBe("bundled");
  });

  it("offers only P-channel power models to a PMOS symbol", () => {
    const options = componentModelOptions("pmos", [], [{
      name: "power.lib",
      text: ".model CUSTOM_P VDMOS(pchannel Vto=-1.8)",
    }]);

    expect(options.map((option) => option.name)).toEqual(expect.arrayContaining([
      "PMOS", "CUSTOM_P", "RSR015P06",
    ]));
    expect(options.map((option) => option.name)).not.toContain("QS6K1");
  });

  it("uses the first definition in native resolution order for duplicate names", () => {
    const options = componentModelOptions(
      "npn",
      [".model SAME NPN(Bf=10)"],
      [{ name: "vendor.lib", text: ".model SAME NPN(Bf=20)\n.model ONLY_LIB NPN(Bf=30)" }],
    );

    expect(options.filter((option) => option.name.toLowerCase() === "same")).toEqual([{
      name: "SAME",
      modelType: "npn",
      source: "document",
      sourceLabel: "This document",
    }]);
    expect(options.find((option) => option.name === "ONLY_LIB")?.sourceLabel).toBe("vendor.lib");
  });

  it("routes a named voltage-controlled switch only to SW model cards", () => {
    const options = componentModelOptions("switch", [
      ".model MYSW SW(Ron=1 Roff=1Meg Vt=1)",
      ".model WRONG CSW(Ron=1 Roff=1Meg It=1m)",
    ], [{
      name: "switches.lib",
      text: ".model LIBSW SW(Ron=2 Roff=2Meg Vt=2)",
    }]);

    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "TAU_SW", source: "generic" }),
      expect.objectContaining({ name: "MYSW", modelType: "sw", source: "document" }),
      expect.objectContaining({ name: "LIBSW", modelType: "sw", source: "library" }),
    ]));
    expect(options.map((option) => option.name)).not.toContain("WRONG");
  });

  it("offers no generic photodiode model and only exact diode cards", () => {
    const options = componentModelOptions("photodiode", [
      ".model BPW34 D(Is=10p N=1.2)",
      ".model WRONG NPN(Bf=100)",
    ], []);

    expect(options).toEqual(expect.arrayContaining([expect.objectContaining({
      name: "BPW34",
      modelType: "d",
      source: "document",
    })]));
    expect(options.map((option) => option.name)).not.toContain("");
  });
});
