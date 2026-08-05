/**
 * LTspice `.asc` schematic importer - Phase 1: a robust parser for the LTspice
 * ASCII schematic grammar, plus a best-effort mapping of common symbol types to
 * Tau component kinds.
 *
 * Goal (see LTspice parity .md): open the user's real LTspice schematics. This
 * module is the foundation - it parses the file losslessly into a structured
 * form. Pin-accurate connectivity (aligning LTspice symbol pins to Tau symbol
 * pins so nets extract correctly) and directive (`.tran`/`.ac`/…) handling build
 * on top of this and are tracked as follow-up items.
 *
 * Reference grammar (LTspice 17.x, plain text, integer coords):
 *   Version 4
 *   SHEET n <w> <h>
 *   WIRE x1 y1 x2 y2
 *   FLAG x y <netname>          ; "0" = ground
 *   SYMBOL <type> x y <orient>  ; orient ∈ R0 R90 R180 R270 M0 M90 M180 M270
 *   SYMATTR <name> <value...>   ; applies to the most recent SYMBOL
 *   WINDOW <id> x y <align> <size>
 *   TEXT x y <align> <size> !<directive>   ; "!" SPICE directive, ";" comment
 *   LINE/RECTANGLE/CIRCLE/ARC <coords...>  ; drawing primitives
 *   IOPIN x y <dir>             ; hierarchy port
 */

import type {
  ComponentKind,
  LtspiceWindow,
  NetLabel,
  PinOverride,
  SchematicAscDataFlag,
  SchematicAscShape,
  SchematicComponent,
  SchematicHierarchicalBlock,
  SchematicPortDirection,
  SchematicWire,
} from "../schematic/types";
import { canonicalWindowJustification } from "../schematic/types";
import {
  hierarchyComponentFingerprint,
  hierarchyNetLabelFingerprint,
  hierarchyWireFingerprint,
} from "../schematic/hierarchyProvenance";
import { buildPartialParamScope, inlineFuncCalls, parseParamAssignments, substituteKnownBraces, substituteBehavioralBraces, substituteScopeIdentifiers, substituteIdentifierExpressions } from "../simulation/paramScope";
import { isComponentKind } from "../schematic/types";
import { getLocalPins, transformPoint } from "../schematic/pins";
import { parseIcValue } from "../engine/icSpec";
import { MAX_COMPONENTS, MAX_WIRES } from "../schematic/documentValidation";
import { ltspiceModelFileFromSymbolAttrs } from "./ltspiceModelFile";

/**
 * Decode a schematic file's raw bytes to text, honoring the encoding LTspice
 * actually writes. LTspice saves many `.asc`/`.asy` files as UTF-16 (with a BOM);
 * the browser's `File.text()` assumes UTF-8 and silently mangles them (every other
 * byte becomes NUL), so the parser then finds zero symbols. Detect the BOM (and a
 * BOM-less UTF-16LE heuristic) and decode correctly before parsing.
 */
export function decodeSchematicText(input: ArrayBuffer | Uint8Array): string {
  // NUL and other C0 control bytes are never legitimate schematic text, but a
  // strict-UTF-8 decode passes them through and they end up inside component
  // labels ("V<NUL>in"). Strip everything except tab/newline/CR post-decode.
  return decodeSchematicBytes(input).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function decodeSchematicBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // BOM-less UTF-16LE heuristic: ASCII-range text encoded as UTF-16LE has a NUL in
  // every odd byte position. If odd bytes are overwhelmingly NUL, decode as UTF-16LE.
  if (bytes.length >= 4) {
    const sample = Math.min(bytes.length, 512);
    let oddNuls = 0;
    let oddCount = 0;
    for (let i = 1; i < sample; i += 2) {
      oddCount++;
      if (bytes[i] === 0x00) oddNuls++;
    }
    if (oddCount > 0 && oddNuls / oddCount > 0.7) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
  }
  // No BOM and not UTF-16. LTspice often saves single-byte (Windows-1252) files
  // where the micro sign is byte 0xB5 (`47µ`); decoding those as UTF-8 mangles
  // the byte into U+FFFD and the value no longer parses. Try strict UTF-8 first
  // (the common case) and fall back to Windows-1252 when a stray high byte makes
  // the stream invalid UTF-8, so `0xB5` → `µ` (U+00B5), which parseQuantity reads.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export type AscOrientation = "R0" | "R90" | "R180" | "R270" | "M0" | "M90" | "M180" | "M270";

export interface AscWire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AscFlag {
  x: number;
  y: number;
  /** Net name; "0" denotes ground. */
  net: string;
  /** Hierarchy-port direction from the `IOPIN` record LTspice writes directly
   *  after this FLAG. Absent on an ordinary net label. */
  port?: AscPortDirection;
}

export interface AscSymbol {
  /** LTspice symbol type, e.g. "res", "voltage", "npn", "opamps\\LT1468". */
  type: string;
  x: number;
  y: number;
  orientation: AscOrientation;
  /** SYMATTR name → value (InstName, Value, Value2, SpiceModel, SpiceLine, …). */
  attrs: Record<string, string>;
  /** `WINDOW` label-placement records that followed this SYMBOL, in file order. */
  windows?: LtspiceWindow[];
}

/** Attribute slot and text size a `WINDOW` record may carry. Wider than the
 *  slots LTspice documents (0..40 plus 123 for Value2) so an unusual but
 *  well-formed record still round-trips; anything outside is kept as an unknown
 *  line, which keeps the file on the blocked-save path rather than guessing. */
const MAX_WINDOW_ATTR = 255;
const MAX_WINDOW_SIZE = 16;
/** Placement offsets are symbol-relative and small; this only rejects absurd
 *  coordinates so a re-emitted record always survives document validation. */
const MAX_WINDOW_OFFSET = 10_000_000;

/** Parse a `WINDOW` record's five operands, or `null` if it is not one Tau can
 *  reproduce exactly. */
function parseWindowRecord(parts: string[]): LtspiceWindow | null {
  if (parts.length !== 6) return null;
  const justification = canonicalWindowJustification(parts[4]);
  if (justification === null) return null;
  const attr = Number(parts[1]);
  const size = Number(parts[5]);
  const x = Number(parts[2]);
  const y = Number(parts[3]);
  if (!Number.isInteger(attr) || attr < 0 || attr > MAX_WINDOW_ATTR) return null;
  if (!Number.isInteger(size) || size < 0 || size > MAX_WINDOW_SIZE) return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (Math.abs(x) > MAX_WINDOW_OFFSET || Math.abs(y) > MAX_WINDOW_OFFSET) return null;
  return { attr, x, y, justification, size };
}

export interface AscText {
  x: number;
  y: number;
  /** True when the text is a SPICE directive (leading "!"); false for a ";" comment. */
  directive: boolean;
  text: string;
}

export type AscShape = SchematicAscShape;
export type AscDataFlag = SchematicAscDataFlag;
export type AscPortDirection = SchematicPortDirection;

export interface AscDocument {
  version: number;
  sheet: { index: number; width: number; height: number };
  wires: AscWire[];
  flags: AscFlag[];
  symbols: AscSymbol[];
  texts: AscText[];
  shapes: AscShape[];
  dataFlags: AscDataFlag[];
  /** Lines that were not understood, preserved for diagnostics. */
  unknown: string[];
}

const ORIENTATIONS = new Set<AscOrientation>([
  "R0", "R90", "R180", "R270", "M0", "M90", "M180", "M270",
]);

const toOrientation = (token: string): AscOrientation =>
  ORIENTATIONS.has(token as AscOrientation) ? (token as AscOrientation) : "R0";

const num = (token: string | undefined): number => {
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
};

/** Pen widths LTspice writes for a drawing primitive. */
const ASC_SHAPE_WIDTHS = ["Normal", "Wide"] as const;

/** Directions LTspice writes on an `IOPIN`, in its own capitalization - the
 *  record is re-emitted verbatim, so the spelling has to survive the trip. */
const ASC_PORT_DIRECTIONS = ["In", "Out", "BiDir"] as const;

/** `LINE|RECTANGLE|CIRCLE|ARC <width> <coords...>`. The width word is not a
 *  coordinate; dropping it writes a record LTspice reads back as malformed.
 *  Returns null for anything the exporter could not reproduce exactly, so the
 *  record falls through to `unknown` and the save stays blocked. */
function parseShapeRecord(kind: AscShape["kind"], parts: string[]): AscShape | null {
  const token = parts[1]?.toLowerCase();
  const width = ASC_SHAPE_WIDTHS.find((candidate) => candidate.toLowerCase() === token);
  if (!width) return null;
  const tokens = parts.slice(2);
  // Endpoints, then LTspice's optional dash-style index.
  const points = kind === "ARC" ? 8 : 4;
  if (tokens.length < points || tokens.length > points + 1) return null;
  // Screen the source tokens rather than what `num` makes of them: it coerces
  // anything unparseable to 0, which would move the drawing to the origin on
  // the way back out. Whole numbers only, so `int` re-emits them unchanged.
  if (!tokens.every((value) => /^[+-]?\d+$/.test(value))) return null;
  return { kind, width, coords: tokens.map(num) };
}

/**
 * Parse LTspice `.asc` text into a structured document. Tolerant of unknown
 * lines (kept in `unknown`) and of CRLF/encoding noise so a real file never
 * throws.
 */
export function parseAsc(text: string): AscDocument {
  const doc: AscDocument = {
    version: 4,
    sheet: { index: 1, width: 0, height: 0 },
    wires: [],
    flags: [],
    symbols: [],
    texts: [],
    shapes: [],
    dataFlags: [],
    unknown: [],
  };

  let current: AscSymbol | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const parts = line.trim().split(/\s+/);
    const tag = parts[0].toUpperCase();

    switch (tag) {
      case "VERSION":
        doc.version = num(parts[1]) || 4;
        break;
      case "SHEET":
        doc.sheet = { index: num(parts[1]) || 1, width: num(parts[2]), height: num(parts[3]) };
        break;
      case "WIRE":
        doc.wires.push({ x1: num(parts[1]), y1: num(parts[2]), x2: num(parts[3]), y2: num(parts[4]) });
        current = null;
        break;
      case "FLAG":
        doc.flags.push({ x: num(parts[1]), y: num(parts[2]), net: parts[3] ?? "" });
        current = null;
        break;
      case "SYMBOL":
        current = {
          type: parts[1] ?? "",
          x: num(parts[2]),
          y: num(parts[3]),
          orientation: toOrientation(parts[4] ?? "R0"),
          attrs: {},
        };
        doc.symbols.push(current);
        break;
      case "SYMATTR":
        if (current && parts[1]) current.attrs[parts[1]] = parts.slice(2).join(" ");
        break;
      case "WINDOW": {
        // Label placement only - no electrical content, but it must survive a
        // save or LTspice reopens the file with every nudged label back at its
        // default spot. A record with no symbol to attach to, or one Tau cannot
        // re-emit exactly, falls through to `unknown` so the save stays blocked.
        const window = current ? parseWindowRecord(parts) : null;
        if (!window) {
          doc.unknown.push(line);
          break;
        }
        (current!.windows ??= []).push(window);
        break;
      }
      case "TEXT": {
        // TEXT x y <align> <size> <payload...>  - payload starts with ! or ;.
        const payload = line.trim().split(/\s+/).slice(5).join(" ");
        const marker = payload.charAt(0);
        doc.texts.push({
          x: num(parts[1]),
          y: num(parts[2]),
          directive: marker === "!",
          text: payload.replace(/^[!;]/, "").trim(),
        });
        current = null;
        break;
      }
      case "LINE":
      case "RECTANGLE":
      case "CIRCLE":
      case "ARC": {
        const shape = parseShapeRecord(tag, parts);
        if (shape) doc.shapes.push(shape);
        else doc.unknown.push(line);
        current = null;
        break;
      }
      case "DATAFLAG": {
        // A readout LTspice paints on the schematic after a run. No electrical
        // content and Tau does not evaluate it, but it must survive a save or
        // reopening the file loses it. The expression is quoted and may contain
        // spaces, so take the remainder of the line verbatim instead of
        // re-joining split tokens. Screen the coordinates against the source
        // text: `num` coerces anything unparseable to 0, which would move the
        // readout to the origin on the way back out; such a record falls
        // through to `unknown` so the save stays blocked.
        const dataFlag = /^DATAFLAG\s+([+-]?\d+)\s+([+-]?\d+)(?:\s+(.*))?$/i.exec(line.trim());
        if (!dataFlag) {
          doc.unknown.push(line);
          break;
        }
        doc.dataFlags.push({ x: num(dataFlag[1]), y: num(dataFlag[2]), expr: dataFlag[3] ?? "" });
        current = null;
        break;
      }
      case "IOPIN": {
        // A hierarchy port decorates the FLAG at its own coordinates - LTspice
        // writes the pair adjacently and one is meaningless without the other,
        // so the direction is stored on that flag. Anything that cannot be
        // paired and re-emitted exactly (an unknown direction word, no flag at
        // those coordinates, or a ground flag, which has no port to be) falls
        // through to `unknown` so the save stays blocked rather than silently
        // dropping the port.
        // Screen the source tokens first: `num` coerces anything unparseable to
        // 0, which would re-emit the port at the origin instead of on its flag.
        const token = parts[3]?.toLowerCase();
        const direction = ASC_PORT_DIRECTIONS.find((d) => d.toLowerCase() === token);
        const wellFormed = direction !== undefined
          && parts.length === 4
          && /^[+-]?\d+$/.test(parts[1])
          && /^[+-]?\d+$/.test(parts[2]);
        // Last match wins: LTspice writes the IOPIN directly after its FLAG, so
        // the most recently parsed flag at those coordinates is the owner.
        const owner = wellFormed
          ? [...doc.flags].reverse().find((f) => f.x === num(parts[1]) && f.y === num(parts[2]) && f.net !== "0")
          : undefined;
        if (!owner) {
          doc.unknown.push(line);
          break;
        }
        owner.port = direction;
        current = null;
        break;
      }
      default:
        doc.unknown.push(line);
        break;
    }
  }

  return doc;
}

