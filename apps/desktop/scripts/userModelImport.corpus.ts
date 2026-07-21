/**
 * User SPICE model import proof (LTspice parity): a REAL vendor `.model` card
 * supplied through `userModelLibraries` must resolve, inline into the ngspice
 * deck, and SIMULATE correctly. This is the credibility test the whole
 * model-import feature exists for - importing a manufacturer's device model is
 * exactly what an EE does first, and until a real vendor file runs end to end
 * through the native engine the feature is only proven against synthetic
 * fixtures.
 *
 * The model is the 2N3055 power NPN from LTspice's own `standard.bjt` library
 * (STMicro parameters); the whole file is read from disk and passed verbatim,
 * never copied into this repo (third-party asset). A common-emitter bias stage
 * then proves the imported model both loads and behaves: the transistor sits in
 * the forward-active region and its collector-to-base current ratio reproduces
 * the model's own current gain (Bf=73). Real LTspice cards carry datasheet
 * annotations (`mfg=STMicro`) ngspice fatally rejects; the deck builder's
 * normalization (userModelLibrary.ts) is what lets this load at all - a control
 * build without the library confirms the name is otherwise unresolved.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice and the installed vendor file, and is
 * skipped cleanly when either is absent.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import type { NetLabel, SchematicComponent } from "../src/schematic/types";

const LIB_PATH = join(
  homedir(),
  "Library", "Application Support", "LTspice", "lib", "cmp", "standard.bjt",
);
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

describe.skipIf(!existsSync(LIB_PATH) || !haveNgspice)("user vendor .model import", () => {
  it("inlines the vendor model, leaves it unresolved without the library, and simulates a bias stage", () => {
    const libText = readFileSync(LIB_PATH, "latin1");
    const { components, netLabels } = commonEmitter();
    const analysis = { kind: "tran", stopTime: 1e-3, steps: 200 } as const;

    // With the library attached: the vendor card is inlined (its fatal
    // `mfg=` annotation normalized away) and the device references it.
    const deck = buildSpiceDeck({ components, wires: [], netLabels, userModelLibraries: [libText] }, analysis);
    expect(deck.netlist).toMatch(/^\.model\s+2N3055\s+NPN/im);
    expect(deck.netlist).not.toMatch(/mfg\s*=/i);
    expect(deck.netlist).toMatch(/^Q\w*\s+coll\s+base\s+0\s+2N3055\b/im);

    // Control: the SAME schematic with no library falls back to Tau's generic
    // starter model and inlines no 2N3055 card - proof the resolution above
    // came from the user library, not a bundled part.
    const without = buildSpiceDeck({ components, wires: [], netLabels }, analysis);
    expect(without.netlist).not.toMatch(/^\.model\s+2N3055\b/im);
    expect(without.netlist).toMatch(/^Q\w*\s+coll\s+base\s+0\s+TAU_NPN\b/im);

    // Run the resolved deck through the real engine. The stage must bias into
    // forward-active operation, and the collector/base current ratio must
    // reproduce the imported model's own current gain (2N3055 Bf=73).
    const netlist = deck.netlist.replace(
      /\n\.end$/,
      [
        "",
        ".meas tran vcoll AVG V(coll) FROM=0.9m TO=1m",
        ".meas tran vbase AVG V(base) FROM=0.9m TO=1m",
        ".end",
      ].join("\n"),
    );
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-usermodel-"));
    try {
      const cirPath = join(tmpDir, "bias.cir");
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
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
