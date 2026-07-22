/**
 * Shippable demo proof: `examples/class-d-amplifier/class-d-starter.asc`
 * (the file inside the DMG, copied verbatim from the user's own LTspice
 * export - see FEATURE_PARITY's class-d fidelity note for the full circuit
 * story) must import through Tau's real project-aware `.asc` pipeline
 * (sibling `deadtime.asy`/`deadtime.asc` resolved exactly as the app does
 * when a user opens the `examples/class-d-amplifier` folder), build a deck,
 * and run BOTH a native operating point and the file's own `.tran` directive
 * through a real ngspice - not the JS fallback solver.
 *
 * Also measures the transient's wall time, since the whole point of a
 * first-run demo is that pressing Run feels instant. If a future edit makes
 * this file's `.tran` slower than the budget below, shorten the shipped
 * `.tran` stop time (only that directive - never the topology) and update
 * the README's "original value" note.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice. The example files themselves are
 * in-repo, so unlike the other corpus specs this one is never skipped for a
 * missing user file - only for a missing ngspice.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { parseTranDirective } from "../src/io/directiveAnalysis";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_DIR = join(REPO_ROOT, "examples", "class-d-amplifier");
const ASC_PATH = join(EXAMPLE_DIR, "class-d-starter.asc");
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

// A first-run demo should feel instant; keep the shipped .tran well inside
// this so there is headroom before it ever needs trimming again.
const TRAN_WALL_BUDGET_MS = 20_000;

/** Sibling-file resolver mirroring `importProjectAsc` for a folder opened as
 *  a Tau project (`deadtime.asy` + `deadtime.asc` next to the main .asc). */
function siblingResolver(dir: string) {
  return makeSubcircuitResolver((symbolType) => {
    const read = (suffix: ".asy" | ".asc") => {
      const path = join(dir, `${symbolType}${suffix}`);
      return existsSync(path) ? decodeSchematicText(readFileSync(path)) : undefined;
    };
    const asy = read(".asy");
    const asc = read(".asc");
    return asy || asc ? { asy, asc } : null;
  });
}

/** Pull `name = <value>` out of ngspice's batch .meas output. */
function measValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
  expect(match, `.meas ${name} missing from ngspice output`).not.toBeNull();
  return Number(match![1]);
}

function runNgspice(netlist: string, tmpDir: string, name: string) {
  const cirPath = join(tmpDir, name);
  writeFileSync(cirPath, netlist);
  const start = Date.now();
  const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 60_000 });
  const wallMs = Date.now() - start;
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  return { run, output, wallMs };
}

describe.skipIf(!haveNgspice)("examples/class-d-amplifier ships a working demo", () => {
  it("imports verbatim, op-converges, and transient-runs well inside the instant-demo budget", () => {
    expect(existsSync(ASC_PATH), "class-d-starter.asc must ship in examples/class-d-amplifier").toBe(true);

    const text = decodeSchematicText(readFileSync(ASC_PATH));
    const imported = importAsc(text, { resolveSubcircuit: siblingResolver(EXAMPLE_DIR) });
    expect(imported.components.length).toBeGreaterThan(0);

    const params = buildParamScope(imported.directives);
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-examples-classd-"));
    try {
      // Native operating point.
      const opDeck = buildSpiceDeck(
        { components: imported.components, wires: imported.wires, netLabels: imported.netLabels, params, directives: imported.directives },
        { kind: "op" },
      );
      const { run: opRun, output: opOutput } = runNgspice(opDeck.netlist, tmpDir, "classd-op.cir");
      expect(opRun.status, opOutput.slice(-2000)).toBe(0);
      expect(opOutput.toLowerCase()).not.toContain("simulation(s) aborted");

      // The file's own .tran directive, run through the real engine, timed.
      // ngspice's CLI batch mode (unlike Tau's native library invocation via
      // Rust) only emits results for an analysis with an explicit output
      // directive, so splice in .meas lines before .end - the same pattern
      // the class-d fidelity corpus spec (classdParity.corpus.ts) uses.
      const tranDirective = imported.directives.find((d) => parseTranDirective(d) !== null);
      expect(tranDirective, "class-d-starter.asc should carry its .tran directive").toBeDefined();
      const tran = parseTranDirective(tranDirective!)!;
      const tranDeck = buildSpiceDeck(
        { components: imported.components, wires: imported.wires, netLabels: imported.netLabels, params, directives: imported.directives },
        { kind: "tran", stopTime: tran.stopTime, steps: tran.steps ?? 3000 },
      );
      const tranNetlist = tranDeck.netlist.replace(
        /\n\.end$/,
        [
          "",
          ".meas tran vpwmmax MAX V(vpwm)",
          ".meas tran vpwmmin MIN V(vpwm)",
          ".meas tran vomax MAX V(vo)",
          ".meas tran vomin MIN V(vo)",
          ".end",
        ].join("\n"),
      );
      const { run: tranRun, output: tranOutput, wallMs } = runNgspice(tranNetlist, tmpDir, "classd-tran.cir");
      expect(tranRun.status, tranOutput.slice(-2000)).toBe(0);
      expect(tranOutput.toLowerCase()).not.toContain("simulation(s) aborted");

      // The comparator must actually switch (rail-to-rail PWM), and the
      // LC-filtered output must show real audio swing - not a dead/garbage
      // run that merely happened to exit 0.
      const vpwmMax = measValue(tranOutput, "vpwmmax");
      const vpwmMin = measValue(tranOutput, "vpwmmin");
      const voMax = measValue(tranOutput, "vomax");
      const voMin = measValue(tranOutput, "vomin");
      expect(vpwmMax).toBeGreaterThan(5);
      expect(vpwmMin).toBeLessThan(-5);
      expect(voMax - voMin).toBeGreaterThan(2);

      // eslint-disable-next-line no-console
      console.log(`\nclass-d-starter.asc .tran wall time: ${wallMs} ms (budget ${TRAN_WALL_BUDGET_MS} ms)\n`);
      expect(wallMs, `transient took ${wallMs} ms - shorten the shipped .tran stop time`).toBeLessThan(TRAN_WALL_BUDGET_MS);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
