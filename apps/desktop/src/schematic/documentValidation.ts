import { CATALOG_BY_KIND } from "./catalog";
import { extractCircuit } from "./netlist";
import { decodeParams, paramValuesValidationMessage } from "./params";
import { simulationBlockReason } from "../simulation/simulationIntegrity";
import { isRetiredKind, retiredKindNotice } from "./retiredKinds";
import type {
  ComponentKind,
  LtspiceExtraAttrs,
  NetLabel,
  Point,
  Probe,
  Rotation,
  SchematicAscDataFlag,
  SchematicAscShape,
  SchematicForeignSymbol,
  SchematicHierarchicalBlock,
  SchematicHierarchyMemberProvenance,
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

function singleLineText(value: unknown, name: string, maxLength = MAX_TEXT_LENGTH): string {
  const result = text(value, name, maxLength);
  if (/[\u0000-\u001f\u007f]/.test(result)) fail(`${name} must not contain control characters.`);
  return result;
}

function spiceNameText(value: unknown, name: string): string {
  const result = singleLineText(value, name);
  if (!result || /[\s=(){};]/.test(result)) fail(`${name} must be one SPICE name token.`);
  return result;
}

function coordinate(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_COORDINATE) {
    fail(`${name} must be a finite coordinate within the canvas limit.`);
  }
  return value;
}

const HIERARCHY_OWNER = /^h-[1-9]\d*$/;

function hierarchyMemberProvenance(value: unknown, name: string): SchematicHierarchyMemberProvenance {
  const source = record(value, name);
  const owner = text(source.owner, `${name}.owner`, MAX_ID_LENGTH);
  if (!HIERARCHY_OWNER.test(owner)) fail(`${name}.owner is not a valid hierarchy owner.`);
  const original = text(source.original, `${name}.original`, MAX_SCHEMATIC_FILE_BYTES);
  if (original.length === 0) fail(`${name}.original must not be empty.`);
  return { owner, original };
}

function point(value: unknown, name: string): Point {
  const source = record(value, name);
  return { x: coordinate(source.x, `${name}.x`), y: coordinate(source.y, `${name}.y`) };
}

