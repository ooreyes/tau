/**
 * LTspice `.asc` schematic importer — Phase 1: a robust parser for the LTspice
 * ASCII schematic grammar, plus a best-effort mapping of common symbol types to
 * Tau component kinds.
 *
 * Goal (see FEATURE_PARITY.md): open the user's real LTspice schematics. This
 * module is the foundation — it parses the file losslessly into a structured
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
import { getLocalPins } from "../schematic/pins";

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
        // Label placement only — does not affect electrical content. Ignored.
        break;
      case "TEXT": {
        // TEXT x y <align> <size> <payload...>  — payload starts with ! or ;.
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
        // Hierarchy port — recorded as a flag-like net marker is out of scope v1.
        break;
      default:
        doc.unknown.push(line);
        break;
    }
  }

  return doc;
}

/**
 * Map an LTspice symbol type to a Tau component kind. Case-insensitive; handles
 * the common built-ins. Vendor/library symbols (e.g. "opamps\\LT1468") return
 * `null` here — they need subcircuit-model import (tracked separately) — except
 * where a generic native kind is a faithful stand-in (handled by the caller).
 */
export function ltspiceTypeToKind(type: string): ComponentKind | null {
  const base = type.replace(/\\/g, "/").toLowerCase();
  const leaf = base.split("/").pop() ?? base;

  const map: Record<string, ComponentKind> = {
    res: "resistor",
    res2: "resistor",
    r: "resistor",
    cap: "capacitor",
    cap2: "capacitor",
    c: "capacitor",
    polcap: "capacitor",
    ind: "inductor",
    ind2: "inductor",
    l: "inductor",
    voltage: "vsource",
    current: "isource",
    diode: "diode",
    schottky: "diode",
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
    sw: "switch",
    csw: "switch",
    pot: "potentiometer",
    ind2t: "transformer",
    "opamp": "opamp",
    "opamp2": "opamp",
  };

  // Any symbol living under an "opamps" directory is an op-amp at heart.
  if (base.includes("opamp")) return "opamp";
  return map[leaf] ?? null;
}

/**
 * LTspice symbol-local pin offsets (R0), extracted from the installed LTspice
 * 17.2.4 library (`lib/sym/*.asy`). Order matches LTspice's PIN order, which is
 * also Tau's pin role order for the mapped kinds (e.g. voltage: + then −; npn:
 * C, B, E; nmos: D, G, S[, B]). Used by the connectivity step of the importer.
 *
 * NOTE: LTspice pin spacing differs from Tau's fixed symbol geometry (e.g. a
 * resistor is 80 units pin-to-pin in LTspice vs 64 in Tau). Faithful import
 * therefore needs imported components to carry their OWN pin positions rather
 * than reuse Tau's built-in geometry — see FEATURE_PARITY.md §1 design note.
 */
export interface LtPin {
  name: string;
  dx: number;
  dy: number;
}
export const LTSPICE_PINS: Record<string, LtPin[]> = {
  res: [{ name: "1", dx: 16, dy: 16 }, { name: "2", dx: 16, dy: 96 }],
  cap: [{ name: "1", dx: 16, dy: 0 }, { name: "2", dx: 16, dy: 64 }],
  ind: [{ name: "1", dx: 16, dy: 16 }, { name: "2", dx: 16, dy: 96 }],
  voltage: [{ name: "+", dx: 0, dy: 16 }, { name: "-", dx: 0, dy: 96 }],
  current: [{ name: "+", dx: 0, dy: 0 }, { name: "-", dx: 0, dy: 80 }],
  diode: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  led: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  zener: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  schottky: [{ name: "A", dx: 16, dy: 0 }, { name: "K", dx: 16, dy: 64 }],
  npn: [{ name: "C", dx: 64, dy: 0 }, { name: "B", dx: 0, dy: 48 }, { name: "E", dx: 64, dy: 96 }],
  pnp: [{ name: "C", dx: 64, dy: 0 }, { name: "B", dx: 0, dy: 48 }, { name: "E", dx: 64, dy: 96 }],
  nmos: [{ name: "D", dx: 48, dy: 0 }, { name: "G", dx: 0, dy: 80 }, { name: "S", dx: 48, dy: 96 }],
  pmos: [{ name: "D", dx: 48, dy: 0 }, { name: "G", dx: 0, dy: 80 }, { name: "S", dx: 48, dy: 96 }],
  sw: [{ name: "A", dx: 0, dy: 16 }, { name: "B", dx: 0, dy: 96 }],
};