/** A pin of an LTspice `.asy` symbol - its name, SpiceOrder, and symbol-local
 *  position (the same R0 frame the `PIN` line gives). */
export interface AsyPin {
  name: string;
  /** SpiceOrder - the port's index in the `.subckt` line / instance pin list. */
  order: number;
  x: number;
  y: number;
}

/** A parsed LTspice `.asy` symbol. `BLOCK` symbols back a hierarchical schematic
 *  (a `.asc` used as a subcircuit); their {@link pins} order the instance's
 *  external connections (sorted by SpiceOrder). */
export interface AsySymbol {
  /** SymbolType: "BLOCK", "CELL", … (BLOCK = hierarchical sub-schematic). */
  symbolType: string;
  /** Pins in SpiceOrder order. */
  pins: AsyPin[];
  /** Symbol-level defaults (Value/Value2/SpiceLine/SpiceLine2). Hierarchical
   * CELL/BLOCK instances inherit these unless their ASC symbol overrides them. */
  attrs: Record<string, string>;
}

/**
 * Parse an LTspice `.asy` symbol file into its pin list (the only part that
 * matters for hierarchical connectivity). Grammar:
 *   SymbolType BLOCK
 *   PIN <x> <y> <side> <offset>
 *   PINATTR PinName <name>
 *   PINATTR SpiceOrder <n>
 * Pins are returned sorted by SpiceOrder so index i is the i-th `.subckt` port.
 */
export function parseAsy(text: string): AsySymbol {
  const result: AsySymbol = { symbolType: "", pins: [], attrs: {} };
  let current: { x: number; y: number; name: string; order: number } | null = null;
  const flush = () => {
    if (current) result.pins.push({ ...current });
    current = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const parts = raw.trim().split(/\s+/);
    const tag = (parts[0] ?? "").toUpperCase();
    if (tag === "SYMBOLTYPE") {
      result.symbolType = parts[1] ?? "";
    } else if (tag === "SYMATTR") {
      const name = parts[1] ?? "";
      if (name) result.attrs[name] = parts.slice(2).join(" ");
    } else if (tag === "PIN") {
      flush();
      current = { x: num(parts[1]), y: num(parts[2]), name: "", order: result.pins.length + 1 };
    } else if (tag === "PINATTR" && current) {
      if ((parts[1] ?? "").toLowerCase() === "pinname") current.name = parts.slice(2).join(" ");
      else if ((parts[1] ?? "").toLowerCase() === "spiceorder") current.order = num(parts[2]) || current.order;
    }
  }
  flush();
  result.pins.sort((a, b) => a.order - b.order);
  return result;
}

/**
 * Map an LTspice symbol type to a Tau component kind. Case-insensitive; handles
 * the common built-ins. Vendor/library symbols return `null` unless a shared
 * native kind has a proven electrical pin topology. Model fidelity remains a
 * separate requirement even when the pins can be represented; verified
 * multi-pin amplifiers below are never forced through the five-pin op-amp kind.
 */
export function ltspiceTypeToKind(type: string): ComponentKind | null {
  const base = type.replace(/\\/g, "/").toLowerCase();
  const leaf = base.split("/").pop() ?? base;

  const map: Record<string, ComponentKind> = {
    res: "resistor",
    res2: "resistor",
    r: "resistor",
    rn55upright: "resistor",
    uprightpowerresistor: "resistor",
    cap: "capacitor",
    cap2: "capacitor",
    c: "capacitor",
    polcap: "polarizedCapacitor",
    // Crystal (xtal): a 2-terminal piezoelectric resonator modelled in LTspice
    // as a capacitor C element (series capacitance Cs) with optional parasitic
    // params (Rser, Lser, Cpar) on SpiceLine. Imported as a capacitor so the
    // SPICE deck line is electrically correct; the full resonator model is carried
    // in the value string by componentValueFromAttrs.
    xtal: "capacitor",
    // Educational/PAsystem 2-terminal capacitor cells (pin geometry from .asy).
    smcap: "capacitor",
    mylarcap: "capacitor",
    coaxcap7: "capacitor",
    ind: "inductor",
    ind2: "inductor",
    l: "inductor",
    voltage: "vsource",
    battery: "vsource",
    signal: "vsource",
    current: "isource",
    // load/load2.asy are Prefix-I current sources whose leaf name IS the
    // dissipative `load`/`load2` flag (AD8410A Iload). Map to isource; the
    // importer appends the flag onto Value so spiceNetlist can handle it.
    load: "isource",
    load2: "isource",
    diode: "diode",
    schottky: "diode",
    varactor: "diode",
    smdiode: "diode",
    zener: "zener",
    led: "led",
    npn: "npn",
    npn3: "npn",
    npn4: "npn",
    // Educational/PAsystem TO-92 cells whose leaf IS the model name (.asy Value;
    // instance often has InstName only). Exact standard.bjt / authored .model.
    "2n3904": "npn",
    pnp: "pnp",
    pnp3: "pnp",
    "2n3906": "pnp",
    nmos: "nmos",
    nmos4: "nmos",
    pmos: "pmos",
    pmos4: "pmos",
    njf: "njf",
    // HandsFreeLayout: sibling 2N5458.asy + authored `.model 2N5458 NJF(…)`.
    "2n5458": "njf",
    pjf: "pjf",
    sw: "switch",
    csw: "switch",
    pot: "potentiometer",
    ind2t: "transformer",
    tline: "tline",
    ltline: "tline",
    "opamp": "opamp",
    "opamp2": "opamp",
    // Voltage-controlled sources (LTspice e/e2 = VCVS, g/g2 = VCCS).
    e: "vcvs",
    e2: "vcvs",
    g: "vccs",
    g2: "vccs",
    // Current-controlled sources (LTspice f/f2 = CCCS, h/h2 = CCVS).
    f: "cccs",
    f2: "cccs",
    h: "ccvs",
    h2: "ccvs",
    // Behavioral (arbitrary) sources: LTspice bv = B-voltage, bi = B-current.
    bv: "bsource",
    bi: "bsource",
    bi2: "bsource",
    b: "bsource",
    b2: "bsource",
    // DIAC/TRIAC are generic Prefix-X symbols: the circuit supplies their
    // `.subckt` definitions. Preserve the exact SpiceOrder pins and invoke that
    // model rather than substituting a resistor/BJT.
    diac: "subckt",
    triac: "subckt",
    // Educational/PAsystem darlingtons: ASC uses `SYMATTR Prefix X` + authored
    // `.lib TIP121.LIB` / `.lib TIP127.LIB` with exact `.SUBCKT tip121`/`tip127`.
    tip121: "subckt",
    tip127: "subckt",
    // Varistor (SpecialFunctions\\varistor): a 4-terminal behavioral voltage-
    // controlled clamp. The two primary terminals (invin/noninvin, SpiceOrder 1/2)
    // are represented by a four-terminal behavioral subcircuit carrier. The
    // deck emitter implements LTspice's documented voltage-controlled clamp.
    varistor: "subckt",
    // LTspice-library subcircuit symbols (`SYMATTR Prefix X`) whose bodies are
    // bundled in engine/bundledSubcircuits.ts. Each imports as a generic
    // `subckt` instance carrying the `.asy`'s exact pin bank; the deck builder
    // emits `X<ref> <nodes> <name> [params]` plus the bundled `.subckt` block.
    towtom2: "subckt",
    capmeter: "subckt",
    "iso16750-2": "subckt",
    "iso7637-2": "subckt",
  };

  // Opamps\opamp - LTspice's ideal single-pole symbol is `SYMATTR Prefix X`
  // onto `.subckt opamp` (opamp.sub, bundled): a true subcircuit instance,
  // unlike the behavioral vendor-opamp mapping below. Must be checked before
  // the directory-wide opamp rule; note its SpiceOrder puts invin FIRST.
  if (leaf === "opamp") return "subckt";
  // These verified library parts are NOT five-pin op-amps. They are eight- or
  // multi-pin instrumentation/fully-differential/high-current amplifiers. The
  // old directory-wide rule assigned opampO's guessed five-pin bank, collapsing
  // REF/output/supply nodes and producing plausible generic gain blocks or a
  // shorted VCVS. Until the user supplies each real symbol/model, retain the
  // foreign record and refuse the whole simulation by part name.
  if (base.includes("opamp") && NON_FIVE_PIN_AMPLIFIER_LEAFS.has(leaf)) return null;
  // Ordinary single-output five-pin symbols under Opamps/ keep the behavioral
  // op-amp path. Their vendor-model fidelity remains a separate, explicit
  // model-library task; this branch only claims the shared pin topology.
  if (base.includes("opamp")) return "opamp";
  // LTspice idealized digital A-devices live under `Digital\`. The path prefix
  // is required - bare leafs like "and"/"or" are too generic to claim globally.
  if (base.includes("digital/")) {
    if (leaf === "dflop") return "dflop";
    if (leaf === "srflop") return "srflop";
    if (leaf === "phidet") return "digitalGate";
    if (DIGITAL_GATE_LEAFS.has(leaf)) return "digitalGate";
  }
  // LTspice behavioral A-devices under `SpecialFunctions\`. `sample` is the
  // SAMPLEHOLD track-and-hold (engine/sampleHoldSpec.ts); path-gated because
  // the bare leaf is too generic to claim globally.
  if (base.includes("specialfunctions/") && leaf === "sample") return "sampleHold";
  // `modulate` is the MODULATOR behavioral VCO (engine/modulatorSpec.ts).
  // `modulate2` (separate SIN/COS outputs) is NOT mapped - see modulatorSpec.
  if (base.includes("specialfunctions/") && leaf === "modulate") return "modulator";
  return map[leaf] ?? null;
}

/** `Digital\*.asy` leafs that map onto the behavioral `digitalGate` kind.
 *  (counter and the diff* family are not yet modelled and fall through to the
 *  skip-warning path; SpecialFunctions\sample maps to the `sampleHold` kind
 *  above. srflop maps to its own kind.) */
const DIGITAL_GATE_LEAFS = new Set([
  "inv", "buf", "buf1", "and", "or", "xor", "schmitt", "schmtbuf", "schmtinv",
]);

/** Proven from the corresponding real LTspice application schematics: these
 * parts expose more/different terminals than opampO's in+/in-/out/v+/v- bank. */
const NON_FIVE_PIN_AMPLIFIER_LEAFS = new Set([
  "ad8235",
  "lt1168",
  "lt1194",
  "lt1795",
]);

/**
 * LTspice symbol-local pin offsets (R0), extracted from the installed LTspice
 * 17.2.4 library (`lib/sym/*.asy`). Order matches LTspice's PIN order, which is
 * also Tau's pin role order for the mapped kinds (e.g. voltage: + then −; npn:
 * C, B, E; nmos: D, G, S[, B]). Used by the connectivity step of the importer.
 *
 * NOTE: LTspice pin spacing differs from Tau's fixed symbol geometry (e.g. a
 * resistor is 80 units pin-to-pin in LTspice vs 64 in Tau). Faithful import
 * therefore needs imported components to carry their OWN pin positions rather
 * than reuse Tau's built-in geometry - see LTspice parity .md design note.
 */
