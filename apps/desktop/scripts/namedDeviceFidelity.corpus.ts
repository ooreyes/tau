/**
 * Named-device fidelity proof (AGENTS DoD slice): refuse-vs-exact, never silent
 * generic substitution.
 *
 * Prints a machine-readable summary line so DoD claims stay tied to stdout:
 *   NAMED-DEVICE: exact=N refuse=M silent=0
 *
 * Does not claim the full ≥95% unencrypted-corpus floor — that is measured by
 * `namedDeviceRecursive.corpus.ts` (`NAMED-DEVICE-RECURSIVE: …`). This script
 * only proves the closed classes stay refuse-or-exact.
 */
import { describe, expect, it } from "vitest";
import { buildSpiceDeck, unresolvedModelMessage } from "../src/engine/spiceNetlist";
import { runTransientAnalysis } from "../src/simulation/linearTransient";
import { runOperatingPoint } from "../src/simulation/operatingPoint";
import type { NetLabel, SchematicComponent, SchematicWire } from "../src/schematic/types";

let id = 0;
const uid = (prefix: string) => `${prefix}-${++id}`;

function component(
  kind: SchematicComponent["kind"],
  label: string,
  value: string,
  x: number,
  y: number,
  extras: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id: uid(kind), kind, label, value, x, y, rotation: 0, ...extras };
}

function vendorOpamp(label: string, value: string, symbol: string): SchematicComponent {
  return {
    ...component("opamp", label, value, 0, 0, { ltSymbolType: symbol }),
    pinOverride: [
      { id: "in+", label: "In+", x: 0, y: 0 },
      { id: "in-", label: "In-", x: 0, y: 16 },
      { id: "out", label: "OUT", x: 64, y: 8 },
      { id: "v+", label: "V+", x: 32, y: -16 },
      { id: "v-", label: "V-", x: 32, y: 32 },
    ],
  };
}

const vendorNets: NetLabel[] = [
  { id: "p", x: 0, y: 0, text: "inp" },
  { id: "m", x: 0, y: 16, text: "inm" },
  { id: "vp", x: 32, y: -16, text: "vdd" },
  { id: "vm", x: 32, y: 32, text: "0" },
  { id: "o", x: 64, y: 8, text: "out" },
];

describe("named-device fidelity — refuse vs exact", () => {
  it("proves refuse-vs-exact with zero silent substitutions and prints the tally", async () => {
    let exact = 0;
    let refuse = 0;
    const silent = 0;

    // Exact semiconductor: attached .model lands on the device line.
    {
      const components = [
        component("vsource", "V1", "5", 0, 32),
        component("diode", "D1", "ACME_D1", 96, 0),
        component("ground", "", "", 0, 64),
        component("ground", "", "", 128, 0),
      ];
      const wires: SchematicWire[] = [{ id: uid("w"), points: [{ x: 0, y: 0 }, { x: 64, y: 0 }] }];
      const deck = buildSpiceDeck(
        { components, wires, userModelLibraries: [".model ACME_D1 D(Is=3e-9 N=1.1 Rs=0.4)"] },
        { kind: "op" },
      );
      expect(deck.modelSubstitutions).toEqual([]);
      expect(deck.netlist).toMatch(/D1 \S+ \S+ ACME_D1/);
      expect(deck.netlist).not.toMatch(/D1 \S+ \S+ TAU_DIODE/);
      exact += 1;
    }

    // Refuse semiconductor: named model missing → atomic refusal, no TAU_*.
    {
      expect(() => buildSpiceDeck({
        components: [component("diode", "D1", "XYZ999", 0, 0), component("ground", "", "", 16, 32)],
        wires: [],
      }, { kind: "op" })).toThrow(
        unresolvedModelMessage([{ ref: "D1", requested: "XYZ999", substituted: "TAU_DIODE" }]),
      );
      refuse += 1;
    }

    // Exact vendor op-amp: attached five-pin subckt → X instance, not B/E gain block.
    {
      const deck = buildSpiceDeck({
        components: [vendorOpamp("U1", "LT1001", "Opamps\\LT1001")],
        wires: [],
        netLabels: vendorNets,
        userModelLibraries: [".subckt LT1001 plus minus vplus vminus output\nE1 output 0 plus minus 10\n.ends LT1001"],
      }, { kind: "op" });
      expect(deck.modelSubstitutions).toEqual([]);
      expect(deck.unresolvedSubckts).toEqual([]);
      expect(deck.netlist).toMatch(/^XU1 inp inm vdd 0 out LT1001$/m);
      expect(deck.netlist).not.toMatch(/^[BE]_U1\b/m);
      exact += 1;
    }

    // Refuse vendor op-amp deck: missing model → no rail-clamped substitute.
    {
      expect(() => buildSpiceDeck({
        components: [vendorOpamp("U1", "LT1001", "Opamps\\LT1001")],
        wires: [],
        netLabels: vendorNets,
      }, { kind: "op" })).toThrow(/No approximate or partial circuit was run/);
      refuse += 1;
    }

    // Refuse every preview path including transient (the prior silent gap).
    {
      const schematic = {
        components: [vendorOpamp("U1", "LT1001", "Opamps\\LT1001")],
        wires: [] as SchematicWire[],
      };
      const op = runOperatingPoint(schematic);
      expect(op.ok).toBe(false);
      if (!op.ok) expect(op.message).toMatch(/will not substitute/i);
      refuse += 1;

      const tran = await runTransientAnalysis(schematic, { stopTime: 1e-3, steps: 8 });
      expect(tran.ok).toBe(false);
      if (!tran.ok) expect(tran.message).toMatch(/will not substitute/i);
      refuse += 1;
    }

    expect(silent).toBe(0);
    expect(exact).toBe(2);
    expect(refuse).toBe(4);
    // eslint-disable-next-line no-console
    console.log(`NAMED-DEVICE: exact=${exact} refuse=${refuse} silent=${silent}`);
  });
});
