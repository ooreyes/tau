/**
 * Ideal-by-default for the junction family (mission item 8).
 *
 * The deck-text assertions here are the contract; the `real ngspice` block is
 * what makes them mean something, because a `.model` card that reads correctly
 * and solves to the wrong number is exactly the failure this feature exists to
 * remove. Every numeric claim below was run through the engine, not derived.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSpiceDeck } from "./spiceNetlist";
import { importAsc } from "../io/ascImport";
import {
  formatIdealVoltageCode,
  hasLtspiceProvenance,
  idealJunctionModel,
  parseIdealVoltageCode,
  IDEAL_DIODE_FORWARD_VOLTS,
  IDEAL_LED_FORWARD_VOLTS,
} from "./idealModels";
import type { ComponentKind, NetLabel, SchematicComponent } from "../schematic/types";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

const part = (
  kind: ComponentKind,
  label: string,
  value: string,
  x: number,
  y: number,
): SchematicComponent => ({ id: label || `${kind}-${x}`, kind, label, value, x, y, rotation: 0 });

/**
 * `V1 → R1 → device under test → ground`, wired by net labels sitting exactly
 * on each pin (the editor's own connectivity rule). `reversed` grounds the
 * ANODE instead, which is how a zener is used.
 *
 * Net `mid` is the device's own terminal, so `V(mid)` is its voltage drop with
 * one terminal at 0 V - the number a student would read on a meter.
 */
function rig(dut: SchematicComponent, supplyVolts: string, seriesOhms = "1k", reversed = false) {
  const driven = reversed ? 432 : 368; // cathode when reversed, anode otherwise
  const grounded = reversed ? 368 : 432;
  const components: SchematicComponent[] = [
    part("vsource", "V1", supplyVolts, 0, 0),
    part("resistor", "R1", seriesOhms, 200, 0),
    dut,
    { ...part("ground", "", "", 0, 32), id: "gnd-src" },
    { ...part("ground", "", "", grounded, 0), id: "gnd-dut" },
  ];
  const netLabels: NetLabel[] = [
    { id: "l1", x: 0, y: -32, text: "vin" },
    { id: "l2", x: 168, y: 0, text: "vin" },
    { id: "l3", x: 232, y: 0, text: "mid" },
    { id: "l4", x: driven, y: 0, text: "mid" },
  ];
  return { components, wires: [], netLabels };
}

const diodeAt = (value: string) => part("diode", "D1", value, 400, 0);

/** Run an `.op` deck and read one node back. Returns null when the run failed,
 *  so a failure surfaces as a bad number rather than a silent skip. */
