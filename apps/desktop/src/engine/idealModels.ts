/**
 * Ideal (textbook) device models for the junction-diode family.
 *
 * ## Why this exists
 *
 * Tau's generic starters are *real* Shockley junctions: `.model TAU_DIODE
 * D(Is=1e-14 N=1)` drops 0.655 V at 1 mA, 0.714 V at 10 mA and 0.595 V at
 * 100 µA. A student who places a diode, measures it, and reads 0.655 V has been
 * given a correct answer to a question they did not ask. The textbook part they
 * dropped on the sheet drops **0.7 V**, full stop. Same story for the LED: the
 * deck's `TAU_LED` settles near 1.77 V at 10 mA while Tau's own preview solver
 * uses a spec tuned to 2.0 V, so the two engines disagreed about the same part.
 *
 * ## Ideal vs real is decided by PROVENANCE, not by a global switch
 *
 * A part **placed in Tau from the palette** is ideal. A part **read from an
 * LTspice `.asc`** keeps its real model, because that file already means
 * something specific and the 4012-file acceptance corpus baseline must stay
 * valid byte-for-byte.
 *
 * The signal is {@link hasLtspiceProvenance}: the LTspice importer stamps every
 * symbol it lands with at least one of `pinOverride` / `ltSymbolType` /
 * `ltModelName` / `ltModelFile` / `ltWindows` / `ltExtraAttrs` / `ltHierarchy`
 * (see `io/ascImport.ts`), and nothing in the editor's placement path sets any
 * of them. It is an absence test rather than a positive "placed" flag because
 * `SchematicComponent` has no such flag and inventing one would rewrite every
 * saved document; the absence is nonetheless exact, because each of those fields
 * exists *only* to carry something an `.asc` said.
 *
 * Two consequences worth knowing, both deliberate:
 *
 * - A part Tau placed, saved to **`.asc`**, and reopened comes back with
 *   `pinOverride`/`ltSymbolType` and is therefore **real**, not ideal. That is
 *   the stated rule applied consistently: once the circuit lives in an LTspice
 *   file it means what LTspice would make of it. Tau's own `.sim` format keeps
 *   the part bare, so a native save round-trips as ideal.
 * - Selecting a manufacturer part (`1N4148`, `1N750`, …) from the Simulation
 *   model dropdown, or a value the document's own `.model` defines, always wins:
 *   {@link idealJunctionModel} only claims values that name no part at all.
 *
 * ## How ideal is expressed
 *
 * As LTspice's own piecewise-linear diode syntax - `D(Ron= Roff= Vfwd= …)` -
 * which `userModelLibrary.translateIdealDiodeDeckLines` already rewrites into
 * ngspice's bundled `sidiode` code model. Emitting that spelling means the same
 * card is correct in *both* engines: ngspice gets `sidiode`, and the dual-deck
 * LTspice comparison path (`BuildSpiceDeckOptions.idealDiodeAsSidiode: false`)
 * gets a card LTspice reads natively as its own ideal diode.
 *
 * ## Where the ideal stops being ideal, stated rather than hidden
 *
 * A perfect switch is not solvable, so `Ron`/`Roff`/`epsilon` are finite. The
 * residual was measured on the real engine, not estimated:
 *
 * | current | modelled drop | ideal |
 * |---|---|---|
 * | 1 µA  | 0.7000014 V | 0.7 V |
 * | 1 mA  | 0.7000447 V | 0.7 V |
 * | 1 A   | 0.7010000 V | 0.7 V |
 *
 * i.e. ≤ 0.05 mV below 1 mA and ≤ 1 mV at 1 A (that last one is `Ron` × 1 A).
 * That is below the precision anything in Tau displays, so it is documented
 * here rather than reported as a substitution - unlike a model swap, nothing
 * about the answer is qualitatively different from the ideal one. Reverse
 * leakage is V/`Roff` (1 nA at 1 V) instead of zero, for the same reason
 * `TAU_SW` uses 1 GΩ rather than 1 TΩ: a wider on/off ratio is a documented
 * ngspice convergence hazard and 1 GΩ is already an open circuit.
 */

