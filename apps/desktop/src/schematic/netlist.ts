import type { NetLabel, Point, SchematicComponent, SchematicWire } from "./types";
import { getComponentPins, type ComponentPin } from "./pins";
import { isEngineeringMantissa, splitEngineeringValue } from "./engineering";

/** Net-label texts that denote the global ground / reference node (case-insensitive). */
const GROUND_LABELS = new Set(["0", "gnd"]);
const isGroundLabel = (text: string): boolean => GROUND_LABELS.has(text.trim().toLowerCase());

export interface ExtractedNet {
  id: string;
  points: Point[];
  pins: ComponentPin[];
  isGround: boolean;
  /** Number of (non-ground) net labels attached. A labelled single-pin net is
   *  still "connected" - the label makes it observable and joinable (the
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

/** Append `value` to the array kept at `key`, creating it on first use.
 *  Replaces the `map.set(key, [...(map.get(key) ?? []), value])` idiom, which
 *  copies the whole bucket on every append - O(k) per call, O(k^2) per key
 *  over k appends. Ground is always the largest net, so that idiom made
 *  ground-net extraction quadratic in the net's point count. */
function pushBucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  bucket.push(value);
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
    pushBucket(pinByComponent, pin.componentId, pin);
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
    // ngspice node identity is case-insensitive and Tau emits sanitized node
    // names. Merge by that exact lowered identity here so diagnostics/probes
    // can never see two nets that the simulation deck silently shorts.
    const key = sanitizeNetName(label.text).toLocaleLowerCase();
    if (key === "") continue;
    pushBucket(labelsByName, key, { x: label.x, y: label.y });
  }
  for (const points of labelsByName.values()) {
    for (let i = 1; i < points.length; i += 1) {
      dsu.union(pointKey(points[0]), pointKey(points[i]));
    }
  }

  const segments = wires.flatMap(wireSegments);
  // Ideal wires short their endpoints. Resistive (non-ideal) wires do NOT -
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

  // Connectivity only occurs where at least one conductor ends (crossing
  // interiors are overpasses). Index orthogonal segments by their fixed axis
  // and exact endpoints, then query those buckets for pins/labels/endpoints.
  // This replaces the former all-segment-pairs scan that froze on large but
  // valid schematics with thousands of independent wires.
  const horizontalByY = new Map<number, number[]>();
  const verticalByX = new Map<number, number[]>();
  const endpointIndexes = new Map<string, number[]>();
  for (const index of idealSegmentIndexes) {
    const segment = segments[index];
    if (segment.a.y === segment.b.y) {
      pushBucket(horizontalByY, segment.a.y, index);
    } else if (segment.a.x === segment.b.x) {
      pushBucket(verticalByX, segment.a.x, index);
    }
    for (const endpoint of [segment.a, segment.b]) {
      pushBucket(endpointIndexes, pointKey(endpoint), index);
    }
  }
  const segmentIndexesAt = (point: Point): number[] => {
    const candidates = new Set(endpointIndexes.get(pointKey(point)) ?? []);
    for (const index of horizontalByY.get(point.y) ?? []) {
      if (pointOnSegment(point, segments[index])) candidates.add(index);
    }
    for (const index of verticalByX.get(point.x) ?? []) {
      if (pointOnSegment(point, segments[index])) candidates.add(index);
    }
    return [...candidates];
  };
  for (const point of [...allPins, ...labelPoints]) {
    for (const index of segmentIndexesAt(point)) breakpoints[index].push(point);
  }
  for (const index of idealSegmentIndexes) {
    for (const endpoint of [segments[index].a, segments[index].b]) {
      for (const other of segmentIndexesAt(endpoint)) {
        if (other === index) continue;
        breakpoints[index].push(endpoint);
        breakpoints[other].push(endpoint);
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
    pushBucket(rootToPoints, root, pointFromKey(key));
  }

  const rootToPins = new Map<string, ComponentPin[]>();
  for (const pin of allPins) {
    const root = dsu.find(pointKey(pin));
    pushBucket(rootToPins, root, pin);
  }

  const groundRoot = groundAnchors.length > 0 ? dsu.find(pointKey(groundAnchors[0])) : null;
  if (!groundRoot) warnings.push("No ground symbol found.");

  const sortedRoots = [...rootToPoints.keys()].sort((a, b) => {
    if (a === groundRoot) return -1;
    if (b === groundRoot) return 1;
    // Root keys are plain "<x>,<y>" coordinate strings (digits/comma/hyphen
    // only, from pointKey/pointFromKey) - a plain lexicographic compare
    // orders them identically to localeCompare for that alphabet but without
    // ICU collation overhead, ~50-100x slower for this hot sort where ground
    // (the largest net) is always one of the compared roots.
    return a < b ? -1 : a > b ? 1 : 0;
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
    if (labelName && !usedNames.has(labelName.toLocaleLowerCase())) {
      usedNames.add(labelName.toLocaleLowerCase());
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
      // LTspice digital gates expose an optional input bank plus true and
      // complementary outputs; unused terminals may float. Reporting those
      // pins as incomplete makes a valid 2-input gate look broken.
      if (pin.kind === "digitalGate") continue;
      // A switch's NC+/NC- control pair is optional: leaving it unwired holds
      // the part at its static open/closed state, which the deck builder
      // reports on its own terms. Nagging here would make every static switch
      // look broken - and callers that treat any extraction warning as fatal
      // (assistantActions) would refuse the schematic outright.
      if (pin.kind === "switch" && (pin.id === "cp" || pin.id === "cn")) continue;
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
 * the probe-resolution authority - a probe dropped mid-segment (the common
 * click) has no DSU point of its own but is still electrically on the net. */
export function netAtPoint(nets: ExtractedNet[], wires: SchematicWire[], point: Point): ExtractedNet | null {
  const atPoint = (net: ExtractedNet, p: Point) => net.points.some((np) => np.x === p.x && np.y === p.y);
  const exact = nets.find((net) => atPoint(net, point));
  if (exact) return exact;
  for (const wire of wires) {
    // Resistive wires are not a single net - only endpoints resolve (exact match above).
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
  if (!raw) return false;
  const { mantissa } = splitEngineeringValue(raw, "Ω");
  if (isEngineeringMantissa(mantissa) && Number(mantissa) === 0) return false;
  return true;
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
  for (const pin of pins) pushBucket(byPoint, pointKey(pin), pin);
  return byPoint;
}

function uniquePoints(points: Point[]): Point[] {
  return [...new Map(points.map((point) => [pointKey(point), point])).values()];
}

/** Greek letters common in EE net names (PowerSim FOC's `uα`/`uβ`, PLL's
 *  `θ_pll`). Transliterated by NAME so distinct labels can never collapse
 *  onto one node - the old strip-only rule turned both `uα` and `uβ` into
 *  `u`, silently shorting the α/β axes together (singular matrix). */
const GREEK_TRANSLITERATION: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ζ": "zeta",
  "η": "eta", "θ": "theta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "µ": "mu",
  "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho", "σ": "sigma", "τ": "tau", "φ": "phi",
  "χ": "chi", "ψ": "psi", "ω": "omega", "Ω": "ohm", "Δ": "delta", "Θ": "theta", "Σ": "sigma", "Φ": "phi", "Ψ": "psi",
};

/** Transliterate one label to SPICE-safe ASCII, collision-free: allowed chars
 *  pass through, Greek maps by name, anything else becomes its hex codepoint. */
export function spiceSafeToken(text: string): string {
  let out = "";
  for (const ch of text.trim()) {
    if (/[A-Za-z0-9_+\-./]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += "_";
    else out += GREEK_TRANSLITERATION[ch] ?? `x${ch.codePointAt(0)!.toString(16)}`;
  }
  return out;
}

/** Reduce a net-label to a SPICE-safe node name (no whitespace; never starts a
 *  generated N00x id, never the ground id "0"). */
function sanitizeNetName(text: string): string {
  const cleaned = spiceSafeToken(text);
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