function opVolts(netlist: string, node: string): number | null {
  const dir = mkdtempSync(join(tmpdir(), "tau-ideal-"));
  try {
    const file = join(dir, "deck.cir");
    writeFileSync(
      file,
      netlist.replace(/^\.end$/m, `.control\nrun\nprint v(${node})\n.endc\n.end`),
    );
    const run = spawnSync("ngspice", ["-b", file], { encoding: "utf8", timeout: 20_000 });
    const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const match = new RegExp(`v\\(${node}\\)\\s*=\\s*(-?[\\d.]+e?[-+]?\\d*)`, "i").exec(out);
    return match ? Number(match[1]) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("provenance", () => {
  it("treats a part with no LTspice field as placed in Tau, and any one of them as imported", () => {
    expect(hasLtspiceProvenance(diodeAt("D"))).toBe(false);
    // Every field the importer can stamp, one at a time - a new one added to
    // the importer without being added to the list would show up here.
    expect(hasLtspiceProvenance({ ...diodeAt("D"), ltSymbolType: "diode" })).toBe(true);
    expect(hasLtspiceProvenance({ ...diodeAt("D"), ltModelName: "1N4148" })).toBe(true);
    expect(hasLtspiceProvenance({ ...diodeAt("D"), ltModelFile: "std.lib" })).toBe(true);
    expect(hasLtspiceProvenance({
      ...diodeAt("D"),
      ltExtraAttrs: { baseValue: "", derivedValue: "D", extras: { SpiceLine: "m=2" } },
    })).toBe(true);
    expect(hasLtspiceProvenance({
      ...diodeAt("D"),
      ltWindows: [{ attr: 3, x: 0, y: 0, justification: "Left", size: 2 }],
    })).toBe(true);
    expect(hasLtspiceProvenance({
      ...diodeAt("D"),
      pinOverride: [{ id: "a", label: "A", x: 0, y: 0 }],
    })).toBe(true);
    // An empty array is not provenance: it carries nothing an .asc said.
    expect(hasLtspiceProvenance({ ...diodeAt("D"), pinOverride: [] })).toBe(false);
  });
});

describe("voltage markings", () => {
  it("reads the markings a part actually carries and refuses part numbers", () => {
    expect(parseIdealVoltageCode("5V1")).toBe(5.1);
    expect(parseIdealVoltageCode("3v3")).toBe(3.3);
    expect(parseIdealVoltageCode("12V")).toBe(12);
    expect(parseIdealVoltageCode("0V7")).toBe(0.7);
    expect(parseIdealVoltageCode("6.3V")).toBe(6.3);
    // These name real parts. Reading "1" out of 1N4148 - which the preview
    // solver's looser `parseZenerBreakdown` does - would silently build a 1 V
    // zener out of a switching diode.
    expect(parseIdealVoltageCode("1N4148")).toBeNull();
    expect(parseIdealVoltageCode("BZX84C15L")).toBeNull();
    expect(parseIdealVoltageCode("MMSD4148")).toBeNull();
    // A bare number is not a marking; it is an unlabelled value.
    expect(parseIdealVoltageCode("5")).toBeNull();
    expect(parseIdealVoltageCode("")).toBeNull();
    expect(parseIdealVoltageCode("0V")).toBeNull();
  });

  it("names a model after the behaviour it describes", () => {
    expect(formatIdealVoltageCode(5.1)).toBe("5V1");
    expect(formatIdealVoltageCode(12)).toBe("12V");
    expect(formatIdealVoltageCode(0.7)).toBe("0V7");
    expect(formatIdealVoltageCode(2)).toBe("2V");
  });
});

describe("idealJunctionModel", () => {
  it("claims a placed diode, LED and zener, and gives each its textbook number", () => {
    expect(idealJunctionModel(diodeAt("D"))).toMatchObject({
      model: "TAU_DIODE_IDEAL_0V7",
      forwardVolts: IDEAL_DIODE_FORWARD_VOLTS,
    });
    expect(idealJunctionModel(part("led", "D2", "LED", 0, 0))).toMatchObject({
      model: "TAU_LED_IDEAL_2V",
      forwardVolts: IDEAL_LED_FORWARD_VOLTS,
    });
    expect(idealJunctionModel(part("zener", "D3", "5V1", 0, 0))).toMatchObject({
      model: "TAU_ZENER_IDEAL_5V1",
      forwardVolts: IDEAL_DIODE_FORWARD_VOLTS,
      breakdownVolts: 5.1,
    });
  });

  it("refuses a part that names a real one, and any part read from an LTspice file", () => {
    expect(idealJunctionModel(diodeAt("1N4148"))).toBeNull();
    expect(idealJunctionModel(part("zener", "D3", "1N750", 0, 0))).toBeNull();
    // Instance parameters mean the value is not a bare model choice.
    expect(idealJunctionModel(diodeAt("D m=2"))).toBeNull();
    expect(idealJunctionModel({ ...diodeAt("D"), ltSymbolType: "diode" })).toBeNull();
    // Not a junction part.
    expect(idealJunctionModel(part("npn", "Q1", "NPN", 0, 0))).toBeNull();
    expect(idealJunctionModel(part("photodiode", "D4", "100u", 0, 0))).toBeNull();
  });
});

describe("deck emission", () => {
  it("gives a placed diode an ideal model, as ngspice's sidiode", () => {
    const deck = buildSpiceDeck(rig(diodeAt("D"), "5"), { kind: "op" });
    expect(deck.netlist).toContain(".model TAU_DIODE_IDEAL_0V7 sidiode(Ron=1m Roff=1G Vfwd=0.7 epsilon=1m)");
    expect(deck.netlist).toMatch(/^A__tau_D1 \S+ tau_d1_id TAU_DIODE_IDEAL_0V7$/m);
    // The generic Shockley starter is NOT what this part solves against.
    expect(deck.netlist).not.toMatch(/^D1 \S+ \S+ TAU_DIODE$/m);
  });

  it("keeps the LTspice-native ideal-diode card on the dual-deck comparison path", () => {
    // `idealDiodeAsSidiode: false` is the LTspice-comparison deck. LTspice reads
    // `D(Ron= Vfwd=)` as its OWN ideal diode, so the same card is correct in
    // both engines and the parity harness compares like with like.
    const deck = buildSpiceDeck(rig(diodeAt("D"), "5"), { kind: "op" }, { idealDiodeAsSidiode: false });
    expect(deck.netlist).toContain(".model TAU_DIODE_IDEAL_0V7 D(Ron=1m Roff=1G Vfwd=0.7 epsilon=1m)");
    expect(deck.netlist).toMatch(/^D1 \S+ tau_d1_id TAU_DIODE_IDEAL_0V7$/m);
  });

  it("emits one card for two identical parts and one per distinct rating", () => {
    const deck = buildSpiceDeck({
      components: [
        part("zener", "D1", "5V1", 0, 0),
        part("zener", "D2", "5V1", 200, 0),
        part("zener", "D3", "12V", 400, 0),
        part("ground", "", "", 0, 64),
      ],
      wires: [],
    }, { kind: "op" });
    const cards = deck.netlist.split("\n").filter((line) => /^\.model TAU_ZENER_IDEAL/.test(line));
    expect(cards).toHaveLength(2);
    expect(cards.join("\n")).toContain("TAU_ZENER_IDEAL_5V1");
    expect(cards.join("\n")).toContain("TAU_ZENER_IDEAL_12V");
  });

  it("lets the document's own .model win over the ideal default", () => {
    const deck = buildSpiceDeck(
      { ...rig(diodeAt("D"), "5"), directives: [".model D D(Is=1e-9 N=1.9)"] },
      { kind: "op" },
    );
    expect(deck.netlist).toMatch(/^D1 \S+ \S+ D$/m);
    expect(deck.netlist).not.toContain("TAU_DIODE_IDEAL");
  });
});

describe("an imported .asc is untouched", () => {
  // The 4012-file acceptance corpus baseline depends on this exactly.
  const asc = (symbol: string, value: string) => [
    "Version 4",
    "SHEET 1 880 680",
    "WIRE 128 96 128 48",
    "WIRE 128 208 128 160",
    `SYMBOL ${symbol} 112 96 R0`,
    "SYMATTR InstName D1",
    `SYMATTR Value ${value}`,
    "FLAG 128 208 0",
    "FLAG 128 48 in",
    "",
  ].join("\n");

  it("keeps the real Berkeley model for a diode read from a file, byte for byte", () => {
    const imported = importAsc(asc("diode", "D"));
    const diode = imported.components.find((c) => c.kind === "diode");
    expect(diode).toBeDefined();
    // The provenance the decision rests on is really there.
    expect(hasLtspiceProvenance(diode!)).toBe(true);

    const deck = buildSpiceDeck({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
    }, { kind: "op" });
    // The exact line Tau emitted before ideal-by-default existed.
    expect(deck.netlist).toMatch(/^D1 in 0 TAU_DIODE$/m);
    expect(deck.netlist).toContain(".model TAU_DIODE D(Is=1e-14 N=1)");
    expect(deck.netlist).not.toContain("IDEAL");
    expect(deck.netlist).not.toContain("sidiode");
  });

  it("keeps a file zener on the generic starter, not on an ideal one", () => {
    const imported = importAsc(asc("zener", "zener"));
    const deck = buildSpiceDeck({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
    }, { kind: "op" });
    expect(deck.netlist).toMatch(/^D1 in 0 TAU_ZENER$/m);
    expect(deck.netlist).not.toContain("IDEAL");
  });

  it("differs from the same part placed in Tau - the provenance test is load-bearing", () => {
    const imported = importAsc(asc("diode", "D"));
    const file = buildSpiceDeck({
      components: imported.components,
      wires: imported.wires,
      netLabels: imported.netLabels,
    }, { kind: "op" }).netlist;
    // Strip only the provenance, change nothing else about the part.
    const placedComponents = imported.components.map((component) => {
      const { pinOverride: _p, ltSymbolType: _t, ltWindows: _w, ltExtraAttrs: _e, ...bare } = component;
      return bare as SchematicComponent;
    });
    const placed = buildSpiceDeck({
      components: placedComponents,
      wires: imported.wires,
      netLabels: imported.netLabels,
    }, { kind: "op" }).netlist;
    expect(file).toContain("TAU_DIODE");
    expect(file).not.toContain("IDEAL");
    expect(placed).toContain("TAU_DIODE_IDEAL_0V7");
  });
});

describe.skipIf(!haveNgspice)("real ngspice", () => {
  it("drops exactly the ideal forward voltage, where the real starter does not", () => {
    // 5 V through 1 k: ~4.3 mA. The generic Shockley starter lands on 0.655 V
    // at 1 mA and 0.714 V at 10 mA - correct for ITS model, and not the number
    // a textbook diode has.
    const ideal = opVolts(buildSpiceDeck(rig(diodeAt("D"), "5"), { kind: "op" }).netlist, "mid");
    expect(ideal).not.toBeNull();
    expect(ideal!).toBeCloseTo(0.7, 3);

    const real = opVolts(
      buildSpiceDeck(rig({ ...diodeAt("D"), ltSymbolType: "diode" }, "5"), { kind: "op" }).netlist,
      "mid",
    );
    expect(real).not.toBeNull();
    // The real model's own answer, unchanged by this feature - and 7 mV away
    // from the textbook one, which is the complaint this feature answers.
    expect(real!).toBeCloseTo(0.6929, 3);
  });

  it("holds the ideal drop across four decades of current, which is what ideal means", () => {
    // The generic starter moves ~59 mV per decade; a fixed-drop model must not.
    const drops = ["1k", "10k", "100k", "1meg"].map((r) => (
      opVolts(buildSpiceDeck(rig(diodeAt("D"), "5", r), { kind: "op" }).netlist, "mid")
    ));
    for (const drop of drops) {
      expect(drop).not.toBeNull();
      expect(drop!).toBeCloseTo(0.7, 3);
    }
  });

  it("gives a placed LED its 2 V drop and blocks in reverse", () => {
    const led = part("led", "D1", "LED", 400, 0);
    const forward = opVolts(buildSpiceDeck(rig(led, "5", "100"), { kind: "op" }).netlist, "mid");
    expect(forward).not.toBeNull();
    expect(forward!).toBeCloseTo(2, 3);
    // Reverse-biased: no conduction, so the series resistor drops nothing and
    // the whole supply stands across the part.
    const reverse = opVolts(buildSpiceDeck(rig(led, "-5", "100"), { kind: "op" }).netlist, "mid");
    expect(reverse).not.toBeNull();
    expect(reverse!).toBeCloseTo(-5, 3);
  });

  it("breaks a zener down at ITS OWN rating, not at a hardcoded 5.1 V", () => {
    // This is the whole point: `.model TAU_ZENER … Bv=5.1` pinned every generic
    // zener at 5.1 V no matter what the schematic said it was.
    for (const [value, expected] of [["5V1", 5.1], ["12V", 12], ["3V3", 3.3]] as const) {
      const zener = part("zener", "D1", value, 400, 0);
      const clamped = opVolts(
        buildSpiceDeck(rig(zener, "24", "1k", true), { kind: "op" }).netlist,
        "mid",
      );
      expect(clamped, `zener ${value}`).not.toBeNull();
      expect(clamped!, `zener ${value}`).toBeCloseTo(expected, 2);
    }
  });

  it("still drops ~0.7 V the forward way round, like a real zener", () => {
    const forward = opVolts(
      buildSpiceDeck(rig(part("zener", "D1", "5V1", 400, 0), "5"), { kind: "op" }).netlist,
      "mid",
    );
    expect(forward).not.toBeNull();
    expect(forward!).toBeCloseTo(0.7, 2);
  });

  it("keeps the part's current readable, which an XSPICE device alone would not", () => {
    const deck = buildSpiceDeck(rig(diodeAt("D"), "5"), { kind: "op" });
    expect(deck.deviceCurrents).toContainEqual({
      componentId: "D1",
      vector: "v__tau_id_d1#branch",
    });
    const dir = mkdtempSync(join(tmpdir(), "tau-ideal-i-"));
    try {
      const file = join(dir, "deck.cir");
      writeFileSync(
        file,
        deck.netlist.replace(/^\.end$/m, ".control\nrun\nprint v__tau_id_d1#branch\n.endc\n.end"),
      );
      const run = spawnSync("ngspice", ["-b", file], { encoding: "utf8", timeout: 20_000 });
      const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      const amps = /v__tau_id_d1#branch\s*=\s*(-?[\d.]+e?[-+]?\d*)/i.exec(out);
      expect(amps, out.slice(-800)).not.toBeNull();
      // (5 − 0.7) / 1k, positive anode → cathode.
      expect(Number(amps![1])).toBeCloseTo(4.3e-3, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
