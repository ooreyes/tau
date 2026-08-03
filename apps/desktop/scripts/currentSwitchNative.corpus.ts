// End-to-end proof for LTspice's `csw.asy`: build the exact deck Tau emits,
// run it in real ngspice, and prove the W device follows current through the
// named voltage source. This guards against a syntactically plausible deck
// that still uses the wrong source direction, threshold, model family, or
// fixed-resistor approximation.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const pinComponent = (
  id: string,
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  pins: SchematicComponent["pinOverride"],
  ltSymbolType?: string,
): SchematicComponent => ({ id, kind, label, value, x: 0, y: 0, rotation: 0, pinOverride: pins, ltSymbolType });

const ground = (id: string, x: number, y: number): SchematicComponent => ({
  id, kind: "ground", label: "", value: "", x, y, rotation: 0,
});

function switchedLoad(controlAmps: string) {
  const components: SchematicComponent[] = [
    pinComponent("w1", "switch", "W1", "Vsense MYSW", [
      { id: "a", label: "+", x: 0, y: 0 },
      { id: "b", label: "-", x: 100, y: 0 },
    ], "csw"),
    pinComponent("vload", "vsource", "Vload", "5", [
      { id: "p", label: "+", x: 0, y: 0 },
      { id: "n", label: "-", x: 0, y: 100 },
    ]),
    pinComponent("rload", "resistor", "Rload", "1k", [
      { id: "a", label: "a", x: 100, y: 0 },
      { id: "b", label: "b", x: 100, y: 100 },
    ]),
    pinComponent("vsense", "vsource", "Vsense", "0", [
      { id: "p", label: "+", x: 200, y: 0 },
      { id: "n", label: "-", x: 200, y: 100 },
    ]),
    // Tau's source convention emits this as I 0 sense <amps>, so the named
    // zero-volt source carries positive current from sense to ground.
    pinComponent("ictl", "isource", "Ictl", controlAmps, [
      { id: "p", label: "+", x: 200, y: 0 },
      { id: "n", label: "-", x: 200, y: 100 },
    ]),
    ground("gload", 0, 100),
    ground("gout", 100, 100),
    ground("gctl", 200, 100),
  ];
  const netLabels: NetLabel[] = [{ id: "out-label", x: 100, y: 0, text: "out" }];
  return {
    components,
    wires: [],
    netLabels,
    directives: [".model MYSW CSW(Ron=1 Roff=1Meg It=.5m Ih=0)"],
  };
}

function nativeOutput(controlAmps: string): { volts: number; netlist: string } {
  const deck = buildSpiceDeck(switchedLoad(controlAmps), { kind: "op" });
  const netlist = `${deck.netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
print v(out)
.endc
.end
`;
  const path = join(tmpdir(), `tau-current-switch-${controlAmps.replace(/\W/g, "_")}.cir`);
  writeFileSync(path, netlist);
  const run = spawnSync("ngspice", ["-b", path], { encoding: "utf8", timeout: 120_000 });
  const output = `${run.stdout}\n${run.stderr}`;
  expect(run.status, output).toBe(0);
  const match = /^v\(out\)\s*=\s*(-?[\d.]+(?:e[-+]?\d+)?)/im.exec(output);
  expect(match, output).not.toBeNull();
  return { volts: Number(match![1]), netlist: deck.netlist };
}

describe.skipIf(!haveNgspice)("LTspice current-controlled switch through real ngspice", () => {
  it("turns on above It and off below It without a resistor approximation", () => {
    const on = nativeOutput("1m");
    const off = nativeOutput("0.1m");

    expect(on.netlist).toMatch(/^W1 \S+ out Vsense MYSW$/m);
    expect(on.netlist).not.toMatch(/^R_W1 /m);
    expect(on.volts).toBeGreaterThan(4.99);
    expect(off.volts).toBeGreaterThan(0);
    expect(off.volts).toBeLessThan(0.01);
    expect(on.volts / off.volts).toBeGreaterThan(900);
  });
});
