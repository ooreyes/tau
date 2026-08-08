/**
 * LTspice `.asc` schematic EXPORTER - the inverse of `ascImport.ts`.
 *
 * Two layers:
 *  - `serializeAscDocument(doc)` - a lossless text serializer that is the inverse
 *    of `parseAsc` for the structures the parser understands. The round-trip
 *    `parseAsc(serializeAscDocument(doc)) ≅ doc` holds for any document built from
 *    VERSION/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/TEXT/shape content (i.e. no `unknown`
 *    lines, which by definition cannot be re-serialized).
 *  - `schematicToAsc({components, wires, netLabels, directives, comments})` -
 *    builds an `AscDocument` from Tau schematic content and serializes it, so a
 *    schematic edited in Tau can be written back as a `.asc` and reopened in
 *    LTspice. Round-trips through Tau's own importer: `importAsc(text) →
 *    schematicToAsc(result) → importAsc(text2)` yields the same components, wires,
 *    and nets (LTspice parity).
 */
import type {
  ComponentKind,
  NetLabel,
  SchematicAscDataFlag,
  SchematicAscShape,
  SchematicComponent,
  SchematicForeignSymbol,
  SchematicHierarchicalBlock,
  LtspiceExtraAttrs,
  SchematicSheet,
  SchematicTextAnnotation,
  SchematicWire,
} from "../schematic/types";
import {
  hierarchyComponentFingerprint,
  hierarchyNetLabelFingerprint,
  hierarchyWireFingerprint,
} from "../schematic/hierarchyProvenance";
import type { AscDocument, AscOrientation } from "./ascImport";
import {
  encodeCarriedAttrs,
  encodeTauPins,
  hasBankedLtPins,
  ltspiceTypeToKind,
  TAU_CARRIED_ATTRS_FIELD,
  TAU_PINS_FIELD,
} from "./ascImport";
import { decodeParams } from "../schematic/params";
import { withoutGateInputCount } from "../engine/digitalGateSpec";
import { parseQuantity } from "../simulation/quantity";

const int = (n: number): string => String(Math.round(n));

/** LTspice writes symbol paths with doubled backslashes; compare on a single
 *  normalized form so `Opamps\\AD823` and `opamps/AD823` are the same symbol. */
const normalizeLtType = (type: string): string => type.replace(/\\+/g, "/").toLowerCase();

const FOLDED_VALUE_FIELDS = ["Value2", "SpiceLine", "SpiceLine2"] as const;

interface ReconciledLtspiceAttrs {
  baseValue: string;
  extras: Record<string, string>;
}

/**
 * Put a safe edit to Tau's joined value back into the one LTspice attribute
 * slot that owns the changed text.
 *
 * LTspice concatenates Value/Value2/SpiceLine/SpiceLine2 for sources, op-amps,
 * and A-devices, while Tau exposes that electrical line as one editable value.
 * The original split is already structured in `LtspiceExtraAttrs`; a minimal
 * prefix/suffix diff tells us whether an edit stayed wholly inside exactly one
 * source slot. When it crosses a slot boundary (or Tau's derived value was a
 * filtered projection such as capacitor Rser metadata), returning null keeps
 * the existing explicit save refusal instead of guessing.
 */