export interface LtPin {
  name: string;
  dx: number;
  dy: number;
}
export const LTSPICE_PINS: Record<string, LtPin[]> = {
  res: [{ name: "1", dx: 16, dy: 16 }, { name: "2", dx: 16, dy: 96 }],
  // PAsystem RN55upright/UprightPowerResistor.asy: vertical pins A(0,-32)/B(0,0).
  rn55: [{ name: "1", dx: 0, dy: -32 }, { name: "2", dx: 0, dy: 0 }],
  cap: [{ name: "1", dx: 16, dy: 0 }, { name: "2", dx: 16, dy: 64 }],
  ind: [{ name: "1", dx: 16, dy: 16 }, { name: "2", dx: 16, dy: 96 }],
  voltage: [{ name: "+", dx: 0, dy: 16 }, { name: "-", dx: 0, dy: 96 }],
  // LTspice current.asy: "+" = SpiceOrder 1 at (0,0), "−" at (0,80), arrow
  // toward "−" - LTspice netlists `I N+ N−` and the current exits the "−" pin.
  // Tau's isource deck emission swaps to `I n p` under its raises-V(p)
  // convention, so LTspice's "−" pin must zip onto Tau's p (index 0) and "+"
  // onto n; the identity map would flip every imported source's sign (logamp's
  // I1 then starves the log loop and ngspice's op hangs in gmin stepping).
  current: [{ name: "-", dx: 0, dy: 80 }, { name: "+", dx: 0, dy: 0 }],
  // load.asy: A(16,0)=SpiceOrder1 (+), B(16,64)=SpiceOrder2 (−). Same polarity
  // zip as current.asy so Iload PWL demos (AD8410A) keep signed current.
  load: [{ name: "-", dx: 16, dy: 64 }, { name: "+", dx: 16, dy: 0 }],
  // load2.asy shares current.asy pin geometry (+(0,0)/−(0,80)).
  load2: [{ name: "-", dx: 0, dy: 80 }, { name: "+", dx: 0, dy: 0 }],
  // bi (B-current) has current.asy's geometry (+(0,0)/−(0,80)) but bsource
  // emission is `B p n` verbatim (no isource swap), so it keeps the identity
  // zip that `current` had to give up.
  bcurrent: [{ name: "+", dx: 0, dy: 0 }, { name: "-", dx: 0, dy: 80 }],
  diode: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  // PAsystem SMdiode.asy: vertical, centered pins A(0,-32)/C(0,32).
  smdiode: [{ name: "A", dx: 0, dy: -32 }, { name: "K", dx: 0, dy: 32 }],
  led: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  zener: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  schottky: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  npn: [{ name: "C", dx: 64, dy: 0 }, { name: "B", dx: 0, dy: 48 }, { name: "E", dx: 64, dy: 96 }],
  pnp: [{ name: "C", dx: 64, dy: 0 }, { name: "B", dx: 0, dy: 48 }, { name: "E", dx: 64, dy: 96 }],
  nmos: [{ name: "D", dx: 48, dy: 0 }, { name: "G", dx: 0, dy: 80 }, { name: "S", dx: 48, dy: 96 }],
  pmos: [{ name: "D", dx: 48, dy: 0 }, { name: "G", dx: 0, dy: 80 }, { name: "S", dx: 48, dy: 96 }],
  mos4: [
    { name: "D", dx: 48, dy: 0 },
    { name: "G", dx: 0, dy: 80 },
    { name: "S", dx: 48, dy: 96 },
    { name: "B", dx: 48, dy: 48 },
  ],
  // LTspice njf/pjf.asy pins (SpiceOrder D,G,S): gate at dy=64 (vs MOS dy=80).
  njf: [{ name: "D", dx: 48, dy: 0 }, { name: "G", dx: 0, dy: 64 }, { name: "S", dx: 48, dy: 96 }],
  // sw.asy (voltage-controlled switch), in SpiceOrder: the switched path A/B
  // then the control pair NC+/NC-. NC+ is the LOWER of the two control pins.
  sw: [
    { name: "A", dx: 0, dy: 16 },
    { name: "B", dx: 0, dy: 96 },
    { name: "NC+", dx: -48, dy: 80 },
    { name: "NC-", dx: -48, dy: 32 },
  ],
  // csw.asy (current-controlled switch) is a 2-pin symbol on its own geometry -
  // its control is a named source, not a pin pair, so it must not borrow sw's
  // bank or the two phantom control pins would land on whatever passes there.
  csw: [{ name: "+", dx: 0, dy: 0 }, { name: "-", dx: 0, dy: 80 }],
  // LTspice tline.asy pins, in SpiceOrder: I1,R1 (left port) / I2,R2 (right
  // port). Symbol-local offsets are centered; mapped to Tau's a1/a2/b1/b2.
  tline: [
    { name: "I1", dx: -48, dy: -16 },
    { name: "R1", dx: -48, dy: 16 },
    { name: "I2", dx: 48, dy: -16 },
    { name: "R2", dx: 48, dy: 16 },
  ],
  // Op-amps come in two geometry families (verified across the LTspice 17.2.4
  // OpAmps/ library). Ordered to Tau's opamp pin roles (in+, in-, out, v+, v-);
  // the v+/v- supply pins are skipped by net extraction (Tau models an ideal
  // 3-terminal opamp) but are carried for completeness.
  //   • opampC - the "centered" UniversalOpAmp/UniversalOpAmp2 layout.
  //   • opampO - the "offset" layout shared by opamp.asy, opamp2.asy and EVERY
  //     vendor part (AD823/LT1001/LT1028/AD711/OP07/…). The 3-pin ideal
  //     opamp.asy shares in+/in-/out with this family exactly.
  opampC: [
    { name: "in+", dx: -32, dy: 16 },
    { name: "in-", dx: -32, dy: -16 },
    { name: "out", dx: 32, dy: 0 },
    { name: "v+", dx: 0, dy: -32 },
    { name: "v-", dx: 0, dy: 32 },
  ],
  opampO: [
    { name: "in+", dx: -32, dy: 80 },
    { name: "in-", dx: -32, dy: 48 },
    { name: "out", dx: 32, dy: 64 },
    { name: "v+", dx: 0, dy: 32 },
    { name: "v-", dx: 0, dy: 96 },
  ],
  // Voltage/current-controlled sources, ordered to Tau's cp,cn,op,on roles.
  // LTspice SpiceOrder is out+,out-,ctrl+,ctrl-; e2/g2 swap the control pair.
  // VCVS (e/e2): out at +(0,16)/-(0,96), control P/N on the left at x=-48.
  vcvs: [
    { name: "cp", dx: -48, dy: 32 },
    { name: "cn", dx: -48, dy: 80 },
    { name: "op", dx: 0, dy: 16 },
    { name: "on", dx: 0, dy: 96 },
  ],
  vcvs2: [
    { name: "cp", dx: -48, dy: 80 },
    { name: "cn", dx: -48, dy: 32 },
    { name: "op", dx: 0, dy: 16 },
    { name: "on", dx: 0, dy: 96 },
  ],
  // VCCS (g/g2): output polarity is reversed vs e - +(0,96)/-(0,16).
  vccs: [
    { name: "cp", dx: -48, dy: 32 },
    { name: "cn", dx: -48, dy: 80 },
    { name: "op", dx: 0, dy: 96 },
    { name: "on", dx: 0, dy: 16 },
  ],
  vccs2: [
    { name: "cp", dx: -48, dy: 80 },
    { name: "cn", dx: -48, dy: 32 },
    { name: "op", dx: 0, dy: 96 },
    { name: "on", dx: 0, dy: 16 },
  ],
  // DIAC/TRIAC are variable-pin subcircuit instances; buildPinOverride assigns
  // p1..pN in this SpiceOrder rather than zipping them to a Tau primitive.
  diac: [{ name: "+", dx: 32, dy: 0 }, { name: "-", dx: 32, dy: 64 }],
  // TRIAC (Misc/TRIAC.asy, SpiceOrder MT2=1 / G=2 / MT1=3):
  //   MT2(32,0), G(-16,64), MT1(32,64).
  triac: [
    { name: "MT2", dx: 32, dy: 0 },
    { name: "G", dx: -16, dy: 64 },
    { name: "MT1", dx: 32, dy: 64 },
  ],
  // varistor (SpecialFunctions/varistor.asy): control voltage on pins 1/2,
  // clamped output on 7/com(8). All four are required for electrical parity.
  varistor: [
    { name: "invin", dx: -32, dy: 48 },
    { name: "noninvin", dx: -32, dy: 80 },
    { name: "out", dx: -16, dy: 32 },
    { name: "com", dx: -16, dy: 96 },
  ],
  // bi2 (B current source, alternate geometry): pins are bi's flipped - +(0,80)/−(0,0).
  bi2: [{ name: "+", dx: 0, dy: 80 }, { name: "-", dx: 0, dy: 0 }],
  // ── LTspice-library subcircuit symbols (`SYMATTR Prefix X`) ──────────────
  // Pins in SpiceOrder from the installed .asy files; the subckt branch of
  // buildPinOverride assigns ids p1..pN in this order (SPICE X-line node
  // order), with the .asy PinName kept as the display label.
  // Misc/TowTom2.asy - 2nd-order Tow-Thomas filter block (V1, V2, INV).
  towtom2: [
    { name: "V1", dx: -32, dy: 64 },
    { name: "V2", dx: -32, dy: -32 },
    { name: "INV", dx: -32, dy: 160 },
  ],
  // Opamps/opamp.asy - ideal single-pole op-amp (subckt opamp, bundled
  // opamp.sub). SpiceOrder 1=invin, 2=noninvin, 3=out; geometry matches the
  // opampO family but the X-line node order is inverting-input FIRST.
  opampIdeal: [
    { name: "invin", dx: -32, dy: 48 },
    { name: "noninvin", dx: -32, dy: 80 },
    { name: "out", dx: 32, dy: 64 },
  ],
  // SpecialFunctions/capmeter.asy - vector impedance meter (subckt capometer).
  capmeter: [
    { name: "DUT+", dx: -80, dy: 32 },
    { name: "DUT-", dx: -80, dy: 96 },
    { name: "bias", dx: -80, dy: -32 },
    { name: "Resistance", dx: 288, dy: 0 },
    { name: "Capacitance", dx: 288, dy: 64 },
  ],
  // ISO16750-2.asy / ISO7637-2.asy - automotive transient generators; both
  // are 2-pin sources with identical geometry (+ at the anchor, − below).
  isoTransient: [{ name: "+", dx: 0, dy: 0 }, { name: "-", dx: 0, dy: 80 }],
  // ── Digital A-devices (`Digital\*.asy`, LTspice 17.2.4) ──────────────────
  // Each .asy exposes a SUBSET of the 8-slot pin contract (1-5 in, 6 _Q, 7 Q,
  // 8 com), so these banks are mapped BY PIN ID, not positionally zipped: the
  // `name` fields below are Tau pin ids for the digitalGate/dflop kinds (see
  // buildPinOverride). Offsets verified against the installed library.
  // and.asy / or.asy share one geometry.
  digAnd: [
    { name: "in1", dx: -32, dy: 32 },
    { name: "in2", dx: -32, dy: 48 },
    { name: "in3", dx: -32, dy: 64 },
    { name: "in4", dx: -32, dy: 80 },
    { name: "in5", dx: -32, dy: 96 },
    { name: "qbar", dx: 32, dy: 80 },
    { name: "q", dx: 32, dy: 48 },
    { name: "com", dx: -16, dy: 96 },
  ],
  // xor.asy: inputs sit at x=-48 and Q at (16,48); outputs/com match digAnd.
  digXor: [
    { name: "in1", dx: -48, dy: 32 },
    { name: "in2", dx: -48, dy: 48 },
    { name: "in3", dx: -48, dy: 64 },
    { name: "in4", dx: -48, dy: 80 },
    { name: "in5", dx: -48, dy: 96 },
    { name: "qbar", dx: 32, dy: 80 },
    { name: "q", dx: 16, dy: 48 },
    { name: "com", dx: -16, dy: 96 },
  ],
  // inv.asy / schmtinv.asy: in, complementary output only.
  digInv: [
    { name: "in1", dx: 0, dy: 64 },
    { name: "qbar", dx: 64, dy: 64 },
    { name: "com", dx: 0, dy: 80 },
  ],
  // buf.asy / schmitt.asy: in, both outputs.
  digBuf: [
    { name: "in1", dx: 0, dy: 64 },
    { name: "qbar", dx: 64, dy: 80 },
    { name: "q", dx: 64, dy: 48 },
    { name: "com", dx: 0, dy: 96 },
  ],
  // buf1.asy / schmtbuf.asy: in, true output only.
  digBuf1: [
    { name: "in1", dx: 0, dy: 64 },
    { name: "q", dx: 64, dy: 64 },
    { name: "com", dx: 0, dy: 80 },
  ],
  // dflop.asy (SpiceOrder D=1, CLK=3, PRE=4, CLR=5, _Q=6, Q=7, com=8 - slot 2
  // is unused in the .asy; mapping is by name so the gap is irrelevant).
  dflop: [
    { name: "d", dx: -80, dy: 48 },
    { name: "clk", dx: -80, dy: 96 },
    { name: "pre", dx: 0, dy: 0 },
    { name: "clr", dx: 0, dy: 144 },
    { name: "qbar", dx: 96, dy: 96 },
    { name: "q", dx: 80, dy: 48 },
    { name: "com", dx: -80, dy: 144 },
  ],
  // srflop.asy (SpiceOrder S=1, R=2, _Q=6, Q=7, com=8).
  srflop: [
    { name: "s", dx: -48, dy: 48 },
    { name: "r", dx: -48, dy: 96 },
    { name: "qbar", dx: 64, dy: 96 },
    { name: "q", dx: 48, dy: 48 },
    { name: "com", dx: -48, dy: 128 },
  ],
  // Digital/phidet.asy: two clock inputs, current output, and common.
  phidet: [
    { name: "in1", dx: -32, dy: -16 },
    { name: "in2", dx: -32, dy: 16 },
    { name: "q", dx: 96, dy: 0 },
    { name: "com", dx: -32, dy: 48 },
  ],
  // SpecialFunctions/sample.asy (SAMPLEHOLD): id-mapped like the digital banks.
  // SpiceOrder in+=1, in-=2, CLK=3, S/H=4, out=7, com=8 (slots 5/6 unused).
  sampleHold: [
    { name: "in+", dx: -80, dy: -32 },
    { name: "in-", dx: -80, dy: 0 },
    { name: "clk", dx: -80, dy: 32 },
    { name: "sh", dx: -80, dy: 64 },
    { name: "out", dx: 96, dy: 16 },
    { name: "com", dx: -80, dy: 96 },
  ],
  // SpecialFunctions/modulate.asy (MODULATOR): id-mapped like sampleHold.
  // SpiceOrder FM=1, AM=2, Q(out)=7, com=8 (slots 3-6 unused).
  modulator: [
    { name: "fm", dx: 0, dy: 0 },
    { name: "am", dx: 0, dy: 64 },
    { name: "out", dx: 144, dy: 32 },
    { name: "com", dx: 0, dy: 96 },
  ],
};

