/**
 * EveryCircuit-style palette rows: one catalog kind may expand into several
 * placeable presets (AND/OR/NAND…, NO vs NC push-button) that share the same
 * ComponentKind but set a different initial `value`.
 */
import { CATALOG, catalogSectionEntries, type CatalogEntry, type CatalogSection } from "./catalog";
import type { ComponentKind } from "./types";

export interface PaletteItemSpec {
  /** Unique row id (React key / active matching). */
  id: string;
  kind: ComponentKind;
  name: string;
  hotkey: string;
  /** Override for `CATALOG.defaultValue` when placing; omit → catalog default. */
  value?: string;
  /** Optional short subtitle under the name. */
  desc?: string;
  /** Matched by {@link matchPaletteItems}, never rendered: see CatalogEntry. */
  searchTerms?: readonly string[];
}

/**
 * The hint a browse row carries when the catalog entry does not supply one.
 *
 * A palette row has three columns of information: the symbol, the name, and one
 * small phrase. The phrase is the only place a reader can find out which of two
 * near-identical rows they are about to place, or that a part is a teaching model
 * rather than the real device - so the rows that HAD one read as considered and
 * the rows without read as unfinished, which is what the review saw.
 *
 * The rules this table follows, in order:
 *
 * 1. **Say what the name leaves out.** "NPN" does not say bjt; "N-JFET" already
 *    says jfet, so it gets nothing. A part whose name is complete stays bare -
 *    a resistor does not need to be told it is a resistor, and filling every row
 *    for symmetry is how a column of hints becomes a column of noise.
 * 2. **Never claim electrical behaviour the engine does not have.** The bulb is
 *    a plain resistor (`spiceNetlist` emits an R), the motor is a series R+L with
 *    no back-EMF, the transmission line is the ideal lossless T device, the op amp
 *    places as `ideal`. Each hint says that, because a student who trusts "DC
 *    Motor" to include mechanical load is being misled by the name.
 * 3. **Fifteen characters.** The rail's hint column is one line and does not
 *    wrap (see `CatalogEntry.desc`); the long form belongs in the inspector.
 *
 * Keyed by kind, and applied only in the preset-less branch below: an entry that
 * spells its own `desc` in `catalog.ts` (the Sheet block) keeps it, and the
 * presets that already distinguish themselves (AND/NAND…, NO/NC) keep theirs.
 */
export const PALETTE_HINTS: Partial<Record<ComponentKind, string>> = {
  // Sources - which flavour of source this row actually places.
  vsource: "dc",
  isource: "dc",
  ground: "0 V reference",

  // Passives. Resistor, capacitor and inductor are named completely; a
  // "Polarized Cap" already says which of the two it is.
  potentiometer: "adjustable tap",
  bulb: "resistive load",

  // Semiconductors - the four junction rows differ only in what the junction is
  // for, and the transistor rows only in device family.
  diode: "rectifier",
  led: "emits light",
  zener: "reverse clamp",
  photodiode: "light current",
  npn: "bjt",
  pnp: "bjt",
  nmos: "mosfet",
  pmos: "mosfet",

  // Analog. The four controlled sources are the classic confusion in the whole
  // catalog: E/G/F/H say nothing, and VCVS/VCCS/CCCS/CCVS differ by one letter
  // in the middle. Spelling the transfer as in/out is the shortest form that
  // cannot be misread.
  opamp: "ideal",
  comparator: "hi/lo output",
  vcvs: "v in, v out",
  vccs: "v in, i out",
  cccs: "i in, i out",
  ccvs: "i in, v out",
  bsource: "expression",
  modulator: "v to frequency",

  // Digital. Four flip-flop rows whose names are single letters.
  logicConstant: "fixed level",
  srflop: "set/reset",
  dflop: "edge clocked",
  tflop: "toggle on edge",
  jkflop: "set/reset/flip",
  counter: "counts edges",
  adc: "analog to bits",
  dac: "bits to analog",
  sevenSeg: "led digit",
  sampleHold: "track and hold",

  // Electromechanical - pole/throw counts, and what each actuator models.
  switch: "one throw",
  spdt: "two throws",
  relay: "coil + contact",
  motor: "r + l armature",
  transformer: "two windings",
  ctTransformer: "center tapped",
  tline: "lossless delay",
};

/** Expand a catalog entry into one or more EveryCircuit-like browse rows. */
export function expandCatalogEntry(entry: CatalogEntry): PaletteItemSpec[] {
  switch (entry.kind) {
    case "digitalGate":
      return [
        { id: "gate-and", kind: "digitalGate", name: "AND", hotkey: "", value: "and", desc: "gate" },
        { id: "gate-or", kind: "digitalGate", name: "OR", hotkey: "", value: "or", desc: "gate" },
        { id: "gate-not", kind: "digitalGate", name: "NOT", hotkey: "", value: "not", desc: "inverter" },
        { id: "gate-nand", kind: "digitalGate", name: "NAND", hotkey: "", value: "nand", desc: "gate" },
        { id: "gate-nor", kind: "digitalGate", name: "NOR", hotkey: "", value: "nor", desc: "gate" },
        { id: "gate-xor", kind: "digitalGate", name: "XOR", hotkey: "", value: "xor", desc: "gate" },
        { id: "gate-xnor", kind: "digitalGate", name: "XNOR", hotkey: "", value: "xnor", desc: "gate" },
      ];
    case "pushButton":
      return [
        { id: "push-no", kind: "pushButton", name: "Push Button NO", hotkey: "", value: "open", desc: "normally open" },
        { id: "push-nc", kind: "pushButton", name: "Push Button NC", hotkey: "", value: "closed", desc: "normally closed" },
      ];
    case "vpulse":
      // EveryCircuit "Logic sources" clock — keep pulse voltage but label closer.
      return [
        { id: "vpulse", kind: "vpulse", name: "Clock / Pulse", hotkey: entry.hotkey, value: entry.defaultValue, desc: "square" },
      ];
    default: {
      // A kind with no presets is one row, and it keeps the catalog's own
      // subtitle and search words. Dropping them here is why a part could not
      // explain itself in the rail without inventing a second case below.
      // The catalog's own `desc` wins over PALETTE_HINTS: an entry that spells
      // its subtitle beside the part is the more specific statement of the two.
      const desc = entry.desc ?? PALETTE_HINTS[entry.kind];
      return [
        {
          id: entry.kind,
          kind: entry.kind,
          name: entry.name,
          hotkey: entry.hotkey,
          value: entry.defaultValue,
          ...(desc ? { desc } : {}),
          ...(entry.searchTerms ? { searchTerms: entry.searchTerms } : {}),
        },
      ];
    }
  }
}

export function paletteItemsForSection(section: CatalogSection): PaletteItemSpec[] {
  return catalogSectionEntries(section).flatMap(expandCatalogEntry);
}

/** Flat list for search; includes preset names (AND, NAND, …). */
export function allPaletteItems(): PaletteItemSpec[] {
  return CATALOG.filter((entry) => entry.paletteVisible !== false).flatMap(expandCatalogEntry);
}

export function matchPaletteItems(query: string): PaletteItemSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return allPaletteItems();
  return allPaletteItems().filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.kind.toLowerCase().includes(q) ||
      (item.desc?.toLowerCase().includes(q) ?? false) ||
      (item.value?.toLowerCase().includes(q) ?? false) ||
      // "subcircuit" has to keep finding the Sheet block row: the name is the
      // act now, and `kind` only spells the abbreviated "subckt".
      (item.searchTerms?.some((term) => term.toLowerCase().includes(q)) ?? false) ||
      item.hotkey.toLowerCase() === q,
  );
}
