/**
 * Import-time `.include` resolution proof (LTspice parity): an `.asc` whose
 * `.include <file>` directive names a vendor model file sitting next to it on
 * disk must now have that file resolved BY THE IMPORTER (`importProjectAsc`),
 * attached as a model library, and its models reaching the ngspice deck.
 * Before this landed, the directive was simply dropped and the deck builder
 * could only warn "Could not resolve the library file ..." - the model never
 * reached the engine, and the user had to attach the file by hand even though
 * it was sitting right there on disk. This proves the whole path end to end:
 * the importer reads the sibling file, hands it back as a model library, the
 * deck builder inlines its model and drops the now-satisfied warning, and a
 * transistor whose value names that model simulates correctly through the
 * real engine.
 *
 * The vendor file is the same 2N3055 power NPN from LTspice's own
 * `standard.bjt` (STMicro parameters) the sibling user-model-import proof
 * runs against, here copied into a throwaway temp project so the importer has
 * an actual sibling file to find - never copied into this repo (third-party
 * asset).
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice and the installed vendor file, and is
 * skipped cleanly when either is absent.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { importProjectAsc } from "../src/io/projectAscImport";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";
import { ltspiceLibRoot } from "./ltspiceLibRoot";

const LIB_PATH = join(ltspiceLibRoot(), "cmp", "standard.bjt");
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Pull `name = <value>` out of ngspice's batch .meas output. */
function measValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
  expect(match, `.meas ${name} missing from ngspice output`).not.toBeNull();
  return Number(match![1]);
}

/**
 * A common-emitter DC bias stage around an NPN whose model name is resolved
 * from the imported library. Built purely from net labels (each label sits on a
 * pin coordinate; labels sharing a name are one net). Pin geometry: resistor
 * a=(x-32,y) b=(x+32,y); vsource p=(x,y-32) n=(x,y+32); npn c=(x+16,y-32)
 * b=(x-32,y) e=(x+16,y+32).
 *   Vcc -> Rc -> collector, Vcc -> Rb -> base, emitter -> ground.
 */
function commonEmitter(): { components: SchematicComponent[]; netLabels: NetLabel[] } {
  const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
    id: label, kind: "vsource", label, value, x, y, rotation: 0,
  });
  const resistor = (label: string, value: string, x: number, y: number): SchematicComponent => ({
    id: label, kind: "resistor", label, value, x, y, rotation: 0,
  });
  const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

  const q1: SchematicComponent = {
    id: "Q1", kind: "npn", label: "Q1", value: "2N3055", x: 500, y: 300, rotation: 0,
  };
  const vcc = vsource("V1", "12", 100, 300); // p at (100,268), n at (100,332)
  const rb = resistor("Rb", "470k", 250, 200); // a at (218,200), b at (282,200)
  const rc = resistor("Rc", "1k", 350, 100); // a at (318,100), b at (382,100)

  const netLabels: NetLabel[] = [
    lbl(100, 268, "vcc"), lbl(218, 200, "vcc"), lbl(318, 100, "vcc"), // supply rail
    lbl(100, 332, "0"), lbl(516, 332, "0"), // ground: Vcc- and emitter
    lbl(282, 200, "base"), lbl(468, 300, "base"), // Rb -> base
    lbl(382, 100, "coll"), lbl(516, 268, "coll"), // Rc -> collector
  ];
  return { components: [vcc, rb, rc, q1], netLabels };
}

describe.skipIf(!existsSync(LIB_PATH) || !haveNgspice)("imported .include resolution", () => {
  it("resolves a sibling vendor library at import time and simulates a bias stage", async () => {
    const root = mkdtempSync(join(tmpdir(), "tau-includeresolution-"));
    try {
      // <root>/examples/vendor.lib sits right beside the schematic that
      // includes it, exactly as a user's own design folder would look.
      const examplesDir = join(root, "examples");
      mkdirSync(examplesDir, { recursive: true });
      writeFileSync(join(examplesDir, "vendor.lib"), readFileSync(LIB_PATH));

      const ascPath = join(examplesDir, "top.asc");
      const ascText = [
        "Version 4",
        "SHEET 1 880 680",
        "TEXT 0 200 Left 2 !.include vendor.lib",
        "",
      ].join("\n");
      writeFileSync(ascPath, ascText);

      // The importer, not the caller, has to find the sibling file: it only
      // gets the schematic text plus filesystem callbacks, the same shape the
      // desktop app wires up around real disk I/O.
      const result = await importProjectAsc(ascText, {
        sourcePath: ascPath,
        rootPath: root,
        readText: async (p) => readFileSync(p, "utf8"),
        pathExists: async (p) => existsSync(p),
      });

      expect(result.modelLibraries).toHaveLength(1);
      expect(result.modelLibraries[0].name).toBe("vendor.lib");
      expect(result.modelLibraries[0].text).toBe(readFileSync(LIB_PATH, "utf8"));

      const { components, netLabels } = commonEmitter();
      const analysis = { kind: "tran", stopTime: 1e-3, steps: 200 } as const;
      const deck = buildSpiceDeck(
        {
          components,
          wires: [],
          netLabels,
          directives: result.directives,
          userModelLibraries: result.modelLibraries.map((l) => l.text),
          userModelLibraryNames: result.modelLibraries.map((l) => l.name),
        },
        analysis,
      );

      // The directive resolved at import time, so the old "could not find
      // this file" warning must not appear.
      expect(deck.circuit.warnings.filter((w) => w.includes("Could not resolve"))).toEqual([]);
      // The vendor card reached the deck, inlined rather than referenced.
      expect(deck.netlist).toMatch(/^\.model\s+2N3055\s+NPN/im);
      // The native sanitizer rejects every file-backed card, so the resolved
      // `.include` must never survive into the netlist verbatim.
      expect(deck.netlist).not.toMatch(/^\.(include|lib)\b/im);

      // Run the resolved deck through the real engine. The stage must bias
      // into forward-active operation, and the collector/base current ratio
      // must reproduce the imported model's own current gain (2N3055 Bf=73).
      const netlist = deck.netlist.replace(
        /\n\.end$/,
        [
          "",
          ".meas tran vcoll AVG V(coll) FROM=0.9m TO=1m",
          ".meas tran vbase AVG V(base) FROM=0.9m TO=1m",
          ".end",
        ].join("\n"),
      );
      const cirPath = join(root, "bias.cir");
      writeFileSync(cirPath, netlist);
      const run = spawnSync("ngspice", ["-b", cirPath], { encoding: "utf8", timeout: 4 * 60_000 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output.slice(-2000)).toBe(0);
      expect(output.toLowerCase()).not.toContain("simulation(s) aborted");

      const vcoll = measValue(output, "vcoll");
      const vbase = measValue(output, "vbase");
      // Forward-active: base-emitter junction conducting, collector pulled
      // below the 12 V rail but not saturated to ground.
      expect(vbase).toBeGreaterThan(0.15);
      expect(vbase).toBeLessThan(0.8);
      expect(vcoll).toBeGreaterThan(6);
      expect(vcoll).toBeLessThan(11.7);
      // Effective current gain Ic/Ib from the two bias resistors (~Bf=73).
      const ib = (12 - vbase) / 470_000;
      const ic = (12 - vcoll) / 1_000;
      expect(ic / ib).toBeGreaterThan(45);
      expect(ic / ib).toBeLessThan(100);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