function reconcileFoldedLtspiceValue(
  provenance: LtspiceExtraAttrs,
  nextValue: string,
): ReconciledLtspiceAttrs | null {
  const rawBase = provenance.baseValue.trim();
  const base = /^["']*$/.test(rawBase) ? "" : rawBase;
  const slots: Array<{ field: "Value" | typeof FOLDED_VALUE_FIELDS[number]; text: string; start: number; end: number }> = [];
  const addSlot = (field: "Value" | typeof FOLDED_VALUE_FIELDS[number], text: string) => {
    if (!text) return;
    const start = slots.length === 0 ? 0 : slots[slots.length - 1].end + 1;
    slots.push({ field, text, start, end: start + text.length });
  };
  addSlot("Value", base);
  for (const field of FOLDED_VALUE_FIELDS) addSlot(field, provenance.extras[field]?.trim() ?? "");

  // Only a literal whole-slot concatenation is reversible. Filtered/derived
  // projections deliberately remain conservative.
  if (slots.map((slot) => slot.text).join(" ") !== provenance.derivedValue) return null;
  if (nextValue === provenance.derivedValue) {
    return { baseValue: provenance.baseValue, extras: { ...provenance.extras } };
  }

  let prefix = 0;
  while (
    prefix < provenance.derivedValue.length
    && prefix < nextValue.length
    && provenance.derivedValue[prefix] === nextValue[prefix]
  ) prefix += 1;
  let suffix = 0;
  while (
    suffix < provenance.derivedValue.length - prefix
    && suffix < nextValue.length - prefix
    && provenance.derivedValue[provenance.derivedValue.length - 1 - suffix]
      === nextValue[nextValue.length - 1 - suffix]
  ) suffix += 1;

  const oldEnd = provenance.derivedValue.length - suffix;
  const replacement = nextValue.slice(prefix, nextValue.length - suffix);
  const owners = slots.filter((slot) => prefix >= slot.start && oldEnd <= slot.end);
  if (owners.length !== 1) return null;
  const owner = owners[0];
  const updatedText = owner.text.slice(0, prefix - owner.start)
    + replacement
    + owner.text.slice(oldEnd - owner.start);
  const extras = { ...provenance.extras };
  let baseValue = provenance.baseValue;
  if (owner.field === "Value") baseValue = updatedText;
  else if (updatedText) extras[owner.field] = updatedText;
  else delete extras[owner.field];

  const normalizedBase = /^["']*$/.test(baseValue.trim()) ? "" : baseValue.trim();
  const reconstructed = [
    normalizedBase,
    ...FOLDED_VALUE_FIELDS.map((field) => extras[field]?.trim() ?? ""),
  ].filter(Boolean).join(" ");
  if (reconstructed !== nextValue) return null;
  return { baseValue, extras };
}

/**
 * Serialize an {@link AscDocument} to LTspice `.asc` text. Inverse of `parseAsc`.
 * Lines are emitted in LTspice's canonical order (header, wires, flags, symbols
 * with their attributes, free text, shapes). `unknown` lines are dropped - they
 * had no structured representation to begin with.
 */
export function serializeAscDocument(doc: AscDocument): string {
  const lines: string[] = [];
  lines.push(`Version ${int(doc.version)}`);
  lines.push(`SHEET ${int(doc.sheet.index)} ${int(doc.sheet.width)} ${int(doc.sheet.height)}`);

  for (const w of doc.wires) {
    lines.push(`WIRE ${int(w.x1)} ${int(w.y1)} ${int(w.x2)} ${int(w.y2)}`);
  }
  for (const f of doc.flags) {
    lines.push(`FLAG ${int(f.x)} ${int(f.y)} ${f.net}`);
    // LTspice writes a hierarchy port directly after the FLAG it decorates, and
    // reads the pair back by coordinate. Emitting it anywhere else would orphan
    // the port.
    if (f.port) lines.push(`IOPIN ${int(f.x)} ${int(f.y)} ${f.port}`);
  }
  // LTspice writes its readouts after the flags and before the symbols. The
  // expression is the verbatim tail of the source record, quotes included, so
  // it goes back out exactly as it came in; an empty one leaves no trailing
  // space to re-parse.
  for (const d of doc.dataFlags) {
    lines.push(`DATAFLAG ${int(d.x)} ${int(d.y)} ${d.expr}`.trimEnd());
  }
  for (const s of doc.symbols) {
    lines.push(`SYMBOL ${s.type} ${int(s.x)} ${int(s.y)} ${s.orientation}`);
    // LTspice's order is SYMBOL, then WINDOW placements, then SYMATTR values.
    for (const w of s.windows ?? []) {
      lines.push(`WINDOW ${int(w.attr)} ${int(w.x)} ${int(w.y)} ${w.justification} ${int(w.size)}`);
    }
    for (const [name, value] of Object.entries(s.attrs)) {
      lines.push(`SYMATTR ${name} ${value}`);
    }
  }
  for (const t of doc.texts) {
    // Parser reads the payload from token index 5; emit canonical align/size
    // placeholders (Left 2) so it parses back identically.
    const marker = t.directive ? "!" : ";";
    lines.push(`TEXT ${int(t.x)} ${int(t.y)} Left 2 ${marker}${t.text}`);
  }
  for (const shape of doc.shapes) {
    lines.push(`${shape.kind} ${shape.width} ${shape.coords.map(int).join(" ")}`.trimEnd());
  }

  return lines.join("\n") + "\n";
}

/**
 * Map a Tau component kind back to the LTspice symbol type that
 * `ltspiceTypeToKind` recognizes, choosing the variant whose pin geometry is
 * banked in `LTSPICE_PINS` so a re-import reconstructs the same `pinOverride`.
 * Returns `null` for kinds with no LTspice symbol of their own (`ground` is a
 * FLAG).
 */
export function kindToLtspiceType(kind: ComponentKind): string | null {
  const map: Partial<Record<ComponentKind, string>> = {
    resistor: "res",
    capacitor: "cap",
    polarizedCapacitor: "polcap",
    inductor: "ind",
    vsource: "voltage",
    isource: "current",
    vac: "voltage",
    iac: "current",
    vpulse: "voltage",
    logicConstant: "voltage",
    diode: "diode",
    zener: "zener",
    led: "led",
    photodiode: "diode",
    bulb: "res",
    npn: "npn",
    pnp: "pnp",
    // Tau exposes an explicit bulk terminal, so use LTspice's four-pin symbols;
    // the three-pin variants would silently tie bulk to source on re-import.
    nmos: "nmos4",
    pmos: "pmos4",
    njf: "njf",
    pjf: "pjf",
    tline: "tline",
    potentiometer: "pot",
    transformer: "ind2t",
    // Bare `opamp` is LTspice's X-prefix subcircuit symbol and re-imports as a
    // generic subckt. `opamp2` is the native five-pin op-amp symbol Tau can
    // bank and round-trip as an opamp without changing its electrical role.
    opamp: "opamp2",
    // LTspice writes doubled backslashes in .asc SYMBOL paths (see the corpus
    // files); the importer's separator normalization accepts either form.
    sampleHold: "SpecialFunctions\\\\sample",
    modulator: "SpecialFunctions\\\\modulate",
    dflop: "Digital\\\\dflop",
    srflop: "Digital\\\\srflop",
    bsource: "bv",
    vcvs: "e",
    vccs: "g",
    // Do not map Tau's static two-terminal switch to LTspice sw: sw has two
    // additional voltage-control pins and different semantics. Likewise, do
    // not map Tau's four-terminal CCCS/CCVS to LTspice f/h. The installed
    // LTspice symbols expose only the two output pins; their controlling
    // current is named by a separate zero-volt source, so a single-symbol
    // export would drop Tau's cp/cn branch. Potentiometers and transformers are
    // composite circuits in LTspice (two resistors; coupled L parts + K text),
    // not lossless single-symbol mappings either. These kinds return null until
    // the exporter can expand and re-collapse faithful composite circuits.
  };
  return map[kind] ?? null;
}

/** Digital gate symbol leafs Tau can import with an exact, role-aware pin bank.
 * The leaf is part of the component's value rather than its kind, so this
 * mapping must run with the whole component instead of `kindToLtspiceType`.
 * Keep the aliases distinct: `inv` exposes qbar while `buf1` exposes q, and
 * collapsing either to their shared behavioral function would change pins. */
const DIGITAL_GATE_LEAFS = new Set([
  "and", "or", "xor", "buf", "buf1", "inv", "schmitt", "schmtbuf", "schmtinv",
]);

/** LTspice symbol leafs whose imported form is NOT a faithful re-emission
 * target even though their pin geometry is banked: the bank drops real .asy
 * pins (npn4/pnp4 substrate - wires to those pins would silently detach), or
 * the importer replaced the source Value with a transformed simulation
 * carrier (varistor/diac). These stay on the blocked-save path.
 *
 * `sw` and `csw` are NOT among them: sw.asy's four pins match a/b/cp/cn,
 * while csw.asy's two pins are banked exactly as a/b and its named current
 * control remains in SpiceModel. */
const VERBATIM_UNSAFE_LEAFS = new Set(["npn4", "pnp4", "varistor", "diac"]);


/**
 * Whether an imported LTspice symbol name can be re-emitted verbatim by the
 * exporter with full fidelity: re-importing the emitted SYMBOL line must yield
 * the same kind, the same banked pin positions, and the same value. Kinds
 * whose imported value is derived from more than the Value attribute
 * (digitalGate prepends the symbol leaf, subckt rebuilds an instance spec)
 * are excluded - their values would double-transform on re-import - as are the
 * path-encoded A-device kinds, whose canonical emission already reproduces the
 * source symbol exactly.
 */
export function canEmitLtSymbolVerbatim(type: string, kind: ComponentKind): boolean {
  const leaf = type.replace(/\\/g, "/").toLowerCase().split("/").pop() ?? "";
  if (VERBATIM_UNSAFE_LEAFS.has(leaf)) return false;
  if (["digitalGate", "subckt", "dflop", "srflop", "tflop", "jkflop", "counter", "timer555", "adc", "dac", "sevenSeg", "sampleHold", "modulator"].includes(kind)) return false;
  return ltspiceTypeToKind(type) === kind && hasBankedLtPins(type);
}

interface LtspiceComponentSymbol {
  type: string;
  value: string;
  /** Tau-only round-trip metadata for a native part without a faithful
   * one-symbol LTspice equivalent. LTspice ignores unknown SYMATTR fields. */
  tauKind?: ComponentKind;
  tauValue?: string;
  carrierPrefix?: string;
}

/**
 * Kinds with no faithful single LTspice symbol - they expand to several
 * ngspice devices. They are persisted as a high-Z (or near-zero) carrier
 * resistor plus `Tau*` metadata, so Tau restores them exactly and LTspice can
 * still open the file. LTspice itself sees only the resistor, which is why
 * every one of these has to be reported on export.
 */
/** Stable phrase identifying a lossy-carrier notice. Callers that only care
 *  about save-BLOCKING problems (round-trip tests, the save guard) filter on
 *  {@link isLossyCarrierWarning} rather than matching prose that may be
 *  reworded. */
export const LOSSY_CARRIER_MARKER = "saved as a placeholder resistor";

/** True for an informational lossy-carrier notice: the part still round-trips
 *  through Tau, it just does not survive into LTspice as itself. */
export function isLossyCarrierWarning(warning: string): boolean {
  return warning.includes(LOSSY_CARRIER_MARKER);
}

export const LOSSY_CARRIER_KINDS: ReadonlySet<string> = new Set([
  "comparator", "cccs", "ccvs", "switch", "pushButton", "spdt", "relay", "motor",
  // T/JK / EveryCircuit ICs are Tau-native — no faithful single LTspice .asy.
  "tflop", "jkflop", "counter", "timer555", "adc", "dac", "sevenSeg",
  // CT transformer expands to 3×L + K; no single LTspice 5-pin CT symbol.
  "ctTransformer",
  "subckt",
]);

/**
 * Kinds {@link componentToLtspiceSymbol} writes under a carrier symbol - one
 * that stands in for the part and records its real identity in `TauKind`. That
 * is also the only place a part's extended slots can be parked when they cannot
 * go back under their own names, so the save guard reads the same set.
 *
 * Kept in step with the carrier branches below by a test that exports one part
 * of every kind in this set and requires a `TauKind` on each.
 */
export const TAU_CARRIER_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  "vac", "iac", "vpulse", "potentiometer", "transformer", "bulb",
  ...(LOSSY_CARRIER_KINDS as ReadonlySet<ComponentKind>),
]);

