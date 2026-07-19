// Waveform-parity gate for the sampleHold kind (FEATURE_PARITY §7 flavor):
// imports the real Educational/SampleAndHold.asc, builds a .tran deck, and
// runs ngspice with .meas probes against hand-computed sine samples -
// exercising BOTH A-device modes (A1 = S/H track-and-hold, A2 = CLK edge
// sampler). Runs under vitest.corpus.config.ts only (needs the local corpus);
// skips on machines without the corpus or ngspice.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, decodeSchematicText } from "../src/io/ascImport";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";

const ASC_PATH = join(homedir(), "Documents", "LTspice", "examples", "Educational", "SampleAndHold.asc");
const hasNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

describe.skipIf(!existsSync(ASC_PATH) || !hasNgspice)("SampleAndHold.asc end-to-end", () => {
  it("both A-device modes reproduce LTspice's behavior", () => {
    const imported = importAsc(decodeSchematicText(readFileSync(ASC_PATH)));
    expect(imported.warnings).toEqual([]);
    const a = imported.components.filter((c) => c.kind === "sampleHold");
    expect(a).toHaveLength(2);

    const deck = buildSpiceDeck(
      { components: imported.components, wires: imported.wires, netLabels: imported.netLabels },
      { kind: "tran", stopTime: 10e-3, steps: 1000 },
    );
    const meas = [
      ".meas tran va525 FIND V(a) AT=0.525m", // tracking: sin(2pi*300*525u)=0.8358
      ".meas tran va575 FIND V(a) AT=0.575m", // held at ~551.7u: 0.8623
      ".meas tran vb550 FIND V(b) AT=0.55m",  // edge sample at ~500.5u: 0.8096
      ".meas tran vb950 FIND V(b) AT=0.95m",  // edge sample at ~900.5u: 0.9920
    ].join("\n");
    const netlist = deck.netlist.replace(/^\.end$/m, `${meas}\n.end`);
    const cirPath = join(tmpdir(), "tau-samplehold-parity.cir");
    writeFileSync(cirPath, netlist);
    const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 60_000 });
    const out = `${run.stdout}\n${run.stderr}`;
    const grab = (name: string) => {
      const m = out.match(new RegExp(`${name}\\s*=\\s*([-0-9.eE+]+)`));
      return m ? Number(m[1]) : NaN;
    };
    expect(grab("va525")).toBeCloseTo(0.8358, 2);
    expect(grab("va575")).toBeCloseTo(0.8623, 2);
    expect(grab("vb550")).toBeCloseTo(0.8096, 2);
    expect(grab("vb950")).toBeCloseTo(0.9920, 2);
  });
});
