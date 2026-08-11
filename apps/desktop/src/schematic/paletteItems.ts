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
}

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
    default:
      return [
        {
          id: entry.kind,
          kind: entry.kind,
          name: entry.name,
          hotkey: entry.hotkey,
          value: entry.defaultValue,
        },
      ];
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
      item.hotkey.toLowerCase() === q,
  );
}