/** Apply an LTspice orientation to a symbol-local point (LTspice screen Y is
 *  down; rotations are clockwise; `Mn` rotates by n first, THEN mirrors across
 *  the vertical axis). Mirror-then-rotate agrees for M0/M180 (mirror commutes
 *  with a 180° turn) but silently swaps the sign for M90/M270 - proven wrong
 *  against real wire geometry: LoopGain2's `voltage` probe at M270 must put
 *  pin (0,16) at (-16,0) onto its feed wire (the old (+16,0) landed both pins
 *  inside the same net segment → "shorted VSRC"), and P2's M270 caps floated. */
export function transformLtPoint(dx: number, dy: number, orientation: AscOrientation): { x: number; y: number } {
  const z = (n: number) => (n === 0 ? 0 : n); // normalize -0 → 0
  switch (orientation) {
    case "R90":
      return { x: z(-dy), y: z(dx) };
    case "M90":
      return { x: z(dy), y: z(dx) };
    case "R180":
      return { x: z(-dx), y: z(-dy) };
    case "M180":
      return { x: z(dx), y: z(-dy) };
    case "R270":
      return { x: z(dy), y: z(-dx) };
    case "M270":
      return { x: z(-dy), y: z(-dx) };
    case "M0":
      return { x: z(-dx), y: z(dy) };
    default:
      return { x: z(dx), y: z(dy) };
  }
}

/** Convert an LTspice orientation to a Tau rotation (degrees). Mirror flips are
 *  approximated by their rotation for now (Tau has no mirror flag yet). */
export function orientationToRotation(orientation: AscOrientation): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case "R90":
      return 90;
    // LT mirrors after rotating; Tau mirrors before rotating. The quarter-turn
    // tokens therefore swap so the rendered body and exact LT pin bank agree.
    case "M270":
      return 90;
    case "R180":
    case "M180":
      return 180;
    case "R270":
      return 270;
    case "M90":
      return 270;
    default:
      return 0;
  }
}

/**
 * Map an LTspice symbol type to the {@link LTSPICE_PINS} key holding its
 * symbol-local pin offsets. Returns `null` when no pin geometry is banked
 * (vendor symbols, opamps, transformers, pots - those need `.asy` import).
 */
/** Whether {@link LTSPICE_PINS} banks pin geometry for this LTspice symbol
 * type - i.e. re-importing the same SYMBOL line reconstructs the same
 * pin positions. Used by the ASC exporter to decide when an imported part's
 * original symbol name can be re-emitted verbatim. */
export function hasBankedLtPins(type: string): boolean {
  return ltPinKey(type) !== null;
}

function ltPinKey(type: string): keyof typeof LTSPICE_PINS | null {
  const base = type.replace(/\\/g, "/").toLowerCase();
  const leaf = (base.split("/").pop() ?? "");
  // Opamps\opamp (ideal single-pole, subckt kind) banks in SpiceOrder, which
  // is invin-first - NOT the in+/in-/out role order of the opampO family.
  // Mirrors ltspiceTypeToKind's leaf gate.
  if (leaf === "opamp") return "opampIdeal";
  // Any op-amp (vendor part or generic) banks to one of two geometry families:
  // the centered UniversalOpAmp layout or the offset layout every other opamp
  // shares. Mirrors ltspiceTypeToKind's `base.includes("opamp")` detection.
  if (base.includes("opamp")) {
    return leaf.includes("universalopamp") ? "opampC" : "opampO";
  }
  // Digital A-devices (path-gated like ltspiceTypeToKind). Their banks are
  // id-mapped, not zipped - see the digital branch of buildPinOverride.
  if (base.includes("digital/")) {
    const digital: Record<string, keyof typeof LTSPICE_PINS> = {
      and: "digAnd", or: "digAnd", xor: "digXor",
      inv: "digInv", schmtinv: "digInv",
      buf: "digBuf", schmitt: "digBuf",
      buf1: "digBuf1", schmtbuf: "digBuf1",
      dflop: "dflop", srflop: "srflop", phidet: "phidet",
    };
    return digital[leaf] ?? null;
  }
  // SpecialFunctions\sample / \modulate - id-mapped banks (mirror
  // ltspiceTypeToKind's path gates).
  if (base.includes("specialfunctions/") && leaf === "sample") return "sampleHold";
  if (base.includes("specialfunctions/") && leaf === "modulate") return "modulator";
  const map: Record<string, keyof typeof LTSPICE_PINS> = {
    res: "res", res2: "res", r: "res",
    rn55upright: "rn55", uprightpowerresistor: "rn55",
    cap: "cap", cap2: "cap", c: "cap", polcap: "cap",
    smcap: "cap", mylarcap: "cap", coaxcap7: "cap",
    ind: "ind", ind2: "ind", l: "ind",
    voltage: "voltage", battery: "voltage", signal: "voltage",
    current: "current",
    load: "load",
    load2: "load2",
    diode: "diode", schottky: "schottky", zener: "zener", led: "led",
    varactor: "diode", smdiode: "smdiode",
    npn: "npn", npn3: "npn", npn4: "npn", "2n3904": "npn",
    pnp: "pnp", pnp3: "pnp", pnp4: "pnp", "2n3906": "pnp",
    nmos: "nmos", nmos4: "mos4",
    pmos: "pmos", pmos4: "mos4",
    njf: "njf", pjf: "njf", "2n5458": "njf",
    sw: "sw", csw: "csw",
    tline: "tline", ltline: "tline",
    // Controlled sources: e/e2 = VCVS, g/g2 = VCCS. The `2` variants swap the
    // control pair (see LTSPICE_PINS). f/h (current-controlled) expose only two
    // output pins - their control is a named device, not a pin pair - so they
    // stay unbanked (null) and fall back to Tau geometry.
    e: "vcvs", e2: "vcvs2", g: "vccs", g2: "vccs2",
    // Behavioral sources share the independent-source pin geometry: the bv
    // (voltage) symbol pins match `voltage`, bi (current) match `current`.
    bv: "voltage", bi: "bcurrent", bi2: "bi2", b: "voltage", b2: "voltage",
    // xtal (Misc/xtal.asy): pins A(16,0)/B(16,64) - same geometry as cap.asy.
    xtal: "cap",
    // DIAC (Misc/DIAC.asy): +(32,0)/-(32,64) - 2-terminal; own bank (x≠cap's 16).
    diac: "diac",
    // TRIAC (Misc/TRIAC.asy): MT2(32,0)/G(-16,64)/MT1(32,64) - 3-terminal.
    triac: "triac",
    // varistor (SpecialFunctions/varistor.asy): four-terminal control/clamp.
    varistor: "varistor",
    // Library subcircuit symbols (Prefix X) - banks are SpiceOrder-ordered;
    // the subckt branch of buildPinOverride assigns p1..pN ids.
    towtom2: "towtom2",
    capmeter: "capmeter",
    "iso16750-2": "isoTransient",
    "iso7637-2": "isoTransient",
  };
  return map[leaf] ?? null;
}

/** A faithfully-imported LTspice schematic, ready to hand to the Tau store. */
export interface AscImportResult {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  /** SPICE directives (`TEXT … !…`), in document order, leading "!" stripped. */
  directives: string[];
  /** Free-text comments (`TEXT … ;…`), leading ";" stripped. */
  comments: string[];
  /** Original TEXT records with positions, retained for lossless `.asc` save. */
  textAnnotations: AscText[];
  /** Original drawing primitives retained for lossless `.asc` save. */
  shapes: AscShape[];
  /** Original `DATAFLAG` readouts retained for lossless `.asc` save. */
  dataFlags: AscDataFlag[];
  /**
   * Source `SYMBOL` records Tau has no equivalent for (e.g. a vendor part like
   * "PowerProducts\\LTC4449"), retained verbatim so an in-place save does not
   * silently delete the part from the user's file.
   */
  foreignSymbols: AscSymbol[];
  /**
   * Source `SYMBOL` records that resolved to a hierarchical block and were
   * flattened into `components`. Unlike `foreignSymbols` these DO simulate -
   * the record is retained only so a save can tell a resolved block apart from
   * a symbol Tau cannot map, and so the exporter can one day re-emit the block
   * instead of its flattened parts. A block's own nested blocks belong to the
   * child file and are not carried here.
   */
  hierarchicalBlocks: SchematicHierarchicalBlock[];
  /** Original SHEET record retained for lossless `.asc` save. */
  sheet: AscDocument["sheet"];
  /** Non-fatal issues (symbols placed without pin-accurate geometry, etc.). */
  warnings: string[];
  /**
   * Informational notes about geometry-carrier mappings - the file opened clean
   * and all retained nets are correct, but the part has no equivalent Tau
   * electrical model. Simulation refuses these carriers. Notes do not affect
   * the import warning count.
   */
  notes: string[];
}

/**
 * Build the per-component world pin positions that make an imported part meet
 * the original LTspice wires. Returns `null` when this symbol has no banked pin
 * geometry (caller falls back to Tau geometry and warns).
 *
 * LTSPICE_PINS is ordered to match each kind's Tau pin-role order, so we zip the
 * LTspice offsets onto Tau's local pin ids/labels. 3-terminal MOS symbols tie
 * the bulk to the source (LTspice's convention) so the 4-node device still
 * resolves every terminal.
 */
function buildPinOverride(
  symbol: AscSymbol,
  kind: ComponentKind,
  symbolMetadata?: AsySymbol | null,
): PinOverride[] | null {
  const metadataPins = symbolMetadata?.pins.length
    && (kind === "subckt" || symbolMetadata.pins.length === getLocalPins(kind).length)
    ? symbolMetadata.pins.map((pin) => ({ name: pin.name, dx: pin.x, dy: pin.y }))
    : null;
  const key = ltPinKey(symbol.type);
  const ltPins = metadataPins ?? (key ? LTSPICE_PINS[key] : null);
  if (!ltPins) return null;
  const tauPins = getLocalPins(kind);
  if (ltPins.length === 0 || tauPins.length === 0) return null;

  // Digital gates expose a per-.asy SUBSET of the kind's full pin bank (e.g.
  // inv.asy has only in1/qbar/com), so a positional zip would misassign roles.
  // Their LTSPICE_PINS entries carry Tau pin ids as names - map by id, and emit
  // ONLY the pins the .asy actually has (the deck builder ignores absent pins,
  // matching LTspice's floating-input semantics). sampleHold and modulator
  // share the scheme.
  if (kind === "digitalGate" || kind === "dflop" || kind === "srflop" || kind === "tflop" || kind === "jkflop" || kind === "sampleHold" || kind === "modulator") {
    const byId = new Map(tauPins.map((p) => [p.id, p]));
    const override: PinOverride[] = [];
    for (const lt of ltPins) {
      const tau = byId.get(lt.name);
      if (!tau) continue;
      const offset = transformLtPoint(lt.dx, lt.dy, symbol.orientation);
      override.push({
        id: tau.id,
        label: tau.label,
        x: symbol.x + offset.x,
        y: symbol.y + offset.y,
      });
    }
    return override.length > 0 ? override : null;
  }

  // A subcircuit instance has a variable pin count set by its .asy, not by the
  // kind's default 2-port geometry: assign ids p1..pN in SpiceOrder (the deck
  // builder emits X-line nodes in that order) and keep the .asy PinName as the
  // display label.
  if (kind === "subckt") {
    return ltPins.map((lt, i) => {
      const offset = transformLtPoint(lt.dx, lt.dy, symbol.orientation);
      return {
        id: `p${i + 1}`,
        label: lt.name,
        x: symbol.x + offset.x,
        y: symbol.y + offset.y,
      };
    });
  }

  const count = Math.min(ltPins.length, tauPins.length);
  const override: PinOverride[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = transformLtPoint(ltPins[i].dx, ltPins[i].dy, symbol.orientation);
    override.push({
      id: tauPins[i].id,
      label: tauPins[i].label,
      x: symbol.x + offset.x,
      y: symbol.y + offset.y,
    });
  }

  // 3-pin LTspice MOS symbols omit the bulk terminal; Tau models it as a 4th
  // node tied to the source so the netlist's body node resolves.
  if ((kind === "nmos" || kind === "pmos") && override.length === 3 && tauPins.length >= 4) {
    const source = override[2];
    const bulk = tauPins[3];
    override.push({ id: bulk.id, label: bulk.label, x: source.x, y: source.y });
  }

  return override;
}

