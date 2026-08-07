// TEMPORARY diagnostic — delete after use. Compares vcvs pin->net mapping with
// and without installed-.asy symbol metadata, to test whether resolving
// LTspice's own e.asy swaps Tau's out/control pin roles.
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { importAsc, decodeSchematicText, parseAsy, type AsySymbol } from "../src/io/ascImport";
import { extractCircuit } from "../src/schematic/netlist";
import { resolveInstalledAsyPath } from "../src/io/ltspiceSymbolResolve";
import { ltspiceLibRoots } from "./ltspiceLibRoot";

const FILE = "/Users/omarreyes/Documents/LTspice/examples/Educational/TwoTau.asc";
const out = (s: string) => process.stderr.write(s + "\n");

function installedSymbolMetadata(symbolType: string): AsySymbol | null {
  const roots = ltspiceLibRoots().map((root) => join(root, "sym"));
  const path = resolveInstalledAsyPath(roots, symbolType);
  if (!path) return null;
  return parseAsy(decodeSchematicText(readFileSync(path)));
}

function report(label: string, opts: Parameters<typeof importAsc>[1]) {
  const imported = importAsc(readFileSync(FILE, "latin1"), opts);
  const circuit = extractCircuit(imported.components, imported.wires, imported.netLabels);
  out(`\n=== ${label} ===`);
  for (const entry of circuit.components) {
    if (entry.component.kind !== "vcvs") continue;
    out(`${entry.component.label}: ${JSON.stringify(entry.pins)}`);
  }
}

describe("pin probe", () => {
  it("compares vcvs pin roles with and without installed .asy", () => {
    report("WITHOUT installed .asy (built-in layout)", undefined);
    report("WITH installed .asy (corpus path)", { resolveSymbolMetadata: installedSymbolMetadata });
    out("\nTruth from e.asy: SpiceOrder 1,2 = OUTPUT (+,-) at (0,16)/(0,96);");
    out("SpiceOrder 3,4 = CONTROL (P,N) at (-48,32)/(-48,80).");
    out("TwoTau: E2 output -> net B, control -> V1 chain (N002).");
  });
});
