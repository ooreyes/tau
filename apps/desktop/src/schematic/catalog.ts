import type { ComponentKind } from "./types";

/** Metadata for a placeable component, used by the palette and placement. */
export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  /** Single-key shortcut to start placing this component. */
  hotkey: string;
  /** Reference-designator prefix, e.g. "R" → R1, R2, ... */
  prefix: string;
  /** Default value applied on placement. */
  defaultValue: string;
  /** Unit hint shown in the palette. */
  unit: string;
}

export const CATALOG: CatalogEntry[] = [
  { kind: "resistor",  name: "Resistor",       hotkey: "r", prefix: "R",   defaultValue: "1k", unit: "Ω" },
  { kind: "capacitor", name: "Capacitor",      hotkey: "c", prefix: "C",   defaultValue: "1µ", unit: "F" },
  { kind: "inductor",  name: "Inductor",       hotkey: "l", prefix: "L",   defaultValue: "1m", unit: "H" },
  { kind: "vsource",   name: "Voltage Source", hotkey: "v", prefix: "V",   defaultValue: "5",  unit: "V" },
  { kind: "ground",    name: "Ground",         hotkey: "g", prefix: "GND", defaultValue: "",   unit: ""  },
];

export const CATALOG_BY_KIND: Record<ComponentKind, CatalogEntry> =
  Object.fromEntries(CATALOG.map((e) => [e.kind, e])) as Record<ComponentKind, CatalogEntry>;
