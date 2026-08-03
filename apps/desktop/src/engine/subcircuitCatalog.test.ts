import { describe, expect, it } from "vitest";
import {
  describeSubcircuit,
  encodeSubcircuitInstanceValue,
  parseSubcircuitInstanceValue,
  subcircuitParameterValue,
  subcircuitOptions,
} from "./subcircuitCatalog";

describe("subcircuit catalog", () => {
  it("extracts named terminals and parameter defaults from a public header", () => {
    expect(describeSubcircuit(`.subckt deadtime vcc vee pwm gp gn params: dead=250n level={5 + trim}\nR1 gp gn 1k\n.ends`)).toEqual({
      name: "deadtime",
      ports: ["vcc", "vee", "pwm", "gp", "gn"],
      parameters: [
        { name: "dead", defaultValue: "250n" },
        { name: "level", defaultValue: "{5 + trim}" },
      ],
    });
  });

  it("uses document, attachment, then bundled first-wins resolution", () => {
    const options = subcircuitOptions([
      `.subckt SAME doc_in doc_out params: gain=2\\n.ends SAME`,
    ], [{
      name: "driver.lib",
      text: `.subckt SAME lib_in lib_out\n.ends SAME\n.subckt DRIVER vcc vee in out\n.ends DRIVER`,
    }]);

    expect(options.filter((option) => option.name.toLowerCase() === "same")).toEqual([expect.objectContaining({
      ports: ["doc_in", "doc_out"],
      source: "document",
      sourceLabel: "This document",
    })]);
    expect(options.find((option) => option.name === "DRIVER")).toEqual(expect.objectContaining({
      ports: ["vcc", "vee", "in", "out"],
      sourceLabel: "driver.lib",
    }));
    expect(options.find((option) => option.name === "tau_passthrough")?.source).toBe("bundled");
    expect(options.find((option) => option.name === "TauDeadtimeDriver")).toEqual(expect.objectContaining({
      ports: ["vcc", "vee", "pwm", "gp", "gn"],
      source: "bundled",
      parameters: [
        expect.objectContaining({ name: "dead", label: "Dead time", unit: "s", defaultValue: "200n" }),
        expect.objectContaining({ name: "threshold", label: "Input threshold", min: 0.1, max: 0.9 }),
        expect.objectContaining({ name: "hysteresis", label: "Input hysteresis", min: 0, max: 0.2 }),
        expect.objectContaining({ name: "transition", label: "Gate transition", unit: "s" }),
        expect.objectContaining({ name: "rout", label: "Output resistance", unit: "Ω" }),
      ],
    }));
  });

  it("round-trips instance overrides without exposing raw X syntax", () => {
    const parsed = parseSubcircuitInstanceValue("deadtime dead=300n level={5 + trim}");
    expect(parsed.name).toBe("deadtime");
    expect([...parsed.overrides]).toEqual([["dead", "300n"], ["level", "{5 + trim}"]]);
    expect(encodeSubcircuitInstanceValue(parsed.name, parsed.overrides)).toBe("deadtime dead=300n level={5 + trim}");
    expect(subcircuitParameterValue(parsed.overrides, "DEAD")).toBe("300n");
  });

  it("reads formal parameters continued from a wrapped header", () => {
    expect(describeSubcircuit(`.subckt wrapped in out\n+ params: Delay={base + 10n} Gain=2\n.ends`)).toEqual({
      name: "wrapped",
      ports: ["in", "out"],
      parameters: [
        { name: "Delay", defaultValue: "{base + 10n}" },
        { name: "Gain", defaultValue: "2" },
      ],
    });
  });

  it("refuses a definition with no terminals or more than the document limit", () => {
    expect(describeSubcircuit(".subckt empty\n.ends")).toBeNull();
    const ports = Array.from({ length: 65 }, (_, index) => `p${index + 1}`).join(" ");
    expect(describeSubcircuit(`.subckt huge ${ports}\n.ends`)).toBeNull();
  });
});