/** Apply an LTspice orientation to a symbol-local point (LTspice screen Y is
 *  down; rotations are clockwise; M* mirrors across the vertical axis first). */
export function transformLtPoint(dx: number, dy: number, orientation: AscOrientation): { x: number; y: number } {
  const mirrored = orientation.startsWith("M");
  const mx = mirrored ? -dx : dx;
  const z = (n: number) => (n === 0 ? 0 : n); // normalize -0 → 0
  switch (orientation) {
    case "R90":
    case "M90":
      return { x: z(-dy), y: z(mx) };
    case "R180":
    case "M180":
      return { x: z(-mx), y: z(-dy) };
    case "R270":
    case "M270":
      return { x: z(dy), y: z(-mx) };
    default:
      return { x: z(mx), y: z(dy) };
  }
}

/** Convert an LTspice orientation to a Tau rotation (degrees). Mirror flips are
 *  approximated by their rotation for now (Tau has no mirror flag yet). */
export function orientationToRotation(orientation: AscOrientation): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case "R90":
    case "M90":
      return 90;
    case "R180":
    case "M180":
      return 180;
    case "R270":
    case "M270":
      return 270;
    default:
      return 0;
  }
}

/**
 * Map an LTspice symbol type to the {@link LTSPICE_PINS} key holding its
 * symbol-local pin offsets. Returns `null` when no pin geometry is banked
 * (vendor symbols, opamps, transformers, pots — those need `.asy` import).
 */
function ltPinKey(type: string): keyof typeof LTSPICE_PINS | null {
  const leaf = (type.replace(/\\/g, "/").toLowerCase().split("/").pop() ?? "");
  const map: Record<string, keyof typeof LTSPICE_PINS> = {
    res: "res", res2: "res", r: "res",
    cap: "cap", cap2: "cap", c: "cap", polcap: "cap",
    ind: "ind", ind2: "ind", l: "ind",
    voltage: "voltage",
    current: "current",
    diode: "diode", schottky: "schottky", zener: "zener", led: "led",
    npn: "npn", npn3: "npn", npn4: "npn",
    pnp: "pnp", pnp3: "pnp", pnp4: "pnp",
    nmos: "nmos", nmos4: "nmos",
    pmos: "pmos", pmos4: "pmos",
    sw: "sw", csw: "sw",
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
  /** Non-fatal issues (symbols placed without pin-accurate geometry, etc.). */
  warnings: string[];
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
export function ascToSchematic(doc: AscDocument): AscImportResult {
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

  const wires: SchematicWire[] = doc.wires.map((w) => ({
    id: id("w"),
    points: [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }],
  }));

  const components: SchematicComponent[] = [];
  const netLabels: NetLabel[] = [];
  const warnings: string[] = [];

  for (const symbol of doc.symbols) {
    const kind = ltspiceTypeToKind(symbol.type);
    const instName = symbol.attrs.InstName ?? "";
    if (!kind) {
      warnings.push(
        `Skipped ${instName || "an unnamed part"}: no Tau equivalent for LTspice symbol "${symbol.type}".`,
      );
      continue;
    }
    const pinOverride = buildPinOverride(symbol, kind) ?? undefined;
    if (!pinOverride) {
      warnings.push(
        `${instName || symbol.type}: placed without pin-accurate geometry (no banked pins for "${symbol.type}"); its connections may be wrong.`,
      );
    }
    components.push({
      id: id("c"),
      kind,
      x: symbol.x,
      y: symbol.y,
      rotation: orientationToRotation(symbol.orientation),
      value: symbol.attrs.Value ?? "",
      label: instName,
      ...(pinOverride ? { pinOverride } : {}),
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

  const directives = doc.texts.filter((t) => t.directive).map((t) => t.text);
  const comments = doc.texts.filter((t) => !t.directive).map((t) => t.text);

  return { components, wires, netLabels, directives, comments, warnings };
}
