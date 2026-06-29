/**
 * LTspice `.asc` schematic EXPORTER — the inverse of `ascImport.ts`.
 *
 * Two layers:
 *  - `serializeAscDocument(doc)` — a lossless text serializer that is the inverse
 *    of `parseAsc` for the structures the parser understands. The round-trip
 *    `parseAsc(serializeAscDocument(doc)) ≅ doc` holds for any document built from
 *    VERSION/SHEET/WIRE/FLAG/SYMBOL/SYMATTR/TEXT/shape content (i.e. no `unknown`
 *    lines, which by definition cannot be re-serialized).
 *  - `schematicToAsc({components, wires, netLabels, directives, comments})` —
 *    builds an `AscDocument` from Tau schematic content and serializes it, so a
 *    schematic edited in Tau can be written back as a `.asc` and reopened in
 *    LTspice. Round-trips through Tau's own importer: `importAsc(text) →
 *    schematicToAsc(result) → importAsc(text2)` yields the same components, wires,
 *    and nets (FEATURE_PARITY §1 "Export Tau schematic → .asc").
 */
import type {
  ComponentKind,
  NetLabel,
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import type { AscDocument, AscOrientation } from "./ascImport";

const int = (n: number): string => String(Math.round(n));

/**
 * Serialize an {@link AscDocument} to LTspice `.asc` text. Inverse of `parseAsc`.
 * Lines are emitted in LTspice's canonical order (header, wires, flags, symbols
 * with their attributes, free text, shapes). `unknown` lines are dropped — they
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
    diode: "diode",
    zener: "zener",
    led: "led",
    npn: "npn",
    pnp: "pnp",
    nmos: "nmos",
    pmos: "pmos",
    switch: "sw",
    potentiometer: "pot",
    transformer: "ind2t",
    opamp: "opamp",
    bsource: "bv",
    vcvs: "e",
    vccs: "g",
    cccs: "f",
    ccvs: "h",
  };
  return map[kind] ?? null;
}

/**
 * Map a Tau rotation (degrees) + mirror flag to an LTspice orientation token.
 * Inverse of `orientationToRotation` + the `M*` mirror convention.
 */
export function rotationToOrientation(
  rotation: 0 | 90 | 180 | 270,
  mirrored: boolean | undefined,
): AscOrientation {
  const base = mirrored ? "M" : "R";
  return `${base}${rotation}` as AscOrientation;
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
    if (wire.points.length > 2) {
      warnings.push(`Wire ${wire.id}: ${wire.points.length}-point polyline split into segments.`);
    }
  }

  for (const c of input.components) {
    if (c.kind === "ground") {
      doc.flags.push({ x: c.x, y: c.y, net: "0" });
      continue;
    }
    const type = kindToLtspiceType(c.kind);
    if (!type) {
      warnings.push(`${c.label || c.id}: no LTspice symbol for kind "${c.kind}"; skipped.`);
      continue;
    }
    const attrs: Record<string, string> = {};
    if (c.label) attrs.InstName = c.label;
    if (c.value) attrs.Value = c.value;
    doc.symbols.push({
      type,
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
