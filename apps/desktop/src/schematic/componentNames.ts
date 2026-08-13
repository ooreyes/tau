import {
  decodeIndependentSourceValue,
  type IndependentSourceLegacyKind,
  type IndependentSourceMode,
} from "./sourceValue";
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
  led: "Generic LED",
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
  switch: "SPST switch",
  pushButton: "Push button",
  spdt: "SPDT switch",
  relay: "Relay",
  motor: "DC motor",
  transformer: "Transformer",
  ctTransformer: "Center-tapped transformer",
  tline: "Transmission line",
};

/**
 * An independent source's identity is its WAVEFORM, and the waveform lives in
 * `component.value`, not in `component.kind`.
 *
 * PDF-3 item 1: the inspector titled a part "DC source" while its own Waveform
 * selector said Sine and its canvas caption said `Sine · 1 V @ 1k Hz`. The
 * drawing and the identity disagreed, and the reader was told the part was
 * something it demonstrably was not.
 *
 * The obvious fix — rewrite `component.kind` on a waveform switch — is the one
 * that cannot be made safe, and it is worth writing down why so nobody spends
 * the afternoon rediscovering it:
 *
 *   - `vac` / `iac` / `vpulse` are STORAGE ALIASES with their own positional
 *     value dialect (`params.ts`'s `AC_SOURCE` codec). A `vac` holding
 *     `PULSE(0 5 0 1n 1n 5u 10u)` decodes to `{offset: "PULSE(0", amplitude:
 *     "5", frequency: "0"}` — measured — and that garbage is what `ascExport`,
 *     `Canvas.geometry` and `acSweep` read.
 *   - They emit a DIFFERENT netlist card: a compact `vac` carries an IMPLICIT
 *     `AC <amplitude>`, so `vsource -> vac` would silently add an `.ac`
 *     stimulus. The report's own decision says this is not a netlist change.
 *   - They are `TAU_CARRIER_KINDS`, so a converted part saves as a stand-in
 *     symbol with a `TauKind` attribute instead of a clean `voltage` symbol.
 *   - There is no `vexp` / `vpwl` / `vsffm` / `ipulse` kind at all; three of
 *     the six waveforms have no kind to convert TO.
 *   - It could never fix an IMPORTED document, which is where the reported
 *     screenshot came from: an LTspice `vsource` holding `SINE(...)` must not
 *     be mutated on load, and it would still title itself "DC source".
 *
 * So the identity is DERIVED from (kind, value) here, which fixes imported and
 * authored parts alike and cannot desynchronise from the drawing. The one kind
 * rewrite that IS lossless — alias to canonical, once the alias's compact
 * dialect has already been left behind — lives in `useSchematic`'s
 * `setSourceIdentity`.
 *
 * The mode words are the Waveform dropdown's own
 * (`IndependentSourceEditor.tsx`'s `WAVEFORM_MODES`), because a reader who has
 * just picked "Piecewise linear" must not then be told they own a
 * "Piecewise-linear" or a "PWL" part. One name per thing, on every surface.
 */
const SOURCE_KIND_UNIT: Partial<Record<ComponentKind, "voltage" | "current">> = {
  vsource: "voltage",
  vac: "voltage",
  vpulse: "voltage",
  isource: "current",
  iac: "current",
};

/** The alias kinds whose value must be decoded in their positional dialect. */
const LEGACY_SOURCE_KIND: Partial<Record<ComponentKind, IndependentSourceLegacyKind>> = {
  vac: "vac",
  iac: "iac",
  vpulse: "vpulse",
};

const WAVEFORM_SOURCE_NAME: Record<IndependentSourceMode, Record<"voltage" | "current", string>> = {
  // `dc` deliberately answers with the base map's own strings, so a one-argument
  // call and a DC-valued two-argument call can never drift apart.
  dc: { voltage: COMPONENT_DISPLAY_NAME.vsource, current: COMPONENT_DISPLAY_NAME.isource },
  sine: { voltage: COMPONENT_DISPLAY_NAME.vac, current: COMPONENT_DISPLAY_NAME.iac },
  pulse: { voltage: COMPONENT_DISPLAY_NAME.vpulse, current: "Pulse current source" },
  pwl: { voltage: "Piecewise linear voltage source", current: "Piecewise linear current source" },
  exp: { voltage: "Exponential voltage source", current: "Exponential current source" },
  sffm: {
    voltage: "Single-frequency FM voltage source",
    current: "Single-frequency FM current source",
  },
};

/**
 * The full name of a kind, for a caller whose kind string is not statically
 * known to be a `ComponentKind` (a measurement row read back from a run).
 * Falls back to the raw string rather than to a capitalised guess: a name this
 * map has not been taught is a gap to fix here, not one to paper over.
 *
 * Pass `value` wherever the caller has the whole component. For an independent
 * source that is what turns "DC source" into "Sine voltage source"; for every
 * other kind it is ignored, so passing it is always safe.
 */
export function componentDisplayName(kind: string, value?: string): string {
  const unit = SOURCE_KIND_UNIT[kind as ComponentKind];
  if (unit !== undefined && value !== undefined) {
    const decoded = decodeIndependentSourceValue(
      value,
      unit === "voltage" ? "V" : "A",
      LEGACY_SOURCE_KIND[kind as ComponentKind],
    );
    return WAVEFORM_SOURCE_NAME[decoded.mode][unit];
  }
  return COMPONENT_DISPLAY_NAME[kind as ComponentKind] ?? kind;
}