const pointOnImportedWire = (point: { x: number; y: number }, wire: SchematicWire): boolean => {
  for (let index = 1; index < wire.points.length; index += 1) {
    const a = wire.points[index - 1];
    const b = wire.points[index];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (cross !== 0) continue;
    if (point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
  }
  return false;
};

/** Recover files written by Tau versions that serialized native Tau anchors as
 * LTspice anchors without TauKind metadata. Their visible/native terminals meet
 * the saved conductors while the reconstructed LT pin bank misses them all.
 * Genuine LTspice files score the opposite way and remain untouched. */
function recoverLegacyTauPinGeometry(
  components: SchematicComponent[],
  wires: SchematicWire[],
  netLabels: NetLabel[],
): { components: SchematicComponent[]; recovered: number } {
  const anchors = new Set([
    ...netLabels.map((label) => `${label.x},${label.y}`),
    ...components.filter((component) => component.kind === "ground").map((component) => `${component.x},${component.y}`),
  ]);
  const connected = (point: { x: number; y: number }) =>
    anchors.has(`${point.x},${point.y}`) || wires.some((wire) => pointOnImportedWire(point, wire));

  const candidates = components.flatMap((component) => {
    if (!component.pinOverride?.length) return [];
    const nativePins = getLocalPins(component.kind).map((pin) => {
      const offset = transformPoint(pin, component.rotation, component.mirrored ?? false);
      return { x: component.x + offset.x, y: component.y + offset.y };
    });
    const nativeScore = nativePins.filter(connected).length;
    const overrideScore = component.pinOverride.filter(connected).length;
    return [{ component, nativeScore, overrideScore }];
  });
  const nativeTotal = candidates.reduce((sum, candidate) => sum + candidate.nativeScore, 0);
  const overrideTotal = candidates.reduce((sum, candidate) => sum + candidate.overrideScore, 0);
  if (nativeTotal < overrideTotal + 2) return { components, recovered: 0 };

  const recoverIds = new Set(
    candidates
      .filter((candidate) => candidate.nativeScore > candidate.overrideScore)
      .map((candidate) => candidate.component.id),
  );
  return {
    recovered: recoverIds.size,
    components: components.map((component) => {
      if (!recoverIds.has(component.id)) return component;
      const { pinOverride: _legacy, ltSymbolType: _legacyType, ...native } = component;
      return native;
    }),
  };
}

/**
 * Convert a parsed LTspice document into Tau schematic content with
 * pin-accurate connectivity. Symbols become components carrying absolute world
 * pin positions (`pinOverride`) so they land on the original wires; FLAGs become
 * ground symbols ("0") or net labels; `TEXT !` lines are surfaced as directives.
 *
 * Coordinates are kept 1:1 with LTspice's 16-unit grid (Tau's GRID is also 16),
 * so wires, pins, and labels stay in one consistent integer coordinate space and
 * nets extract exactly as LTspice intends.
 */
/** Independent-source kinds whose LTspice `Value2`/`SpiceLine` carry the
 *  `AC <mag> [phase]` stimulus (and other inline spec) that concatenates onto
 *  the SPICE source line. Behavioral B-sources (`bv`/`bi`) also split long
 *  `V=`/`I=` expressions across Value/Value2 (MicroCode.asc `if(` …); join
 *  those the same way. For every other kind we keep only `Value` (Value2 on
 *  a semiconductor names instance params the generic models don't consume yet). */
const SOURCE_KINDS_WITH_INLINE_SPEC = new Set<ComponentKind>(["vsource", "isource", "bsource"]);

/**
 * `SYMATTR` fields Tau reads structure out of: the two LTspice writes for every
 * part, plus the metadata the exporter adds for a Tau-only kind. Everything
 * else is an extended slot carried verbatim ({@link LtspiceExtraAttrs}). The
 * exporter and the save guard both key off this list, so it lives in one place.
 */
export const RESERVED_SYMATTR_FIELDS: readonly string[] = [
  "InstName", "Value", "TauKind", "TauValue", "TauLabel", "TauAttrs", "TauPins",
];

/**
 * The Tau-only slot holding the extended slots of a part written out under a
 * carrier symbol. A Tau-native kind (a switch, a subcircuit, …) is saved as a
 * placeholder resistor, so its own `Value2`/`SpiceLine` cannot be re-emitted
 * under those names - on a resistor they would mean something else entirely.
 * They ride here instead, beside the `TauKind` that says what part they belong
 * to; LTspice ignores the field, and Tau restores the split on reopen.
 */
export const TAU_CARRIED_ATTRS_FIELD = "TauAttrs";
/** Tau-only, URI-encoded compact terminal geometry for native X blocks. */
export const TAU_PINS_FIELD = "TauPins";

/** Upper bounds on a carried set. Generous next to any real symbol (LTspice
 *  itself writes four spec slots) and small enough that a crafted file cannot
 *  grow one component's attributes without bound across repeated saves. */
const MAX_CARRIED_ATTRS = 16;
const MAX_CARRIED_ATTRS_LENGTH = 4096;

/** A SYMATTR field name that survives `SYMATTR <name> <value>` unchanged. */
const SYMATTR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True when the text holds a control character - a newline in an attribute
 *  value would forge whole `.asc` records the next time it is written out. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Serialize the slots (and the `Value` they sat beside) for
 * {@link TAU_CARRIED_ATTRS_FIELD}. Compact JSON: the `.asc` parser reads an
 * attribute as the rest of its line and collapses runs of whitespace, and the
 * attribute values it produces are already single-space normalized, so the
 * encoded form survives a parse unchanged.
 */
export function encodeCarriedAttrs(baseValue: string, extras: Record<string, string>): string {
  return JSON.stringify({ base: baseValue, slots: extras });
}

/**
 * Read {@link TAU_CARRIED_ATTRS_FIELD} back. Returns `null` for anything Tau
 * did not write: the field is file content, so a hand-edited or hostile `.asc`
 * can put arbitrary text here and the only safe response is to ignore it.
 *
 * A decoded name has to be a real SYMATTR field name, and never a reserved one
 * (a `TauKind` or `InstName` slot would overwrite the part's identity when the
 * exporter writes the set back out). A decoded value has to be free of control
 * characters, or a newline in it would forge whole records on the next save.
 */
export function decodeCarriedAttrs(
  encoded: string,
): { baseValue: string; extras: Record<string, string> } | null {
  if (encoded.length > MAX_CARRIED_ATTRS_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { base, slots } = parsed as { base?: unknown; slots?: unknown };
  if (typeof base !== "string") return null;
  if (typeof slots !== "object" || slots === null || Array.isArray(slots)) return null;
  const entries = Object.entries(slots as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_CARRIED_ATTRS) return null;
  const extras: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!SYMATTR_NAME.test(name) || RESERVED_SYMATTR_FIELDS.includes(name)) return null;
    if (typeof value !== "string" || hasControlCharacter(value)) return null;
    extras[name] = value;
  }
  if (hasControlCharacter(base)) return null;
  return { baseValue: base, extras };
}

const MAX_TAU_PINS_LENGTH = 32768;
const MAX_TAU_PIN_OFFSET = 1_000_000;

/** Persist native p1..pN geometry relative to the component anchor. */
export function encodeTauPins(component: Pick<SchematicComponent, "x" | "y" | "pinOverride">): string | null {
  const pins = component.pinOverride;
  if (!pins || pins.length === 0 || pins.length > 64) return null;
  const rows = pins.map((pin, index) => {
    const dx = pin.x - component.x;
    const dy = pin.y - component.y;
    if (pin.id !== `p${index + 1}` || pin.label.length > 80 || hasControlCharacter(pin.label)) return null;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > MAX_TAU_PIN_OFFSET || Math.abs(dy) > MAX_TAU_PIN_OFFSET) return null;
    return [pin.id, pin.label, dx, dy] as const;
  });
  if (rows.some((row) => row === null)) return null;
  const encoded = encodeURIComponent(JSON.stringify(rows));
  return encoded.length <= MAX_TAU_PINS_LENGTH ? encoded : null;
}

/** Decode only the exact bounded shape Tau writes; hostile metadata is ignored. */
export function decodeTauPins(encoded: string, x: number, y: number): PinOverride[] | null {
  if (encoded.length === 0 || encoded.length > MAX_TAU_PINS_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) return null;
  const pins: PinOverride[] = [];
  for (const [index, candidate] of parsed.entries()) {
    if (!Array.isArray(candidate) || candidate.length !== 4) return null;
    const [id, label, dx, dy] = candidate;
    if (id !== `p${index + 1}` || typeof label !== "string" || label.length > 80 || hasControlCharacter(label)) return null;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (Math.abs(dx) > MAX_TAU_PIN_OFFSET || Math.abs(dy) > MAX_TAU_PIN_OFFSET) return null;
    pins.push({ id, label, x: x + dx, y: y + dy });
  }
  return pins;
}

/**
 * The warning a `SYMBOL` with no Tau kind and no resolvable subcircuit raises.
 * Exported so the save-risk check can subtract the exact messages belonging to
 * symbols it already knows are carried verbatim; matching the text with a
 * regex there would let the two drift apart silently.
 */
export function foreignSymbolWarning(instName: string, symbolType: string): string {
  return `Skipped ${instName || "an unnamed part"}: no Tau equivalent for LTspice symbol "${symbolType}".`;
}

/** The extended slots of a symbol's attributes, in the order the file wrote
 *  them, or `null` when it carried none. */
export function extendedSymbolAttrs(attrs: Record<string, string>): Record<string, string> | null {
  const extras: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!RESERVED_SYMATTR_FIELDS.includes(name)) extras[name] = value;
  }
  return Object.keys(extras).length > 0 ? extras : null;
}

/**
 * Build a Tau component value from a symbol's SYMATTR attributes. For
 * independent sources, append `Value2` and `SpiceLine` to `Value` (space-joined)
 * so the LTspice `AC <mag> [phase]` stimulus - and any other inline source spec
 * - rides on the value, exactly as LTspice concatenates them on the netlist
 * line. Other kinds map `Value` only.
 */
/** LTspice empty SYMATTR fields are often the quoted sentinel `""` / `''`.
 * Treat those as absent so they are not joined into Value (LT3956 V1). */
