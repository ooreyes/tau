import type { ComponentKind } from "./types";

/** Metadata for a placeable component, used by the palette and placement. */
export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  section: "Passives" | "Sources" | "Semiconductors" | "Analog" | "Electromechanical" | "Markers";
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
  { kind: "resistor",      section: "Passives",          name: "Resistor",        hotkey: "r", prefix: "R",   defaultValue: "1k",    unit: "Ω" },
  { kind: "capacitor",     section: "Passives",          name: "Capacitor",       hotkey: "c", prefix: "C",   defaultValue: "1µ",    unit: "F" },
  { kind: "inductor",      section: "Passives",          name: "Inductor",        hotkey: "l", prefix: "L",   defaultValue: "1m",    unit: "H" },
  { kind: "potentiometer", section: "Passives",          name: "Potentiometer",   hotkey: "h", prefix: "RV",  defaultValue: "10k",   unit: "Ω" },

  { kind: "vsource",       section: "Sources",           name: "DC Voltage",      hotkey: "v", prefix: "V",   defaultValue: "5",     unit: "V" },
  { kind: "isource",       section: "Sources",           name: "DC Current",      hotkey: "i", prefix: "I",   defaultValue: "1m",    unit: "A" },
  { kind: "vac",           section: "Sources",           name: "AC Voltage",      hotkey: "a", prefix: "V",   defaultValue: "1 1k",  unit: "V Hz" },
  { kind: "iac",           section: "Sources",           name: "AC Current",      hotkey: "y", prefix: "I",   defaultValue: "1m 1k", unit: "A Hz" },
  { kind: "vpulse",        section: "Sources",           name: "Pulse Voltage",   hotkey: "k", prefix: "V",   defaultValue: "0 5 100k 0.5", unit: "V" },
  { kind: "ground",        section: "Sources",           name: "Ground",          hotkey: "g", prefix: "GND", defaultValue: "",      unit: "" },

  { kind: "diode",         section: "Semiconductors",    name: "Diode",           hotkey: "d", prefix: "D",   defaultValue: "D",     unit: "" },
  { kind: "led",           section: "Semiconductors",    name: "LED",             hotkey: "e", prefix: "D",   defaultValue: "LED",   unit: "" },
  { kind: "zener",         section: "Semiconductors",    name: "Zener",           hotkey: "z", prefix: "D",   defaultValue: "5V1",   unit: "" },
  { kind: "nmos",          section: "Semiconductors",    name: "NMOS",            hotkey: "m", prefix: "M",   defaultValue: "NMOS",  unit: "" },
  { kind: "pmos",          section: "Semiconductors",    name: "PMOS",            hotkey: "p", prefix: "M",   defaultValue: "PMOS",  unit: "" },
  { kind: "npn",           section: "Semiconductors",    name: "NPN",             hotkey: "q", prefix: "Q",   defaultValue: "NPN",   unit: "" },
  { kind: "pnp",           section: "Semiconductors",    name: "PNP",             hotkey: "b", prefix: "Q",   defaultValue: "PNP",   unit: "" },

  { kind: "opamp",         section: "Analog",            name: "Op Amp",          hotkey: "o", prefix: "U",   defaultValue: "ideal", unit: "" },
  { kind: "switch",        section: "Electromechanical", name: "Switch",          hotkey: "s", prefix: "S",   defaultValue: "open",  unit: "" },
  { kind: "transformer",   section: "Electromechanical", name: "Transformer",     hotkey: "t", prefix: "T",   defaultValue: "1:1",   unit: "" },
  { kind: "testpoint",     section: "Markers",           name: "Test Point",      hotkey: "x", prefix: "TP",  defaultValue: "",      unit: "" },
];

export const CATALOG_BY_KIND: Record<ComponentKind, CatalogEntry> =
  Object.fromEntries(CATALOG.map((e) => [e.kind, e])) as Record<ComponentKind, CatalogEntry>;
