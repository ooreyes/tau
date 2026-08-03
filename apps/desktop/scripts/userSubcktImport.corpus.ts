/**
 * User SPICE subcircuit import proof (LTspice parity): a REAL vendor `.subckt`
 * macromodel supplied through `userModelLibraries` must resolve, inline, and
 * SIMULATE. Vendor op-amp macromodels are where LTspice users live, and many of
 * them (Analog Devices' among them) build their output/clamp stages from
 * LTspice switch primitives that ngspice does not accept verbatim:
 *   - the `.model` type is `VSWITCH`/`ISWITCH`, which ngspice spells `SW`/`CSW`,
 *     and the control levels are stated as on/off (`Von`/`Voff`) rather than
 *     ngspice's center-plus-hysteresis (`Vt`/`Vh`);
 *   - the switch instance wraps its control nodes in parentheses `(nc+,nc-)`,
 *     which ngspice rejects.
 * Left as-is, ngspice fails the whole deck ("Unable to find definition of model
 * ..."), so the imported op-amp does nothing. The deck builder's subckt
 * normalization (userModelLibrary.ts) is what makes it simulate.
 *
 * The model is the AD8541 rail-to-rail CMOS op-amp from LTspice's own library
 * (Analog Devices macromodel); the file is read from disk and passed verbatim,
 * never copied into this repo (third-party asset). It is imported through the
 * ordinary five-pin `opamp` path, not pre-converted to Tau's generic `subckt`
 * carrier. With the model attached its output must follow the 2.5 V input; a
 * control build without the library must refuse instead of substituting Tau's
 * ideal/gain-block op-amp.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice and the installed vendor file, and is
 * skipped cleanly when either is absent.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import type { NetLabel, PinOverride, SchematicComponent } from "../src/schematic/types";
import { ltspiceLibRoot } from "./ltspiceLibRoot";

const LIB_PATH = join(ltspiceLibRoot(), "sub", "AD8541.lib");
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Pull `name = <value>` out of ngspice's batch .meas output. */
function measValue(output: string, name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
  expect(match, `.meas ${name} missing from ngspice output`).not.toBeNull();
  return Number(match![1]);
}

/**
 * AD8541 wired as a unity-gain buffer. The op-amp is a `subckt` instance whose
 * absolute pin positions (pinOverride) land on the same coordinates as net
 * labels, in the vendor port order (`+in -in V+ V- out`); each label name is a
 * net. A 5 V supply and a 2.5 V input drive it single-supply.
 *   +in <- input,  -in <- output (feedback),  out -> output net.
 */
function unityBuffer(): { components: SchematicComponent[]; netLabels: NetLabel[] } {
  const pinOverride: PinOverride[] = [
    { id: "in+", label: "+IN", x: 0, y: 0 },
    { id: "in-", label: "-IN", x: 0, y: 40 },
    { id: "v+", label: "V+", x: 0, y: 80 },
    { id: "v-", label: "V-", x: 0, y: 120 },
    { id: "out", label: "OUT", x: 100, y: 0 },
  ];
  const u1: SchematicComponent = {
    id: "U1",
    kind: "opamp",
    label: "U1",
    value: "AD8541",
    x: 0,
    y: 0,
    rotation: 0,
    pinOverride,
    ltSymbolType: "Opamps\\AD8541",
  };
  const vsource = (label: string, value: string, x: number, y: number): SchematicComponent => ({
    id: label, kind: "vsource", label, value, x, y, rotation: 0,
  });
  const vpos = vsource("Vp", "5", 300, 100); // p at (300,68), n at (300,132)
  const vin = vsource("Vi", "2.5", 400, 100); // p at (400,68), n at (400,132)
  const lbl = (x: number, y: number, text: string): NetLabel => ({ id: `f-${x}-${y}`, x, y, text });

  const netLabels: NetLabel[] = [
    lbl(0, 0, "inp"), lbl(400, 68, "inp"), // +in <- 2.5 V input
    lbl(0, 40, "vout"), lbl(100, 0, "vout"), // -in tied to out (unity feedback)
    lbl(0, 80, "vpos"), lbl(300, 68, "vpos"), // V+ <- 5 V rail
    lbl(0, 120, "0"), lbl(300, 132, "0"), lbl(400, 132, "0"), // V- and both sources to ground
  ];
  return { components: [u1, vpos, vin], netLabels };
}

describe.skipIf(!existsSync(LIB_PATH) || !haveNgspice)("user vendor .subckt import", () => {
  it("normalizes the switch constructs, leaves it unresolved without the library, and simulates a buffer", () => {
    const libText = readFileSync(LIB_PATH, "latin1");
    const { components, netLabels } = unityBuffer();
    const analysis = { kind: "tran", stopTime: 1e-3, steps: 200 } as const;

    // With the library attached: the vendor subckt is inlined and its two
    // LTspice-only switch constructs are rewritten into ngspice's spelling.
    const deck = buildSpiceDeck({ components, wires: [], netLabels, userModelLibraries: [libText] }, analysis);
    expect(deck.netlist).toMatch(/^XU1 inp vout vpos 0 vout AD8541$/m);
    expect(deck.netlist).not.toMatch(/^[BE]_U1\b/m);
    expect(deck.netlist).toMatch(/\.model\s+VSY_SWITCH\s+SW\(/i);
    expect(deck.netlist).toMatch(/S1\s+90\s+91\s+50\s+99\s+VSY_SWITCH/i);
    expect(deck.netlist).not.toMatch(/vswitch/i);
    expect(deck.netlist).not.toContain("(50,99)");

    // Control: the SAME named part with no library is an atomic refusal, not
    // an unresolved native error and not Tau's ideal/generic op-amp.
    expect(() => buildSpiceDeck({ components, wires: [], netLabels }, analysis))
      .toThrow(/Simulation refused: U1 \(AD8541\).*attached Model Library.*No approximate or partial circuit was run/);

    // Run the resolved deck through the real engine. As a unity buffer the
    // output must track the 2.5 V input to within an op-amp's offset/settling.
    const netlist = deck.netlist.replace(
      /\n\.end$/,
      [
        "",
        ".meas tran vout AVG V(vout) FROM=0.9m TO=1m",
        ".meas tran vinp AVG V(inp) FROM=0.9m TO=1m",
        ".end",
      ].join("\n"),
    );
    const tmpDir = mkdtempSync(join(tmpdir(), "tau-usersubckt-"));
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
      // Buffer output follows the input; a wide 100 mV band still fails hard if
      // the switch stage tripped at 0 (which is what an untranslated card does).
      expect(Math.abs(vout - vinp)).toBeLessThan(0.1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
