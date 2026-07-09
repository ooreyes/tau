import type { NetLabel, Point, SchematicComponent, SchematicWire } from "./types";
import { getComponentPins, type ComponentPin } from "./pins";

/** Net-label texts that denote the global ground / reference node (case-insensitive). */
const GROUND_LABELS = new Set(["0", "gnd"]);
const isGroundLabel = (text: string): boolean => GROUND_LABELS.has(text.trim().toLowerCase());

export interface ExtractedNet {
  id: string;
  points: Point[];
  pins: ComponentPin[];
  isGround: boolean;
  /** Number of (non-ground) net labels attached. A labelled single-pin net is
   *  still "connected" — the label makes it observable and joinable (the
   *  LTspice idiom of probing an output through a bare flag). */
  labelCount: number;
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

  // Iterative find with path compression. Recursion here could blow the call
  // stack on large/complex nets (long union chains from wire breakpoints), so
  // we walk to the root then re-point every node on the path directly at it.
  find(key: string): string {
    this.add(key);
    let root = key;
    let parent = this.parent.get(root)!;
    while (parent !== root) {
      root = parent;
      parent = this.parent.get(root)!;
    }
    let node = key;
    while (node !== root) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  // Union by size keeps trees shallow regardless of insertion order.
  private size = new Map<string, number>();

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const sizeA = this.size.get(rootA) ?? 1;
    const sizeB = this.size.get(rootB) ?? 1;
    if (sizeA < sizeB) {
      this.parent.set(rootA, rootB);
      this.size.set(rootB, sizeA + sizeB);
    } else {
      this.parent.set(rootB, rootA);
      this.size.set(rootA, sizeA + sizeB);
    }
  }

  keys() {
    return [...this.parent.keys()];
  }
}