/**
 * True for a switch left on Tau's static open/closed state instead of naming a
 * `.model`. LTspice's `sw` is only a switch because its Value names one, so a
 * part on a static state is no longer that symbol however it was imported and
 * belongs under the carrier - which is what the state means to a netlist too.
 *
 * An empty value is deliberately not a static state here: an imported `sw` with
 * no `Value` attribute (LTspice writes several) has to go back out as a
 * valueless `sw`, which reproduces the source record exactly. A switch placed
 * in Tau carries no `pinOverride`, so it never reaches the verbatim path.
 */
function isStaticStateSwitch(component: SchematicComponent): boolean {
  if (component.kind !== "switch") return false;
  const state = component.value.trim().toLowerCase();
  return state.startsWith("open") || state.startsWith("closed");
}

function componentToLtspiceSymbol(component: SchematicComponent): LtspiceComponentSymbol | null {
  if (
    component.ltSymbolType &&
    component.pinOverride?.length &&
    canEmitLtSymbolVerbatim(component.ltSymbolType, component.kind) &&
    !isStaticStateSwitch(component)
  ) {
    // An imported part keeps its original LTspice symbol: the banked geometry
    // regenerates the same pinOverride on re-import, and LTspice reopens the
    // file with the exact symbol it wrote (a 3-pin `nmos` stays 3-pin instead
    // of being rewritten to `nmos4` with a relocated bulk pin; a vendor op-amp
    // keeps its library identity instead of collapsing to `opamp2`).
    return { type: component.ltSymbolType, value: component.value };
  }
  if (component.kind === "vac" || component.kind === "iac") {
    const signal = decodeParams(component.kind, component.value);
    const offset = signal.offset || "0";
    const amplitude = signal.amplitude || "1";
    const frequency = signal.frequency || "1k";
    return {
      type: component.kind === "vac" ? "voltage" : "current",
      // `voltage.asy` / `current.asy` are LTspice's canonical independent
      // sources. Keeping both the transient SIN and small-signal AC stimulus
      // in Value makes a Tau Library source immediately runnable in LTspice
      // and prevents it from ever entering the lossy-save warning path.
      value: `SINE(${offset} ${amplitude} ${frequency}) AC ${amplitude}`,
      tauKind: component.kind,
      tauValue: component.value,
      carrierPrefix: component.kind === "vac" ? "V" : "I",
    };
  }
  if (component.kind === "vpulse") {
    const pulse = decodeParams("vpulse", component.value);
    const low = pulse.low || "0";
    const high = pulse.high || "5";
    const frequency = parseQuantity(pulse.frequency || "100k", "Hz");
    const duty = Math.min(0.99, Math.max(0.01, Number(pulse.duty || "0.5") || 0.5));
    const period = frequency > 0 ? 1 / frequency : 1e-5;
    const edge = period * 0.01;
    const width = Math.max(period * duty - edge, period * 0.005);
    return {
      type: "voltage",
      value: `PULSE(${low} ${high} 0 ${edge} ${edge} ${width} ${period})`,
      tauKind: component.kind,
      tauValue: component.value,
      carrierPrefix: "V",
    };
  }
  if (component.kind === "potentiometer") {
    return {
      type: "pot", value: component.value, tauKind: component.kind,
      tauValue: component.value, carrierPrefix: "R",
    };
  }
  if (component.kind === "transformer") {
    return {
      type: "ind2t", value: component.value, tauKind: component.kind,
      tauValue: component.value, carrierPrefix: "L",
    };
  }
  if (component.kind === "bulb") {
    // Electrically a resistor; carrier keeps the bulb glyph identity on reopen.
    return {
      type: "res",
      value: component.value.trim() || "10",
      tauKind: component.kind,
      tauValue: component.value,
      carrierPrefix: "R",
    };
  }
  if (LOSSY_CARRIER_KINDS.has(component.kind)) {
    // These Tau-native parts expand to multiple ngspice devices and therefore
    // have no faithful single LTspice symbol. Persist them as a benign high-Z
    // resistor plus explicit Tau metadata. Tau restores the exact kind/value,
    // pins, drawing, and simulator behavior; LTspice can still open/netlist the
    // file instead of failing on an unknown symbol or malformed element.
    const closedContact = (component.kind === "switch" || component.kind === "pushButton")
      && (component.value.trim().toLowerCase().startsWith("closed")
        || component.value.trim().toLowerCase() === "pressed"
        || component.value.trim().toLowerCase() === "on"
        || component.value.trim().toLowerCase() === "1");
    let carrierValue = closedContact ? "1m" : "1T";
    if (component.kind === "motor") {
      const rTok = component.value.trim().split(/[\s,;]+/).filter(Boolean)[0];
      carrierValue = rTok || "10";
    } else if (component.kind === "relay") {
      carrierValue = component.value.trim() || "100";
    }
    return {
      type: "res",
      value: carrierValue,
      tauKind: component.kind,
      tauValue: component.value,
      carrierPrefix: "R",
    };
  }
  if (component.kind === "bsource" && /^\s*I\s*=/i.test(component.value)) {
    // Use LTspice's behavioral-current glyph when the expression drives
    // current. The generic `bv` symbol is electrically a B source too, but its
    // voltage-source artwork misrepresents the generated circuit.
    return { type: "bi", value: component.value };
  }
  if (component.kind === "digitalGate") {
    const value = component.value.trim();
    const match = /^([^\s,]+)(?:[\s,]+|$)/.exec(value);
    const candidate = match?.[1].toLowerCase() ?? "";
    // Never reinterpret an unknown function as an AND gate. That would emit a
    // syntactically valid ASC whose electrical behavior differs from Tau.
    if (!DIGITAL_GATE_LEAFS.has(candidate)) return null;
    const leaf = candidate;
    // LTspice encodes the function in `SYMBOL Digital\\<leaf>`, not Value.
    // Leaving it in Value would re-import as e.g. `and and Vhigh=5` because
    // the importer correctly prepends the symbol leaf.
    // `Inputs=` is Tau's reading of the symbol, not something the `.asc` said,
    // so it never goes out: LTspice's `Digital\and` already means five inputs
    // and its A-device parameter list has no such key. Nothing is lost - an
    // imported gate re-derives the count from the same symbol on reopen, and a
    // gate Tau placed itself carries its whole value in `SYMATTR TauValue`.
    // Without the strip an imported file also stops re-exporting byte-identically.
    const params = withoutGateInputCount(value.slice(match?.[0].length ?? 0).trim());
    return { type: `Digital\\\\${leaf}`, value: params };
  }
  const type = kindToLtspiceType(component.kind);
  return type ? { type, value: component.value } : null;
}