function normalizeLtspiceAttr(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^["']*$/.test(trimmed) ? "" : trimmed;
}

export function componentValueFromAttrs(
  kind: ComponentKind,
  attrs: Record<string, string>,
): string {
  // LTspice writes an empty source value as the quoted sentinel `""` (a 0 V/0 A
  // source, typically excited only by its AC spec). Normalize it to empty.
  const base = normalizeLtspiceAttr(attrs.Value);
  if (SOURCE_KINDS_WITH_INLINE_SPEC.has(kind)) {
    // LTspice can split one transient spec across all four attribute fields
    // (e.g. `Value SINE(` / `Value2 0 100u` / `SpiceLine 5Meg` /
    // `SpiceLine2 0 0 0 1)`), so concatenate every field - in document order -
    // to reconstruct the full netlist value, exactly as LTspice joins them.
    const extras = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map(normalizeLtspiceAttr)
      .filter(Boolean);
    return [base, ...extras].filter(Boolean).join(" ");
  }
  // A transmission line whose `Value` is omitted inherits its .asy symbol
  // default (LTspice's tline.asy ships `Td=50n Z0=50`), so an empty import must
  // adopt that default rather than a bare/ambiguous value.
  if (kind === "tline") {
    return base || "Td=50n Z0=50";
  }
  // An op-amp's behavioral params ride on the extra attributes (UniversalOpamp2
  // writes `Value2 Avol=1Meg GBW=10Meg Slew=10Meg`); keep them all so the deck
  // builder can read Avol for the rail-clamped model (engine/opampSpec.ts).
  if (kind === "opamp") {
    const extras = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map(normalizeLtspiceAttr)
      .filter(Boolean);
    return [base, ...extras].filter(Boolean).join(" ");
  }
  // Digital A-devices spread `Vhigh=/Vlow=/Vt=/Vhys=/Td=` across all four
  // attribute fields (Electrometer.asc: `Value Vhigh=0 Vlow=-5` +
  // `Value2 Trise=10n`); join them all for parseDigitalGate, which skips
  // unknown tokens. The caller prepends the gate function (from the symbol
  // path) since LTspice encodes it in the symbol name, not the value.
  if (kind === "digitalGate" || kind === "dflop" || kind === "srflop" || kind === "tflop" || kind === "jkflop" || kind === "sampleHold" || kind === "modulator") {
    const extras = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map(normalizeLtspiceAttr)
      .filter(Boolean);
    return [base, ...extras].filter(Boolean).join(" ");
  }
  // Capacitors/inductors may carry an initial condition in any of the spec
  // attributes (LTspice writes e.g. `SpiceLine2 IC=1`). Append just the `IC=`
  // token - not the whole attribute, which can hold ngspice-incompatible
  // LTspice-only keys (Rser, Cpar, …).
  if (kind === "capacitor" || kind === "polarizedCapacitor" || kind === "inductor") {
    // A nonlinear (Chan) magnetic-core inductor spreads its core geometry across
    // Value2/SpiceLine (A=/Lm=/Lg=/N=); keep all of it so the deck builder can
    // size the equivalent linear inductance. Plain L/C keep just the `IC=` token.
    if (kind === "inductor" && /\b(hc|bs|br|lm|lg)\s*=/i.test(base)) {
      const extras = [attrs.Value2, attrs.SpiceLine]
        .map((s) => s?.trim())
        .filter((s): s is string => !!s && !/^rser\b/i.test(s));
      return [base, ...extras].join(" ").trim();
    }
    const ic = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map((s) => parseIcValue(s ?? ""))
      .find((v): v is string => v !== null);
    // Retain only parasitics Tau actually translates. Vendor metadata often
    // shares SpiceLine (`Irms=1.5 Rser=.1`); copying it wholesale makes the
    // capacitance/inductance token unparsable. Lser identifies Misc\xtal and
    // its BVD expansion; ordinary C/L Rser is expanded explicitly by the deck.
    const parasitics = [...(attrs.SpiceLine ?? "").matchAll(/\b(Rser|Lser|Cpar)\s*=\s*([^\s]+)/gi)]
      .filter((match) => kind === "capacitor" || kind === "polarizedCapacitor" || match[1].toLowerCase() === "rser")
      .map((match) => `${match[1]}=${match[2]}`);
    return [base, ...parasitics, ...(ic !== undefined ? [`IC=${ic}`] : [])]
      .filter(Boolean)
      .join(" ");
  }
  return base;
}

/** Reconstruct LTspice's W-device tail from the fields csw.asy assigns to it:
 * `SpiceModel` is the controlling voltage-source name, `Value` is the CSW
 * model name, and a trailing instance state lives in the normal spec slots.
 * The installed csw.asy supplies `Value CSW` as a symbol default, so a
 * schematic normally omits that field when it has not been customized. */
export function currentSwitchValueFromAttrs(attrs: Record<string, string>): string {
  const controlSource = (attrs.SpiceModel ?? "").trim();
  const model = (attrs.Value ?? "").trim() || "CSW";
  const tail = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return [controlSource, model, ...tail].filter(Boolean).join(" ");
}

/** A resolved hierarchical block: the `.asy` symbol (ports) plus the `.asc`
 *  schematic body it stands for. Returned by a {@link SubcircuitResolver}. */
export interface SubcircuitDef {
  symbol: AsySymbol;
  body: AscDocument;
}

/** Resolve an LTspice symbol type (e.g. "deadtime") to its hierarchical block
 *  definition, or `null` if it is not a sub-schematic. The Open dialog backs
 *  this with sibling-file reads; tests back it with in-memory fixtures. */
export type SubcircuitResolver = (symbolType: string) => SubcircuitDef | null;
/** Resolve user-owned `.asy` defaults without requiring a sibling `.asc` body.
 * Used for vendor model identity only; defaults are not merged into source
 * attrs, so lossless save still reflects exactly what the `.asc` contained. */
export type SymbolMetadataResolver = (symbolType: string) => AsySymbol | null;

/** Options for {@link ascToSchematic}. */
export interface AscImportOptions {
  /** Resolve a symbol with no built-in kind to a hierarchical sub-schematic. */
  resolveSubcircuit?: SubcircuitResolver;
  /** Resolve model metadata declared by a user-owned `.asy` symbol. */
  resolveSymbolMetadata?: SymbolMetadataResolver;
  /** Internal: recursion depth (guards against a symbol referencing itself). */
  _depth?: number;
  /** Internal: shared placement cursor so every flattened block lands in its
   *  own disjoint X-region (no false geometric net merges between instances). */
  _placement?: { nextX: number };
  /** Internal: parents already on the resolution stack (cycle guard by name). */
  _stack?: ReadonlySet<string>;
}

const MAX_SUBCIRCUIT_DEPTH = 16;
/** Gap left between adjacent flattened blocks (LTspice grid units). */
const SUBCIRCUIT_MARGIN = 1000;
const isGroundNet = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return t === "0" || t === "gnd";
};

/** Bounding-box min-X over an already-built result (components incl. their pin
 *  overrides, wires, net labels). Used to pack flattened blocks side by side. */
function resultBounds(r: AscImportResult): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  const see = (x: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };
  for (const c of r.components) {
    see(c.x);
    for (const p of c.pinOverride ?? []) see(p.x);
  }
  for (const w of r.wires) for (const p of w.points) see(p.x);
  for (const n of r.netLabels) see(n.x);
  if (minX === Infinity) {
    minX = 0;
    maxX = 0;
  }
  return { minX, maxX };
}

/**
 * Flatten a hierarchical block instance into parent-frame schematic content.
 *
 * LTspice resolves an `X` instance by name-matching the `.asy` pins to the
 * body's labelled IOPINs and substituting the parent's nets for those ports.
 * Tau has no subcircuit device, so we inline the body instead - which reuses the
 * full netlist/solver stack (TS *and* native) unchanged. Two rules make the
 * inline electrically exact:
 *   1. **Ports bridge by name.** Each `.asy` pin maps to a unique synthetic net
 *      `<inst>:<pin>`. A net label with that name is dropped at the pin's parent
 *      world position (so it joins the parent net there) and the body's same-
 *      named net is renamed to it - wiring the body port to the parent net.
 *   2. **Internals stay private.** Every other body net is prefixed `<inst>/…`
 *      so two instances of one block never short their internals together;
 *      ground (`0`/`GND`) is left global, exactly as ngspice treats subckt node 0.
 * Body geometry is shifted into its own disjoint X-region (via the shared
 * placement cursor) so no body pin/wire can coincide with parent or sibling
 * content and forge a false net.
 */
function flattenSubcircuit(
  symbol: AscSymbol,
  def: SubcircuitDef,
  instName: string,
  hierarchyOwner: string,
  options: AscImportOptions,
  newId: (prefix: string) => string,
): { result: AscImportResult; bridges: NetLabel[] } {
  const placement = options._placement ?? { nextX: 1_000_000 };
  const stack = options._stack ?? new Set<string>();

  // LTspice CELL/BLOCK params live on the .asy as defaults and on the parent
  // SYMBOL as per-instance overrides. Substitute them textually before
  // recursion so nested instances inherit the resolved expressions while
  // global references such as `{Vout}` remain for the parent param scope.
  const bindings = new Map<string, string>();
  for (const attrs of [def.symbol.attrs, symbol.attrs]) {
    for (const field of ["Value", "Value2", "SpiceLine", "SpiceLine2"]) {
      const text = attrs[field]?.trim() ?? "";
      if (!text.includes("=")) continue;
      for (const assignment of parseParamAssignments(text)) {
        bindings.set(assignment.name.toLowerCase(), assignment.expr);
      }
    }
  }
  const substituteBindings = (text: string): string => {
    let result = text;
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      result = result.replace(/\{([A-Za-z_]\w*)\}/g, (match, name: string) => {
        const expression = bindings.get(name.toLowerCase());
        if (expression === undefined) return match;
        changed = true;
        const trimmed = expression.trim();
        if (/^\{.*\}$/.test(trimmed) || /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?[A-Za-zµ]*$/i.test(trimmed)) return trimmed;
        return `{${trimmed}}`;
      });
      if (!changed) break;
    }
    return result;
  };
  const parameterizedBody: AscDocument = bindings.size === 0 ? def.body : {
    ...def.body,
    symbols: def.body.symbols.map((bodySymbol) => ({
      ...bodySymbol,
      attrs: Object.fromEntries(Object.entries(bodySymbol.attrs).map(([key, value]) => [key, substituteBindings(value)])),
    })),
    texts: def.body.texts.map((text) => ({ ...text, text: substituteBindings(text.text) })),
  };

  // Recurse first so nested blocks resolve and the body is fully flat.
  const body = ascToSchematic(parameterizedBody, {
    ...options,
    _depth: (options._depth ?? 0) + 1,
    _placement: placement,
    _stack: new Set([...stack, symbol.type.toLowerCase()]),
  });
  // BLOCK/CELL bodies commonly define implementation-only `.param` values
  // used by their own R/C/source fields (for example PowerSim TYPE2 computes
  // R1/C1/C2 from the instance's gain and corner frequencies). Those body
  // directives must not leak into the parent deck, but dropping all of them
  // before resolving `{R1}` left otherwise-complete flattened blocks with
  // unparseable component values. Resolve the private scope while the body is
  // still isolated, after per-instance bindings have been substituted.
  let bodyComponents = body.components;
  try {
    const localDirectives = parameterizedBody.texts
      .filter((text) => text.directive)
      .map((text) => text.text);
    // Lenient per-component resolution: a body may intentionally reference a
    // parent/global parameter - keep THAT brace for the top-level scope while
    // still resolving every sibling value the private scope can satisfy. (The
    // previous all-or-nothing pass abandoned the whole block on the first
    // parent-scope reference, leaving e.g. `{Cnom}` unresolved next to fully
    // local `{Co}` values that then failed deck-building.)
    const localScope = buildPartialParamScope(localDirectives);
    // Local params only the PARENT scope can finish evaluating (LPF's
    // `.param Co=1/({f}*2k*PI)` with instance-bound `f={soc_flt}`): their
    // .param directives are dropped with the body, so expand them textually
    // into every value that references them - the enclosing flatten (or the
    // top-level deck scope) completes the numeric evaluation.
    const expandUnresolvedBraces = (text: string): string => {
      if (localScope.unresolved.size === 0 || !text.includes("{")) return text;
      let result = text;
      for (let pass = 0; pass < 8; pass += 1) {
        const next = result.replace(/\{([^{}]*)\}/g, (_m, inner: string) => `{${substituteIdentifierExpressions(inner, localScope.unresolved)}}`);
        if (next === result) break;
        result = next;
      }
      return result;
    };
    bodyComponents = body.components.map((component) => {
      if (!component.value) return component;
      // Behavioral expressions (PowerSim TIMER's `V=IF(time>=T,1,0)`) may
      // reference the block's private params BARE, not `{braced}` - LTspice
      // binds those late from the subckt scope. Bind them here, textually,
      // while the private scope still exists; run-time names (`time`,
      // `V(node)`) survive untouched.
      if (/^\s*[VIR]\s*=/i.test(component.value)) {
        const inlined = inlineFuncCalls(component.value, localScope.funcs);
        const bound = substituteScopeIdentifiers(substituteBehavioralBraces(inlined, localScope), localScope);
        return { ...component, value: substituteIdentifierExpressions(bound, localScope.unresolved) };
      }
      return component.value.includes("{")
        ? { ...component, value: substituteKnownBraces(expandUnresolvedBraces(substituteKnownBraces(component.value, localScope)), localScope) }
        : component;
    });
  } catch {
    // Malformed local .param directives: leave values untouched rather than
    // failing the import; the top-level scope may still resolve them.
  }

  // Port net renames: <asy pin name> → <inst>:<pin>, and a parent-side bridge
  // label at each pin's world position so the body port joins the parent net.
  const portRename = new Map<string, string>();
  const bridges: NetLabel[] = [];
  for (const pin of def.symbol.pins) {
    const synthetic = `${instName}:${pin.name}`;
    portRename.set(pin.name, synthetic);
    const offset = transformLtPoint(pin.x, pin.y, symbol.orientation);
    bridges.push({ id: newId("n"), x: symbol.x + offset.x, y: symbol.y + offset.y, text: synthetic });
  }

  // Pack the body into a fresh X-region; keep Y so geometry stays compact.
  const { minX, maxX } = resultBounds(body);
  const dx = placement.nextX - minX;
  placement.nextX += maxX - minX + SUBCIRCUIT_MARGIN;

  // Split the body's labels: internal nets keep a private `<inst>/…` name and
  // stay with the block; the body side of a *port* net is renamed to the bridge
  // synthetic and handed back separately so the caller can register it AFTER the
  // parent's own FLAGs - letting the user's net name (e.g. `vpwm`) win over the
  // synthetic when both land on the same node (so `V(vpwm)` resolves on import).
  const internalLabels: NetLabel[] = [];
  const portLabels: NetLabel[] = [];
  for (const n of body.netLabels) {
    const shifted = { id: `${instName}~${n.id}`, x: n.x + dx, y: n.y };
    if (isGroundNet(n.text)) {
      internalLabels.push({ ...shifted, text: n.text });
    } else if (portRename.has(n.text)) {
      portLabels.push({ ...shifted, text: portRename.get(n.text)! });
    } else {
      internalLabels.push({ ...shifted, text: `${instName}/${n.text}` });
    }
  }

  const flattenedComponents = bodyComponents.map((component) => {
    const flattened: SchematicComponent = {
      ...component,
      id: `${instName}~${component.id}`,
      label: component.label ? `${instName}.${component.label}` : component.label,
      x: component.x + dx,
      ...(component.pinOverride
        ? { pinOverride: component.pinOverride.map((pin) => ({ ...pin, x: pin.x + dx })) }
        : {}),
    };
    return {
      ...flattened,
      ltHierarchy: { owner: hierarchyOwner, original: hierarchyComponentFingerprint(flattened) },
    };
  });
  const flattenedWires = body.wires.map((wire) => {
    const flattened: SchematicWire = {
      ...wire,
      id: `${instName}~${wire.id}`,
      points: wire.points.map((point) => ({ x: point.x + dx, y: point.y })),
    };
    return {
      ...flattened,
      ltHierarchy: { owner: hierarchyOwner, original: hierarchyWireFingerprint(flattened) },
    };
  });
  const markLabel = (label: NetLabel): NetLabel => ({
    ...label,
    ltHierarchy: { owner: hierarchyOwner, original: hierarchyNetLabelFingerprint(label) },
  });
  const flattenedLabels = internalLabels.map(markLabel);
  const flattenedBridges = [...bridges, ...portLabels].map(markLabel);

  const result: AscImportResult = {
    components: flattenedComponents,
    wires: flattenedWires,
    netLabels: flattenedLabels,
    // A subcircuit body's own directives/comments are for standalone testing of
    // the block; they must not run when the block is used inside a parent.
    directives: [],
    comments: [],
    textAnnotations: [],
    shapes: [],
    // A flattened block's own carried records belong to the child file, not to
    // the parent that inlined it - same as `textAnnotations`/`shapes` above.
    dataFlags: [],
    // A foreign symbol inside a block's own body belongs to that block's file,
    // not to the parent, so it must not be injected into the parent on save.
    foreignSymbols: [],
    // Likewise a block nested inside this body: its SYMBOL record lives in the
    // child `.asc`, so only the parent's own instance record is carried up.
    hierarchicalBlocks: [],
    sheet: { ...body.sheet },
    warnings: body.warnings.map((w) => `${instName}: ${w}`),
    notes: body.notes.map((n) => `${instName}: ${n}`),
  };
  // `bridges` (parent-side) + `portLabels` (body-side) carry the same synthetic
  // names; both are deferred so a coincident parent FLAG names the net instead.
  return { result, bridges: flattenedBridges };
}

