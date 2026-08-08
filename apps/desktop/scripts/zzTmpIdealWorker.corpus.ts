// TEMPORARY: proves the ideal-junction deck survives Tau's own Rust sanitizer
// and bundled libngspice, not just the system ngspice CLI. Delete after use.
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { runNativeSpiceWorker, nativeWorkerPaths } from "./nativeSpiceWorker";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const part = (kind: any, label: string, value: string, x: number, y: number): SchematicComponent =>
  ({ id: label || `${kind}-${x}`, kind, label, value, x, y, rotation: 0 });

function rig(dut: SchematicComponent, supply: string, series = "1k", reversed = false) {
  const driven = reversed ? 432 : 368;
  const grounded = reversed ? 368 : 432;
  const components: SchematicComponent[] = [
    part("vsource", "V1", supply, 0, 0),
    part("resistor", "R1", series, 200, 0),
    dut,
    { ...part("ground", "", "", 0, 32), id: "gnd-src" },
    { ...part("ground", "", "", grounded, 0), id: "gnd-dut" },
  ];
  const netLabels: NetLabel[] = [
    { id: "l1", x: 0, y: -32, text: "vin" },
    { id: "l2", x: 168, y: 0, text: "vin" },
    { id: "l3", x: 232, y: 0, text: "mid" },
    { id: "l4", x: driven, y: 0, text: "mid" },
  ];
  return { components, wires: [], netLabels };
}

describe("packaged engine", () => {
  it("accepts ideal diode / LED / zener decks", () => {
    console.log("worker paths:", JSON.stringify(nativeWorkerPaths()));
    for (const [name, schematic] of [
      ["diode", rig(part("diode", "D1", "D", 400, 0), "5")],
      ["led", rig(part("led", "D1", "LED", 400, 0), "5", "100")],
      ["zener 12V reverse", rig(part("zener", "D1", "12V", 400, 0), "24", "1k", true)],
      ["led REAL", rig({ ...part("led", "D1", "LED", 400, 0), ltSymbolType: "led" } as any, "5", "100")],
      ["diode REAL", rig({ ...part("diode", "D1", "D", 400, 0), ltSymbolType: "diode" } as any, "5")],
      ["led ideal tran", rig(part("led", "D1", "LED", 400, 0), "5", "100")],
    ] as const) {
      const deck = buildSpiceDeck(schematic as any, { kind: "op" });
      const run = runNativeSpiceWorker(deck.netlist);
      console.log(name, "ok=", run.ok, run.ok ? "" : run.error, (run.messages ?? []).filter((m) => /error|warn/i.test(m)).join(" | "));
      expect(run.ok, `${name}: ${run.error ?? ""}\n${deck.netlist}`).toBe(true);
    }
  });
});
