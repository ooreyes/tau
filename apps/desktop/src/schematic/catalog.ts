import type { ComponentKind } from "./types";

/** Metadata for a placeable component, used by the palette and placement. */
export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  section: CatalogSection;
  /** Single-key shortcut to start placing this component. */
  hotkey: string;
  /** Reference-designator prefix, e.g. "R" → R1, R2, ... */
  prefix: string;
  /** Default value applied on placement. */
  defaultValue: string;
  /** Unit hint shown in the palette. */
  unit: string;
}

/**
 * Palette section labels — EveryCircuit-like browse order.
 * Sources first (power), then Passives → Semiconductors → Analog → Digital →
 * Electromechanical. Do not derive order from CATALOG insertion
 * (a Digital entry mid-Sources used to hoist Digital above Semiconductors).
 */
export const PALETTE_SECTIONS = [
  "Sources",
  "Passives",
  "Semiconductors",
  "Analog",
  "Digital",
  "Electromechanical",
] as const;

export type CatalogSection = (typeof PALETTE_SECTIONS)[number];

export const CATALOG: CatalogEntry[] = [
  // ── Sources ──────────────────────────────────────────────────────────────
  { kind: "vsource",       section: "Sources",           name: "DC Voltage",      hotkey: "v", prefix: "V",   defaultValue: "5",     unit: "V" },
  { kind: "isource",       section: "Sources",           name: "DC Current",      hotkey: "i", prefix: "I",   defaultValue: "1m",    unit: "A" },
  // Literal AC source: places `vac` with amplitude + frequency (sine). Not a
  // DC source with small-signal AC stimulus toggled on — that stays on DC Voltage.
  { kind: "vac",           section: "Sources",           name: "AC Voltage",      hotkey: "a", prefix: "V",   defaultValue: "1 1k",  unit: "V Hz" },
  { kind: "iac",           section: "Sources",           name: "AC Current",      hotkey: "y", prefix: "I",   defaultValue: "1m 1k", unit: "A Hz" },
  // unit is "" (not "V"): the value is the 4-token PULSE spec (low high freq
  // duty), not a single voltage - Canvas.tsx's sourceValueLabel gives it a
  // bespoke "low→high @ freq" canvas label instead of suffixing one unit
  // onto the whole token string.
  { kind: "vpulse",        section: "Sources",           name: "Pulse Voltage",   hotkey: "k", prefix: "V",   defaultValue: "0 5 100k 0.5", unit: "" },
  { kind: "ground",        section: "Sources",           name: "Ground",          hotkey: "g", prefix: "GND", defaultValue: "",      unit: "" },

  // ── Passives ─────────────────────────────────────────────────────────────
  { kind: "resistor",      section: "Passives",          name: "Resistor",        hotkey: "r", prefix: "R",   defaultValue: "1k",    unit: "Ω" },
  { kind: "potentiometer", section: "Passives",          name: "Potentiometer",   hotkey: "h", prefix: "RV",  defaultValue: "10k",   unit: "Ω" },
  { kind: "capacitor",     section: "Passives",          name: "Capacitor",       hotkey: "c", prefix: "C",   defaultValue: "1µ",    unit: "F" },
  { kind: "polarizedCapacitor", section: "Passives",     name: "Polarized Cap",   hotkey: "",  prefix: "C",   defaultValue: "10µ",   unit: "F" },
  { kind: "inductor",      section: "Passives",          name: "Inductor",        hotkey: "l", prefix: "L",   defaultValue: "1m",    unit: "H" },
  // Filament as a plain resistor — power is I²R from the same path as any R.
  { kind: "bulb",          section: "Passives",          name: "Light Bulb",      hotkey: "",  prefix: "R",   defaultValue: "10",    unit: "Ω" },

  // ── Semiconductors ───────────────────────────────────────────────────────
  // The three junction defaults below are LOAD-BEARING, not decoration: a part
  // placed with one of them and no LTspice provenance simulates as the ideal
  // textbook device (`engine/idealModels.ts`) - the diode drops a fixed 0.7 V,
  // the LED 2.0 V, and the zener breaks down at the voltage its value spells.
  // So `5V1` is the zener's RATING, and changing it here changes the part a
  // student places; changing it to something that is not a voltage marking
  // (`zener`, a part number) drops the part back onto the real Shockley
  // starter. Naming a manufacturer part instead - here or from the Simulation
  // model dropdown - is the intended way to get real device behaviour.
  { kind: "diode",         section: "Semiconductors",    name: "Diode",           hotkey: "d", prefix: "D",   defaultValue: "D",     unit: "" },
  { kind: "led",           section: "Semiconductors",    name: "LED",             hotkey: "e", prefix: "D",   defaultValue: "LED",   unit: "" },
  { kind: "zener",         section: "Semiconductors",    name: "Zener",           hotkey: "z", prefix: "D",   defaultValue: "5V1",   unit: "" },
  { kind: "photodiode",    section: "Semiconductors",    name: "Photodiode",      hotkey: "",  prefix: "D",   defaultValue: "100u",  unit: "A" },
  { kind: "npn",           section: "Semiconductors",    name: "NPN",             hotkey: "q", prefix: "Q",   defaultValue: "NPN",   unit: "" },
  { kind: "pnp",           section: "Semiconductors",    name: "PNP",             hotkey: "b", prefix: "Q",   defaultValue: "PNP",   unit: "" },
  { kind: "nmos",          section: "Semiconductors",    name: "NMOS",            hotkey: "m", prefix: "M",   defaultValue: "NMOS W=10u L=1u",  unit: "" },
  { kind: "pmos",          section: "Semiconductors",    name: "PMOS",            hotkey: "p", prefix: "M",   defaultValue: "PMOS W=10u L=1u",  unit: "" },
  { kind: "njf",           section: "Semiconductors",    name: "N-JFET",          hotkey: "",  prefix: "J",   defaultValue: "NJF",   unit: "" },
  { kind: "pjf",           section: "Semiconductors",    name: "P-JFET",          hotkey: "",  prefix: "J",   defaultValue: "PJF",   unit: "" },

  // ── Analog ───────────────────────────────────────────────────────────────
  { kind: "opamp",         section: "Analog",            name: "Op Amp",          hotkey: "o", prefix: "U",   defaultValue: "ideal", unit: "" },
  // unit is "" (not "Vhi Vlo"): the value is the vhigh/vlow/vhyst spec, not a
  // single quantity - Canvas.tsx's sourceValueLabel gives it a bespoke
  // "1V/0V" canvas label instead of suffixing a two-word "unit" onto it.
  { kind: "comparator",    section: "Analog",            name: "Comparator",      hotkey: "",  prefix: "U",   defaultValue: "1 0",   unit: "" },
  { kind: "vcvs",          section: "Analog",            name: "VCVS (E)",        hotkey: "u", prefix: "E",   defaultValue: "10",    unit: "V/V" },
  { kind: "vccs",          section: "Analog",            name: "VCCS (G)",        hotkey: "w", prefix: "G",   defaultValue: "1m",    unit: "A/V" },
  { kind: "cccs",          section: "Analog",            name: "CCCS (F)",        hotkey: "f", prefix: "F",   defaultValue: "10",    unit: "A/A" },
  { kind: "ccvs",          section: "Analog",            name: "CCVS (H)",        hotkey: "n", prefix: "H",   defaultValue: "1k",    unit: "V/A" },
  { kind: "bsource",       section: "Analog",            name: "Behavioral (B)",  hotkey: "j", prefix: "B",   defaultValue: "V=1",   unit: "" },
  // Behavioral VCO (LTspice SpecialFunctions\modulate). mark=space keeps a
  // bare placement oscillating at 1kHz even with the FM input unwired (FM=0V
  // selects the `space` frequency; 1V selects `mark`).
  { kind: "modulator",     section: "Analog",            name: "Modulator (VCO)", hotkey: "",  prefix: "A",   defaultValue: "mark=1K space=1K", unit: "" },
  // Generic subcircuit instance (SPICE X device): the value's first token is
  // the .subckt name (bundled library or document-defined), the rest instance
  // params. Imported LTspice-library symbols (TowTom2, capmeter, ISO16750-2,
  // ISO7637-2) land on this kind with their own .asy pin geometry.
  { kind: "subckt",        section: "Analog",            name: "Subcircuit (X)",  hotkey: "",  prefix: "X",   defaultValue: "tau_passthrough", unit: "" },

  // ── Digital ──────────────────────────────────────────────────────────────
  { kind: "logicConstant", section: "Digital",           name: "Logic Constant",  hotkey: "",  prefix: "V",   defaultValue: "1",     unit: "V" },
  // LTspice-style idealized digital (behavioral levels, not a logic family).
  // The gate's value names its function: and/or/xor/buf/inv/schmtbuf/schmtinv.
  { kind: "digitalGate",   section: "Digital",           name: "Logic Gate",      hotkey: "",  prefix: "A",   defaultValue: "and",   unit: "" },
  // Async SR latch (LTspice Digital\srflop): S/R → XSPICE d_dff set/reset.
  // Catalog name stays "SR Latch" (Q/Q̅) — no fake gated-SR without an enable pin.
  { kind: "srflop",        section: "Digital",           name: "SR Latch",        hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  { kind: "dflop",         section: "Digital",           name: "D Flip-Flop",     hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  // Edge-triggered T / JK via XSPICE d_tff / d_jkff (EveryCircuit-style; no LTspice .asy).
  { kind: "tflop",         section: "Digital",           name: "T Flip-Flop",     hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  { kind: "jkflop",        section: "Digital",           name: "JK Flip-Flop",    hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  // EveryCircuit-style ICs (Tau-owned behavioral — not vendor macromodels).
  { kind: "counter",       section: "Digital",           name: "Counter (4-bit)", hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  { kind: "timer555",      section: "Digital",           name: "555 Timer",       hotkey: "",  prefix: "X",   defaultValue: "",      unit: "" },
  { kind: "adc",           section: "Digital",           name: "ADC (4-bit)",     hotkey: "",  prefix: "A",   defaultValue: "Vhigh=5", unit: "" },
  { kind: "dac",           section: "Digital",           name: "DAC (4-bit)",     hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },
  { kind: "sevenSeg",      section: "Digital",           name: "7-Segment",       hotkey: "",  prefix: "U",   defaultValue: "",      unit: "" },
  { kind: "sampleHold",    section: "Digital",           name: "Sample & Hold",   hotkey: "",  prefix: "A",   defaultValue: "",      unit: "" },

  // ── Electromechanical (switches → actuators → magnetics) ─────────────────
  { kind: "switch",        section: "Electromechanical", name: "Switch",          hotkey: "s", prefix: "S",   defaultValue: "open",  unit: "" },
  { kind: "pushButton",    section: "Electromechanical", name: "Push Button",     hotkey: "",  prefix: "S",   defaultValue: "open",  unit: "" },
  { kind: "spdt",          section: "Electromechanical", name: "SPDT",            hotkey: "",  prefix: "S",   defaultValue: "no",    unit: "" },
  // Coil R + voltage-controlled contact (TAU_SW). Value = coil ohms.
  { kind: "relay",         section: "Electromechanical", name: "Relay",           hotkey: "",  prefix: "K",   defaultValue: "100",   unit: "Ω" },
  // Armature series R+L only — no back-EMF / mechanical load.
  { kind: "motor",         section: "Electromechanical", name: "DC Motor",        hotkey: "",  prefix: "M",   defaultValue: "10 1m", unit: "Ω H" },
  { kind: "transformer",   section: "Electromechanical", name: "Transformer",     hotkey: "t", prefix: "T",   defaultValue: "1:1",   unit: "" },
  // Center-tapped secondary: primary L + two half-secondaries + multi-winding K.
  { kind: "ctTransformer", section: "Electromechanical", name: "CT Transformer",  hotkey: "",  prefix: "T",   defaultValue: "1:1",   unit: "" },
  // unit is "" (not "Ω s"): the value is a "Td=50n Z0=50" key=value spec that
  // already self-describes each token - LTspice shows it as raw text, and a
  // two-word "unit" suffixed onto the whole string was never meaningful.
  { kind: "tline",         section: "Electromechanical", name: "Transmission Line", hotkey: "", prefix: "T",   defaultValue: "Td=50n Z0=50", unit: "" },
];

export const CATALOG_BY_KIND: Record<ComponentKind, CatalogEntry> =
  Object.fromEntries(CATALOG.map((e) => [e.kind, e])) as Record<ComponentKind, CatalogEntry>;

/** Catalog entries belonging to one palette section, in browse order. */
export function catalogSectionEntries(section: CatalogSection): CatalogEntry[] {
  return CATALOG.filter((e) => e.section === section);
}