/**
 * Per-symbol defaults for the LTspice-library subcircuit symbols (Prefix X),
 * taken from the installed `.asy` files' own `SYMATTR` lines. LTspice only
 * writes an attribute into the `.asc` when the user changed it, so an instance
 * without a `SpiceModel`/`SpiceLine` must adopt the symbol's default (the ISO
 * examples' U1 instances carry no attrs at all and mean the 12 V variant).
 */
const SUBCKT_SYMBOL_DEFAULTS: Record<string, { name: string; params?: string }> = {
  diac: { name: "DIAC" },
  triac: { name: "TRIAC" },
  varistor: { name: "VARISTOR" },
  opamp: { name: "opamp", params: "Aol=100K GBW=10Meg" },
  towtom2: { name: "TowTom2" },
  capmeter: { name: "capometer", params: "current=1m freq=3Meg C=.5µ Q=.25" },
  "iso16750-2": { name: "4-6-3_12V_StartingProfile" },
  "iso7637-2": { name: "Pulse1_12V" },
};

/**
 * Compose a `subckt` component value - `<subcircuit name> [param=val …]` -
 * from an instance's attributes with the `.asy` defaults as fallback. The name
 * comes from `SpiceModel` (how the ISO symbols select a profile) or `Value`;
 * instance params ride on `SpiceLine`/`SpiceLine2` (Fc.asc's capmeter). The
 * deck builder sanitizes the name and normalizes `µ` at emission time.
 */
function subcktValueFromSymbol(
  leaf: string,
  attrs: Record<string, string>,
  metadataAttrs?: Record<string, string>,
): string {
  const def = SUBCKT_SYMBOL_DEFAULTS[leaf];
  const effective = { ...metadataAttrs, ...attrs };
  const rawValue = effective.Value?.trim() ?? "";
  const valueIsParams = /^\w+\s*=/.test(rawValue);
  const value2 = effective.Value2?.trim() ?? "";
  const value2IsParams = /^\w+\s*=/.test(value2);
  const metadataSpiceModel = metadataAttrs?.SpiceModel?.trim() ?? "";
  const metadataModelFile = metadataAttrs?.ModelFile?.trim() ?? "";
  // When `.asy` carries ModelFile (or SpiceModel is a non-file profile), the
  // symbol's SpiceModel is the default subckt/profile name (UniversalOpAmp
  // `level1`, ISO16750 pulse). When SpiceModel alone is `*.lib`/`*.sub`, it is
  // the library path and Value2/Value hold the subckt name (AD711 → AD712).
  const metadataProfile = metadataSpiceModel
    && (metadataModelFile || !/\.(lib|sub|mod)$/i.test(metadataSpiceModel))
    ? metadataSpiceModel
    : "";
  // On installed Prefix-X symbols Value2 is LTspice's exact X-line tail: its
  // first token is the simulation subcircuit and any following tokens are
  // instance parameters. An instance SpiceModel is always an explicit override.
  const name = [
    attrs.SpiceModel,
    metadataProfile,
    value2IsParams ? "" : value2,
    valueIsParams ? "" : rawValue,
    def?.name,
    leaf,
  ].map((candidate) => candidate?.trim() ?? "").find(Boolean) ?? leaf;
  const params = [valueIsParams ? rawValue : undefined, value2IsParams ? value2 : undefined, effective.SpiceLine, effective.SpiceLine2]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join(" ") || def?.params || "";
  return params ? `${name} ${params}` : name;
}

/**
 * Return a human-readable import note for known placeholder symbol types, or
 * `null` when the symbol needs no note (it maps faithfully to a Tau kind).
 * Used by {@link ascToSchematic} to populate `AscImportResult.notes`.
 */
function importPlaceholderNote(leaf: string, instName: string): string | null {
  const ref = instName || leaf;
  switch (leaf) {
    case "diac":
      return `${ref}: DIAC imported as a model-backed subcircuit instance. Tau will refuse simulation if the document or an attached library does not define DIAC.`;
    case "triac":
      return `${ref}: TRIAC imported as a model-backed subcircuit instance. Tau will refuse simulation if the document or an attached library does not define TRIAC.`;
    case "varistor":
      return `${ref}: LTspice voltage-controlled varistor imported with all four terminals and its Rclamp behavior.`;
    default:
      return null;
  }
}

/**
 * Reject a parsed `.asc` document whose SYMBOL/WIRE/FLAG record counts already
 * exceed what a Tau document is ever allowed to hold, using the exact caps
 * `validateSchematicDocument` enforces on every other load path. This runs
 * immediately after `parseAsc`'s cheap line-by-line scan and BEFORE any
 * quadratic work (`recoverLegacyTauPinGeometry` below compares every
 * component's pins against every wire, so an unbounded symbol/wire count froze
 * the importer itself - well before a post-import validation pass could ever
 * run). Checked on every `ascToSchematic` call, including recursive
 * hierarchical-block flattening, so a hostile subcircuit body can't hide from
 * the same limits either.
 */
function assertAscWithinLimits(doc: AscDocument): void {
  if (doc.symbols.length > MAX_COMPONENTS) {
    throw new Error(
      `This schematic has ${doc.symbols.length.toLocaleString("en-US")} components; Tau documents are limited to ${MAX_COMPONENTS.toLocaleString("en-US")}.`,
    );
  }
  if (doc.wires.length > MAX_WIRES) {
    throw new Error(
      `This schematic has ${doc.wires.length.toLocaleString("en-US")} wires; Tau documents are limited to ${MAX_WIRES.toLocaleString("en-US")}.`,
    );
  }
  // A FLAG becomes either a ground component or a net label - both bounded by
  // MAX_COMPONENTS in validateSchematicDocument (net labels have no separate cap).
  if (doc.flags.length > MAX_COMPONENTS) {
    throw new Error(
      `This schematic has ${doc.flags.length.toLocaleString("en-US")} net labels; Tau documents are limited to ${MAX_COMPONENTS.toLocaleString("en-US")}.`,
    );
  }
}