function component(value: unknown, index: number): SchematicComponent | null {
  const source = record(value, `components[${index}]`);
  const kind = text(source.kind, `components[${index}].kind`) as ComponentKind;
  // A kind Tau has retired is dropped, not rejected: refusing it would make the
  // whole document unopenable over a part the user never has to care about.
  // Everything else unrecognized still fails - this is not a widened allowlist.
  if (isRetiredKind(kind)) return null;
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
    result.ltSymbolType = singleLineText(source.ltSymbolType, `components[${index}].ltSymbolType`, MAX_TEXT_LENGTH);
  }
  if (source.ltModelName !== undefined) {
    result.ltModelName = spiceNameText(source.ltModelName, `components[${index}].ltModelName`);
  }
  if (source.ltModelFile !== undefined) {
    result.ltModelFile = singleLineText(source.ltModelFile, `components[${index}].ltModelFile`, MAX_TEXT_LENGTH);
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
  if (source.ltExtraAttrs !== undefined) {
    result.ltExtraAttrs = ltspiceExtraAttrs(source.ltExtraAttrs, `components[${index}].ltExtraAttrs`);
  }
  if (source.ltHierarchy !== undefined) {
    result.ltHierarchy = hierarchyMemberProvenance(source.ltHierarchy, `components[${index}].ltHierarchy`);
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
  return {
    id: text(source.id, `wires[${index}].id`, MAX_ID_LENGTH),
    points,
    ...(resistance ? { resistance } : {}),
    ...(source.ltHierarchy !== undefined
      ? { ltHierarchy: hierarchyMemberProvenance(source.ltHierarchy, `wires[${index}].ltHierarchy`) }
      : {}),
  };
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
  if (source.ltHierarchy !== undefined) {
    result.ltHierarchy = hierarchyMemberProvenance(source.ltHierarchy, `netLabels[${index}].ltHierarchy`);
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
const LTSPICE_ATTR_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_COMPONENT_ATTR_FIELDS = new Set([
  "InstName", "Value", "TauKind", "TauValue", "TauLabel", "TauAttrs",
]);
const MAX_LT_EXTRA_ATTRS = 16;

function ltspiceExtraAttrs(value: unknown, name: string): LtspiceExtraAttrs {
  const source = record(value, name);
  const baseValue = text(source.baseValue, `${name}.baseValue`, MAX_COMPONENT_VALUE_LENGTH);
  const derivedValue = text(source.derivedValue, `${name}.derivedValue`, MAX_COMPONENT_VALUE_LENGTH);
  if (CONTROL_CHARACTER.test(baseValue)) fail(`${name}.baseValue must not contain control characters.`);
  if (CONTROL_CHARACTER.test(derivedValue)) fail(`${name}.derivedValue must not contain control characters.`);
  const rawExtras = record(source.extras, `${name}.extras`);
  const entries = Object.entries(rawExtras);
  if (entries.length === 0 || entries.length > MAX_LT_EXTRA_ATTRS) {
    fail(`${name}.extras must have from 1 to at most ${MAX_LT_EXTRA_ATTRS} entries.`);
  }
  const extras: Record<string, string> = {};
  for (const [field, raw] of entries) {
    if (!LTSPICE_ATTR_FIELD.test(field) || RESERVED_COMPONENT_ATTR_FIELDS.has(field)) {
      fail(`${name}.extras has a field name that is not a valid extended SYMATTR name.`);
    }
    const attrValue = text(raw, `${name}.extras.${field}`, MAX_COMPONENT_VALUE_LENGTH);
    if (CONTROL_CHARACTER.test(attrValue)) fail(`${name}.extras.${field} must not contain control characters.`);
    extras[field] = attrValue;
  }
  return { baseValue, derivedValue, extras };
}

// Shared by `ascForeignSymbols` and `ascHierarchicalBlocks`: both carry a raw
// SYMBOL record with identical shape and identical re-emission rules, so the
// field name only decides how a rejection is reported.
function foreignSymbol(
  value: unknown,
  index: number,
  field: "ascForeignSymbols" | "ascHierarchicalBlocks" = "ascForeignSymbols",
): SchematicForeignSymbol {
  const label = `${field}[${index}]`;
  const source = record(value, label);
  const orientation = text(source.orientation, `${label}.orientation`, 8);
  if (!ASC_ORIENTATIONS.has(orientation)) {
    fail(`${label}.orientation must be one of R0, R90, R180, R270, M0, M90, M180, M270.`);
  }
  const attrsSource = record(source.attrs, `${label}.attrs`);
  const attrsEntries = Object.entries(attrsSource);
  if (attrsEntries.length > MAX_FOREIGN_SYMBOL_ATTRS) {
    fail(`${label}.attrs must have at most ${MAX_FOREIGN_SYMBOL_ATTRS} entries.`);
  }
  const attrs: Record<string, string> = {};
  for (const [name, raw] of attrsEntries) {
    if (name.length > MAX_TEXT_LENGTH) fail(`${label}.attrs has a field name that is too long.`);
    if (name === "" || FORGES_ASC_RECORD.test(name)) {
      fail(`${label}.attrs has a field name that is not a valid SYMATTR name.`);
    }
    const attrValue = text(raw, `${label}.attrs.${name}`, MAX_COMPONENT_VALUE_LENGTH);
    if (CONTROL_CHARACTER.test(attrValue)) {
      fail(`${label}.attrs.${name} must not contain control characters.`);
    }
    attrs[name] = attrValue;
  }
  const symbolType = text(source.type, `${label}.type`, MAX_TEXT_LENGTH);
  if (symbolType === "" || FORGES_ASC_RECORD.test(symbolType)) {
    fail(`${label}.type must be a non-empty LTspice symbol name with no whitespace.`);
  }
  const result: SchematicForeignSymbol = {
    type: symbolType,
    x: coordinate(source.x, `${label}.x`),
    y: coordinate(source.y, `${label}.y`),
    orientation: orientation as SchematicForeignSymbol["orientation"],
    attrs,
  };
  if (source.windows !== undefined) {
    if (!Array.isArray(source.windows) || source.windows.length > MAX_WINDOWS_PER_COMPONENT) {
      fail(`${label}.windows must be an array of at most ${MAX_WINDOWS_PER_COMPONENT} records.`);
    }
    result.windows = source.windows.map((candidate, windowIndex) => {
      const name = `${label}.windows[${windowIndex}]`;
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

function hierarchicalBlock(value: unknown, index: number): SchematicHierarchicalBlock {
  const result: SchematicHierarchicalBlock = foreignSymbol(value, index, "ascHierarchicalBlocks");
  const source = record(value, `ascHierarchicalBlocks[${index}]`);
  if (source.provenance === undefined) return result;
  const raw = record(source.provenance, `ascHierarchicalBlocks[${index}].provenance`);
  const owner = text(raw.owner, `ascHierarchicalBlocks[${index}].provenance.owner`, MAX_ID_LENGTH);
  if (!HIERARCHY_OWNER.test(owner)) {
    fail(`ascHierarchicalBlocks[${index}].provenance.owner is not a valid hierarchy owner.`);
  }
  const boundedCount = (name: string, value: unknown, max: number): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
      fail(`ascHierarchicalBlocks[${index}].provenance.${name} must be an integer from 0 to ${max}.`);
    }
    return value;
  };
  result.provenance = {
    owner,
    componentCount: boundedCount("componentCount", raw.componentCount, MAX_COMPONENTS),
    wireCount: boundedCount("wireCount", raw.wireCount, MAX_WIRES),
    netLabelCount: boundedCount("netLabelCount", raw.netLabelCount, MAX_COMPONENTS),
  };
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

/**
 * Notices for the parts {@link validateSchematicDocument} silently drops as
 * retired. Read from the same untrusted value, and defensively: this runs
 * before validation, so nothing here may assume a well-formed document.
 */
export function retiredKindNotices(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const components = (value as { components?: unknown }).components;
  if (!Array.isArray(components)) return [];
  const notices: string[] = [];
  for (const candidate of components.slice(0, MAX_COMPONENTS)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const { kind, label } = candidate as { kind?: unknown; label?: unknown };
    if (typeof kind !== "string") continue;
    const named = typeof label === "string" ? label.slice(0, MAX_ID_LENGTH) : "";
    const notice = retiredKindNotice(kind, named);
    if (notice) notices.push(notice);
  }
  return notices;
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
  const ascHierarchicalBlocks = source.ascHierarchicalBlocks === undefined ? [] : source.ascHierarchicalBlocks;
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
  if (!Array.isArray(ascHierarchicalBlocks) || ascHierarchicalBlocks.length > MAX_ASC_FOREIGN_SYMBOLS) {
    fail(`ascHierarchicalBlocks must be an array of at most ${MAX_ASC_FOREIGN_SYMBOLS} items.`);
  }
  if (!Array.isArray(userModelLibraries) || userModelLibraries.length > MAX_MODEL_LIBRARIES) {
    fail(`userModelLibraries must be an array of at most ${MAX_MODEL_LIBRARIES} items.`);
  }

  const remainingPoints = { value: MAX_WIRE_POINTS };
  const validatedComponents = source.components
    .map(component)
    .filter((entry): entry is SchematicComponent => entry !== null);
  const validatedWires = source.wires.map((candidate, index) => wire(candidate, index, remainingPoints));
  const validatedProbes = probes.map(probe);
  const validatedLabels = netLabels.map(netLabel);
  const validatedHierarchicalBlocks = ascHierarchicalBlocks.map(
    (candidate: unknown, index: number) => hierarchicalBlock(candidate, index),
  );
  const hierarchyOwners = validatedHierarchicalBlocks
    .map((block) => block.provenance?.owner)
    .filter((owner): owner is string => owner !== undefined);
  if (new Set(hierarchyOwners).size !== hierarchyOwners.length) {
    fail("ascHierarchicalBlocks provenance owners must be unique.");
  }
  const hierarchyOwnerSet = new Set(hierarchyOwners);
  const hierarchyMembers = [
    ...validatedComponents.map((item) => item.ltHierarchy),
    ...validatedWires.map((item) => item.ltHierarchy),
    ...validatedLabels.map((item) => item.ltHierarchy),
  ].filter((item): item is SchematicHierarchyMemberProvenance => item !== undefined);
  const orphan = hierarchyMembers.find((item) => !hierarchyOwnerSet.has(item.owner));
  if (orphan) fail(`hierarchy member references missing owner "${orphan.owner}".`);
  const hierarchySnapshotBytes = hierarchyMembers.reduce((sum, item) => sum + item.original.length, 0);
  if (hierarchySnapshotBytes > 2 * MAX_SCHEMATIC_FILE_BYTES) {
    fail("hierarchy member snapshots exceed the aggregate document limit.");
  }
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
  // Shared with the live pass below rather than scanned twice: the
  // deserializer must keep refusing (a document with two R1s cannot be
  // simulated), and the dock must be able to LIST the same collision without a
  // throw. Two copies of the scan would drift the moment one grew a case.
  const duplicateReference = duplicateReferenceDesignators(validatedComponents)[0];
  if (duplicateReference) {
    fail(`component reference "${duplicateReference.display}" is used ${duplicateReference.count} times; each component name must be unique.`);
  }

  const validatedLibraries = userModelLibraries.map(modelLibrary);
  if (new Set(validatedLibraries.map((item) => item.name)).size !== validatedLibraries.length) {
    fail("attached model file names must be unique.");
  }
  const totalLibraryText = validatedLibraries.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLibraryText > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
    fail(`attached model files exceed the ${MAX_MODEL_LIBRARY_TOTAL_LENGTH}-character aggregate limit.`);
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
    // Arrow, not a bare reference: `map` passes the array as a third argument,
    // which would land in `field`.
    ...(ascForeignSymbols.length > 0
      ? { ascForeignSymbols: ascForeignSymbols.map((candidate: unknown, index: number) => foreignSymbol(candidate, index)) }
      : {}),
    ...(validatedHierarchicalBlocks.length > 0
      ? { ascHierarchicalBlocks: validatedHierarchicalBlocks }
      : {}),
    ...(ascSheet !== undefined ? { ascSheet: schematicSheet(ascSheet) } : {}),
    // Additive: only emit the key when attachments exist so legacy/empty
    // documents keep their exact prior serialized shape.
    ...(validatedLibraries.length > 0 ? { userModelLibraries: validatedLibraries } : {}),
  };
}

/* ── live diagnostics (P3-14) ────────────────────────────────────────────────
 *
 * Everything above is a DESERIALIZER: every check ends in `fail()`, it runs
 * once on load/import, and it either returns a document or throws. That is the
 * right shape for untrusted bytes and the wrong shape for a dock, which needs
 * a LIST of everything wrong with a document the user is still typing.
 *
 * So this half is a linter over the live store. It reuses the checks that
 * already exist rather than restating them - `extractCircuit`'s connectivity
 * warnings, `params.ts`'s per-field ranges, the duplicate-designator scan
 * above, `simulationIntegrity`'s fail-closed refusal - because a second
 * spelling of a rule is a rule that will disagree with itself. Where a check
 * already has product copy, the row carries that copy VERBATIM, so a problem
 * reads identically before Run and after it.
 *
 * Only two classes had no code anywhere and are new here: "no source" and
 * "shorted source".
 */

/** One reference designator used by more than one part. */
export interface DuplicateReference {
  /** The designator as first drawn, for the message. */
  display: string;
  /** How many parts carry it. */
  count: number;
  /** Every part carrying it, in document order. */
  componentIds: string[];
}

/**
 * Reference designators used more than once, in first-appearance order.
 *
 * Case-insensitive because SPICE is: `r1` and `R1` are one instance name in the
 * emitted deck, and letting both through would silently drop one part's card.
 * Blank labels are skipped - an unnamed part gets its designator at emission.
 */
export function duplicateReferenceDesignators(
  components: readonly Pick<SchematicComponent, "id" | "label">[],
): DuplicateReference[] {
  const byKey = new Map<string, DuplicateReference>();
  for (const item of components) {
    const display = item.label.trim();
    if (!display) continue;
    const key = display.toLocaleLowerCase();
    const previous = byKey.get(key);
    if (previous) {
      previous.count += 1;
      previous.componentIds.push(item.id);
    } else {
      byKey.set(key, { display, count: 1, componentIds: [item.id] });
    }
  }
  return [...byKey.values()].filter(({ count }) => count > 1);
}

/** Which check produced a row. Present so tests can pin coverage per class
 *  instead of grepping prose that product copy is free to reword. */
export type LiveDiagnosticCode =
  | "no-ground"
  | "no-source"
  | "shorted-source"
  | "duplicate-reference"
  | "bad-parameter"
  | "unsupported-model"
  | "directive-or-model"
  | "floating-pin"
  | "label-names-nothing"
  | "connectivity";

/** A navigation contract deliberately independent of the editor shell.
 *
 * The linter knows what object is wrong; Canvas/App own selection and
 * viewport movement. Carrying the target as data lets the diagnostics UI stay
 * useful before a run and lets any shell focus a component or a net without
 * scraping its human-readable message for an id. */
export type DiagnosticFocusTarget =
  | {
    kind: "component";
    componentId: string;
    /** Human reference for an accessible action label, e.g. `R1`. */
    reference: string;
  }
  | {
    kind: "net";
    netId: string;
    x: number;
    y: number;
    /** A reader's label when one exists, otherwise the stable extracted id. */
    label?: string;
  };

/** Structured net context shown by a diagnostic row and usable by callers
 * that want to cross-highlight a waveform/net inspector. */
export interface DiagnosticNetContext {
  id: string;
  x: number;
  y: number;
  label?: string;
}

export interface LiveDiagnostic {
  /** Stable within one pass; used as a React key and for deduplication. */
  id: string;
  code: LiveDiagnosticCode;
  /**
   * `error` means this document cannot be simulated as drawn; `warning` means
   * it can, but almost certainly not as intended. The split matches how the
   * run report already tones these: a missing ground aborts deck
   * construction, a single-pin net only warns.
   */
  severity: "error" | "warning";
  /** What is wrong, naming the offending part. Product copy, shown verbatim. */
  message: string;
  /** The offending part, so a row can select it. Absent for document-level
   *  problems (no ground, no source) that belong to no single part. */
  componentId?: string;
  /** Reference designator / catalog name for display without parsing prose. */
  reference?: string;
  /** Electrical net affected by this row, when the linter can identify one. */
  net?: DiagnosticNetContext;
  /** Explicit focus action target for the editor shell. */
  focus?: DiagnosticFocusTarget;
}

export interface LiveDiagnosticsInput {
  components: readonly SchematicComponent[];
  wires: readonly SchematicWire[];
  netLabels?: readonly NetLabel[];
  ascForeignSymbols?: readonly SchematicForeignSymbol[];
  /**
   * The fail-closed model/directive probe: a thunk that builds a deck and is
   * expected to THROW the engine's own refusal, which becomes one row verbatim.
   *
   * Injected rather than imported, and that is a module-graph decision, not a
   * style one. `engine/spiceNetlist.ts` pulls in some forty engine modules, and
   * this file is imported by `store/useProject.ts`, `project/fsBridge.ts` and
   * the CLI - none of which has any business loading a SPICE emitter to learn
   * a file-size cap. The caller that already owns the engine passes the thunk.
   *
   * Omitting it costs exactly the two classes only the deck can see (an
   * explicitly named model that resolved nowhere, and a malformed directive);
   * every structural class still runs.
   */
  probeDeck?: () => void;
}

/**
 * A part that drives the circuit: an INDEPENDENT source.
 *
 * Derived from the catalog rather than a hard-coded kind list, because the
 * kind set is actively moving - P3-01 converts a source's `kind` between
 * `vsource`/`vac`/`vpulse` and their exp/pwl/sffm equivalents, and a frozen
 * list would then report "no source" for a schematic that visibly has one,
 * which is the worst possible failure for this check.
 *
 * Two catalog facts, unioned, because neither alone is right: the `Sources`
 * section holds `ground` (which drives nothing) and misses `logicConstant`
 * (which is a DC source living under Digital), while the `V`/`I` designator
 * prefix is exactly what an independent source carries and nothing else does.
 */
function isIndependentSource(kind: ComponentKind): boolean {
  const entry = CATALOG_BY_KIND[kind];
  if (!entry) return false;
  if (kind === "ground") return false;
  return entry.section === "Sources" || entry.prefix === "V" || entry.prefix === "I";
}

/** What to call this part in a row: its designator, else its kind's name. */
function partName(component: SchematicComponent): string {
  return component.label.trim() || CATALOG_BY_KIND[component.kind]?.name || component.kind;
}

function componentDiagnosticTarget(component: SchematicComponent): Pick<LiveDiagnostic, "componentId" | "reference" | "focus"> {
  const reference = partName(component);
  return {
    componentId: component.id,
    reference,
    focus: { kind: "component", componentId: component.id, reference },
  };
}

function netDiagnosticTarget(
  net: { id: string; points: readonly Point[] },
  labels: readonly NetLabel[],
): Pick<LiveDiagnostic, "net" | "focus"> {
  // Every extracted net originates from a pin, wire, or label and therefore
  // has a point. Keep the guard anyway: a future extractor bug should yield a
  // non-actionable row, never an invented coordinate at the canvas origin.
  const point = net.points[0];
  if (!point) return {};
  const label = labels.find((candidate) => net.points.some((candidatePoint) => (
    candidatePoint.x === candidate.x && candidatePoint.y === candidate.y
  )))?.text.trim() || undefined;
  const context: DiagnosticNetContext = { id: net.id, x: point.x, y: point.y, ...(label ? { label } : {}) };
  return {
    net: context,
    focus: { kind: "net", netId: context.id, x: context.x, y: context.y, ...(context.label ? { label: context.label } : {}) },
  };
}

/** `extractCircuit`'s single-pin warning, so its text can be matched back to
 *  the pin that produced it without restating the exemptions it applies. */
const SINGLE_PIN_WARNING = /^(.+) is only connected to one pin\.$/;

/**
 * Everything wrong with the document as it stands, with no run required.
 *
 * Order is fixed and deliberate: errors before warnings, and within that the
 * document-level structural failures first, because "there is no ground" is
 * the sentence that explains most of the rows under it. Callers render the
 * array in order, and the dock's badge count is this array's length - the
 * report's done-when requires those two to be the same number.
 */
export function liveSchematicDiagnostics(input: LiveDiagnosticsInput): LiveDiagnostic[] {
  const components = input.components;
  const netLabels = input.netLabels ?? [];
  const foreignSymbols = input.ascForeignSymbols ?? [];
  // A sheet with no parts on it is not a broken circuit, it is an empty one.
  // Without this gate a brand-new untitled schematic opens shouting "No ground
  // symbol found." at someone who has not drawn anything yet.
  //
  // Foreign symbols are the exception, and a fail-closed one: they live in a
  // collection of their own, so an import made entirely of parts Tau has no
  // model for reaches here with `components` empty. Returning [] there would
  // present an unsimulatable sheet as a clean one. The refusal is reported on
  // its own — a sheet with no Tau-modelled part in it has no topology worth
  // lecturing about.
  if (components.length === 0) {
    const refusal = simulationBlockReason(components, foreignSymbols);
    return refusal
      ? [{ id: "unsupported-model::0", code: "unsupported-model", severity: "error", message: refusal }]
      : [];
  }

  const errors: LiveDiagnostic[] = [];
  const warnings: LiveDiagnostic[] = [];
  const push = (row: Omit<LiveDiagnostic, "id">) => {
    const list = row.severity === "error" ? errors : warnings;
    list.push({ ...row, id: `${row.code}:${row.componentId ?? ""}:${list.length}` });
  };

  const circuit = extractCircuit(
    components as SchematicComponent[],
    input.wires as SchematicWire[],
    netLabels as NetLabel[],
  );

  // ── no ground reference ────────────────────────────────────────────────
  // The netlist's own sentence, verbatim, so this row and the warning a real
  // run produces are the same string rather than two names for one problem.
  const noGround = circuit.warnings.includes("No ground symbol found.");
  if (noGround) push({ code: "no-ground", severity: "error", message: "No ground symbol found." });

  // ── no source ──────────────────────────────────────────────────────────
  const sources = components.filter((component) => isIndependentSource(component.kind));
  if (sources.length === 0) {
    push({
      code: "no-source",
      severity: "error",
      message: "No source: nothing in this schematic drives it. Add a voltage or current source.",
    });
  }

  // ── shorted source ─────────────────────────────────────────────────────
  // Every terminal on one net, so the source drives nothing and the solver
  // sees a zero-impedance loop. Tested over all of the part's pins rather than
  // a hard-coded `p`/`n` pair, so a future source with a different bank is
  // covered the day it lands.
  const extractedById = new Map(circuit.components.map((entry) => [entry.component.id, entry]));
  for (const source of sources) {
    const pins = Object.values(extractedById.get(source.id)?.pins ?? {});
    if (pins.length < 2) continue;
    if (pins.some((net) => net === "")) continue;
    if (!pins.every((net) => net === pins[0])) continue;
    push({
      code: "shorted-source",
      severity: "error",
      ...componentDiagnosticTarget(source),
      message: `${partName(source)} is shorted: every terminal sits on the same net, so it drives nothing.`,
    });
  }

  // ── duplicate reference designators ────────────────────────────────────
  for (const duplicate of duplicateReferenceDesignators(components)) {
    const collider = components.find((component) => component.id === duplicate.componentIds[1]);
    push({
      code: "duplicate-reference",
      severity: "error",
      // The second occurrence, not the first: the first one is where the name
      // legitimately came from, and the collider is the part to go and rename.
      componentId: duplicate.componentIds[1],
      reference: duplicate.display,
      focus: {
        kind: "component",
        componentId: duplicate.componentIds[1],
        reference: collider ? partName(collider) : duplicate.display,
      },
      message: `Duplicate reference: "${duplicate.display}" is used ${duplicate.count} times; each component name must be unique.`,
    });
  }

  // ── unparseable / out-of-range parameter values ────────────────────────
  // `paramValuesValidationMessage` over `decodeParams` is the same pair the
  // inspector commits through, so the dock cannot disagree with the field that
  // refused the keystroke.
  for (const component of components) {
    const message = paramValuesValidationMessage(
      component.kind,
      decodeParams(component.kind, component.value),
    );
    if (!message) continue;
    push({
      code: "bad-parameter",
      severity: "error",
      ...componentDiagnosticTarget(component),
      message: `${partName(component)}: ${message}`,
    });
  }

  // ── unresolved named device / missing model, fail-closed ────────────────
  // Verbatim from `simulationIntegrity`, which is where the refusal is worded.
  // It SAYS it refused and names what it refused over; paraphrasing it here
  // would be the one thing this item is not allowed to soften.
  const refusal = simulationBlockReason(components, foreignSymbols);
  if (refusal) {
    const named = components.find((component) => refusal.includes(partName(component)));
    push({
      code: "unsupported-model",
      severity: "error",
      ...(named ? componentDiagnosticTarget(named) : {}),
      message: refusal,
    });
  }

  // ── directive errors, and a named model that resolved nowhere ───────────
  // Only when the structure is sound: the deck refuses on a missing ground or
  // an empty sheet FIRST, so probing before then would just restate a row that
  // is already above, and it is the expensive check of the set.
  if (errors.length === 0 && input.probeDeck) {
    try {
      input.probeDeck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Attribution is by designator match, which is all the engine's copy
      // offers - it names parts (`M1 names model "IRF540"`), not ids.
      const named = components.find((component) => {
        const name = component.label.trim();
        return name.length > 0 && new RegExp(`(^|[^\\w])${escapeForRegExp(name)}([^\\w]|$)`).test(message);
      });
      push({
        code: "directive-or-model",
        severity: "error",
        ...(named ? componentDiagnosticTarget(named) : {}),
        message,
      });
    }
  }

  // ── floating / unconnected pins ────────────────────────────────────────
  // Taken from `extractCircuit`'s warnings rather than recomputed, because the
  // decision of WHICH single-pin nets deserve a warning carries reasoned
  // exemptions (an ideal op-amp ignores its rails, a digital gate may float
  // unused terminals, a switch's control pair is optional). Restating those
  // here would make a valid part look broken the first time one changed. Only
  // the mapping back to a component id is done locally.
  const pinOwnerByName = new Map<string, { componentId: string; net: typeof circuit.nets[number] }>();
  for (const net of circuit.nets) {
    for (const pin of net.pins) {
      const key = `${pin.componentLabel || pin.componentId}.${pin.label}`;
      if (!pinOwnerByName.has(key)) pinOwnerByName.set(key, { componentId: pin.componentId, net });
    }
  }
  for (const warning of circuit.warnings) {
    if (warning === "No ground symbol found.") continue;
    const single = SINGLE_PIN_WARNING.exec(warning);
    if (!single) {
      // An extraction warning this pass does not recognize is still shown,
      // not dropped: a netlist warning nobody surfaces is how a real problem
      // becomes invisible.
      push({ code: "connectivity", severity: "warning", message: warning });
      continue;
    }
    const owner = pinOwnerByName.get(single[1]);
    const component = owner ? components.find((candidate) => candidate.id === owner.componentId) : undefined;
    const netTarget = owner ? netDiagnosticTarget(owner.net, netLabels) : {};
    push({
      code: "floating-pin",
      severity: "warning",
      ...(component ? componentDiagnosticTarget(component) : netTarget),
      ...(netTarget.net ? { net: netTarget.net } : {}),
      message: warning,
    });
  }

  // ── a net label naming nothing ─────────────────────────────────────────
  // A net that carries labels and not one pin. `extractCircuit` treats a
  // LABELLED single-pin net as connected on purpose (the LTspice idiom of
  // probing an output through a bare flag), so this is the case it cannot
  // report: a flag floating on empty canvas, which silently names no node.
  for (const net of circuit.nets) {
    if (net.pins.length > 0 || net.labelCount === 0) continue;
    const onNet = netLabels.filter((label) =>
      net.points.some((point) => point.x === label.x && point.y === label.y),
    );
    for (const label of onNet) {
      push({
        code: "label-names-nothing",
        severity: "warning",
        ...netDiagnosticTarget(net, netLabels),
        message: `Net label "${label.text}" names nothing: it is not on a wire or a pin.`,
      });
    }
  }

  return [...errors, ...warnings];
}

/** Escape a designator for literal use inside a `RegExp`. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