/**
 * Map a Tau rotation (degrees) + mirror flag to an LTspice orientation token.
 * Inverse of `orientationToRotation` + the `M*` mirror convention.
 */
export function rotationToOrientation(
  rotation: 0 | 90 | 180 | 270,
  mirrored: boolean | undefined,
): AscOrientation {
  if (!mirrored) return `R${rotation}` as AscOrientation;
  const ltRotation = rotation === 90 ? 270 : rotation === 270 ? 90 : rotation;
  return `M${ltRotation}` as AscOrientation;
}

export interface SchematicExportInput {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  /** SPICE directives (no leading "!"); emitted as `TEXT … !…`. */
  directives?: string[];
  /** Free-text comments (no leading ";"); emitted as `TEXT … ;…`. */
  comments?: string[];
  /** Positioned LTspice TEXT records retained from an imported `.asc`. */
  textAnnotations?: SchematicTextAnnotation[];
  /** Drawing primitives retained from an imported `.asc`. */
  shapes?: SchematicAscShape[];
  /** `DATAFLAG` readouts retained from an imported `.asc`. */
  dataFlags?: SchematicAscDataFlag[];
  /**
   * Source SYMBOL records with no Tau equivalent, retained from an imported
   * `.asc` so an in-place save does not silently delete the part.
   */
  foreignSymbols?: SchematicForeignSymbol[];
  /** Resolved source blocks plus provenance for their flattened simulation
   * members. Untouched groups are re-emitted as the original block record. */
  hierarchicalBlocks?: SchematicHierarchicalBlock[];
  /** Original LTspice sheet geometry retained from import. */
  sheet?: SchematicSheet;
}

