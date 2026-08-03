// Native proof for LTspice's charge-defined capacitor. A Q=100p*x device must
// behave as an actual 100 pF capacitor in an RC step response, not merely parse.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const placed = (
  id: string,
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  pins: NonNullable<SchematicComponent["pinOverride"]>,
): SchematicComponent => ({ id, kind, label, value, x: 0, y: 0, rotation: 0, pinOverride: pins });

const components: SchematicComponent[] = [
  placed("v1", "vsource", "V1", "PULSE(0 1 0 1n 1n 100u 200u)", [
    { id: "p", label: "+", x: 0, y: 0 },
    { id: "n", label: "-", x: 0, y: 100 },
  ]),
  placed("r1", "resistor", "R1", "{900+100}", [
    { id: "a", label: "a", x: 0, y: 0 },
    { id: "b", label: "b", x: 100, y: 0 },
  ]),
  placed("c1", "capacitor", "C1", "Q=100p*x", [
    { id: "a", label: "a", x: 100, y: 0 },
    { id: "b", label: "b", x: 100, y: 100 },
  ]),
  placed("g1", "ground", "", "", [{ id: "g", label: "GND", x: 0, y: 100 }]),
  placed("g2", "ground", "", "", [{ id: "g", label: "GND", x: 100, y: 100 }]),
];
const netLabels: NetLabel[] = [{ id: "out", x: 100, y: 0, text: "out" }];

describe.skipIf(!haveNgspice)("LTspice charge-defined capacitor through real ngspice", () => {
  it("matches the one-time-constant RC step value", () => {
    const deck = buildSpiceDeck({ components, wires: [], netLabels }, { kind: "tran", stopTime: 1e-6, steps: 2_000 });
    expect(deck.netlist).toMatch(/^R1 \S+ out 1000$/m);
    expect(deck.netlist).toMatch(/^C1 out 0 Q='100p\*\(V\(out,0\)\)'$/m);

    const netlist = `${deck.netlist.replace(/^\s*\.end\s*$/mi, "")}
.control
run
meas tran tau_v find v(out) at=100n
print tau_v
.endc
.end
`;
    const path = join(tmpdir(), "tau-behavioral-capacitor.cir");
    writeFileSync(path, netlist);
    const run = spawnSync("ngspice", ["-b", path], { encoding: "utf8", timeout: 120_000 });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).toBe(0);
    const match = /^tau_v\s*=\s*(-?[\d.]+(?:e[-+]?\d+)?)/im.exec(output);
    expect(match, output).not.toBeNull();
    // V(τ) = 1-e^-1 = 0.6321. The authored source has a 1 ns edge, so allow
    // integration tolerance while still rejecting a missing/wrong capacitor.
    expect(Number(match![1])).toBeGreaterThan(0.60);
    expect(Number(match![1])).toBeLessThan(0.67);
  });
});
