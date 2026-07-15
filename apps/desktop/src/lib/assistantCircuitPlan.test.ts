import { describe, expect, it } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import {
  ASSISTANT_CATALOG_PROMPT,
  ASSISTANT_GENERATABLE_KINDS,
  compileAssistantCircuitPlan,
} from "./assistantCircuitPlan";

const divider = {
  mode: "create",
  filename: "divider.asc",
  components: [
    { ref: "V1", kind: "vsource", value: "5" },
    { ref: "R1", kind: "resistor", value: "1k" },
    { ref: "R2", kind: "resistor", value: "1k" },
  ],
  nets: [
    { name: "vin", pins: ["V1.p", "R1.a"] },
    { name: "vout", pins: ["R1.b", "R2.a"] },
    { name: "0", pins: ["V1.n", "R2.b"] },
  ],
  directives: [".op", ".tran 10m"],
};

describe("assistant circuit plan", () => {
  it("compiles a logical library plan into a validated ASC proposal", () => {
    const action = compileAssistantCircuitPlan("plan-1", divider);
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    expect(action.filename).toBe("divider.asc");
    expect(action.componentCount).toBe(3);
    expect(action.wireCount).toBeGreaterThanOrEqual(3);
    expect(action.source).toMatch(/^Version 4\nSHEET /);
    expect(action.source).toContain("FLAG");
    expect(action.document.netLabels?.map((label) => label.text)).toEqual(expect.arrayContaining(["vin", "vout"]));
    expect(action.document.directives).toEqual(["op", "tran 10m"]);
    const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
    expect(circuit.components.find(({ component }) => component.label === "R1")?.pins).toMatchObject({
      a: "vin",
      b: "vout",
    });
    expect(circuit.components.find(({ component }) => component.label === "R2")?.pins).toMatchObject({
      a: "vout",
      b: "0",
    });
  });

  it("can propose an undoable replacement without accepting coordinates", () => {
    const action = compileAssistantCircuitPlan("plan-2", { ...divider, mode: "replace_current", filename: undefined });
    expect(action.type).toBe("apply_current_asc");
    expect(action.componentCount).toBe(3);
  });

  it("rejects unknown parts, invalid pins, duplicate connections, and missing ground", () => {
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      components: [{ ref: "X1", kind: "imaginary" }],
    })).toThrow(/cannot generate safely/i);
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      nets: [{ name: "0", pins: ["V1.nope"] }],
    })).toThrow(/not a valid/i);
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      nets: [
        { name: "0", pins: ["V1.n"] },
        { name: "other", pins: ["V1.n", "R1.a"] },
      ],
    })).toThrow(/more than one net/i);
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      nets: divider.nets.filter((net) => net.name !== "0"),
    })).toThrow(/ground net/i);
  });

  it("rejects path-like values and unsafe simulator directives", () => {
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      components: [{ ref: "R1", kind: "resistor", value: "1k\n.shell rm -rf /" }],
    })).toThrow(/invalid/i);
    expect(() => compileAssistantCircuitPlan("x", {
      ...divider,
      directives: [".include /tmp/untrusted.lib"],
    })).toThrow(/not allowed/i);
  });

  it("publishes only catalog kinds with exact pin ids", () => {
    expect(ASSISTANT_CATALOG_PROMPT.map((entry) => entry.kind)).toEqual(ASSISTANT_GENERATABLE_KINDS);
    for (const entry of ASSISTANT_CATALOG_PROMPT) {
      expect(entry.pins.length).toBeGreaterThan(0);
      expect(new Set(entry.pins.map((pin) => pin.id)).size).toBe(entry.pins.length);
    }
  });

  it("round-trips every advertised kind through real ASC pin geometry", () => {
    const failures: string[] = [];
    for (const entry of ASSISTANT_CATALOG_PROMPT) {
      const ref = `${entry.refPrefix}1`;
      let action;
      try {
        action = compileAssistantCircuitPlan(`kind-${entry.kind}`, {
          mode: "create",
          filename: `${entry.kind}.asc`,
          components: [{ ref, kind: entry.kind }],
          nets: [{ name: "0", pins: [`${ref}.${entry.pins[0].id}`] }],
        });
      } catch (error) {
        failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      expect(action.document.components.some((component) => component.kind === entry.kind), entry.kind).toBe(true);
    }
    expect(failures).toEqual([]);
  });
});
