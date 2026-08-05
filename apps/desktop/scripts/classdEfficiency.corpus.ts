import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeSchematicText, importAsc, makeSubcircuitResolver } from "../src/io/ascImport";
import { parseTranDirective } from "../src/io/directiveAnalysis";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { buildParamScope } from "../src/simulation/paramScope";
import { deriveRcCurrents } from "../src/simulation/currents";
import { runMeasurements } from "../src/simulation/measure";
import { measurementValue, runPairedBatch } from "./parityHarness";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_DIR = join(REPO_ROOT, "examples", "class-d-amplifier");
const ASC_PATH = join(EXAMPLE_DIR, "class-d-starter.asc");
const OWNER_FIXTURE_SHA256 = "7dcaf7a13a0af750758cf0245cccb5cb54d0a69ef676c4caf5572cbaca9ccd07";
const REL_TOLERANCE = 0.02;

function resolver(symbolType: string) {
  const read = (extension: ".asy" | ".asc") => {
    const path = join(EXAMPLE_DIR, `${symbolType}${extension}`);
    return existsSync(path) ? decodeSchematicText(readFileSync(path)) : undefined;
  };
  const asy = read(".asy");
  const asc = read(".asc");
  return asy || asc ? { asy, asc } : null;
}

function relativeError(tau: number, ltspice: number): number {
  return Math.abs(tau - ltspice) / Math.abs(ltspice);
}

describe("class-d_starter.asc authored Efficiency parity", () => {
  it("runs the unmodified owner fixture and matches LTspice's .meas result", () => {
    const bytes = readFileSync(ASC_PATH);
    expect(createHash("sha256").update(bytes).digest("hex"), "the owner fixture must remain verbatim").toBe(OWNER_FIXTURE_SHA256);
    const imported = importAsc(decodeSchematicText(bytes), { resolveSubcircuit: makeSubcircuitResolver(resolver) });
    expect(imported.warnings, "sibling deadtime must resolve warning-clean").toEqual([]);
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
    expect(deck.unresolvedSubckts).toEqual([]);
    // Save the filtered output plus both supply currents; I(R1) is derived the
    // same way the desktop native path does (node voltages → deriveRcCurrents),
    // not by hard-coding R1=8 Ω, so this gate matches what the UI evaluates.
    const result = runPairedBatch(
      "classd-efficiency",
      deck.netlist,
      ["v(vo)", "i(v1)", "i(v2)"],
      measurements,
    );
    const ltPs = measurementValue(result.ltspiceLog, "ps");
    const ltPl = measurementValue(result.ltspiceLog, "pl");
    const ltEfficiency = measurementValue(result.ltspiceLog, "efficiency");
    const vo = result.ngspice.get("v(vo)")!;
    const i1 = result.ngspice.get("i(v1)")!;
    const i2 = result.ngspice.get("i(v2)")!;
    // R1 sits between net `vo` and ground in the Class-D fixture; map the
    // saved v(vo) vector onto that net id so deriveRcCurrents matches App.
    const load = deck.circuit.components.find(({ component }) => component.label === "R1");
    expect(load, "R1 load must survive import").toBeDefined();
    const voNet = load!.pins.a === "0" ? load!.pins.b : load!.pins.a;
    expect(voNet, "R1 must have a non-ground pin").toBeTruthy();
    const nodeVoltages = new Map<string, number[]>([[voNet!, vo.values]]);
    const derived = deriveRcCurrents(deck.circuit.components, nodeVoltages, vo.axis);
    const iR1 = derived.find((trace) => trace.ref.toLowerCase() === "r1");
    expect(iR1, `deriveRcCurrents missed I(R1); got ${derived.map((t) => t.ref).join(",")}`).toBeDefined();
    const tauMeasurements = runMeasurements(measurements, {
      times: vo.axis,
      traces: [{ id: "vo", label: "V(vo)", values: vo.values }],
      currents: [
        iR1!,
        { ref: "V1", label: "I(V1)", values: i1.values },
        { ref: "V2", label: "I(V2)", values: i2.values },
      ],
    }, params.scope, params.funcs);
    const byName = (name: string) =>
      tauMeasurements.find((measurement) => measurement.name.toLowerCase() === name)?.value ?? null;
    const tauPs = byName("ps");
    const tauPl = byName("pl");
    const tauEfficiency = byName("efficiency");
    expect({ tauPs, tauPl, tauEfficiency, tauMeasurements }).toEqual(expect.objectContaining({
      tauPs: expect.any(Number),
      tauPl: expect.any(Number),
      tauEfficiency: expect.any(Number),
    }));
    expect(ltPs).toBeGreaterThan(0);
    expect(ltPl).toBeGreaterThan(0);
    expect(ltEfficiency).toBeGreaterThan(0);
    expect(relativeError(tauPs!, ltPs)).toBeLessThanOrEqual(REL_TOLERANCE);
    expect(relativeError(tauPl!, ltPl)).toBeLessThanOrEqual(REL_TOLERANCE);
    expect(relativeError(tauEfficiency!, ltEfficiency)).toBeLessThanOrEqual(REL_TOLERANCE);
  });
});
