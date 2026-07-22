/**
 * Shippable demo proof: `examples/ad8541-buffer/ad8541-buffer.sim` (the file
 * inside the DMG) must load exactly as the app would - JSON.parse then
 * `validateSchematicDocument`, the same path `openSimFromProject` takes - with
 * its AD8541 vendor library already attached (`userModelLibraries`), build a
 * deck through the real vendor-model-attach flow (see
 * userSubcktImport.corpus.ts for the full mechanism this reuses), and
 * simulate through native ngspice as a unity-gain buffer.
 *
 * Also proves the negative case a fresh user hits before attaching the
 * library: the SAME document with `userModelLibraries` stripped leaves the
 * AD8541 subcircuit unresolved, which is exactly the "missing model" state
 * the README's Model-libraries walkthrough shows how to fix.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice. The example files themselves (the
 * .sim AND the AD8541.lib copy) are in-repo, so this never depends on the
 * installed LTspice library and is only skipped for a missing ngspice.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { validateSchematicDocument } from "../src/schematic/documentValidation";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_DIR = join(REPO_ROOT, "examples", "ad8541-buffer");
const SIM_PATH = join(EXAMPLE_DIR, "ad8541-buffer.sim");
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Pull `name = <value>` out of ngspice's batch .meas output. */
function measValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
  expect(match, `.meas ${name} missing from ngspice output`).not.toBeNull();
  return Number(match![1]);
}

describe.skipIf(!haveNgspice)("examples/ad8541-buffer ships a working demo", () => {
  it("loads with the AD8541 library pre-attached, inlines and translates it, and simulates a unity buffer", () => {
    expect(existsSync(SIM_PATH), "ad8541-buffer.sim must ship in examples/ad8541-buffer").toBe(true);

    const parsed = JSON.parse(readFileSync(SIM_PATH, "utf8")) as unknown;
    const document = validateSchematicDocument(parsed);
    expect(document.userModelLibraries?.length, "the shipped .sim should carry the AD8541 library pre-attached").toBe(1);
    expect(document.userModelLibraries?.[0]?.name).toBe("AD8541.lib");

    const analysis = { kind: "tran", stopTime: 1e-3, steps: 200 } as const;
    const userModelLibraries = document.userModelLibraries?.map((library) => library.text) ?? [];
    const deck = buildSpiceDeck(
      { components: document.components, wires: document.wires, netLabels: document.netLabels ?? [], userModelLibraries },
      analysis,
    );

    // The vendor subckt must be inlined and its LTspice-only switch construct
    // translated - never shipped through to ngspice verbatim.
    expect(deck.unresolvedSubckts).toEqual([]);
    expect(deck.netlist).toMatch(/\.subckt\s+AD8541/i);
    expect(deck.netlist).toMatch(/\.model\s+VSY_SWITCH\s+SW\(/i);
    expect(deck.netlist).not.toMatch(/vswitch/i);
    expect(deck.netlist).not.toMatch(/\(\s*50\s*,\s*99\s*\)/);

    // Control: strip the attached library from the SAME document. The
    // AD8541 reference is then unresolved - the exact state a user sees
    // before attaching the library (or after removing it), which the
    // README's Model-libraries walkthrough shows how to fix.
    const without = buildSpiceDeck(
      { components: document.components, wires: document.wires, netLabels: document.netLabels ?? [] },
      analysis,
    );
    expect(without.unresolvedSubckts.length).toBeGreaterThan(0);
    expect(without.netlist).not.toMatch(/\.subckt\s+AD8541/i);

    // Run the resolved deck through the real engine.
    const netlist = deck.netlist.replace(
      /\n\.end$/,
      [
        "",
        ".meas tran vout AVG V(vout) FROM=0.9m TO=1m",
        ".meas tran vinp AVG V(inp) FROM=0.9m TO=1m",
        ".end",
      ].join("\n"),
    );
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-examples-ad8541-"));
    try {
      const cirPath = join(tmpDir, "buffer.cir");
      writeFileSync(cirPath, netlist);
      const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 4 * 60_000 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output.slice(-2000)).toBe(0);
      expect(output.toLowerCase()).not.toContain("simulation(s) aborted");

      const vout = measValue(output, "vout");
      const vinp = measValue(output, "vinp");
      expect(vinp).toBeCloseTo(2.5, 2);
      // README-promised tolerance: output within 50 mV of the input.
      expect(Math.abs(vout - vinp)).toBeLessThan(0.05);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
