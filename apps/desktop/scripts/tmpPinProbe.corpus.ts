// TEMPORARY diagnostic — delete after use. Prints the imported pin geometry of
// every vcvs in TwoTau.asc so the E-source out/control mapping can be checked
// against LTspice's e.asy SpiceOrder (1,2 = out +/-, 3,4 = control P/N).
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { importAsc } from "../src/io/ascImport";
import { getComponentPins } from "../src/schematic/pins";
import { extractCircuit } from "../src/schematic/netlist";

const FILE = "/Users/omarreyes/Documents/LTspice/examples/Educational/TwoTau.asc";

describe("pin probe", () => {
  it("prints vcvs pin world positions", () => {
    const out = (s: string) => process.stderr.write(s + "\n");
    const text = readFileSync(FILE, "latin1");
    const imported = importAsc(text);
    out("KINDS: " + imported.components.map((c) => `${c.label}:${c.kind}`).join(", "));
    for (const c of imported.components) {
      if (c.kind !== "vcvs") continue;
      out(`\n${c.label} at (${c.x},${c.y}) rot=${c.rotation} value=${c.value}`);
      for (const p of getComponentPins(c)) {
        out(`   pin ${String(p.id).padEnd(3)} world=(${p.x},${p.y})`);
      }
    }
    out("\nnetLabels: " + JSON.stringify(imported.netLabels));

    const circuit = extractCircuit(imported.components, imported.wires, imported.netLabels);
    out("\n--- resolved pin -> net ---");
    for (const entry of circuit.components) {
      if (entry.component.kind !== "vcvs") continue;
      out(`${entry.component.label}: ${JSON.stringify(entry.pins)}`);
    }
  });
});
