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
  NetLabel,
  PinOverride,
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import { buildPartialParamScope, inlineFuncCalls, parseParamAssignments, substituteKnownBraces, substituteBehavioralBraces, substituteScopeIdentifiers, substituteIdentifierExpressions } from "../simulation/paramScope";
import { isComponentKind } from "../schematic/types";
import { getLocalPins, transformPoint } from "../schematic/pins";
import { parseIcValue } from "../engine/icSpec";
import { MAX_COMPONENTS, MAX_WIRES } from "../schematic/documentValidation";

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
}

export interface AscSymbol {
  /** LTspice symbol type, e.g. "res", "voltage", "npn", "opamps\\LT1468". */
  type: string;
  x: number;
  y: number;
  orientation: AscOrientation;
  /** SYMATTR name → value (InstName, Value, Value2, SpiceModel, SpiceLine, …). */
  attrs: Record<string, string>;
}

export interface AscText {
  x: number;
  y: number;
  /** True when the text is a SPICE directive (leading "!"); false for a ";" comment. */
  directive: boolean;
  text: string;
}

export interface AscShape {
  kind: "LINE" | "RECTANGLE" | "CIRCLE" | "ARC";
  coords: number[];
}

export interface AscDocument {
  version: number;
  sheet: { index: number; width: number; height: number };
  wires: AscWire[];
  flags: AscFlag[];
  symbols: AscSymbol[];
  texts: AscText[];
  shapes: AscShape[];
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
      case "WINDOW":
        // Label placement only - does not affect electrical content. Ignored.
        break;
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
      case "ARC":
        doc.shapes.push({ kind: tag, coords: parts.slice(1).map(num).filter((n) => Number.isFinite(n)) });
        current = null;
        break;
      case "IOPIN":
        // Hierarchy port - recorded as a flag-like net marker is out of scope v1.
        break;
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
 * the common built-ins. Vendor/library symbols (e.g. "opamps\\LT1468") return
 * `null` here - they need subcircuit-model import (tracked separately) - except
 * where a generic native kind is a faithful stand-in (handled by the caller).
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
    polcap: "capacitor",
    // Crystal (xtal): a 2-terminal piezoelectric resonator modelled in LTspice
    // as a capacitor C element (series capacitance Cs) with optional parasitic
    // params (Rser, Lser, Cpar) on SpiceLine. Imported as a capacitor so the
    // SPICE deck line is electrically correct; the full resonator model is carried
    // in the value string by componentValueFromAttrs.
    xtal: "capacitor",
    ind: "inductor",
    ind2: "inductor",
    l: "inductor",
    voltage: "vsource",
    battery: "vsource",
    signal: "vsource",
    current: "isource",
    diode: "diode",
    schottky: "diode",
    varactor: "diode",
    smdiode: "diode",
    zener: "zener",
    led: "led",
    npn: "npn",
    npn3: "npn",
    npn4: "npn",
    pnp: "pnp",
    pnp3: "pnp",
    nmos: "nmos",
    nmos4: "nmos",
    pmos: "pmos",
    pmos4: "pmos",
    njf: "njf",
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
    // DIAC: 2-terminal bidirectional trigger diode (misc\\DIAC). No Tau analog;
    // imported as a resistor placeholder so the file opens clean and the two nets
    // connect correctly. An import note is emitted instead of a warning.
    diac: "resistor",
    // TRIAC: 3-terminal AC power switch (misc\\TRIAC, pins MT2/G/MT1). Imported
    // as an NPN placeholder so all three nets connect correctly. Import note emitted.
    triac: "npn",
    // Varistor (SpecialFunctions\\varistor): a 4-terminal behavioral voltage-
    // controlled clamp. The two primary terminals (invin/noninvin, SpiceOrder 1/2)
    // are mapped to a resistor placeholder; the output/com pins are dropped. Its
    // `Rclamp=` value is an A-device param, not an Ohm value, so the placeholder
    // is given a neutral high-Z resting resistance (see the value assignment in
    // ascToSchematic) rather than the unparseable raw value.
    varistor: "resistor",
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
  // Any symbol living under an "opamps" directory is an op-amp at heart.
  if (base.includes("opamp")) return "opamp";
  // LTspice idealized digital A-devices live under `Digital\`. The path prefix
  // is required - bare leafs like "and"/"or" are too generic to claim globally.
  if (base.includes("digital/")) {
    if (leaf === "dflop") return "dflop";
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
 *  (counter/srflop/phidet and the diff* family are not yet modelled and fall
 *  through to the skip-warning path; SpecialFunctions\sample maps to the
 *  `sampleHold` kind above.) */
const DIGITAL_GATE_LEAFS = new Set([
  "inv", "buf", "buf1", "and", "or", "xor", "schmitt", "schmtbuf", "schmtinv",
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
  sw: [{ name: "A", dx: 0, dy: 16 }, { name: "B", dx: 0, dy: 96 }],
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
  // DIAC (Misc/DIAC.asy, SpiceOrder +=1 / −=2): +(32,0) / −(32,64).
  // Imported as resistor; zipped to Tau resistor pins a/b.
  diac: [{ name: "+", dx: 32, dy: 0 }, { name: "-", dx: 32, dy: 64 }],
  // TRIAC (Misc/TRIAC.asy, SpiceOrder MT2=1 / G=2 / MT1=3):
  //   MT2(32,0) → Tau C, G(-16,64) → Tau B (gate), MT1(32,64) → Tau E.
  // Imported as npn placeholder; zipped to Tau npn pins c/b/e.
  triac: [
    { name: "MT2", dx: 32, dy: 0 },
    { name: "G", dx: -16, dy: 64 },
    { name: "MT1", dx: 32, dy: 64 },
  ],
  // varistor (SpecialFunctions/varistor.asy): primary terminals invin(−32,48)/
  // noninvin(−32,80) at SpiceOrder 1/2. Imported as resistor; zipped to a/b.
  varistor: [{ name: "invin", dx: -32, dy: 48 }, { name: "noninvin", dx: -32, dy: 80 }],
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
      dflop: "dflop",
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
    ind: "ind", ind2: "ind", l: "ind",
    voltage: "voltage", battery: "voltage", signal: "voltage",
    current: "current",
    diode: "diode", schottky: "schottky", zener: "zener", led: "led",
    varactor: "diode", smdiode: "smdiode",
    npn: "npn", npn3: "npn", npn4: "npn",
    pnp: "pnp", pnp3: "pnp", pnp4: "pnp",
    nmos: "nmos", nmos4: "mos4",
    pmos: "pmos", pmos4: "mos4",
    njf: "njf", pjf: "njf",
    sw: "sw", csw: "sw",
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
    // varistor (SpecialFunctions/varistor.asy): primary pins invin(-32,48)/
    // noninvin(-32,80) at SpiceOrder 1/2 - own bank.
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
  /** Original SHEET record retained for lossless `.asc` save. */
  sheet: AscDocument["sheet"];
  /** Non-fatal issues (symbols placed without pin-accurate geometry, etc.). */
  warnings: string[];
  /**
   * Informational notes about placeholder mappings - the file opened clean and
   * all nets are correct, but a device was mapped to the closest Tau analog
   * (e.g. diac → resistor, triac → npn). Does not affect the warning count.
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
function buildPinOverride(symbol: AscSymbol, kind: ComponentKind): PinOverride[] | null {
  const key = ltPinKey(symbol.type);
  if (!key) return null;
  const ltPins = LTSPICE_PINS[key];
  const tauPins = getLocalPins(kind);
  if (ltPins.length === 0 || tauPins.length === 0) return null;

  // Digital gates expose a per-.asy SUBSET of the kind's full pin bank (e.g.
  // inv.asy has only in1/qbar/com), so a positional zip would misassign roles.
  // Their LTSPICE_PINS entries carry Tau pin ids as names - map by id, and emit
  // ONLY the pins the .asy actually has (the deck builder ignores absent pins,
  // matching LTspice's floating-input semantics). sampleHold and modulator
  // share the scheme.
  if (kind === "digitalGate" || kind === "dflop" || kind === "sampleHold" || kind === "modulator") {
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
 *  the SPICE source line. For every other kind we keep only `Value` (Value2 on
 *  a semiconductor names instance params the generic models don't consume yet). */
const SOURCE_KINDS_WITH_INLINE_SPEC = new Set<ComponentKind>(["vsource", "isource"]);

/**
 * Build a Tau component value from a symbol's SYMATTR attributes. For
 * independent sources, append `Value2` and `SpiceLine` to `Value` (space-joined)
 * so the LTspice `AC <mag> [phase]` stimulus - and any other inline source spec
 * - rides on the value, exactly as LTspice concatenates them on the netlist
 * line. Other kinds map `Value` only.
 */
export function componentValueFromAttrs(
  kind: ComponentKind,
  attrs: Record<string, string>,
): string {
  // LTspice writes an empty source value as the quoted sentinel `""` (a 0 V/0 A
  // source, typically excited only by its AC spec). Normalize it to empty.
  const rawBase = (attrs.Value ?? "").trim();
  const base = /^["']*$/.test(rawBase) ? "" : rawBase;
  if (SOURCE_KINDS_WITH_INLINE_SPEC.has(kind)) {
    // LTspice can split one transient spec across all four attribute fields
    // (e.g. `Value SINE(` / `Value2 0 100u` / `SpiceLine 5Meg` /
    // `SpiceLine2 0 0 0 1)`), so concatenate every field - in document order -
    // to reconstruct the full netlist value, exactly as LTspice joins them.
    const extras = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);
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
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);
    return [base, ...extras].filter(Boolean).join(" ");
  }
  // Digital A-devices spread `Vhigh=/Vlow=/Vt=/Vhys=/Td=` across all four
  // attribute fields (Electrometer.asc: `Value Vhigh=0 Vlow=-5` +
  // `Value2 Trise=10n`); join them all for parseDigitalGate, which skips
  // unknown tokens. The caller prepends the gate function (from the symbol
  // path) since LTspice encodes it in the symbol name, not the value.
  if (kind === "digitalGate" || kind === "dflop" || kind === "sampleHold" || kind === "modulator") {
    const extras = [attrs.Value2, attrs.SpiceLine, attrs.SpiceLine2]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);
    return [base, ...extras].filter(Boolean).join(" ");
  }
  // Capacitors/inductors may carry an initial condition in any of the spec
  // attributes (LTspice writes e.g. `SpiceLine2 IC=1`). Append just the `IC=`
  // token - not the whole attribute, which can hold ngspice-incompatible
  // LTspice-only keys (Rser, Cpar, …).
  if (kind === "capacitor" || kind === "inductor") {
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
      .filter((match) => kind === "capacitor" || match[1].toLowerCase() === "rser")
      .map((match) => `${match[1]}=${match[2]}`);
    return [base, ...parasitics, ...(ic !== undefined ? [`IC=${ic}`] : [])]
      .filter(Boolean)
      .join(" ");
  }
  return base;
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

/** Options for {@link ascToSchematic}. */
export interface AscImportOptions {
  /** Resolve a symbol with no built-in kind to a hierarchical sub-schematic. */
  resolveSubcircuit?: SubcircuitResolver;
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

  const result: AscImportResult = {
    components: bodyComponents.map((c) => ({
      ...c,
      id: `${instName}~${c.id}`,
      label: c.label ? `${instName}.${c.label}` : c.label,
      x: c.x + dx,
      ...(c.pinOverride ? { pinOverride: c.pinOverride.map((p) => ({ ...p, x: p.x + dx })) } : {}),
    })),
    wires: body.wires.map((w) => ({
      id: `${instName}~${w.id}`,
      points: w.points.map((p) => ({ x: p.x + dx, y: p.y })),
    })),
    netLabels: internalLabels,
    // A subcircuit body's own directives/comments are for standalone testing of
    // the block; they must not run when the block is used inside a parent.
    directives: [],
    comments: [],
    textAnnotations: [],
    sheet: { ...body.sheet },
    warnings: body.warnings.map((w) => `${instName}: ${w}`),
    notes: body.notes.map((n) => `${instName}: ${n}`),
  };
  // `bridges` (parent-side) + `portLabels` (body-side) carry the same synthetic
  // names; both are deferred so a coincident parent FLAG names the net instead.
  return { result, bridges: [...bridges, ...portLabels] };
}

/**
 * Per-symbol defaults for the LTspice-library subcircuit symbols (Prefix X),
 * taken from the installed `.asy` files' own `SYMATTR` lines. LTspice only
 * writes an attribute into the `.asc` when the user changed it, so an instance
 * without a `SpiceModel`/`SpiceLine` must adopt the symbol's default (the ISO
 * examples' U1 instances carry no attrs at all and mean the 12 V variant).
 */
const SUBCKT_SYMBOL_DEFAULTS: Record<string, { name: string; params?: string }> = {
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
function subcktValueFromSymbol(leaf: string, attrs: Record<string, string>): string {
  const def = SUBCKT_SYMBOL_DEFAULTS[leaf];
  const name = (attrs.SpiceModel ?? attrs.Value ?? "").trim() || def?.name || leaf;
  const params = [attrs.SpiceLine, attrs.SpiceLine2]
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
      return `${ref}: DIAC (bidirectional trigger diode) imported as a resistor placeholder. Nets are correct; replace with a subcircuit model for simulation accuracy.`;
    case "triac":
      return `${ref}: TRIAC imported as an NPN placeholder (MT2→C, G→B, MT1→E). Nets are correct; replace with a subcircuit model for simulation accuracy.`;
    case "varistor":
      return `${ref}: Varistor (4-terminal behavioral clamp) imported as a resistor placeholder using the two primary terminals. Nets are correct; replace with a subcircuit model for simulation accuracy.`;
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

  for (const symbol of doc.symbols) {
    const leaf = symbol.type.replace(/\\/g, "/").toLowerCase().split("/").pop() ?? "";
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
    const kind = tauKind ?? ltspiceTypeToKind(symbol.type);
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
        const { result, bridges } = flattenSubcircuit(
          symbol,
          def,
          instName || `X${counter}`,
          { ...options, _placement: placement },
          id,
        );
        components.push(...result.components);
        wires.push(...result.wires);
        netLabels.push(...result.netLabels);
        deferredBridges.push(...bridges);
        warnings.push(...result.warnings);
        notes.push(...result.notes);
        // Propagate the advanced cursor back to this scope for the next sibling.
        options._placement = placement;
        continue;
      }
      warnings.push(
        `Skipped ${instName || "an unnamed part"}: no Tau equivalent for LTspice symbol "${symbol.type}".`,
      );
      continue;
    }
    const pinOverride = tauKind ? undefined : (buildPinOverride(symbol, kind) ?? undefined);
    if (!pinOverride && !tauKind) {
      warnings.push(
        `${instName || symbol.type}: placed without pin-accurate geometry (no banked pins for "${symbol.type}"); its connections may be wrong.`,
      );
    }
    // Emit an informational note (not a warning) for placeholder mappings.
    // The file opens clean and all nets are correct; the note documents that a
    // device was mapped to the closest Tau analog rather than a faithful model.
    const placeholderNote = importPlaceholderNote(leaf, instName);
    if (placeholderNote) notes.push(placeholderNote);
    components.push({
      id: id("c"),
      kind,
      x: symbol.x,
      y: symbol.y,
      rotation: orientationToRotation(symbol.orientation),
      ...(symbol.orientation.startsWith("M") ? { mirrored: true } : {}),
      // A digital gate's function (and/or/xor/inv/…) is encoded in the symbol
      // NAME, not its value; prepend the leaf so parseDigitalGate sees it.
      // Voltage-triggered devices imported as a resistor placeholder (varistor
      // `Rclamp=`, diac `VK=`) carry no parseable Ohm value - their spec is an
      // A-device / breakover param the resistor emitter can't use. Give the
      // placeholder a neutral high-Z resting value (both are near-open below
      // their clamp/breakover voltage) so the deck builds and the op converges.
      // Nets stay correct; the import note already says to swap in a real model.
      value: tauKind
        ? (symbol.attrs.TauValue === "\"\"" ? "" : (symbol.attrs.TauValue ?? symbol.attrs.Value ?? ""))
        : kind === "digitalGate"
        ? `${leaf} ${componentValueFromAttrs(kind, symbol.attrs)}`.trim()
        : kind === "subckt"
          ? subcktValueFromSymbol(leaf, symbol.attrs)
          : (leaf === "varistor" || leaf === "diac") && kind === "resistor"
            ? "1Meg"
            : componentValueFromAttrs(kind, symbol.attrs),
      label: tauKind
        ? (symbol.attrs.TauLabel === "\"\"" ? "" : (symbol.attrs.TauLabel ?? instName))
        : instName,
      // Carry the source symbol name with the banked geometry so the exporter
      // can reproduce the original SYMBOL line instead of the canonical Tau
      // export symbol (which for e.g. a 3-pin `nmos` would relocate the bulk
      // pin and change connectivity).
      ...(pinOverride ? { pinOverride, ltSymbolType: symbol.type } : {}),
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
      netLabels.push({ id: id("n"), x: flag.x, y: flag.y, text: flag.net });
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
