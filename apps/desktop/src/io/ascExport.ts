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
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import type { AscDocument, AscOrientation } from "./ascImport";
import { hasBankedLtPins, ltspiceTypeToKind } from "./ascImport";
import { decodeParams } from "../schematic/params";
import { parseQuantity } from "../simulation/quantity";

const int = (n: number): string => String(Math.round(n));

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
  }
  for (const s of doc.symbols) {
    lines.push(`SYMBOL ${s.type} ${int(s.x)} ${int(s.y)} ${s.orientation}`);
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
    lines.push(`${shape.kind} ${shape.coords.map(int).join(" ")}`.trimEnd());
  }

  return lines.join("\n") + "\n";
}

/**
 * Map a Tau component kind back to the LTspice symbol type that
 * `ltspiceTypeToKind` recognizes, choosing the variant whose pin geometry is
 * banked in `LTSPICE_PINS` so a re-import reconstructs the same `pinOverride`.
 * Returns `null` for kinds with no LTspice symbol of their own (`ground` is a
 * FLAG, `testpoint` is a Tau-only probe marker).
 */
export function kindToLtspiceType(kind: ComponentKind): string | null {
  const map: Partial<Record<ComponentKind, string>> = {
    resistor: "res",
    capacitor: "cap",
    inductor: "ind",
    vsource: "voltage",
    isource: "current",
    vac: "voltage",
    iac: "current",
    vpulse: "voltage",
    diode: "diode",
    zener: "zener",
    led: "led",
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
 * pins (npn4/pnp4 substrate, sw/csw control pair - wires to those pins would
 * silently detach), or the importer replaced the source Value with a
 * placeholder (varistor/diac get a neutral high-Z resistance). These stay on
 * the blocked-save path. */
const VERBATIM_UNSAFE_LEAFS = new Set(["npn4", "pnp4", "sw", "csw", "varistor", "diac"]);

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
  if (["digitalGate", "subckt", "dflop", "sampleHold", "modulator"].includes(kind)) return false;
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

function componentToLtspiceSymbol(component: SchematicComponent): LtspiceComponentSymbol | null {
  if (
    component.ltSymbolType &&
    component.pinOverride?.length &&
    canEmitLtSymbolVerbatim(component.ltSymbolType, component.kind)
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
  if (["comparator", "cccs", "ccvs", "switch", "subckt", "testpoint"].includes(component.kind)) {
    // These Tau-native parts expand to multiple ngspice devices and therefore
    // have no faithful single LTspice symbol. Persist them as a benign high-Z
    // resistor plus explicit Tau metadata. Tau restores the exact kind/value,
    // pins, drawing, and simulator behavior; LTspice can still open/netlist the
    // file instead of failing on an unknown symbol or malformed element.
    const closedSwitch = component.kind === "switch" && component.value.trim().toLowerCase().startsWith("closed");
    return {
      type: "res",
      value: closedSwitch ? "1m" : "1T",
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
    const params = value.slice(match?.[0].length ?? 0).trim();
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
}

export interface SchematicToAscResult {
  text: string;
  /** Non-fatal issues (parts with no LTspice symbol, multi-segment wires split). */
  warnings: string[];
}

/**
 * Build an LTspice `.asc` from Tau schematic content. Components become SYMBOLs
 * (with `InstName`/`Value` attributes), `ground` parts and net labels become
 * FLAGs, wires become one WIRE per orthogonal segment, and directives/comments
 * become TEXT lines. Returns the serialized text plus any warnings.
 */
export function schematicToAsc(input: SchematicExportInput): SchematicToAscResult {
  const warnings: string[] = [];
  const doc: AscDocument = {
    version: 4,
    sheet: { index: 1, width: 880, height: 680 },
    wires: [],
    flags: [],
    symbols: [],
    texts: [],
    shapes: [],
    unknown: [],
  };

  for (const wire of input.wires) {
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
    if (c.kind === "ground") {
      doc.flags.push({ x: c.x, y: c.y, net: "0" });
      continue;
    }
    const symbol = componentToLtspiceSymbol(c);
    if (!symbol) {
      warnings.push(`${c.label || c.id}: no LTspice symbol for kind "${c.kind}"; skipped.`);
      continue;
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
    doc.symbols.push({
      type: symbol.type,
      x: c.x,
      y: c.y,
      orientation: rotationToOrientation(c.rotation, c.mirrored),
      attrs,
    });
  }

  for (const label of input.netLabels) {
    doc.flags.push({ x: label.x, y: label.y, net: label.text });
  }

  for (const d of input.directives ?? []) {
    doc.texts.push({ x: 0, y: 0, directive: true, text: d });
  }
  for (const comment of input.comments ?? []) {
    doc.texts.push({ x: 0, y: 0, directive: false, text: comment });
  }

  return { text: serializeAscDocument(doc), warnings };
}
