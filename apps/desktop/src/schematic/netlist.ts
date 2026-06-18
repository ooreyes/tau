import type { Point, SchematicComponent, SchematicWire } from "./types";
import { getComponentPins, type ComponentPin } from "./pins";

export interface ExtractedNet {
  id: string;
  points: Point[];
  pins: ComponentPin[];
  isGround: boolean;
}

export interface ExtractedComponent {
  component: SchematicComponent;
  pins: Record<string, string>;
}

export interface ExtractedCircuit {
  nets: ExtractedNet[];
  components: ExtractedComponent[];
  groundNetId: string | null;
  warnings: string[];
}

interface Segment {
  a: Point;
  b: Point;
}

class DisjointSet {
  private parent = new Map<string, string>();

  add(key: string) {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    const parent = this.parent.get(key);
    if (!parent || parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }

  keys() {
    return [...this.parent.keys()];
  }
}

export function extractCircuit(
  components: SchematicComponent[],
  wires: SchematicWire[],
): ExtractedCircuit {
  const dsu = new DisjointSet();
  const allPins = components.flatMap(getComponentPins);
  const pinByComponent = new Map<string, ComponentPin[]>();
  const warnings: string[] = [];

  for (const pin of allPins) {
    dsu.add(pointKey(pin));
    pinByComponent.set(pin.componentId, [...(pinByComponent.get(pin.componentId) ?? []), pin]);
  }

  for (const pins of pinsByPoint(allPins).values()) {
    for (let i = 1; i < pins.length; i += 1) {
      dsu.union(pointKey(pins[0]), pointKey(pins[i]));
    }
  }

  const groundPins = allPins.filter((pin) => pin.kind === "ground");
  for (let i = 1; i < groundPins.length; i += 1) {
    dsu.union(pointKey(groundPins[0]), pointKey(groundPins[i]));
  }

  const segments = wires.flatMap(wireSegments);
  const breakpoints = segments.map((segment) => [segment.a, segment.b]);

  for (let i = 0; i < segments.length; i += 1) {
    for (const pin of allPins) {
      if (pointOnSegment(pin, segments[i])) breakpoints[i].push(pin);
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      for (const point of segmentIntersections(segments[i], segments[j])) {
        breakpoints[i].push(point);
        breakpoints[j].push(point);
      }
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segmentPoints = uniquePoints(breakpoints[i]).sort((p1, p2) =>
      segments[i].a.x === segments[i].b.x ? p1.y - p2.y : p1.x - p2.x,
    );
    for (let j = 1; j < segmentPoints.length; j += 1) {
      dsu.union(pointKey(segmentPoints[j - 1]), pointKey(segmentPoints[j]));
    }
  }

  const rootToPoints = new Map<string, Point[]>();
  for (const key of dsu.keys()) {
    const root = dsu.find(key);
    rootToPoints.set(root, [...(rootToPoints.get(root) ?? []), pointFromKey(key)]);
  }

  const rootToPins = new Map<string, ComponentPin[]>();
  for (const pin of allPins) {
    const root = dsu.find(pointKey(pin));
    rootToPins.set(root, [...(rootToPins.get(root) ?? []), pin]);
  }

  const groundRoot = groundPins.length > 0 ? dsu.find(pointKey(groundPins[0])) : null;
  if (!groundRoot) warnings.push("No ground symbol found.");

  const sortedRoots = [...rootToPoints.keys()].sort((a, b) => {
    if (a === groundRoot) return -1;
    if (b === groundRoot) return 1;
    return a.localeCompare(b);
  });

  const rootToNetId = new Map<string, string>();
  let nextNet = 1;
  for (const root of sortedRoots) {
    rootToNetId.set(root, root === groundRoot ? "0" : `N${String(nextNet++).padStart(3, "0")}`);
  }

  const nets: ExtractedNet[] = sortedRoots.map((root) => ({
    id: rootToNetId.get(root) ?? root,
    points: uniquePoints(rootToPoints.get(root) ?? []),
    pins: rootToPins.get(root) ?? [],
    isGround: root === groundRoot,
  }));

  for (const net of nets) {
    if (!net.isGround && net.pins.length === 1) {
      const pin = net.pins[0];
      warnings.push(`${pin.componentLabel || pin.componentId}.${pin.label} is only connected to one pin.`);
    }
  }

  const extractedComponents = components.map((component) => {
    const pins: Record<string, string> = {};
    for (const pin of pinByComponent.get(component.id) ?? []) {
      pins[pin.id] = rootToNetId.get(dsu.find(pointKey(pin))) ?? "";
    }
    return { component, pins };
  });

  return {
    nets,
    components: extractedComponents,
    groundNetId: groundRoot ? rootToNetId.get(groundRoot) ?? null : null,
    warnings,
  };
}

function wireSegments(wire: SchematicWire): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < wire.points.length; i += 1) {
    const a = wire.points[i - 1];
    const b = wire.points[i];
    if (a.x !== b.x || a.y !== b.y) segments.push({ a, b });
  }
  return segments;
}

function segmentIntersections(first: Segment, second: Segment): Point[] {
  const firstVertical = first.a.x === first.b.x;
  const secondVertical = second.a.x === second.b.x;

  if (firstVertical !== secondVertical) {
    const vertical = firstVertical ? first : second;
    const horizontal = firstVertical ? second : first;
    const point = { x: vertical.a.x, y: horizontal.a.y };
    return pointOnSegment(point, vertical) && pointOnSegment(point, horizontal) ? [point] : [];
  }

  if (firstVertical && secondVertical && first.a.x === second.a.x) {
    return overlappingEndpoints(first, second, "y");
  }

  if (!firstVertical && !secondVertical && first.a.y === second.a.y) {
    return overlappingEndpoints(first, second, "x");
  }

  return [];
}

function overlappingEndpoints(first: Segment, second: Segment, axis: "x" | "y"): Point[] {
  return uniquePoints([first.a, first.b, second.a, second.b].filter((point) => {
    if (axis === "x") {
      return between(point.x, first.a.x, first.b.x) && between(point.x, second.a.x, second.b.x);
    }
    return between(point.y, first.a.y, first.b.y) && between(point.y, second.a.y, second.b.y);
  }));
}

function pointOnSegment(point: Point, segment: Segment): boolean {
  if (segment.a.x === segment.b.x) {
    return point.x === segment.a.x && between(point.y, segment.a.y, segment.b.y);
  }
  if (segment.a.y === segment.b.y) {
    return point.y === segment.a.y && between(point.x, segment.a.x, segment.b.x);
  }
  return false;
}

function between(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) && value <= Math.max(a, b);
}

function pinsByPoint(pins: ComponentPin[]): Map<string, ComponentPin[]> {
  const byPoint = new Map<string, ComponentPin[]>();
  for (const pin of pins) byPoint.set(pointKey(pin), [...(byPoint.get(pointKey(pin)) ?? []), pin]);
  return byPoint;
}

function uniquePoints(points: Point[]): Point[] {
  return [...new Map(points.map((point) => [pointKey(point), point])).values()];
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function pointFromKey(key: string): Point {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}
