import { CATALOG_BY_KIND } from "./catalog";
import type {
  ComponentKind,
  NetLabel,
  Point,
  Probe,
  Rotation,
  SchematicAscDataFlag,
  SchematicAscShape,
  SchematicForeignSymbol,
  SchematicPortDirection,
  SchematicComponent,
  SchematicSheet,
  SchematicTextAnnotation,
  SchematicWire,
} from "./types";
import { canonicalWindowJustification } from "./types";
import type { SchematicDocument, SchematicModelLibrary } from "../store/useSchematic";

export const MAX_SCHEMATIC_FILE_BYTES = 5 * 1024 * 1024;
// Exported so other import paths (the `.asc` importer's early count gate, in
// particular) can reject an oversized document by the same numbers instead of
// duplicating them - two copies of a security limit drift apart silently.
export const MAX_COMPONENTS = 5_000;
export const MAX_WIRES = 20_000;
const MAX_WIRE_POINTS = 100_000;
// Must clear the `.asc` importer's off-canvas parking convention: flattened
// hierarchical sub-blocks are shifted into disjoint X-regions starting at
// x = 1,000,000 (ascImport.ts) so their internals can never forge a false net
// with parent content. A parent block's shift re-shifts its already-parked
// children, so nested hierarchies grow the cursor roughly geometrically
// (measured 2.5e8 on a real 4-phase converter; depth is capped at 16). The
// cap exists to reject absurd values a hand-crafted file could use to break
// float math (1e308 coordinates), not to bound the canvas: 1e12 is exact in
// doubles and clears every real hierarchy with orders-of-magnitude headroom,
// while a pathological nesting chain overflows to Infinity and still fails
// the finiteness check - rejection, not corruption.
const MAX_ABS_COORDINATE = 1_000_000_000_000;
const MAX_TEXT_LENGTH = 160;
// A component's value is one future deck line, and real vendor blocks carry
// legitimately huge ones - flattened battery models in the acceptance corpus
// embed multi-KB PWL/table expressions. 32 KiB bounds a single field hard
// (the 5 MB document cap and the native 512 KiB deck cap still bound the
// aggregate) without rejecting genuine imported content.
const MAX_COMPONENT_VALUE_LENGTH = 32_768;
const MAX_ID_LENGTH = 128;
// One placement per attribute slot; LTspice's own slots stop well below this.
const MAX_WINDOWS_PER_COMPONENT = 64;
const MAX_DIRECTIVES = 1_000;
const MAX_TEXT_ANNOTATIONS = 2_000;
const MAX_ASC_SHAPES = 2_000;
const MAX_ASC_DATA_FLAGS = 2_000;
// A DATAFLAG expression is carried verbatim and never interpreted, so it only
// needs to be bounded, not parsed. Matches a directive's ceiling.
const MAX_ASC_DATA_FLAG_EXPR_LENGTH = 32_768;
const MAX_ASC_FOREIGN_SYMBOLS = 2_000;
// Generous next to any real symbol (LTspice itself writes a handful of SYMATTR
// fields per part) and small enough that a crafted file cannot grow one
// symbol's attributes without bound.
const MAX_FOREIGN_SYMBOL_ATTRS = 64;
// An imported LTspice TEXT !-block lands as ONE directive string with its
// embedded newlines (a behavioral-source table in the acceptance corpus runs
// to 2.5 KB), so a directive gets the same generous single-field cap as a
// component value; the 5 MB file cap and the native 512 KiB deck cap bound
// the aggregate.
const MAX_DIRECTIVE_LENGTH = 32_768;
// Exported so the attach-file UI can pre-check both caps before it ever
// touches the store (an inline error there is much cheaper than round-tripping
// through attachModelLibrary and validateSchematicDocument to discover the
// same limit).
export const MAX_MODEL_LIBRARIES = 64;
const MAX_MODEL_LIBRARY_NAME_LENGTH = 256;
// A single attached file may be up to the same size as a schematic import; the
// aggregate cap bounds a hand-crafted document from loading unbounded text.
const MAX_MODEL_LIBRARY_TEXT_LENGTH = MAX_SCHEMATIC_FILE_BYTES;
export const MAX_MODEL_LIBRARY_TOTAL_LENGTH = 4 * MAX_SCHEMATIC_FILE_BYTES;
const ROTATIONS = new Set<Rotation>([0, 90, 180, 270]);
const PROBE_COLORS = new Set([
  "var(--trace-red)",
  "var(--trace-purple)",
  "var(--trace-cyan)",
  "var(--trace-green)",
  "var(--trace-amber)",
  "var(--trace-cream)",
]);

