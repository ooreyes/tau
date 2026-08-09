import type { ComponentKind } from "./types";

/**
 * The full human name of every component kind - the one place that turns a
 * schematic enum into something a reader recognises.
 *
 * This exists because the same question was being answered in three different
 * voices. `catalog.ts` carries a PALETTE name, tuned to fit a narrow browse
 * column ("PMOS", "VCVS (E)", "Polarized Cap"); the telemetry dock carried its
 * own partial map and fell back to a capitalised enum for anything it had
 * forgotten; and the Properties panel printed the raw kind string beside it.
 * So one part could read "PMOS", "PMOS" and "pmos" on three surfaces of the
 * same app, and a kind added to the catalog silently leaked "Sevenseg" into the
 * dock.
 *
 * It is a total record on purpose: `Record<ComponentKind, string>` makes adding
 * a kind without naming it a type error rather than a fallback nobody notices.
 * The palette name stays separate and stays short - these names are written for
 * a titled group header ("P-channel MOSFET"), not for a 96px-wide rail.
 */
export const COMPONENT_DISPLAY_NAME: Record<ComponentKind, string> = {
  // Sources
  vsource: "DC source",
  isource: "Current source",
  // Tau's dedicated AC symbols carry amplitude + frequency and produce an
  // actual sinusoid in transient analysis, which is why they may be named for
  // their wave shape while the generic vsource/isource may not.
  vac: "Sine voltage source",
  iac: "Sine current source",
  vpulse: "Pulse voltage source",
  ground: "Ground",

  // Passives
  resistor: "Resistor",
  potentiometer: "Potentiometer",
  capacitor: "Capacitor",
  polarizedCapacitor: "Polarized capacitor",
  inductor: "Inductor",
  bulb: "Light bulb",

  // Semiconductors
  diode: "Diode",
  led: "LED",
  zener: "Zener diode",
  photodiode: "Photodiode",
  npn: "NPN bipolar transistor",
  pnp: "PNP bipolar transistor",
  nmos: "N-channel MOSFET",
  pmos: "P-channel MOSFET",
  njf: "N-channel JFET",
  pjf: "P-channel JFET",

  // Analog
  opamp: "Operational amplifier",
  comparator: "Comparator",
  vcvs: "Voltage-controlled voltage source",
  vccs: "Voltage-controlled current source",
  cccs: "Current-controlled current source",
  ccvs: "Current-controlled voltage source",
  bsource: "Behavioral source",
  modulator: "Voltage-controlled oscillator",
  subckt: "Subcircuit",

  // Digital
  logicConstant: "Logic constant",
  digitalGate: "Logic gate",
  srflop: "SR latch",
  dflop: "D flip-flop",
  tflop: "T flip-flop",
  jkflop: "JK flip-flop",
  counter: "4-bit counter",
  timer555: "555 timer",
  adc: "4-bit ADC",
  dac: "4-bit DAC",
  sevenSeg: "7-segment display",
  sampleHold: "Sample and hold",

  // Electromechanical
  switch: "Switch",
  pushButton: "Push button",
  spdt: "SPDT switch",
  relay: "Relay",
  motor: "DC motor",
  transformer: "Transformer",
  ctTransformer: "Center-tapped transformer",
  tline: "Transmission line",
};

/**
 * The full name of a kind, for a caller whose kind string is not statically
 * known to be a `ComponentKind` (a measurement row read back from a run).
 * Falls back to the raw string rather than to a capitalised guess: a name this
 * map has not been taught is a gap to fix here, not one to paper over.
 */
export function componentDisplayName(kind: string): string {
  return COMPONENT_DISPLAY_NAME[kind as ComponentKind] ?? kind;
}
