import { CATALOG_BY_KIND } from "./catalog";
import type { ComponentKind, NetLabel, Point, Probe, Rotation, SchematicComponent, SchematicWire } from "./types";
import type { SchematicDocument } from "../store/useSchematic";

export const MAX_SCHEMATIC_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COMPONENTS = 5_000;
const MAX_WIRES = 20_000;
const MAX_WIRE_POINTS = 100_000;
const MAX_ABS_COORDINATE = 1_000_000;
const MAX_TEXT_LENGTH = 160;
const MAX_ID_LENGTH = 128;
const MAX_DIRECTIVES = 1_000;
const MAX_DIRECTIVE_LENGTH = 1_024;
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
  return {
    id: text(source.id, `components[${index}].id`, MAX_ID_LENGTH),
    kind,
    x: coordinate(source.x, `components[${index}].x`),
    y: coordinate(source.y, `components[${index}].y`),
    rotation: rotation as Rotation,
    ...(source.mirrored === true ? { mirrored: true } : {}),
    value: text(source.value, `components[${index}].value`),
    label: text(source.label, `components[${index}].label`),
  };
}

function wire(value: unknown, index: number, remainingPoints: { value: number }): SchematicWire {
  const source = record(value, `wires[${index}]`);
  if (!Array.isArray(source.points) || source.points.length < 2) fail(`wires[${index}].points needs at least two points.`);
  remainingPoints.value -= source.points.length;
  if (remainingPoints.value < 0) fail(`wire point limit exceeded (${MAX_WIRE_POINTS}).`);
  const points = source.points.map((candidate, pointIndex) => point(candidate, `wires[${index}].points[${pointIndex}]`));
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1];
    const current = points[pointIndex];
    if (previous.x !== current.x && previous.y !== current.y) fail(`wires[${index}] must be orthogonal.`);
  }
  return { id: text(source.id, `wires[${index}].id`, MAX_ID_LENGTH), points };
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
  return result;
}

function netLabel(value: unknown, index: number): NetLabel {
  const source = record(value, `netLabels[${index}]`);
  return {
    id: text(source.id, `netLabels[${index}].id`, MAX_ID_LENGTH),
    x: coordinate(source.x, `netLabels[${index}].x`),
    y: coordinate(source.y, `netLabels[${index}].y`),
    text: text(source.text, `netLabels[${index}].text`, 80),
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
  if (!Array.isArray(probes) || probes.length > MAX_COMPONENTS) fail("probes must be a bounded array.");
  if (!Array.isArray(netLabels) || netLabels.length > MAX_COMPONENTS) fail("netLabels must be a bounded array.");
  if (!Array.isArray(directives) || directives.length > MAX_DIRECTIVES) fail("directives must be a bounded array.");

  const remainingPoints = { value: MAX_WIRE_POINTS };
  return {
    components: source.components.map(component),
    wires: source.wires.map((candidate, index) => wire(candidate, index, remainingPoints)),
    probes: probes.map(probe),
    netLabels: netLabels.map(netLabel),
    directives: directives.map((value, index) => text(value, `directives[${index}]`, MAX_DIRECTIVE_LENGTH)),
  };
}