import type { SchematicComponent } from "../schematic/types";

/** Textbook forward drop of a silicon diode. */
export const IDEAL_DIODE_FORWARD_VOLTS = 0.7;
/** Textbook forward drop of an indicator LED (red/green, ~10 mA). */
export const IDEAL_LED_FORWARD_VOLTS = 2;
/** Fallback zener breakdown when the part names none - Tau's palette default. */
export const IDEAL_ZENER_BREAKDOWN_VOLTS = 5.1;

/** Conducting-contact resistance. Matches `TAU_SW`'s `Ron`, which is the number
 *  Tau has always used for an ideal closed contact. */
const IDEAL_ON_OHMS = "1m";
/** Blocking resistance. Matches `TAU_SW`'s `Roff` for the reason given there. */
const IDEAL_OFF_OHMS = "1G";
/** Width of `sidiode`'s quadratic corner. Nonzero so the conductance is
 *  continuous through the knee; small enough to cost ≤ 0.1 mV (measured). */
const IDEAL_EPSILON = "1m";

/**
 * `SchematicComponent` fields that exist only to carry something an LTspice
 * file said. Any one of them present means this part was read from an `.asc`,
 * never placed in Tau's editor. Kept as a list so a field added to the importer
 * later is a one-line change here rather than a silent hole.
 */
const LTSPICE_PROVENANCE_FIELDS = [
  "pinOverride",
  "ltSymbolType",
  "ltModelName",
  "ltModelFile",
  "ltWindows",
  "ltExtraAttrs",
  "ltHierarchy",
] as const satisfies ReadonlyArray<keyof SchematicComponent>;

/** True when this part came out of an LTspice `.asc` rather than Tau's palette.
 *  See the provenance section of this module's header for why absence is the
 *  test and why it is exact. */
export function hasLtspiceProvenance(component: SchematicComponent): boolean {
  return LTSPICE_PROVENANCE_FIELDS.some((field) => {
    const value = component[field];
    if (value === undefined || value === null) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });
}

/**
 * A voltage written the way component markings write it: `5V1` = 5.1 V,
 * `12V` = 12 V, `0V7` = 0.7 V, `6.3V` = 6.3 V. Deliberately strict - it must
 * NOT claim `1N4148`, `BZX84C15L`, `MMSD4148` or a bare number, because those
 * either name a real part or mean nothing, and reading a breakdown voltage out
 * of a part number is exactly the kind of confident guess Tau does not make.
 * Returns null for anything else.
 */
export function parseIdealVoltageCode(text: string): number | null {
  const trimmed = text.trim();
  const rNotation = /^(\d{1,3})V(\d{1,2})$/i.exec(trimmed);
  const decimal = /^(\d{1,3}(?:\.\d{1,2})?)V$/i.exec(trimmed);
  const volts = rNotation
    ? Number(`${rNotation[1]}.${rNotation[2]}`)
    : decimal ? Number(decimal[1]) : NaN;
  if (!Number.isFinite(volts) || volts <= 0 || volts > 400) return null;
  return volts;
}

/**
 * The inverse: 5.1 → `5V1`, 12 → `12V`, 0.7 → `0V7`. Used to name the emitted
 * `.model` after the behaviour it describes, so two zeners rated the same share
 * one card and a deck can be read without looking anything up.
 */
export function formatIdealVoltageCode(volts: number): string {
  const [whole, fraction = ""] = String(Math.round(volts * 1000) / 1000).split(".");
  return `${whole}V${fraction}`;
}

/** A number in a `.model` card: no exponent, no trailing zeros, no unit suffix
 *  that either engine could read as something else. */
function deckNumber(volts: number): string {
  return String(Math.round(volts * 1000) / 1000);
}

/** Values that name Tau's generic starter for a kind rather than a real part.
 *  These are the palette defaults (`schematic/catalog.ts`) plus the LTspice
 *  symbol leaf names the importer falls back to, so the same table answers for
 *  a part typed by hand and one Tau placed. */
const GENERIC_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  diode: new Set(["", "d", "diode"]),
  led: new Set(["", "led"]),
  zener: new Set(["", "zener"]),
};

