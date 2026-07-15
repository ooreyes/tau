import { describe, expect, it } from "vitest";
import { extractCircuit } from "../schematic/netlist";
import {
  ASSISTANT_CATALOG_PROMPT,
  ASSISTANT_COMPOSITE_KINDS,
  ASSISTANT_DIRECT_GENERATABLE_KINDS,
  ASSISTANT_GENERATABLE_KINDS,
  assertAssistantDrawingIntegrity,
  assistantSchematicSvg,
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

interface TopologyPlan {
  mode: "create";
  filename: string;
  components: Array<{ ref: string; kind: string; value?: string }>;
  nets: Array<{ name: string; pins: string[] }>;
  directives?: string[];
}

/** Compile through ASC and assert the re-imported electrical graph, not just
 * the generated text. This catches routes that look plausible but terminate
 * beside a real LTspice pin, and routes that accidentally cross another pin. */
function expectRoundTripConnectivity(id: string, plan: TopologyPlan) {
  const action = compileAssistantCircuitPlan(id, plan);
  expect(action.type).toBe("create_asc");
  if (action.type !== "create_asc") throw new Error("expected create action");

  const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
  const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
  for (const net of plan.nets) {
    for (const token of net.pins) {
      const split = token.lastIndexOf(".");
      const ref = token.slice(0, split);
      const pin = token.slice(split + 1);
      expect(byRef.get(ref)?.[pin], token).toBe(net.name);
    }
  }
  expect(circuit.groundNetId).toBe("0");
  return action;
}

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

  it("rejects a plan that leaves a pin out of every net", () => {
    // The exact malformed shape Qwen3-4B produced live (2026-07-14): V1.p and
    // R2.a silently floating, which simulated as a plausible-looking 0 V / 0 A
    // "divider". The rejection message feeds the provider's repair loop.
    expect(() => compileAssistantCircuitPlan("uncovered", {
      mode: "create",
      filename: "divider.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "5" },
        { ref: "R1", kind: "resistor", value: "1k" },
        { ref: "R2", kind: "resistor", value: "2k" },
      ],
      nets: [
        { name: "out", pins: ["R1.b", "R2.b"] },
        { name: "0", pins: ["V1.n", "R1.a"] },
      ],
    })).toThrow(/V1\.p, R2\.a are not connected to any net/);
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

  it("advertises safe composite macros but withholds unresolved symbol contracts", () => {
    expect(ASSISTANT_GENERATABLE_KINDS).toEqual(expect.arrayContaining([...ASSISTANT_COMPOSITE_KINDS]));
    expect(ASSISTANT_GENERATABLE_KINDS).not.toContain("subckt");
  });

  it("round-trips every advertised kind through real ASC pin geometry", () => {
    const failures: string[] = [];
    for (const entry of ASSISTANT_CATALOG_PROMPT) {
      const ref = `${entry.refPrefix}1`;
      let action;
      try {
        // Every pin must land in a net (coverage rule); joining them all in
        // net 0 keeps the fixture electrically meaningless but geometrically
        // complete, which is all this round-trip test measures.
        const nets = [{ name: "0", pins: entry.pins.map((pin) => `${ref}.${pin.id}`) }];
        action = compileAssistantCircuitPlan(`kind-${entry.kind}`, {
          mode: "create",
          filename: `${entry.kind}.asc`,
          components: [{ ref, kind: entry.kind }],
          nets,
        });
      } catch (error) {
        failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if ((ASSISTANT_DIRECT_GENERATABLE_KINDS as readonly string[]).includes(entry.kind)) {
        expect(action.document.components.some((component) => component.kind === entry.kind), entry.kind).toBe(true);
      } else {
        expect(action.document.components.length, entry.kind).toBeGreaterThan(0);
      }
    }
    expect(failures).toEqual([]);
  });

  it("lowers a potentiometer into two connected resistor halves", () => {
    const action = compileAssistantCircuitPlan("macro-pot", {
      mode: "create",
      filename: "potentiometer.asc",
      components: [{ ref: "RV1", kind: "potentiometer", value: "10k" }],
      nets: [
        { name: "top", pins: ["RV1.a"] },
        { name: "wiper", pins: ["RV1.w"] },
        { name: "0", pins: ["RV1.b"] },
      ],
    });
    const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
    const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
    expect(byRef.get("R_RV1_A")).toMatchObject({ a: "top", b: "wiper" });
    expect(byRef.get("R_RV1_B")).toMatchObject({ a: "wiper", b: "0" });
    expect(action.source.match(/SYMATTR Value 5000/g)).toHaveLength(2);
  });

  it("lowers a transformer into coupled inductors with all four terminals", () => {
    const action = compileAssistantCircuitPlan("macro-transformer", {
      mode: "create",
      filename: "transformer.asc",
      components: [{ ref: "T1", kind: "transformer", value: "1:2" }],
      nets: [
        { name: "primary", pins: ["T1.p1"] },
        { name: "0", pins: ["T1.p2", "T1.s2"] },
        { name: "secondary", pins: ["T1.s1"] },
      ],
    });
    const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
    const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
    expect(byRef.get("L_T1_P")).toMatchObject({ a: "primary", b: "0" });
    expect(byRef.get("L_T1_S")).toMatchObject({ a: "secondary", b: "0" });
    expect(action.source).toMatch(/TEXT \S+ \S+ Left 2 !K_T1 L_T1_P L_T1_S 0\.999/);
  });

  it("lowers current-controlled sources into an explicit sense branch and behavioral output", () => {
    for (const [kind, ref, outputKind, expression] of [
      ["cccs", "F1", "bi", "I=I(V_F1_SENSE)*3"],
      ["ccvs", "H1", "bv", "V=I(V_H1_SENSE)*2000"],
    ] as const) {
      const action = compileAssistantCircuitPlan(`macro-${kind}`, {
        mode: "create",
        filename: `${kind}.asc`,
        components: [{ ref, kind, value: kind === "cccs" ? "3" : "2k" }],
        nets: [
          { name: "control_plus", pins: [`${ref}.cp`] },
          { name: "0", pins: [`${ref}.cn`, `${ref}.on`] },
          { name: "output", pins: [`${ref}.op`] },
        ],
      });
      const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
      const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
      expect(byRef.get(`V_${ref}_SENSE`)).toMatchObject({ p: "control_plus", n: "0" });
      expect(byRef.get(`B_${ref}_OUT`)).toMatchObject({ p: "output", n: "0" });
      expect(action.source).toContain(`SYMBOL ${outputKind}`);
      expect(action.source).toContain(`SYMATTR Value ${expression}`);
    }
  });

  it("lowers a comparator into a clamped behavioral output with high-impedance input anchors", () => {
    const action = compileAssistantCircuitPlan("macro-comparator", {
      mode: "create",
      filename: "comparator.asc",
      components: [
        { ref: "U1", kind: "comparator", value: "5 0 0.1" },
        { ref: "V1", kind: "vsource", value: "1" },
      ],
      nets: [
        { name: "positive", pins: ["V1.p", "U1.in+"] },
        { name: "negative", pins: ["U1.in-"] },
        { name: "output", pins: ["U1.out"] },
        { name: "0", pins: ["V1.n"] },
      ],
    });
    const circuit = extractCircuit(action.document.components, action.document.wires, action.document.netLabels);
    const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
    expect(byRef.get("R_U1_INP")).toMatchObject({ a: "positive", b: "0" });
    expect(byRef.get("R_U1_INM")).toMatchObject({ a: "negative", b: "0" });
    expect(byRef.get("B_U1")).toMatchObject({ p: "output", n: "0" });
    expect(action.source).toContain("V=if(V(output)>2.5");
    expect(action.source).toContain("V(positive)-V(negative)");
  });

  it("lowers a static switch without claiming LTspice voltage-control pins", () => {
    for (const [state, resistance] of [["open", "1e12"], ["closed", "1m"]] as const) {
      const action = compileAssistantCircuitPlan(`macro-switch-${state}`, {
        mode: "create",
        filename: `switch-${state}.asc`,
        components: [{ ref: "S1", kind: "switch", value: state }],
        nets: [{ name: "signal", pins: ["S1.a"] }, { name: "0", pins: ["S1.b"] }],
      });
      expect(action.source).toContain("SYMATTR InstName R_S1");
      expect(action.source).toContain(`SYMATTR Value ${resistance}`);
      expect(action.source).not.toContain("SYMBOL sw");
    }
  });

  it("preserves a powered op-amp feedback network through ASC routing", () => {
    const action = expectRoundTripConnectivity("topology-opamp", {
      mode: "create",
      filename: "inverting-amplifier.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "SINE(0 1 1k)" },
        { ref: "V2", kind: "vsource", value: "15" },
        { ref: "V3", kind: "vsource", value: "15" },
        { ref: "R1", kind: "resistor", value: "10k" },
        { ref: "R2", kind: "resistor", value: "100k" },
        { ref: "R3", kind: "resistor", value: "10k" },
        { ref: "U1", kind: "opamp", value: "ideal" },
      ],
      nets: [
        { name: "vin", pins: ["V1.p", "R1.a"] },
        { name: "inverting", pins: ["R1.b", "R2.a", "U1.in-"] },
        { name: "vout", pins: ["R2.b", "R3.a", "U1.out"] },
        { name: "vcc", pins: ["V2.p", "U1.v+"] },
        { name: "vee", pins: ["V3.n", "U1.v-"] },
        { name: "0", pins: ["V1.n", "V2.n", "V3.p", "R3.b", "U1.in+"] },
      ],
      directives: [".tran 5m"],
    });
    expect(action.source).toContain("SYMBOL opamp2");
  });

  it("preserves every node of a capacitor-coupled NPN bias stage", () => {
    const action = expectRoundTripConnectivity("topology-npn", {
      mode: "create",
      filename: "common-emitter.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "12" },
        { ref: "V2", kind: "vsource", value: "SINE(0 10m 1k)" },
        { ref: "C1", kind: "capacitor", value: "1u" },
        { ref: "R1", kind: "resistor", value: "100k" },
        { ref: "R2", kind: "resistor", value: "22k" },
        { ref: "R3", kind: "resistor", value: "4.7k" },
        { ref: "R4", kind: "resistor", value: "1k" },
        { ref: "Q1", kind: "npn", value: "2N3904" },
      ],
      nets: [
        { name: "vcc", pins: ["V1.p", "R1.a", "R3.a"] },
        { name: "input", pins: ["V2.p", "C1.a"] },
        { name: "base", pins: ["C1.b", "R1.b", "R2.a", "Q1.b"] },
        { name: "collector", pins: ["R3.b", "Q1.c"] },
        { name: "emitter", pins: ["Q1.e", "R4.a"] },
        { name: "0", pins: ["V1.n", "V2.n", "R2.b", "R4.b"] },
      ],
      directives: [".op", ".tran 10m"],
    });
    expect(action.source).toContain("SYMBOL npn");
  });

  it("keeps controlled and behavioral source input/output nets isolated", () => {
    const action = expectRoundTripConnectivity("topology-controlled", {
      mode: "create",
      filename: "controlled-sources.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "1" },
        { ref: "E1", kind: "vcvs", value: "10" },
        { ref: "G1", kind: "vccs", value: "2m" },
        { ref: "B1", kind: "bsource", value: "V=V(ctrl)*V(eout)" },
        { ref: "R1", kind: "resistor", value: "1k" },
        { ref: "R2", kind: "resistor", value: "1k" },
        { ref: "R3", kind: "resistor", value: "1k" },
      ],
      nets: [
        { name: "ctrl", pins: ["V1.p", "E1.cp", "G1.cp"] },
        { name: "eout", pins: ["E1.op", "R1.a"] },
        { name: "gout", pins: ["G1.op", "R2.a"] },
        { name: "bout", pins: ["B1.p", "R3.a"] },
        {
          name: "0",
          pins: ["V1.n", "E1.cn", "E1.on", "G1.cn", "G1.on", "B1.n", "R1.b", "R2.b", "R3.b"],
        },
      ],
      directives: [".op"],
    });
    expect(action.source).toContain("SYMBOL e");
    expect(action.source).toContain("SYMBOL g");
    expect(action.source).toContain("SYMBOL bv");
  });

  it("preserves isolation on a dense multi-net resistor mesh", () => {
    expectRoundTripConnectivity("dense-mesh", {
      mode: "create",
      filename: "dense-mesh.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "5" },
        ...Array.from({ length: 12 }, (_, index) => ({
          ref: `R${index + 1}`,
          kind: "resistor",
          value: "1k",
        })),
      ],
      nets: [
        { name: "0", pins: ["V1.n", "R10.b"] },
        { name: "n1", pins: ["V1.p", "R1.a", "R4.a", "R5.a", "R7.a", "R9.a"] },
        { name: "n2", pins: ["R3.a", "R11.b"] },
        { name: "n3", pins: ["R9.b"] },
        { name: "n4", pins: ["R1.b", "R5.b", "R6.a", "R8.a", "R12.a"] },
        { name: "n5", pins: ["R2.b", "R3.b", "R7.b", "R11.a", "R12.b"] },
        { name: "n6", pins: ["R2.a", "R4.b", "R6.b", "R8.b", "R10.a"] },
      ],
    });
  });

  it("orients series and shunt passives like a hand-drawn schematic", () => {
    const action = compileAssistantCircuitPlan("layout-1", divider);
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    const byLabel = new Map(action.document.components.map((component) => [component.label, component]));
    // Series R1 bridges two signal nets between levels → native horizontal.
    expect(byLabel.get("R1")?.rotation).toBe(0);
    // Shunt R2 bridges signal to ground → native vertical (a on top).
    expect(byLabel.get("R2")?.rotation).toBe(90);
  });

  it("draws a connected LED circuit with wires on native symbol pins", () => {
    const action = compileAssistantCircuitPlan("led-layout", {
      mode: "create",
      filename: "led.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "5" },
        { ref: "R1", kind: "resistor", value: "330" },
        { ref: "D1", kind: "led", value: "LED" },
      ],
      nets: [
        { name: "VIN", pins: ["V1.p", "R1.a"] },
        { name: "LED_A", pins: ["R1.b", "D1.a"] },
        { name: "0", pins: ["D1.k", "V1.n"] },
      ],
      directives: [".tran 10m"],
    });
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    // Document must be native Tau geometry (no LTspice pin overrides).
    expect(action.document.components.every((component) => !component.pinOverride?.length)).toBe(true);
    assertAssistantDrawingIntegrity(action.document.components, action.document.wires);
    // Pin-aligned layout: series VIN and LED_A wires should be single straight segments.
    const straight = action.document.wires.filter((wire) => wire.points.length === 2);
    expect(straight.length).toBeGreaterThanOrEqual(2);
    const svg = assistantSchematicSvg(
      action.document.components,
      action.document.wires,
      action.document.netLabels ?? [],
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("V1");
    expect(svg).toContain("R1");
    expect(svg).toContain("D1");
  });

  it("accepts common op-amp pin nicknames so Class-D plans can create files", () => {
    const action = compileAssistantCircuitPlan("opamp-aliases", {
      mode: "create",
      filename: "inverting.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "SINE(0 1 10)" },
        { ref: "V2", kind: "vsource", value: "15" },
        { ref: "V3", kind: "vsource", value: "15" },
        { ref: "R1", kind: "resistor", value: "10k" },
        { ref: "R2", kind: "resistor", value: "100k" },
        { ref: "U1", kind: "opamp", value: "ideal" },
      ],
      nets: [
        // Model-ish nicknames: U1.n / U1.p / U1.vcc instead of in-/in+/v+
        { name: "vin", pins: ["V1.p", "R1.a"] },
        { name: "inverting", pins: ["R1.b", "R2.a", "U1.n"] },
        { name: "vout", pins: ["R2.b", "U1.out"] },
        { name: "vcc", pins: ["V2.p", "U1.vcc"] },
        { name: "vee", pins: ["V3.n", "U1.vee"] },
        { name: "0", pins: ["V1.n", "V2.n", "V3.p", "U1.p"] },
      ],
      directives: [".tran 200m"],
    });
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    const circuit = extractCircuit(
      action.document.components,
      action.document.wires,
      action.document.netLabels,
    );
    const u1 = circuit.components.find(({ component }) => component.label === "U1");
    expect(u1?.pins).toMatchObject({
      "in-": "inverting",
      "in+": "0",
      out: "vout",
      "v+": "vcc",
      "v-": "vee",
    });
  });

  it("preserves both ports of a terminated transmission line", () => {
    const action = expectRoundTripConnectivity("topology-tline", {
      mode: "create",
      filename: "switched-tline.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "PULSE(0 5 0 1n 1n 100n 200n)" },
        { ref: "T1", kind: "tline", value: "Td=50n Z0=50" },
        { ref: "R1", kind: "resistor", value: "50" },
      ],
      nets: [
        { name: "line_in", pins: ["V1.p", "T1.a1"] },
        { name: "remote", pins: ["T1.b1", "R1.a"] },
        { name: "0", pins: ["V1.n", "T1.a2", "T1.b2", "R1.b"] },
      ],
      directives: [".tran 500n"],
    });
    expect(action.source).toContain("SYMBOL tline");
  });
});