export interface SchematicToAscResult {
  text: string;
  /** Non-fatal issues (parts with no LTspice symbol, multi-segment wires split). */
  warnings: string[];
  /** Owners whose unchanged flattened members were replaced by their original
   * hierarchy record. Used by the semantic post-save topology check. */
  preservedHierarchyOwners?: string[];
}

/**
 * Build an LTspice `.asc` from Tau schematic content. Components become SYMBOLs
 * (with `InstName`/`Value` attributes), `ground` parts and net labels become
 * FLAGs, wires become one WIRE per orthogonal segment, and directives/comments
 * become TEXT lines. Returns the serialized text plus any warnings.
 */
export function schematicToAsc(input: SchematicExportInput): SchematicToAscResult {
  const warnings: string[] = [];
  const preservedHierarchyOwners = new Set<string>();
  const emittedHierarchyBlocks: SchematicHierarchicalBlock[] = [];
  const seenHierarchyOwners = new Set<string>();

  // Prove the synthetic implementation is byte-for-byte equivalent to the
  // snapshot taken at import before suppressing any of it. Counts catch a
  // deletion; exact canonical fingerprints catch electrical, geometry, and
  // label edits. An invalid group is exported flat only as diagnostic output -
  // its blocking warning prevents the caller from writing that output.
  for (const block of input.hierarchicalBlocks ?? []) {
    const instance = block.attrs.InstName || block.type;
    const provenance = block.provenance;
    if (!provenance || seenHierarchyOwners.has(provenance.owner)) {
      warnings.push(`${instance}: hierarchical block has incomplete preservation provenance; save refused.`);
      continue;
    }
    seenHierarchyOwners.add(provenance.owner);
    const components = input.components.filter((component) => component.ltHierarchy?.owner === provenance.owner);
    const wires = input.wires.filter((wire) => wire.ltHierarchy?.owner === provenance.owner);
    const labels = input.netLabels.filter((label) => label.ltHierarchy?.owner === provenance.owner);
    const complete = components.length === provenance.componentCount
      && wires.length === provenance.wireCount
      && labels.length === provenance.netLabelCount;
    if (!complete) {
      warnings.push(`${instance}: hierarchical block is incomplete; a flattened child object was added, removed, or lost.`);
      continue;
    }
    const edited = components.some((component) =>
      component.ltHierarchy?.original !== hierarchyComponentFingerprint(component)
    ) || wires.some((wire) => wire.ltHierarchy?.original !== hierarchyWireFingerprint(wire))
      || labels.some((label) => label.ltHierarchy?.original !== hierarchyNetLabelFingerprint(label));
    if (edited) {
      warnings.push(`${instance}: hierarchical block was edited inside its flattened child; edit the child .asc before saving the parent.`);
      continue;
    }
    preservedHierarchyOwners.add(provenance.owner);
    emittedHierarchyBlocks.push(block);
  }
  const doc: AscDocument = {
    version: 4,
    sheet: input.sheet ? { ...input.sheet } : { index: 1, width: 880, height: 680 },
    wires: [],
    flags: [],
    symbols: [],
    texts: [],
    shapes: (input.shapes ?? []).map((shape) => ({ ...shape, coords: [...shape.coords] })),
    dataFlags: (input.dataFlags ?? []).map((dataFlag) => ({ ...dataFlag })),
    unknown: [],
  };

  for (const wire of input.wires) {
    if (wire.ltHierarchy && preservedHierarchyOwners.has(wire.ltHierarchy.owner)) continue;
    // Tau wires are polylines; LTspice WIREs are single segments. Split.
    for (let i = 0; i + 1 < wire.points.length; i += 1) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      doc.wires.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    // Splitting an orthogonal Tau polyline into LTspice WIRE records is an
    // exact representation, not a lossy export condition.
  }

  for (const [componentIndex, c] of input.components.entries()) {
    if (c.ltHierarchy && preservedHierarchyOwners.has(c.ltHierarchy.owner)) continue;
    if (c.kind === "ground") {
      doc.flags.push({ x: c.x, y: c.y, net: "0" });
      continue;
    }
    const symbol = componentToLtspiceSymbol(c);
    if (!symbol) {
      warnings.push(`${c.label || c.id}: no LTspice symbol for kind "${c.kind}"; skipped.`);
      continue;
    }
    // Tau round-trips these through their `Tau*` attributes, so the loss is
    // invisible here - it lands on whoever opens the file in LTspice and sees
    // a bare resistor where a switch or subcircuit used to be. Say so.
    //
    // Only when the part really did go out under a carrier: a `TauKind` is what
    // marks a stand-in symbol, and a kind in this set does not always need one
    // (an imported `sw` is written back as itself). Reporting on the kind alone
    // would claim a placeholder that is not in the file.
    if (symbol.tauKind && LOSSY_CARRIER_KINDS.has(c.kind)) {
      const reads = symbol.value === "1T" ? "an open circuit" : `a ${symbol.value} resistor`;
      warnings.push(
        `${c.label || c.id}: ${LOSSY_CARRIER_MARKER}. Tau reopens it as a ${c.kind}, `
        + `but in LTspice it reads as ${reads}.`,
      );
    }
    const attrs: Record<string, string> = {};
    // A part created natively in Tau has Tau-local anchor/pin geometry, which
    // is not the same as the corresponding LTspice .asy geometry. Persist the
    // native identity for *every* such part so reopening Tau's own ASC never
    // replaces its pins with LTspice offsets and silently breaks the graph.
    // Faithfully imported LTspice parts already carry pinOverride and continue
    // to round-trip through their original LT symbol geometry.
    const roundTripTauKind = c.pinOverride?.length ? symbol.tauKind : c.kind;
    if (symbol.tauKind) {
      // The carrier is a real LTspice resistor, so give it an R designator.
      // TauLabel restores the user's original U/F/H/S/X/TP designator.
      attrs.InstName = `${symbol.carrierPrefix ?? "R"}_TAU_${componentIndex + 1}`;
      attrs.TauLabel = c.label || "\"\"";
    } else if (c.label) attrs.InstName = c.label;
    if (symbol.value) attrs.Value = symbol.value;
    if (roundTripTauKind) {
      attrs.TauKind = roundTripTauKind;
      attrs.TauValue = symbol.tauValue || c.value || "\"\"";
      attrs.TauLabel = c.label || "\"\"";
    }
    if (symbol.tauKind && c.kind === "subckt" && c.pinOverride?.length && !c.ltSymbolType) {
      const encodedPins = encodeTauPins(c);
      if (encodedPins) attrs[TAU_PINS_FIELD] = encodedPins;
      else warnings.push(`${c.label || c.id}: native subcircuit terminal geometry could not be preserved.`);
    }
    // Label placement is expressed in the source symbol's own attribute slots
    // and geometry, so it only survives when the part is written back under
    // that same symbol. Exporting it onto a different symbol (a carrier
    // resistor, or Tau's canonical type) would scatter the text.
    const windows = c.ltWindows ?? [];
    const keepsSourceSymbol = c.ltSymbolType !== undefined
      && normalizeLtType(c.ltSymbolType) === normalizeLtType(symbol.type);
    if (windows.length > 0 && !keepsSourceSymbol) {
      warnings.push(
        `${c.label || c.id}: label placement is not preserved; the part is saved as symbol "${symbol.type}".`,
      );
    }
    // The extended attribute slots mean what they mean relative to the symbol
    // that declared them, so - like label placement - they can only go back
    // onto that same symbol. Restoring the split is what makes the file read as
    // the original part in LTspice rather than one whose whole spec collapsed
    // into `Value`.
    const extraAttrs = c.ltExtraAttrs;
    if (extraAttrs) {
      // Nothing was folded onto the value when the two agree, so the slots stay
      // independent of it and an edited value simply takes `Value`. Otherwise
      // an edit is accepted only when its minimal diff stays inside one exact
      // source slot. A cross-slot transformation remains ambiguous and blocked.
      const currentValue = c.value ?? "";
      const reconciled = extraAttrs.derivedValue === extraAttrs.baseValue
        || currentValue === extraAttrs.derivedValue
        ? null
        : reconcileFoldedLtspiceValue(extraAttrs, currentValue);
      const valueIntact = extraAttrs.derivedValue === extraAttrs.baseValue
        || currentValue === extraAttrs.derivedValue
        || reconciled !== null;
      const base = extraAttrs.derivedValue === extraAttrs.baseValue
        ? currentValue
        : (reconciled?.baseValue ?? extraAttrs.baseValue);
      const extras = reconciled?.extras ?? extraAttrs.extras;
      if (valueIntact && keepsSourceSymbol && !symbol.tauKind) {
        // LTspice omits `Value` entirely on a part whose spec lives in the
        // other slots; writing one back would add an attribute it never had.
        if (base) attrs.Value = base;
        else delete attrs.Value;
        for (const [name, value] of Object.entries(extras)) attrs[name] = value;
      } else if (valueIntact && symbol.tauKind) {
        // The part is written under a carrier symbol, so its slots cannot go
        // back under their own names - `SpiceLine` on the placeholder resistor
        // would be read as the resistor's. Park them in the Tau-only slot
        // instead, next to the `TauKind` that says which part they describe.
        // LTspice sees the carrier either way; this is what stops a save from
        // destroying the spec on the way through Tau.
        attrs[TAU_CARRIED_ATTRS_FIELD] = encodeCarriedAttrs(base, extras);
      } else {
        warnings.push(
          `${c.label || c.id}: ${Object.keys(extraAttrs.extras).join(", ")} ${
            Object.keys(extraAttrs.extras).length === 1 ? "is" : "are"
          } not preserved; the part's parameters are saved on Value alone.`,
        );
      }
    }
    doc.symbols.push({
      type: symbol.type,
      x: c.x,
      y: c.y,
      orientation: rotationToOrientation(c.rotation, c.mirrored),
      attrs,
      ...(keepsSourceSymbol && windows.length > 0 ? { windows } : {}),
    });
  }

  // Foreign symbols carry no Tau semantics - append after every real component
  // so a save never interleaves them with the parts Tau understands.
  for (const foreign of input.foreignSymbols ?? []) {
    doc.symbols.push({
      ...foreign,
      attrs: { ...foreign.attrs },
      ...(foreign.windows ? { windows: foreign.windows.map((w) => ({ ...w })) } : {}),
    });
  }

  // A preserved block is a real source record, not a foreign/unsupported part:
  // its flattened members power simulation in Tau, while this exact record is
  // what LTspice must receive when the parent file is saved.
  for (const block of emittedHierarchyBlocks) {
    doc.symbols.push({
      type: block.type,
      x: block.x,
      y: block.y,
      orientation: block.orientation,
      attrs: { ...block.attrs },
      ...(block.windows ? { windows: block.windows.map((window) => ({ ...window })) } : {}),
    });
  }

  for (const label of input.netLabels) {
    if (label.ltHierarchy && preservedHierarchyOwners.has(label.ltHierarchy.owner)) continue;
    doc.flags.push({
      x: label.x,
      y: label.y,
      net: label.text,
      ...(label.port ? { port: label.port } : {}),
    });
  }

  // Preserve every imported comment at its original position. For directives,
  // match the current authored list back to its original TEXT record by value.
  // If a setup form changed a directive's arguments, reuse the position of the
  // same directive kind (`.tran`, `.ac`, …). A newly-added directive gets
  // Tau's canonical origin while removed directives disappear. This keeps
  // simulation state and ASC presentation in sync without making the engine
  // depend on canvas annotation coordinates.
  const annotations = input.textAnnotations ?? [];
  const currentDirectives = input.directives ?? [];
  const consumed = new Set<number>();
  const directiveKind = (directive: string) => /^\s*(\.[^\s]+)/.exec(directive)?.[1].toLowerCase() ?? "";
  for (const annotation of annotations) {
    if (!annotation.directive) {
      doc.texts.push({ ...annotation });
      continue;
    }
    let index = currentDirectives.findIndex((directive, candidate) =>
      !consumed.has(candidate) && directive === annotation.text
    );
    if (index < 0) {
      const annotationKind = directiveKind(annotation.text);
      index = currentDirectives.findIndex((directive, candidate) =>
        !consumed.has(candidate) && annotationKind !== "" && directiveKind(directive) === annotationKind
      );
    }
    if (index >= 0) {
      consumed.add(index);
      doc.texts.push({ ...annotation, text: currentDirectives[index] });
    }
  }
  currentDirectives.forEach((directive, index) => {
    if (!consumed.has(index)) {
      doc.texts.push({ x: 0, y: 0, directive: true, text: directive });
    }
  });
  if (!annotations.some((annotation) => !annotation.directive)) {
    for (const comment of input.comments ?? []) {
      doc.texts.push({ x: 0, y: 0, directive: false, text: comment });
    }
  }

  return {
    text: serializeAscDocument(doc),
    warnings,
    ...(preservedHierarchyOwners.size > 0
      ? { preservedHierarchyOwners: [...preservedHierarchyOwners] }
      : {}),
  };
}