export interface IdealJunctionModel {
  /** `.model` name the device line references. */
  readonly model: string;
  /** The whole `.model` card, in LTspice ideal-diode spelling. */
  readonly card: string;
  /** Forward drop this part is defined to have, in volts. */
  readonly forwardVolts: number;
  /** Reverse breakdown, for a zener; absent for diode and LED. */
  readonly breakdownVolts?: number;
}

/**
 * The ideal model for a junction part placed in Tau, or `null` when the real
 * path must be taken - which is every one of:
 *
 * - the part is not a diode / LED / zener;
 * - it carries LTspice provenance (see {@link hasLtspiceProvenance});
 * - its value names something: a manufacturer part, a document `.model`, an
 *   instance parameter, anything at all beyond the kind's generic token or a
 *   plain voltage marking.
 *
 * Callers must additionally give a document-defined `.model` of the same name
 * precedence; this function cannot see the document's model table.
 */
export function idealJunctionModel(component: SchematicComponent): IdealJunctionModel | null {
  const generic = GENERIC_VALUES[component.kind];
  if (!generic) return null;
  if (hasLtspiceProvenance(component)) return null;

  const value = component.value.trim();
  const coded = parseIdealVoltageCode(value);
  if (coded === null && !generic.has(value.toLowerCase())) return null;

  if (component.kind === "zener") {
    // A zener's marking is its BREAKDOWN, not its forward drop: `5V1` is a
    // 5.1 V zener that still drops ~0.7 V the other way round. Emitting Bv from
    // the part's own name is the whole point - the deck used to pin every
    // generic zener at 5.1 V no matter what the schematic said.
    const breakdownVolts = coded ?? IDEAL_ZENER_BREAKDOWN_VOLTS;
    const model = `TAU_ZENER_IDEAL_${formatIdealVoltageCode(breakdownVolts)}`;
    return {
      model,
      card: `.model ${model} D(Ron=${IDEAL_ON_OHMS} Roff=${IDEAL_OFF_OHMS}`
        + ` Vfwd=${deckNumber(IDEAL_DIODE_FORWARD_VOLTS)}`
        + ` Vrev=${deckNumber(breakdownVolts)} Rrev=${IDEAL_ON_OHMS}`
        + ` epsilon=${IDEAL_EPSILON} revepsilon=${IDEAL_EPSILON})`,
      forwardVolts: IDEAL_DIODE_FORWARD_VOLTS,
      breakdownVolts,
    };
  }

  const isLed = component.kind === "led";
  const forwardVolts = coded ?? (isLed ? IDEAL_LED_FORWARD_VOLTS : IDEAL_DIODE_FORWARD_VOLTS);
  const model = `TAU_${isLed ? "LED" : "DIODE"}_IDEAL_${formatIdealVoltageCode(forwardVolts)}`;
  return {
    model,
    card: `.model ${model} D(Ron=${IDEAL_ON_OHMS} Roff=${IDEAL_OFF_OHMS}`
      + ` Vfwd=${deckNumber(forwardVolts)} epsilon=${IDEAL_EPSILON})`,
    forwardVolts,
  };
}

/**
 * Prefix of the zero-volt ammeter Tau puts in series with an ideal junction.
 *
 * ngspice's `sidiode` is an XSPICE code model, so its instance is an `A` device
 * and it reports **no** current of its own - `@d1[id]` stops existing the moment
 * the diode becomes ideal. Every current readout in Tau (the probe, the
 * measurements table, wire flow) would silently go blank for exactly the parts
 * a beginner is most likely to place. A 0 V source in series is the standard
 * SPICE ammeter, costs one node, and gives back `I(D1)` with the right sign:
 * the source's `+` terminal faces the anode, so its branch current is positive
 * anode → cathode, the same convention `@d1[id]` used.
 */
export const IDEAL_SENSE_PREFIX = "V__TAU_ID_";

/** True for the ammeter above, matched on the emitted instance name. */
export function isIdealSenseSourceName(name: string): boolean {
  return name.toUpperCase().startsWith(IDEAL_SENSE_PREFIX);
}