function fail(message: string): never {
  throw new Error(`Invalid Tau schematic: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.length > maxLength) fail(`${name} must be a string up to ${maxLength} characters.`);
  return value;
}

function coordinate(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_COORDINATE) {
    fail(`${name} must be a finite coordinate within the canvas limit.`);
  }
  return value;
}

function point(value: unknown, name: string): Point {
  const source = record(value, name);
  return { x: coordinate(source.x, `${name}.x`), y: coordinate(source.y, `${name}.y`) };
}

function component(value: unknown, index: number): SchematicComponent {
  const source = record(value, `components[${index}]`);
  const kind = text(source.kind, `components[${index}].kind`) as ComponentKind;
  if (!(kind in CATALOG_BY_KIND)) fail(`components[${index}].kind is not supported.`);
  const rotation = source.rotation;
  if (typeof rotation !== "number" || !ROTATIONS.has(rotation as Rotation)) {
    fail(`components[${index}].rotation must be 0, 90, 180, or 270.`);
  }
  const result: SchematicComponent = {
    id: text(source.id, `components[${index}].id`, MAX_ID_LENGTH),
    kind,
    x: coordinate(source.x, `components[${index}].x`),
    y: coordinate(source.y, `components[${index}].y`),
    rotation: rotation as Rotation,
    ...(source.mirrored === true ? { mirrored: true } : {}),
    value: text(source.value, `components[${index}].value`, MAX_COMPONENT_VALUE_LENGTH),
    label: text(source.label, `components[${index}].label`),
  };
  if (source.pinOverride !== undefined) {
    if (!Array.isArray(source.pinOverride) || source.pinOverride.length > 64) {
      fail(`components[${index}].pinOverride must be an array of at most 64 pins.`);
    }
    result.pinOverride = source.pinOverride.map((candidate, pinIndex) => {
      const pin = record(candidate, `components[${index}].pinOverride[${pinIndex}]`);
      return {
        id: text(pin.id, `components[${index}].pinOverride[${pinIndex}].id`, MAX_ID_LENGTH),
        label: text(pin.label, `components[${index}].pinOverride[${pinIndex}].label`, 80),
        x: coordinate(pin.x, `components[${index}].pinOverride[${pinIndex}].x`),
        y: coordinate(pin.y, `components[${index}].pinOverride[${pinIndex}].y`),
      };
    });
  }
  if (source.ltSymbolType !== undefined) {
    result.ltSymbolType = text(source.ltSymbolType, `components[${index}].ltSymbolType`, MAX_TEXT_LENGTH);
  }
  if (source.ltWindows !== undefined) {
    if (!Array.isArray(source.ltWindows) || source.ltWindows.length > MAX_WINDOWS_PER_COMPONENT) {
      fail(`components[${index}].ltWindows must be an array of at most ${MAX_WINDOWS_PER_COMPONENT} records.`);
    }
    result.ltWindows = source.ltWindows.map((candidate, windowIndex) => {
      const name = `components[${index}].ltWindows[${windowIndex}]`;
      const window = record(candidate, name);
      const { attr, size } = window;
      if (typeof attr !== "number" || !Number.isInteger(attr) || attr < 0) fail(`${name}.attr must be a non-negative integer.`);
      if (typeof size !== "number" || !Number.isInteger(size) || size < 0) fail(`${name}.size must be a non-negative integer.`);
      const justification = canonicalWindowJustification(text(window.justification, `${name}.justification`, 40));
      // Re-emitted verbatim into `.asc` text, so an unrecognized token must
      // never round-trip - it would write a record LTspice cannot read.
      if (justification === null) fail(`${name}.justification is not a supported LTspice justification.`);
      return { attr, x: coordinate(window.x, `${name}.x`), y: coordinate(window.y, `${name}.y`), justification, size };
    });
  }
  return result;
}

function wire(value: unknown, index: number, remainingPoints: { value: number }): SchematicWire {
  const source = record(value, `wires[${index}]`);
  if (!Array.isArray(source.points) || source.points.length < 2) fail(`wires[${index}].points needs at least two points.`);
  remainingPoints.value -= source.points.length;
  if (remainingPoints.value < 0) fail(`wire point limit exceeded (${MAX_WIRE_POINTS}).`);
  const points = source.points.map((candidate, pointIndex) => point(candidate, `wires[${index}].points[${pointIndex}]`));
  // Diagonal segments are allowed: Tau's own editor only draws orthogonal
  // wires, but LTspice permits diagonals and imported `.asc` documents keep
  // them - the canvas and the netlister both handle arbitrary segments, so a
  // document carrying them must round-trip through save/load unchanged.
  const resistance =
    source.resistance === undefined || source.resistance === null || source.resistance === ""
      ? undefined
      : text(source.resistance, `wires[${index}].resistance`, 40);
  return { id: text(source.id, `wires[${index}].id`, MAX_ID_LENGTH), points, ...(resistance ? { resistance } : {}) };
}

function probe(value: unknown, index: number): Probe {
  const source = record(value, `probes[${index}]`);
  const color = text(source.color, `probes[${index}].color`, 40);
  if (!PROBE_COLORS.has(color)) fail(`probes[${index}].color is not supported.`);
  const result: Probe = {
    id: text(source.id, `probes[${index}].id`, MAX_ID_LENGTH),
    x: coordinate(source.x, `probes[${index}].x`),
    y: coordinate(source.y, `probes[${index}].y`),
    color,
  };
  if (source.componentId !== undefined) {
    result.componentId = text(source.componentId, `probes[${index}].componentId`, MAX_ID_LENGTH);
  }
  if (source.netId !== undefined) {
    result.netId = text(source.netId, `probes[${index}].netId`, MAX_ID_LENGTH);
  }
  return result;
}

function netLabel(value: unknown, index: number): NetLabel {
  const source = record(value, `netLabels[${index}]`);
  const result: NetLabel = {
    id: text(source.id, `netLabels[${index}].id`, MAX_ID_LENGTH),
    x: coordinate(source.x, `netLabels[${index}].x`),
    y: coordinate(source.y, `netLabels[${index}].y`),
    text: text(source.text, `netLabels[${index}].text`, 80),
  };
  // dx/dy are optional (absent on labels never dragged, and on any .sim file
  // saved before manual placement existed) - omitting them here (rather than
  // defaulting to 0) preserves "auto-place" as a distinct state from an
  // explicit zero offset the user actually dragged onto the anchor.
  if (source.dx !== undefined) result.dx = coordinate(source.dx, `netLabels[${index}].dx`);
  if (source.dy !== undefined) result.dy = coordinate(source.dy, `netLabels[${index}].dy`);
  // Re-emitted verbatim into an `IOPIN` record, so only LTspice's own spellings
  // may pass - anything else would write a file LTspice reads as malformed.
  if (source.port !== undefined) {
    const port = text(source.port, `netLabels[${index}].port`, 8);
    if (port !== "In" && port !== "Out" && port !== "BiDir") {
      fail(`netLabels[${index}].port must be "In", "Out", or "BiDir".`);
    }
    result.port = port as SchematicPortDirection;
  }
  return result;
}

function modelLibrary(value: unknown, index: number): SchematicModelLibrary {
  const source = record(value, `userModelLibraries[${index}]`);
  return {
    name: text(source.name, `userModelLibraries[${index}].name`, MAX_MODEL_LIBRARY_NAME_LENGTH),
    text: text(source.text, `userModelLibraries[${index}].text`, MAX_MODEL_LIBRARY_TEXT_LENGTH),
  };
}

function textAnnotation(value: unknown, index: number): SchematicTextAnnotation {
  const source = record(value, `textAnnotations[${index}]`);
  if (typeof source.directive !== "boolean") {
    fail(`textAnnotations[${index}].directive must be a boolean.`);
  }
  return {
    x: coordinate(source.x, `textAnnotations[${index}].x`),
    y: coordinate(source.y, `textAnnotations[${index}].y`),
    directive: source.directive,
    text: text(source.text, `textAnnotations[${index}].text`, MAX_DIRECTIVE_LENGTH),
  };
}

function ascDataFlag(value: unknown, index: number): SchematicAscDataFlag {
  const source = record(value, `ascDataFlags[${index}]`);
  const x = coordinate(source.x, `ascDataFlags[${index}].x`);
  const y = coordinate(source.y, `ascDataFlags[${index}].y`);
  // Whole numbers only, matching what the `.asc` parser accepts: these are
  // re-emitted through `Math.round`, so a fractional coordinate would move the
  // readout on the way back out instead of being refused.
  if (!Number.isInteger(x)) fail(`ascDataFlags[${index}].x must be a whole number.`);
  if (!Number.isInteger(y)) fail(`ascDataFlags[${index}].y must be a whole number.`);
  const expr = source.expr === undefined
    ? ""
    : text(source.expr, `ascDataFlags[${index}].expr`, MAX_ASC_DATA_FLAG_EXPR_LENGTH);
  // The expression is re-emitted as the tail of a single record, so a newline
  // in it would forge extra `.asc` lines on save.
  if (/[\r\n]/.test(expr)) fail(`ascDataFlags[${index}].expr must be a single line.`);
  return { x, y, expr };
}

const ASC_SHAPE_KINDS = new Set(["LINE", "RECTANGLE", "CIRCLE", "ARC"]);
const ASC_SHAPE_WIDTHS = new Set(["Normal", "Wide"]);

function ascShape(value: unknown, index: number): SchematicAscShape {
  const source = record(value, `ascShapes[${index}]`);
  const kind = text(source.kind, `ascShapes[${index}].kind`) as SchematicAscShape["kind"];
  if (!ASC_SHAPE_KINDS.has(kind)) {
    fail(`ascShapes[${index}].kind must be one of LINE, RECTANGLE, CIRCLE, ARC.`);
  }
  const width = text(source.width, `ascShapes[${index}].width`) as SchematicAscShape["width"];
  if (!ASC_SHAPE_WIDTHS.has(width)) {
    fail(`ascShapes[${index}].width must be "Normal" or "Wide".`);
  }
  // Endpoints for this kind, optionally followed by LTspice's dash-style index.
  // The count is part of the record's grammar, not just a bound: a LINE with an
  // ARC's eight coordinates serializes to a line LTspice cannot read back.
  const points = kind === "ARC" ? 8 : 4;
  if (!Array.isArray(source.coords) || source.coords.length < points || source.coords.length > points + 1) {
    fail(`ascShapes[${index}].coords must be an array of ${points} or ${points + 1} numbers for a ${kind}.`);
  }
  return {
    kind,
    width,
    coords: source.coords.map((coord, coordIndex) => {
      const name = `ascShapes[${index}].coords[${coordIndex}]`;
      const value = coordinate(coord, name);
      // Whole numbers only, matching what the `.asc` parser accepts: these are
      // re-emitted through `Math.round`, so a fractional coordinate would move
      // the drawing on the way back out instead of being refused.
      if (!Number.isInteger(value)) fail(`${name} must be a whole number.`);
      return value;
    }),
  };
}

const ASC_ORIENTATIONS = new Set([
  "R0", "R90", "R180", "R270", "M0", "M90", "M180", "M270",
]);

// A foreign symbol is the only document field written back into `.asc` text
// without passing through a fixed table first, and `SYMBOL`/`SYMATTR` are
// space-delimited line records. A newline would forge whole records and an
// interior space would shift a record's remaining fields, so both are refused
// here rather than sanitized: `parseAsc` splits on lines and cannot produce
// either, so a value carrying one did not come from an LTspice file.
const FORGES_ASC_RECORD = /[\s\u0000-\u001f\u007f]/;
// An attribute VALUE is the last field on its `SYMATTR` line, so an interior
// space is ordinary and must stay; only a control character can forge a record.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function foreignSymbol(value: unknown, index: number): SchematicForeignSymbol {
  const source = record(value, `ascForeignSymbols[${index}]`);
  const orientation = text(source.orientation, `ascForeignSymbols[${index}].orientation`, 8);
  if (!ASC_ORIENTATIONS.has(orientation)) {
    fail(`ascForeignSymbols[${index}].orientation must be one of R0, R90, R180, R270, M0, M90, M180, M270.`);
  }
  const attrsSource = record(source.attrs, `ascForeignSymbols[${index}].attrs`);
  const attrsEntries = Object.entries(attrsSource);
  if (attrsEntries.length > MAX_FOREIGN_SYMBOL_ATTRS) {
    fail(`ascForeignSymbols[${index}].attrs must have at most ${MAX_FOREIGN_SYMBOL_ATTRS} entries.`);
  }
  const attrs: Record<string, string> = {};
  for (const [name, raw] of attrsEntries) {
    if (name.length > MAX_TEXT_LENGTH) fail(`ascForeignSymbols[${index}].attrs has a field name that is too long.`);
    if (name === "" || FORGES_ASC_RECORD.test(name)) {
      fail(`ascForeignSymbols[${index}].attrs has a field name that is not a valid SYMATTR name.`);
    }
    const attrValue = text(raw, `ascForeignSymbols[${index}].attrs.${name}`, MAX_COMPONENT_VALUE_LENGTH);
    if (CONTROL_CHARACTER.test(attrValue)) {
      fail(`ascForeignSymbols[${index}].attrs.${name} must not contain control characters.`);
    }
    attrs[name] = attrValue;
  }
  const symbolType = text(source.type, `ascForeignSymbols[${index}].type`, MAX_TEXT_LENGTH);
  if (symbolType === "" || FORGES_ASC_RECORD.test(symbolType)) {
    fail(`ascForeignSymbols[${index}].type must be a non-empty LTspice symbol name with no whitespace.`);
  }
  const result: SchematicForeignSymbol = {
    type: symbolType,
    x: coordinate(source.x, `ascForeignSymbols[${index}].x`),
    y: coordinate(source.y, `ascForeignSymbols[${index}].y`),
    orientation: orientation as SchematicForeignSymbol["orientation"],
    attrs,
  };
  if (source.windows !== undefined) {
    if (!Array.isArray(source.windows) || source.windows.length > MAX_WINDOWS_PER_COMPONENT) {
      fail(`ascForeignSymbols[${index}].windows must be an array of at most ${MAX_WINDOWS_PER_COMPONENT} records.`);
    }
    result.windows = source.windows.map((candidate, windowIndex) => {
      const name = `ascForeignSymbols[${index}].windows[${windowIndex}]`;
      const window = record(candidate, name);
      const { attr, size } = window;
      if (typeof attr !== "number" || !Number.isInteger(attr) || attr < 0) fail(`${name}.attr must be a non-negative integer.`);
      if (typeof size !== "number" || !Number.isInteger(size) || size < 0) fail(`${name}.size must be a non-negative integer.`);
      const justification = canonicalWindowJustification(text(window.justification, `${name}.justification`, 40));
      // Re-emitted verbatim into `.asc` text, so an unrecognized token must
      // never round-trip - it would write a record LTspice cannot read.
      if (justification === null) fail(`${name}.justification is not a supported LTspice justification.`);
      return { attr, x: coordinate(window.x, `${name}.x`), y: coordinate(window.y, `${name}.y`), justification, size };
    });
  }
  return result;
}

function schematicSheet(value: unknown): SchematicSheet {
  const source = record(value, "ascSheet");
  const index = source.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > 64) {
    fail("ascSheet.index must be an integer from 1 to 64.");
  }
  return {
    index,
    width: coordinate(source.width, "ascSheet.width"),
    height: coordinate(source.height, "ascSheet.height"),
  };
}

/** Parse only the versioned schematic shape Tau can safely render and simulate. */
export function validateSchematicDocument(value: unknown): SchematicDocument {
  const source = record(value, "document");
  if (!Array.isArray(source.components) || source.components.length > MAX_COMPONENTS) {
    fail(`components must be an array of at most ${MAX_COMPONENTS} items.`);
  }
  if (!Array.isArray(source.wires) || source.wires.length > MAX_WIRES) {
    fail(`wires must be an array of at most ${MAX_WIRES} items.`);
  }
  const probes = source.probes === undefined ? [] : source.probes;
  const netLabels = source.netLabels === undefined ? [] : source.netLabels;
  const directives = source.directives === undefined ? [] : source.directives;
  const textAnnotations = source.textAnnotations === undefined ? [] : source.textAnnotations;
  const ascShapes = source.ascShapes === undefined ? [] : source.ascShapes;
  const ascDataFlags = source.ascDataFlags === undefined ? [] : source.ascDataFlags;
  const ascForeignSymbols = source.ascForeignSymbols === undefined ? [] : source.ascForeignSymbols;
  const ascSheet = source.ascSheet;
  const userModelLibraries = source.userModelLibraries === undefined ? [] : source.userModelLibraries;
  if (!Array.isArray(probes) || probes.length > MAX_COMPONENTS) fail("probes must be a bounded array.");
  if (!Array.isArray(netLabels) || netLabels.length > MAX_COMPONENTS) fail("netLabels must be a bounded array.");
  if (!Array.isArray(directives) || directives.length > MAX_DIRECTIVES) fail("directives must be a bounded array.");
  if (!Array.isArray(textAnnotations) || textAnnotations.length > MAX_TEXT_ANNOTATIONS) {
    fail(`textAnnotations must be an array of at most ${MAX_TEXT_ANNOTATIONS} items.`);
  }
  if (!Array.isArray(ascShapes) || ascShapes.length > MAX_ASC_SHAPES) {
    fail(`ascShapes must be an array of at most ${MAX_ASC_SHAPES} items.`);
  }
  if (!Array.isArray(ascDataFlags) || ascDataFlags.length > MAX_ASC_DATA_FLAGS) {
    fail(`ascDataFlags must be an array of at most ${MAX_ASC_DATA_FLAGS} items.`);
  }
  if (!Array.isArray(ascForeignSymbols) || ascForeignSymbols.length > MAX_ASC_FOREIGN_SYMBOLS) {
    fail(`ascForeignSymbols must be an array of at most ${MAX_ASC_FOREIGN_SYMBOLS} items.`);
  }
  if (!Array.isArray(userModelLibraries) || userModelLibraries.length > MAX_MODEL_LIBRARIES) {
    fail(`userModelLibraries must be an array of at most ${MAX_MODEL_LIBRARIES} items.`);
  }

  const remainingPoints = { value: MAX_WIRE_POINTS };
  const validatedComponents = source.components.map(component);
  const validatedWires = source.wires.map((candidate, index) => wire(candidate, index, remainingPoints));
  const validatedProbes = probes.map(probe);
  const validatedLabels = netLabels.map(netLabel);
  const allIds = [
    ...validatedComponents.map((item) => item.id),
    ...validatedWires.map((item) => item.id),
    ...validatedProbes.map((item) => item.id),
    ...validatedLabels.map((item) => item.id),
  ];
  if (new Set(allIds).size !== allIds.length) fail("component, wire, probe, and label ids must be unique.");
  const componentIds = new Set(validatedComponents.map((item) => item.id));
  for (const candidate of validatedProbes) {
    if (candidate.componentId && !componentIds.has(candidate.componentId)) {
      fail(`probe ${candidate.id} references a missing component.`);
    }
  }
  const referenceCounts = new Map<string, { display: string; count: number }>();
  for (const item of validatedComponents) {
    const display = item.label.trim();
    if (!display) continue;
    const key = display.toLocaleLowerCase();
    const previous = referenceCounts.get(key);
    referenceCounts.set(key, { display: previous?.display ?? display, count: (previous?.count ?? 0) + 1 });
  }
  const duplicateReference = [...referenceCounts.values()].find(({ count }) => count > 1);
  if (duplicateReference) {
    fail(`component reference "${duplicateReference.display}" is used ${duplicateReference.count} times; each component name must be unique.`);
  }

  const validatedLibraries = userModelLibraries.map(modelLibrary);
  if (new Set(validatedLibraries.map((item) => item.name)).size !== validatedLibraries.length) {
    fail("attached model library names must be unique.");
  }
  const totalLibraryText = validatedLibraries.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLibraryText > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
    fail(`attached model libraries exceed the ${MAX_MODEL_LIBRARY_TOTAL_LENGTH}-character aggregate limit.`);
  }

  return {
    components: validatedComponents,
    wires: validatedWires,
    probes: validatedProbes,
    netLabels: validatedLabels,
    directives: directives.map((value, index) => text(value, `directives[${index}]`, MAX_DIRECTIVE_LENGTH)),
    ...(textAnnotations.length > 0
      ? { textAnnotations: textAnnotations.map(textAnnotation) }
      : {}),
    ...(ascShapes.length > 0 ? { ascShapes: ascShapes.map(ascShape) } : {}),
    ...(ascDataFlags.length > 0 ? { ascDataFlags: ascDataFlags.map(ascDataFlag) } : {}),
    ...(ascForeignSymbols.length > 0 ? { ascForeignSymbols: ascForeignSymbols.map(foreignSymbol) } : {}),
    ...(ascSheet !== undefined ? { ascSheet: schematicSheet(ascSheet) } : {}),
    // Additive: only emit the key when attachments exist so legacy/empty
    // documents keep their exact prior serialized shape.
    ...(validatedLibraries.length > 0 ? { userModelLibraries: validatedLibraries } : {}),
  };
}
