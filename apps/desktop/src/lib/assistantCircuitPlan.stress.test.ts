import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractCircuit } from "../schematic/netlist";
import { importAsc } from "../io/ascImport";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { compileAssistantCircuitPlan } from "./assistantCircuitPlan";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

describe("assistant complex-circuit adversarial contract", () => {
  it("compiles, exports, reimports, and netlists the maximum 80-part fanout", { timeout: 30_000 }, () => {
    const resistors = Array.from({ length: 79 }, (_, index) => ({
      ref: `R${index + 1}`,
      kind: "resistor",
      value: `${index + 1}k`,
    }));
    const plan = {
      mode: "create",
      filename: "max-fanout.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "PULSE(0 5 0 1n 1n 5u 10u)" },
        ...resistors,
      ],
      nets: [
        { name: "FANOUT", pins: ["V1.p", ...resistors.map(({ ref }) => `${ref}.a`)] },
        { name: "0", pins: ["V1.n", ...resistors.map(({ ref }) => `${ref}.b`)] },
      ],
      directives: [".tran 100n 20u"],
    };

    const startedAt = performance.now();
    const action = compileAssistantCircuitPlan("stress-max-fanout", plan);
    const compileMs = performance.now() - startedAt;
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    expect(action.componentCount).toBe(80);
    // The labeled-bus representation keeps the contract ceiling interactive;
    // the pre-optimization star router took 6.4-7.8 seconds on this fixture.
    expect(compileMs).toBeLessThan(2_000);
    expect(action.wireCount).toBeLessThan(10);
    expect(action.document.netLabels?.filter(({ text }) => text === "FANOUT")).toHaveLength(80);
    expect(action.document.netLabels?.filter(({ text }) => text === "0")).toHaveLength(80);

    const reopened = importAsc(action.source);
    expect(reopened.warnings).toEqual([]);
    const circuit = extractCircuit(reopened.components, reopened.wires, reopened.netLabels);
    expect(circuit.warnings).toEqual([]);
    const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
    for (const resistor of resistors) {
      expect(byRef.get(resistor.ref)).toMatchObject({ a: "FANOUT", b: "0" });
    }

    const deck = buildSpiceDeck(
      {
        components: reopened.components,
        wires: reopened.wires,
        netLabels: reopened.netLabels,
        directives: reopened.directives,
      },
      { kind: "tran", stopTime: 20e-6, steps: 200 },
    );
    expect(deck.netlist).not.toMatch(/\b(?:NaN|undefined|Infinity)\b/);
    expect(deck.netlist.match(/^R\d+\s/gm)).toHaveLength(79);
    expect(new TextEncoder().encode(deck.netlist).byteLength).toBeLessThan(512 * 1024);
  });

  it("preserves long PWL data and legal worst-case identifiers without deck injection", () => {
    const value = "PWL(0 0 1u 1 2u 0 3u 1 4u 0 5u 1 6u 0 7u 1 8u 0 9u 1 10u 0 11u 1 12u 0 13u 1 14u 0 15u 1 16u 0)";
    expect(value.length).toBeLessThanOrEqual(160);
    const action = compileAssistantCircuitPlan("stress-pathological-safe", {
      mode: "create",
      filename: "legal odd name.asc",
      components: [
        { ref: "V_source_123456789012345", kind: "vsource", value },
        { ref: "R_load_123456789012345", kind: "resistor", value: "1.23456789Meg" },
      ],
      nets: [
        { name: "BUS.$-42", pins: ["V_source_123456789012345.p", "R_load_123456789012345.a"] },
        { name: "0", pins: ["V_source_123456789012345.n", "R_load_123456789012345.b"] },
      ],
      directives: [".tran 100n 16u", ".options reltol=1e-5"],
    });
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    expect(action.filename).toBe("legal odd name.asc");
    const reopened = importAsc(action.source);
    expect(reopened.warnings).toEqual([]);
    const deck = buildSpiceDeck(
      {
        components: reopened.components,
        wires: reopened.wires,
        netLabels: reopened.netLabels,
        directives: reopened.directives,
      },
      { kind: "tran", stopTime: 16e-6, steps: 160 },
    );
    expect(deck.netlist).toContain("PWL(0 0 0.000001 1");
    expect(deck.netlist).toContain("reltol=1e-5");
    expect(deck.netlist).not.toMatch(/\.(?:control|shell)|[\r\0]/i);
  });

  it("rejects oversized and ambiguous hostile plans before layout", () => {
    const base = {
      mode: "create",
      filename: "bounded.asc",
      components: [
        { ref: "V1", kind: "vsource", value: "1" },
        { ref: "R1", kind: "resistor", value: "1k" },
      ],
      nets: [
        { name: "N1", pins: ["V1.p", "R1.a"] },
        { name: "0", pins: ["V1.n", "R1.b"] },
      ],
      directives: [".op"],
    };
    const startedAt = performance.now();
    expect(() => compileAssistantCircuitPlan("too-many-components", {
      ...base,
      components: Array.from({ length: 81 }, (_, index) => ({
        ref: `R${index + 1}`,
        kind: "resistor",
        value: "1k",
      })),
    })).toThrow(/1–80 components/);
    expect(() => compileAssistantCircuitPlan("too-many-nets", {
      ...base,
      nets: Array.from({ length: 161 }, (_, index) => ({ name: `N${index + 1}`, pins: ["R1.a"] })),
    })).toThrow(/1–160 nets/);
    expect(() => compileAssistantCircuitPlan("too-many-pins", {
      ...base,
      nets: [
        { name: "N1", pins: Array.from({ length: 81 }, () => "R1.a") },
        base.nets[1],
      ],
    })).toThrow(/connect at least one pin/);
    expect(() => compileAssistantCircuitPlan("duplicate-ref", {
      ...base,
      components: [...base.components, { ref: "r1", kind: "resistor", value: "2k" }],
    })).toThrow(/not a unique safe reference/);
    expect(() => compileAssistantCircuitPlan("duplicate-net", {
      ...base,
      nets: [...base.nets, { name: "n1", pins: ["R1.b"] }],
    })).toThrow(/not a unique safe net name/);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it("keeps feedback/crossing mesh nets isolated and rejects dangling pins", () => {
    const resistors = Array.from({ length: 12 }, (_, index) => ({
      ref: `R${index + 1}`,
      kind: "resistor",
      value: "1k",
    }));
    const plan = {
      mode: "create",
      filename: "cyclic-crossing-mesh.asc",
      components: [{ ref: "V1", kind: "vsource", value: "5" }, ...resistors],
      nets: [
        { name: "0", pins: ["V1.n", "R10.b"] },
        { name: "n1", pins: ["V1.p", "R1.a", "R4.a", "R5.a", "R7.a", "R9.a"] },
        { name: "n2", pins: ["R3.a", "R11.b"] },
        { name: "n3", pins: ["R9.b"] },
        { name: "n4", pins: ["R1.b", "R5.b", "R6.a", "R8.a", "R12.a"] },
        { name: "n5", pins: ["R2.b", "R3.b", "R7.b", "R11.a", "R12.b"] },
        { name: "n6", pins: ["R2.a", "R4.b", "R6.b", "R8.b", "R10.a"] },
      ],
      directives: [".op"],
    };
    const action = compileAssistantCircuitPlan("stress-crossing-feedback", plan);
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    const reopened = importAsc(action.source);
    const circuit = extractCircuit(reopened.components, reopened.wires, reopened.netLabels);
    const byRef = new Map(circuit.components.map(({ component, pins }) => [component.label, pins]));
    for (const net of plan.nets) {
      for (const token of net.pins) {
        const split = token.lastIndexOf(".");
        expect(byRef.get(token.slice(0, split))?.[token.slice(split + 1)], token).toBe(net.name);
      }
    }
    expect(new Set(plan.nets.map(({ name }) => name)).size).toBe(plan.nets.length);

    expect(() => compileAssistantCircuitPlan("stress-dangling", {
      ...plan,
      components: [...plan.components, { ref: "C99", kind: "capacitor", value: "1n" }],
    })).toThrow(/C99\.a, C99\.b are not connected to any net/);
  });

  it.runIf(haveNgspice)("executes a mixed analog/digital shift-register deck in real ngspice", { timeout: 30_000 }, () => {
    const flipFlops = Array.from({ length: 4 }, (_, index) => ({
      ref: `A${index + 1}`,
      kind: "dflop",
      value: "Vhigh=5 Vlow=0",
    }));
    const loads = Array.from({ length: 4 }, (_, index) => [
      { ref: `R${index + 1}`, kind: "resistor", value: `${index + 1}k` },
      { ref: `C${index + 1}`, kind: "capacitor", value: `${index + 1}n` },
    ]).flat();
    const groundPins = ["VD.n", "VCLK.n"];
    for (const flipFlop of flipFlops) {
      groundPins.push(`${flipFlop.ref}.pre`, `${flipFlop.ref}.clr`, `${flipFlop.ref}.com`);
    }
    for (let index = 1; index <= 4; index += 1) {
      groundPins.push(`R${index}.b`, `C${index}.b`);
    }
    const plan = {
      mode: "create",
      filename: "mixed-shift-register.asc",
      components: [
        {
          ref: "VD",
          kind: "vsource",
          value: "PWL(0 0 1m 0 1.001m 5 3m 5 3.001m 0 5m 0 5.001m 5 7m 5 7.001m 0 9m 0)",
        },
        { ref: "VCLK", kind: "vsource", value: "PULSE(0 5 0.5m 1n 1n 0.25m 1m)" },
        ...flipFlops,
        ...loads,
      ],
      nets: [
        { name: "DATA", pins: ["VD.p", "A1.d"] },
        { name: "CLK", pins: ["VCLK.p", ...flipFlops.map(({ ref }) => `${ref}.clk`)] },
        ...flipFlops.map(({ ref }, index) => ({
          name: `Q${index + 1}`,
          pins: [
            `${ref}.q`,
            ...(index < flipFlops.length - 1 ? [`A${index + 2}.d`] : []),
            `R${index + 1}.a`,
            `C${index + 1}.a`,
          ],
        })),
        ...flipFlops.map(({ ref }, index) => ({ name: `Q${index + 1}BAR`, pins: [`${ref}.qbar`] })),
        { name: "0", pins: groundPins },
      ],
      directives: [".tran 2u 10m"],
    };

    const action = compileAssistantCircuitPlan("stress-mixed-signal", plan);
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create action");
    const reopened = importAsc(action.source);
    expect(reopened.warnings).toEqual([]);
    const deck = buildSpiceDeck(
      {
        components: reopened.components,
        wires: reopened.wires,
        netLabels: reopened.netLabels,
        directives: reopened.directives,
      },
      { kind: "tran", stopTime: 0.01, steps: 5_000 },
    );
    expect(deck.netlist.match(/^\.model\s+a\d+_dff\s+d_dff/im)).not.toBeNull();
    // Each flip-flop lowers to an ADC bridge, DFF, and DAC bridge.
    expect(deck.netlist.match(/^A\S+\s/gm)).toHaveLength(12);

    const directory = mkdtempSync(join(tmpdir(), "tau-mixed-stress-"));
    try {
      const path = join(directory, "mixed.cir");
      writeFileSync(path, deck.netlist.replace(/\n\.end$/, "\n.print tran v(Q4)\n.end"));
      const run = spawnSync("ngspice", ["-b", path], { encoding: "utf8", timeout: 20_000 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.error, output.slice(-2_000)).toBeUndefined();
      expect(run.status, output.slice(-2_000)).toBe(0);
      const rows = /No\. of Data Rows\s*:\s*(\d+)/i.exec(output);
      expect(rows, output.slice(-2_000)).not.toBeNull();
      expect(Number(rows?.[1])).toBeGreaterThan(1_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
