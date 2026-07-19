/**
 * Class-D fidelity check (FEATURE_PARITY §7, priority #2): the flagship
 * class-d_starter.asc must SIMULATE correctly, not just converge in .op. Its
 * PWM comparator is a UniversalOpamp2 run open loop between ±10 V rails -
 * with the plain gain-1e6 op-amp model the "PWM" node saturates to ~1e7 V and
 * the whole amplifier is garbage; with the rail-clamped model (engine/
 * opampSpec.ts) it must switch rail to rail and the LC-filtered output must
 * reproduce the 1 kHz / 7.5 V audio program.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs the user's own corpus file and a real ngspice.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { parseTranDirective } from "../src/io/directiveAnalysis";

const ASC_PATH = join(homedir(), "Downloads", "LTspice_export", "class-d_starter.asc");
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Pull `name = <value>` out of ngspice's batch .meas output. */
function measValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
  expect(match, `.meas ${name} missing from ngspice output`).not.toBeNull();
  return Number(match![1]);
}

describe.skipIf(!existsSync(ASC_PATH) || !haveNgspice)("class-d_starter.asc fidelity", () => {
  it("PWM node switches rail to rail and the filtered output follows the audio program", () => {
    const text = decodeSchematicText(readFileSync(ASC_PATH));
    const resolve = makeSubcircuitResolver((symbolType) => {
      const read = (name: string): string | undefined => {
        const path = join(ASC_PATH, "..", name);
        return existsSync(path) ? decodeSchematicText(readFileSync(path)) : undefined;
      };
      const asy = read(`${symbolType}.asy`);
      const asc = read(`${symbolType}.asc`);
      return asy || asc ? { asy, asc } : null;
    });
    const imported = importAsc(text, { resolveSubcircuit: resolve });

    // Simulate the circuit's own window (.tran 0 3m - 60 carrier cycles,
    // 3 audio cycles), with .meas probes spliced in before .end: the deck
    // builder doesn't pass .meas through, and these are the assertions.
    const tranDirective = imported.directives.find((d) => parseTranDirective(d) !== null);
    expect(tranDirective, "class-d_starter.asc should carry its .tran directive").toBeDefined();
    const tran = parseTranDirective(tranDirective!)!;
    const deck = buildSpiceDeck(
      {
        components: imported.components,
        wires: imported.wires,
        netLabels: imported.netLabels,
        params: buildParamScope(imported.directives),
        directives: imported.directives,
      },
      { kind: "tran", stopTime: tran.stopTime, steps: tran.steps ?? 3000 },
    );
    const netlist = deck.netlist.replace(
      /\n\.end$/,
      [
        "",
        ".meas tran vpwmmax MAX V(vpwm)",
        ".meas tran vpwmmin MIN V(vpwm)",
        ".meas tran vomax MAX V(vo)",
        ".meas tran vomin MIN V(vo)",
        // Skip the first carrier period (comparator t=0 settling); ngspice
        // requires the FROM=/TO= key form, not LTspice's bare FROM/TO.
        `.meas tran voavg AVG V(vo) FROM=50u TO=${tran.stopTime}`,
        ".end",
      ].join("\n"),
    );

    const tmpDir = mkdtempSync(join(tmpdir(), "tau-classd-"));
    try {
      const cirPath = join(tmpDir, "classd.cir");
      writeFileSync(cirPath, netlist);
      const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 8 * 60_000 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output.slice(-2000)).toBe(0);
      expect(output.toLowerCase()).not.toContain("simulation(s) aborted");

      // The comparator output must clamp to the ±10 V rails - not ±1e7 V
      // (broken open-loop op-amp) and not stuck at one rail (dead PWM).
      const vpwmMax = measValue(output, "vpwmmax");
      const vpwmMin = measValue(output, "vpwmmin");
      expect(vpwmMax).toBeGreaterThan(9);
      expect(vpwmMax).toBeLessThan(10.5);
      expect(vpwmMin).toBeLessThan(-9);
      expect(vpwmMin).toBeGreaterThan(-10.5);

      // LC-filtered output ≈ the audio program (SINE 0 7.5 1k through a
      // unity-ish modulator): amplitude in the right range, mean near zero.
      const voMax = measValue(output, "vomax");
      const voMin = measValue(output, "vomin");
      const voAvg = measValue(output, "voavg");
      expect(voMax).toBeGreaterThan(5);
      expect(voMax).toBeLessThan(11);
      expect(voMin).toBeLessThan(-5);
      expect(voMin).toBeGreaterThan(-11);
      expect(Math.abs(voAvg)).toBeLessThan(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