export function extractCircuit(
  components: SchematicComponent[],
  wires: SchematicWire[],
  netLabels: NetLabel[] = [],
): ExtractedCircuit {
  const dsu = new DisjointSet();
  const allPins = components.flatMap(getComponentPins);
  const pinByComponent = new Map<string, ComponentPin[]>();
  const warnings: string[] = [];

  for (const pin of allPins) {
    dsu.add(pointKey(pin));
    pinByComponent.set(pin.componentId, [...(pinByComponent.get(pin.componentId) ?? []), pin]);
  }

  // Net labels are electrical: a labelled point joins whatever net sits under
  // it, and all labels sharing a name are the same net (LTspice's primary
  // cross-schematic connectivity). Register each label point as a DSU node;
  // points coincide with wire endpoints/pins, so unions merge the real nets.
  const labelPoints: Point[] = netLabels.map((label) => ({ x: label.x, y: label.y }));
  for (const point of labelPoints) dsu.add(pointKey(point));

  for (const pins of pinsByPoint(allPins).values()) {
    for (let i = 1; i < pins.length; i += 1) {
      dsu.union(pointKey(pins[0]), pointKey(pins[i]));
    }
  }

  // Ground anchors: ground-symbol pins plus any net label named "0"/"GND".
  const groundAnchors: Point[] = [
    ...allPins.filter((pin) => pin.kind === "ground"),
    ...netLabels.filter((label) => isGroundLabel(label.text)),
  ].map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < groundAnchors.length; i += 1) {
    dsu.union(pointKey(groundAnchors[0]), pointKey(groundAnchors[i]));
  }

  // Merge non-ground labels that share a name.
  const labelsByName = new Map<string, Point[]>();
  for (const label of netLabels) {
    if (isGroundLabel(label.text)) continue;
    const key = label.text.trim();
    if (key === "") continue;
    labelsByName.set(key, [...(labelsByName.get(key) ?? []), { x: label.x, y: label.y }]);
  }
  for (const points of labelsByName.values()) {
    for (let i = 1; i < points.length; i += 1) {
      dsu.union(pointKey(points[0]), pointKey(points[i]));
    }
  }

  const segments = wires.flatMap(wireSegments);
  // Ideal wires short their endpoints. Resistive (non-ideal) wires do NOT —
  // they only contribute endpoints as DSU nodes so netAtPoint can resolve them;
  // spiceNetlist emits a series R between the endpoint nets.
  const idealSegmentIndexes: number[] = [];
  {
    let segIdx = 0;
    for (const wire of wires) {
      const segs = wireSegments(wire);
      if (!isResistiveWire(wire)) {
        for (let k = 0; k < segs.length; k += 1) idealSegmentIndexes.push(segIdx + k);
      } else {
        if (wire.points.length >= 1) dsu.add(pointKey(wire.points[0]));
        if (wire.points.length >= 2) dsu.add(pointKey(wire.points[wire.points.length - 1]));
      }
      segIdx += segs.length;
    }
  }
  const breakpoints = segments.map((segment) => [segment.a, segment.b]);

  for (const i of idealSegmentIndexes) {
    for (const pin of allPins) {
      if (pointOnSegment(pin, segments[i])) breakpoints[i].push(pin);
    }
    for (const point of labelPoints) {
      if (pointOnSegment(point, segments[i])) breakpoints[i].push(point);
    }
  }

  for (let a = 0; a < idealSegmentIndexes.length; a += 1) {
    for (let b = a + 1; b < idealSegmentIndexes.length; b += 1) {
      const i = idealSegmentIndexes[a];
      const j = idealSegmentIndexes[b];
      for (const point of segmentIntersections(segments[i], segments[j])) {
        if (!isSegmentEndpoint(point, segments[i]) && !isSegmentEndpoint(point, segments[j])) continue;
        breakpoints[i].push(point);
        breakpoints[j].push(point);
      }
    }
  }

  for (const i of idealSegmentIndexes) {
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

  const groundRoot = groundAnchors.length > 0 ? dsu.find(pointKey(groundAnchors[0])) : null;
  if (!groundRoot) warnings.push("No ground symbol found.");

  const sortedRoots = [...rootToPoints.keys()].sort((a, b) => {
    if (a === groundRoot) return -1;
    if (b === groundRoot) return 1;
    return a.localeCompare(b);
  });

  // Prefer a user/LTspice net-label name for a net's id (so V(vcc) resolves as
  // the author intended); fall back to a generated N00x id otherwise.
  const rootToLabelName = new Map<string, string>();
  for (const label of netLabels) {
    if (isGroundLabel(label.text)) continue;
    const name = sanitizeNetName(label.text);
    if (name === "") continue;
    const root = dsu.find(pointKey({ x: label.x, y: label.y }));
    if (!rootToLabelName.has(root)) rootToLabelName.set(root, name);
  }
  const usedNames = new Set<string>();

  const rootToNetId = new Map<string, string>();
  let nextNet = 1;
  for (const root of sortedRoots) {
    if (root === groundRoot) {
      rootToNetId.set(root, "0");
      continue;
    }
    const labelName = rootToLabelName.get(root);
    if (labelName && !usedNames.has(labelName)) {
      usedNames.add(labelName);
      rootToNetId.set(root, labelName);
    } else {
      rootToNetId.set(root, `N${String(nextNet++).padStart(3, "0")}`);
    }
  }

  const rootLabelCount = new Map<string, number>();
  for (const label of netLabels) {
    if (isGroundLabel(label.text)) continue;
    const root = dsu.find(pointKey({ x: label.x, y: label.y }));
    rootLabelCount.set(root, (rootLabelCount.get(root) ?? 0) + 1);
  }

  const nets: ExtractedNet[] = sortedRoots.map((root) => ({
    id: rootToNetId.get(root) ?? root,
    points: uniquePoints(rootToPoints.get(root) ?? []),
    pins: rootToPins.get(root) ?? [],
    isGround: root === groundRoot,
    labelCount: rootLabelCount.get(root) ?? 0,
  }));

  for (const net of nets) {
    if (!net.isGround && net.pins.length === 1 && net.labelCount === 0) {
      const pin = net.pins[0];
      // The ideal op-amp ignores its supply rails, so don't nag about unconnected V+/V-.
      if (pin.kind === "opamp" && (pin.id === "v+" || pin.id === "v-")) continue;
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

/** Resolve which net sits under a world point: an exact net point (endpoint /
 * pin / junction), or any point lying on a wire segment of the net. This is
 * the probe-resolution authority — a probe dropped mid-segment (the common
 * click) has no DSU point of its own but is still electrically on the net. */
export function netAtPoint(nets: ExtractedNet[], wires: SchematicWire[], point: Point): ExtractedNet | null {
  const atPoint = (net: ExtractedNet, p: Point) => net.points.some((np) => np.x === p.x && np.y === p.y);
  const exact = nets.find((net) => atPoint(net, point));
  if (exact) return exact;
  for (const wire of wires) {
    // Resistive wires are not a single net — only endpoints resolve (exact match above).
    if (isResistiveWire(wire)) continue;
    for (const segment of wireSegments(wire)) {
      if (!pointOnSegment(point, segment)) continue;
      const owner = nets.find((net) => atPoint(net, segment.a) || atPoint(net, segment.b));
      if (owner) return owner;
    }
  }
  return null;
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

/** True when the wire carries a non-zero series resistance (non-ideal conductor). */
export function isResistiveWire(wire: SchematicWire): boolean {
  const raw = (wire.resistance ?? "").trim();
  if (!raw || raw === "0") return false;
  return true;
}

function segmentIntersections(first: Segment, second: Segment): Point[] {
  // Diagonal wires (LTspice allows them) must be classified explicitly: a
  // diagonal is neither vertical nor horizontal, so a "not vertical" test
  // alone would route two X-crossing diagonals that happen to share a start
  // row into the horizontal-overlap branch and falsely merge their endpoints
  // (Electrometer.asc crosses its dflop feedback this way as an overpass).
  // Diagonals connect only at shared endpoints, which the DSU handles by
  // point key without any help from this function.
  const firstVertical = first.a.x === first.b.x;
  const secondVertical = second.a.x === second.b.x;
  const firstHorizontal = first.a.y === first.b.y;
  const secondHorizontal = second.a.y === second.b.y;

  if ((firstVertical && secondHorizontal) || (secondVertical && firstHorizontal)) {
    const vertical = firstVertical ? first : second;
    const horizontal = firstVertical ? second : first;
    const point = { x: vertical.a.x, y: horizontal.a.y };
    return pointOnSegment(point, vertical) && pointOnSegment(point, horizontal) ? [point] : [];
  }

  if (firstVertical && secondVertical && first.a.x === second.a.x) {
    return overlappingEndpoints(first, second, "y");
  }

  if (firstHorizontal && secondHorizontal && first.a.y === second.a.y) {
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

function isSegmentEndpoint(point: Point, segment: Segment): boolean {
  return pointKey(point) === pointKey(segment.a) || pointKey(point) === pointKey(segment.b);
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

/** Reduce a net-label to a SPICE-safe node name (no whitespace; never starts a
 *  generated N00x id, never the ground id "0"). */
function sanitizeNetName(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_+\-./]/g, "");
  if (cleaned === "" || cleaned === "0") return "";
  return cleaned;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function pointFromKey(key: string): Point {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}