export function ascToSchematic(doc: AscDocument, options: AscImportOptions = {}): AscImportResult {
  assertAscWithinLimits(doc);
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

  const wires: SchematicWire[] = doc.wires.map((w) => ({
    id: id("w"),
    points: [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }],
  }));

  const components: SchematicComponent[] = [];
  const netLabels: NetLabel[] = [];
  // Subcircuit port bridges, deferred until after the parent's own FLAGs so a
  // coincident user net label (e.g. `vpwm`) wins the net's name over the
  // synthetic `<inst>:<port>` (keeps `V(<user name>)` resolving on import).
  const deferredBridges: NetLabel[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  // Source SYMBOL records with no Tau equivalent, retained verbatim so an
  // in-place save does not silently delete the part - see AscImportResult.
  const foreignSymbols: AscSymbol[] = [];
  // Source SYMBOL records that flattened into real components - retained so a
  // save can name the hierarchy instead of reporting an unmappable symbol.
  const hierarchicalBlocks: SchematicHierarchicalBlock[] = [];

  for (const symbol of doc.symbols) {
    const leaf = symbol.type.replace(/\\/g, "/").toLowerCase().split("/").pop() ?? "";
    const symbolMetadata = options.resolveSymbolMetadata?.(symbol.type) ?? null;
    if (leaf === "jumper") {
      // A jumper is a graphical net-tie (0 Ω short), not a SPICE device -
      // LTspice emits no netlist line for it. Import it as a wire between its
      // two pins (jumper.asy: +(-32,64) / -(32,64)) so the nets merge exactly.
      const p1 = transformLtPoint(-32, 64, symbol.orientation);
      const p2 = transformLtPoint(32, 64, symbol.orientation);
      wires.push({
        id: id("w"),
        points: [
          { x: symbol.x + p1.x, y: symbol.y + p1.y },
          { x: symbol.x + p2.x, y: symbol.y + p2.y },
        ],
      });
      continue;
    }
    const tauKind = isComponentKind(symbol.attrs.TauKind) ? symbol.attrs.TauKind : null;
    const mappedKind = ltspiceTypeToKind(symbol.type);
    const installedPrefixX = symbolMetadata?.attrs.Prefix?.trim().toUpperCase() === "X"
      && (symbolMetadata?.pins.length ?? 0) > 0;
    // ASC may override `.asy` Prefix QN→X (PAsystem TIP121/TIP127) while the
    // sibling `.lib` supplies the exact darlington `.subckt` — honor that.
    const instancePrefixX = symbol.attrs.Prefix?.trim().toUpperCase() === "X"
      && (symbolMetadata?.pins.length ?? 0) > 0;
    const prefixX = installedPrefixX || instancePrefixX;
    // Opamps/ maps to the five-terminal `opamp` kind for the ordinary single-
    // output family. Prefix-X symbols whose .asy exposes a different pin count
    // (disable pin, instrumentation, FDA, …) must keep exact SpiceOrder ports
    // as a `subckt` — forcing the five-pin contract refused exact 6-port models
    // like AD8029 and silently dropped unused .asy pins.
    const nonFivePinOpamp = mappedKind === "opamp"
      && prefixX
      && symbolMetadata!.pins.length !== 5;
    const kind = tauKind
      ?? (nonFivePinOpamp ? "subckt" : null)
      ?? mappedKind
      ?? (prefixX ? "subckt" : null);
    const instName = symbol.attrs.InstName ?? "";
    if (!kind) {
      // No built-in kind: try resolving the symbol as a hierarchical block and
      // inline (flatten) its schematic. This is how LTspice instances a `.asc`
      // used as a symbol (e.g. class-d_starter's `deadtime` X1).
      const def = options.resolveSubcircuit?.(symbol.type) ?? null;
      const depth = options._depth ?? 0;
      if (def && ["BLOCK", "CELL"].includes(def.symbol.symbolType.toUpperCase()) && depth < MAX_SUBCIRCUIT_DEPTH
        && !(options._stack ?? new Set()).has(symbol.type.toLowerCase())) {
        const placement = options._placement ?? { nextX: 1_000_000 };
        const hierarchyOwner = id("h");
        const { result, bridges } = flattenSubcircuit(
          symbol,
          def,
          instName || `X${counter}`,
          hierarchyOwner,
          { ...options, _placement: placement },
          id,
        );
        components.push(...result.components);
        wires.push(...result.wires);
        netLabels.push(...result.netLabels);
        deferredBridges.push(...bridges);
        warnings.push(...result.warnings);
        notes.push(...result.notes);
        // Retain the un-flattened record. The block simulates (its parts are in
        // `components`), so this must NOT go on `foreignSymbols` - that set
        // means "not simulated" and feeds the simulation-integrity refusal.
        hierarchicalBlocks.push({
          type: symbol.type,
          x: symbol.x,
          y: symbol.y,
          orientation: symbol.orientation,
          attrs: { ...symbol.attrs },
          ...(symbol.windows ? { windows: symbol.windows.map((w) => ({ ...w })) } : {}),
          provenance: {
            owner: hierarchyOwner,
            componentCount: result.components.length,
            wireCount: result.wires.length,
            netLabelCount: result.netLabels.length + bridges.length,
          },
        });
        // Propagate the advanced cursor back to this scope for the next sibling.
        options._placement = placement;
        continue;
      }
      // No built-in kind and no resolvable subcircuit: retain a deep copy of
      // the raw record so an in-place save re-emits it verbatim instead of
      // dropping the part. (The subcircuit-flatten branch above does NOT reach
      // here - it emits real components and must not also carry the symbol.)
      foreignSymbols.push({
        type: symbol.type,
        x: symbol.x,
        y: symbol.y,
        orientation: symbol.orientation,
        attrs: { ...symbol.attrs },
        ...(symbol.windows ? { windows: symbol.windows.map((w) => ({ ...w })) } : {}),
      });
      warnings.push(foreignSymbolWarning(instName, symbol.type));
      continue;
    }
    const tauPinAttribute = tauKind ? symbol.attrs[TAU_PINS_FIELD] : undefined;
    const tauPins = tauPinAttribute ? decodeTauPins(tauPinAttribute, symbol.x, symbol.y) : null;
    if (tauPinAttribute && !tauPins) {
      warnings.push(`${instName || symbol.type}: ignored invalid TauPins terminal metadata.`);
    }
    const pinOverride = tauKind
      ? (tauPins ?? undefined)
      : (buildPinOverride(symbol, kind, symbolMetadata) ?? undefined);
    if (!pinOverride && !tauKind) {
      warnings.push(
        `${instName || symbol.type}: placed without pin-accurate geometry (no banked pins for "${symbol.type}"); its connections may be wrong.`,
      );
    }
    // Emit an informational note (not a warning) for geometry-carrier mappings.
    // The file opens clean with retained nets, while the simulation-integrity
    // guard uses ltSymbolType to refuse it before any deck or solver work.
    const placeholderNote = importPlaceholderNote(leaf, instName);
    if (placeholderNote) notes.push(placeholderNote);
    // A digital gate's function (and/or/xor/inv/…) is encoded in the symbol
    // NAME, not its value; prepend the leaf so parseDigitalGate sees it.
    // Model-backed X devices and behavioral varistors carry their parameters in
    // Value2/SpiceLine; subcktValueFromSymbol retains those instance params.
    const authoredValue = componentValueFromAttrs(kind, symbol.attrs);
    const semiconductorKinds = new Set<ComponentKind>([
      "npn", "pnp", "njf", "pjf", "nmos", "pmos", "diode", "zener", "led",
    ]);
    // Model-named discrete cells (SYMBOL 2N3904 with InstName only): take the
    // .asy Value or the leaf so the deck requests the exact model, not TAU_*.
    const discreteModelValue = semiconductorKinds.has(kind) && !authoredValue.trim()
      ? (symbolMetadata?.attrs.Value?.trim() || leaf)
      : authoredValue;
    const value = tauKind
      ? (symbol.attrs.TauValue === "\"\"" ? "" : (symbol.attrs.TauValue ?? symbol.attrs.Value ?? ""))
      : leaf === "csw"
        ? currentSwitchValueFromAttrs(symbol.attrs)
        : kind === "digitalGate"
          ? `${leaf} ${authoredValue}`.trim()
          : kind === "subckt"
            ? subcktValueFromSymbol(leaf, symbol.attrs, symbolMetadata?.attrs)
            : kind === "isource" && (leaf === "load" || leaf === "load2")
              // Leaf name IS the dissipative flag; append so spiceNetlist sees
              // the same `… load` / `… load2` token a hand-netlisted I-source uses.
              ? `${authoredValue} ${leaf}`.trim()
              : discreteModelValue;
    // A part Tau wrote under a carrier symbol keeps its slots in the Tau-only
    // field, since on the carrier their own names belong to another part. They
    // are read back with the `Value` they sat beside, so the exporter has the
    // same split it started from. A field Tau did not write decodes to null and
    // is treated as absent rather than trusted.
    const carried = symbol.attrs[TAU_CARRIED_ATTRS_FIELD] !== undefined
      ? decodeCarriedAttrs(symbol.attrs[TAU_CARRIED_ATTRS_FIELD])
      : null;
    // Tau never writes both, but a hand-edited file can hold both: a carried
    // slot describes the part, one written on the symbol itself describes the
    // carrier standing in for it, so the carried one wins where they collide
    // and neither is dropped.
    const onSymbol = extendedSymbolAttrs(symbol.attrs);
    const extras = carried ? { ...onSymbol, ...carried.extras } : onSymbol;
    // ModelFile is the library path; SpiceModel is only a file when it ends in
    // .lib/.sub/.mod (otherwise it is a subckt/profile name — ISO / UniversalOpAmp).
    const resolvedModelFile = (kind === "opamp" || kind === "subckt") && symbolMetadata
      ? ltspiceModelFileFromSymbolAttrs(symbolMetadata.attrs)
      : undefined;
    components.push({
      id: id("c"),
      kind,
      x: symbol.x,
      y: symbol.y,
      rotation: orientationToRotation(symbol.orientation),
      ...(symbol.orientation.startsWith("M") ? { mirrored: true } : {}),
      value,
      label: tauKind
        ? (symbol.attrs.TauLabel === "\"\"" ? "" : (symbol.attrs.TauLabel ?? instName))
        : instName,
      // Carry the source symbol name with the banked geometry so the exporter
      // can reproduce the original SYMBOL line instead of the canonical Tau
      // export symbol (which for e.g. a 3-pin `nmos` would relocate the bulk
      // pin and change connectivity).
      ...(pinOverride
        ? { pinOverride, ...(tauKind ? {} : { ltSymbolType: symbol.type }) }
        : {}),
      // A vendor symbol can keep its actual simulation alias/model-file only
      // in the `.asy` defaults (the `.asc` instance often contains InstName
      // alone). Store those defaults separately: they affect model resolution
      // but are never re-emitted as source SYMATTR records unless the user edits
      // the named Simulation model control.
      ...((kind === "opamp" || kind === "subckt") && symbolMetadata
        ? {
          // Prefer .asy SpiceModel when it is a profile/subckt name (level1,
          // ISO pulse) rather than a *.lib path — Value2 is often params
          // (`Avol=1Meg…`), so leaf alone wrongly requested "universalopamp1".
          ltModelName: (() => {
            const metaSpice = symbolMetadata.attrs.SpiceModel?.trim() ?? "";
            const metaFile = symbolMetadata.attrs.ModelFile?.trim() ?? "";
            const profile = metaSpice
              && (metaFile || !/\.(lib|sub|mod)$/i.test(metaSpice))
              ? metaSpice.split(/\s+/)[0]
              : "";
            return [profile, symbolMetadata.attrs.Value2, symbolMetadata.attrs.Value, leaf]
              .map((candidate) => candidate?.trim().split(/\s+/)[0] ?? "")
              .find((candidate) => candidate !== "" && !candidate.includes("=")) ?? leaf;
          })(),
          ...(resolvedModelFile ? { ltModelFile: resolvedModelFile } : {}),
        }
        : {}),
      // Label placement travels with the part, not the symbol bank, so keep it
      // even for a symbol whose geometry Tau could not bank - the exporter
      // decides whether it can be re-emitted.
      ...(symbol.windows?.length ? { ltWindows: symbol.windows } : {}),
      // Several of these slots are folded onto `value` above, so the split has
      // to travel with the part for the exporter to put them back.
      ...(extras
        ? {
          ltExtraAttrs: {
            // The carrier's own `Value` is the placeholder Tau gave it, not the
            // one the slots came from; that one travels in the carried record.
            baseValue: carried?.baseValue ?? symbol.attrs.Value ?? "",
            derivedValue: value,
            extras,
          },
        }
        : {}),
    });
  }

  for (const flag of doc.flags) {
    if (flag.net === "0") {
      // LTspice ground flag → a Tau ground symbol whose pin sits at the flag.
      components.push({
        id: id("c"),
        kind: "ground",
        x: flag.x,
        y: flag.y,
        rotation: 0,
        value: "",
        label: "",
      });
    } else if (flag.net.trim() !== "") {
      netLabels.push({
        id: id("n"),
        x: flag.x,
        y: flag.y,
        text: flag.net,
        ...(flag.port ? { port: flag.port } : {}),
      });
    }
  }
  // Register subcircuit port bridges last so a same-node parent FLAG names the net.
  netLabels.push(...deferredBridges);

  const recovered = recoverLegacyTauPinGeometry(components, wires, netLabels);
  if (recovered.recovered > 0) {
    notes.push(`Recovered native Tau pin geometry for ${recovered.recovered} component(s) saved by an older Tau version.`);
  }
  const directives = doc.texts.filter((t) => t.directive).map((t) => t.text);
  const comments = doc.texts.filter((t) => !t.directive).map((t) => t.text);

  return {
    components: recovered.components,
    wires,
    netLabels,
    directives,
    comments,
    textAnnotations: doc.texts.map((text) => ({ ...text })),
    shapes: doc.shapes.map((shape) => ({ ...shape, coords: [...shape.coords] })),
    dataFlags: doc.dataFlags.map((dataFlag) => ({ ...dataFlag })),
    foreignSymbols,
    hierarchicalBlocks,
    sheet: { ...doc.sheet },
    warnings,
    notes,
  };
}

/**
 * Parse raw LTspice `.asc` text and convert it to Tau schematic content in one
 * step. Convenience wrapper over `parseAsc` + `ascToSchematic` for the Open
 * dialog and tests. `parseAsc` itself never throws - an empty/contentless
 * `.asc`, or one full of lines it doesn't recognize, yields an empty-but-valid
 * result. `ascToSchematic` can still throw: `assertAscWithinLimits` rejects a
 * document whose SYMBOL/WIRE/FLAG counts exceed Tau's document caps (before
 * doing any pin-geometry work), and malformed per-instance `.param` scopes can
 * also raise. Callers must treat this as a fallible parse, not a guaranteed one.
 */
export function importAsc(text: string, options: AscImportOptions = {}): AscImportResult {
  return ascToSchematic(parseAsc(text), options);
}

/**
 * Resolve a hierarchical symbol from raw sibling-file text. Returns a
 * {@link SubcircuitResolver} that the Open dialog can build from a "read this
 * symbol's `.asy` + `.asc`" callback (and tests from an in-memory map), so the
 * file-system parts stay outside this pure module. A symbol resolves only when
 * BOTH its `.asy` (ports/defaults) and `.asc` (body) are found and the `.asy`
 * is a hierarchical BLOCK or CELL.
 */
export function makeSubcircuitResolver(
  readFiles: (symbolType: string) => { asy?: string; asc?: string } | null,
): SubcircuitResolver {
  return (symbolType) => {
    const files = readFiles(symbolType);
    if (!files?.asy || !files.asc) return null;
    const symbol = parseAsy(files.asy);
    if (!["BLOCK", "CELL"].includes(symbol.symbolType.toUpperCase())) return null;
    return { symbol, body: parseAsc(files.asc) };
  };
}
