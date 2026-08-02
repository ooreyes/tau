import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeSchematicText, importAsc, makeSubcircuitResolver } from "../src/io/ascImport";
import { parseTranDirective } from "../src/io/directiveAnalysis";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { buildParamScope } from "../src/simulation/paramScope";
import { runMeasurements } from "../src/simulation/measure";
import { measurementValue, runPairedBatch } from "./parityHarness";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_DIR = join(REPO_ROOT, "examples", "class-d-amplifier");
const ASC_PATH = join(EXAMPLE_DIR, "class-d-starter.asc");
const OWNER_FIXTURE_SHA256 = "7dcaf7a13a0af750758cf0245cccb5cb54d0a69ef676c4caf5572cbaca9ccd07";

function resolver(symbolType: string) {
  const read = (extension: ".asy" | ".asc") => {
    const path = join(EXAMPLE_DIR, `${symbolType}${extension}`);
    return existsSync(path) ? decodeSchematicText(readFileSync(path)) : undefined;
  };
  const asy = read(".asy");
  const asc = read(".asc");
  return asy || asc ? { asy, asc } : null;
}

describe("class-d_starter.asc authored Efficiency parity", () => {
  it("runs the unmodified owner fixture and matches LTspice's .meas result", () => {
    const bytes = readFileSync(ASC_PATH);
    expect(createHash("sha256").update(bytes).digest("hex"), "the owner fixture must remain verbatim").toBe(OWNER_FIXTURE_SHA256);
    const imported = importAsc(decodeSchematicText(bytes), { resolveSubcircuit: makeSubcircuitResolver(resolver) });
    const tran = imported.directives.map(parseTranDirective).find((value) => value !== null);
    expect(tran, "the unmodified fixture must contain .tran").not.toBeNull();
    const measurements = imported.directives.filter((directive) => /^\.meas(?:ure)?\b/i.test(directive));
    expect(measurements.map((line) => line.toLowerCase())).toEqual(expect.arrayContaining([
      expect.stringMatching(/^\.meas tran ps /),
      expect.stringMatching(/^\.meas tran pl /),
      expect.stringMatching(/^\.meas tran efficiency /),
    ]));
    const params = buildParamScope(imported.directives);
    const deck = buildSpiceDeck({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
      directives: imported.directives,
      params,
    }, { kind: "tran", stopTime: tran!.stopTime, steps: tran!.steps ?? 3000 });
    const result = runPairedBatch(
      "classd-efficiency",
      deck.netlist,
      ["v(vo)", "i(v1)", "i(v2)"],
      measurements,
    );
    const ltspice = measurementValue(result.ltspiceLog, "efficiency");
    const vo = result.ngspice.get("v(vo)")!;
    const i1 = result.ngspice.get("i(v1)")!;
    const i2 = result.ngspice.get("i(v2)")!;
    const tauMeasurements = runMeasurements(measurements, {
      times: vo.axis,
      traces: [{ id: "vo", label: "V(vo)", values: vo.values }],
      currents: [
        { ref: "R1", label: "I(R1)", values: vo.values.map((voltage) => voltage / 8) },
        { ref: "V1", label: "I(V1)", values: i1.values },
        { ref: "V2", label: "I(V2)", values: i2.values },
      ],
    }, params.scope, params.funcs);
    const tau = tauMeasurements.find((measurement) => measurement.name.toLowerCase() === "efficiency")?.value;
    expect(tau, JSON.stringify(tauMeasurements)).not.toBeNull();
    expect(ltspice).toBeGreaterThan(0);
    expect(Math.abs(tau! - ltspice) / Math.abs(ltspice)).toBeLessThanOrEqual(0.02);
  });
});
