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

/**
 * Union-find over schematic points, addressed by dense integer node ids.
 *
 * This used to be a `Map<string, string>` keyed on `pointKey`'s `"<x>,<y>"`
 * strings, which meant every `add`/`find`/`union` allocated a fresh string and
 * hashed it, and every path-compression step wrote another string back into
 * the map. `extractCircuit` sits on interactive paths — the netlist is derived
 * again after each edit — so that allocation traffic was measurable as
 * milliseconds of latency per keystroke on a large schematic.
 *
 * Now each distinct coordinate is interned exactly once into a dense id and
 * the forest itself lives in flat `Int32Array`s, so the inner loops are array
 * indexing with no allocation and no hashing at all. Ids are handed out in
 * first-touch order, which is deliberately the same order the old parent map
 * iterated in: `extractCircuit` walks every node to bucket points per root,
 * and the order of that walk decides the order of `ExtractedNet.points`, which
 * is observable output.
 *
 * The interner is a two-level `x -> y -> id` index on the raw numbers rather
 * than a `Map` on the joined string, because a string-keyed interner would
 * still pay the allocation on every lookup and the allocation is most of what
 * we are trying to remove. Numeric keys discriminate exactly as the string
 * keys did: `Map` compares with SameValueZero, which unifies `-0` with `0` and
 * matches `NaN` with itself, and `${x},${y}` collapsed those same pairs. The
 * only place the two forms could have drifted is the coordinate handed back
 * out. The old reverse lookup parsed the key with `Number(...)`, which quietly
 * laundered a `-0` into `0`, and `-0` is reachable here: `rotatePoint` negates
 * a zero pin offset (`{ x: -point.y }` at 90 degrees). Handing the interned
 * number straight back would therefore have put a `-0` into `ExtractedNet
 * .points` where callers have always seen `0`, so `intern` normalises the same
 * way the old parse did.
 */
class DisjointSet {
  private readonly idByX = new Map<number, Map<number, number>>();
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private parent = new Int32Array(64);
  private size = new Int32Array(64);
  private count = 0;

  /** Node id for a coordinate, minting one on first sight. */
  private intern(point: Point): number {
    // See the class comment: canonicalising -0 to +0 here is what keeps the
    // reverse lookup identical to the old parse-the-key-back round trip.
    const x = point.x === 0 ? 0 : point.x;
    const y = point.y === 0 ? 0 : point.y;
    let column = this.idByX.get(x);
    if (column === undefined) {
      column = new Map<number, number>();
      this.idByX.set(x, column);
    }
    const existing = column.get(y);
    if (existing !== undefined) return existing;

    const id = this.count;
    this.count += 1;
    if (this.count > this.parent.length) this.grow();
    column.set(y, id);
    this.xs.push(x);
    this.ys.push(y);
    this.parent[id] = id;
    this.size[id] = 1;
    return id;
  }

  /** Double the flat arrays. Amortised O(1) growth matters because the node
   *  count is not known up front - wire breakpoints mint nodes as they are
   *  discovered - and the schematics this has to survive are the ones with
   *  thousands of independent wires. */
  private grow(): void {
    const grownParent = new Int32Array(this.parent.length * 2);
    grownParent.set(this.parent);
    this.parent = grownParent;
    const grownSize = new Int32Array(this.size.length * 2);
    grownSize.set(this.size);
    this.size = grownSize;
  }

  /** Register a coordinate. Only `x`/`y` are ever read and only the numbers are
   *  retained, so callers hand pins and net labels in directly rather than
   *  copying them into a bare `Point` first - nothing about the richer object
   *  can leak into the extracted nets. */
  add(point: Point): void {
    this.intern(point);
  }

  // Iterative find with path compression. Recursion here could blow the call
  // stack on large/complex nets (long union chains from wire breakpoints), so
  // we walk to the root then re-point every node on the path directly at it.
  rootOf(node: number): number {
    let root = node;
    while (this.parent[root] !== root) root = this.parent[root];
    let walk = node;
    while (walk !== root) {
      const next = this.parent[walk];
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  /** Root for a coordinate, registering it first if it is new — the old
   *  string-keyed `find` did the same implicit `add`, and several call sites
   *  lean on it (a wire endpoint often reaches the forest only by being
   *  unioned with its neighbour). */
  find(point: Point): number {
    return this.rootOf(this.intern(point));
  }

  // Union by size keeps trees shallow regardless of insertion order. The tie
  // break matters and is load bearing: on equal sizes `b`'s root is hung under
  // `a`'s root, so `a`'s root survives. Which node ends up as a net's root
  // decides that net's sort key, and therefore whether it is `N001` or `N002`
  // in the emitted deck, so this rule must not be "improved" into union by
  // rank or into the other tie direction.
  union(a: Point, b: Point) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const sizeA = this.size[rootA];
    const sizeB = this.size[rootB];
    if (sizeA < sizeB) {
      this.parent[rootA] = rootB;
      this.size[rootB] = sizeA + sizeB;
    } else {
      this.parent[rootB] = rootA;
      this.size[rootA] = sizeA + sizeB;
    }
  }

  /** Number of interned points; ids are `0 .. nodeCount - 1` in first-touch
   *  order, which is the traversal order callers must use to reproduce the
   *  old parent-map iteration. */
  get nodeCount(): number {
    return this.count;
  }

  /** The coordinate behind a node id, as a fresh plain `Point` — callers put
   *  these straight into `ExtractedNet.points`, so it must not be a pin or a
   *  label object carrying extra fields. */
  pointAt(node: number): Point {
    return { x: this.xs[node], y: this.ys[node] };
  }

  /** The `"<x>,<y>"` spelling of a node, for the one place that still needs an
   *  orderable key: the net sort. Built on demand for the surviving roots
   *  rather than kept for every node, which is the whole saving. */
  keyAt(node: number): string {
    return `${this.xs[node]},${this.ys[node]}`;
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
    dsu.add(pin);
    pushBucket(pinByComponent, pin.componentId, pin);
  }

  // Net labels are electrical: a labelled point joins whatever net sits under
  // it, and all labels sharing a name are the same net (LTspice's primary
  // cross-schematic connectivity). Register each label point as a DSU node;
  // points coincide with wire endpoints/pins, so unions merge the real nets.
  const labelPoints: Point[] = netLabels.map((label) => ({ x: label.x, y: label.y }));
  for (const point of labelPoints) dsu.add(point);

  for (const pins of pinsByPoint(allPins).values()) {
    for (let i = 1; i < pins.length; i += 1) {
      dsu.union(pins[0], pins[i]);
    }
  }

  // Ground anchors: ground-symbol pins plus any net label named "0"/"GND".
  const groundAnchors: Point[] = [
    ...allPins.filter((pin) => pin.kind === "ground"),
    ...netLabels.filter((label) => isGroundLabel(label.text)),
  ].map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < groundAnchors.length; i += 1) {
    dsu.union(groundAnchors[0], groundAnchors[i]);
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
      dsu.union(points[0], points[i]);
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
        if (wire.points.length >= 1) dsu.add(wire.points[0]);
        if (wire.points.length >= 2) dsu.add(wire.points[wire.points.length - 1]);
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
      dsu.union(segmentPoints[j - 1], segmentPoints[j]);
    }
  }

  // Nodes are visited in first-touch order, which is what the old parent-map
  // iteration gave us; each root's bucket therefore accumulates its points in
  // the same order as before, and that order is visible in `net.points`.
  const rootToPoints = new Map<number, Point[]>();
  const nodeCount = dsu.nodeCount;
  for (let node = 0; node < nodeCount; node += 1) {
    pushBucket(rootToPoints, dsu.rootOf(node), dsu.pointAt(node));
  }

  const rootToPins = new Map<number, ComponentPin[]>();
  for (const pin of allPins) {
    pushBucket(rootToPins, dsu.find(pin), pin);
  }

  // Held as a node id, so the emptiness test has to be an explicit null check:
  // id 0 is a perfectly ordinary root (the first point the extraction touched)
  // and would read as falsy.
  const groundRoot = groundAnchors.length > 0 ? dsu.find(groundAnchors[0]) : null;
  if (groundRoot === null) warnings.push("No ground symbol found.");

  // Nets are ordered by their root's coordinate spelling, so materialise that
  // spelling once per surviving root instead of inside the comparator.
  const rootKeys = new Map<number, string>();
  for (const root of rootToPoints.keys()) rootKeys.set(root, dsu.keyAt(root));

  const sortedRoots = [...rootToPoints.keys()].sort((a, b) => {
    if (a === groundRoot) return -1;
    if (b === groundRoot) return 1;
    // Root keys are plain "<x>,<y>" coordinate strings (digits/comma/hyphen
    // only, from DisjointSet.keyAt) - a plain lexicographic compare orders
    // them identically to localeCompare for that alphabet but without ICU
    // collation overhead, ~50-100x slower for this hot sort where ground
    // (the largest net) is always one of the compared roots.
    const keyA = rootKeys.get(a)!;
    const keyB = rootKeys.get(b)!;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Prefer a user/LTspice net-label name for a net's id (so V(vcc) resolves as
  // the author intended); fall back to a generated N00x id otherwise.
  const rootToLabelName = new Map<number, string>();
  for (const label of netLabels) {
    if (isGroundLabel(label.text)) continue;
    const name = sanitizeNetName(label.text);
    if (name === "") continue;
    const root = dsu.find(label);
    if (!rootToLabelName.has(root)) rootToLabelName.set(root, name);
  }
  const usedNames = new Set<string>();

  const rootToNetId = new Map<number, string>();
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

  const rootLabelCount = new Map<number, number>();
  for (const label of netLabels) {
    if (isGroundLabel(label.text)) continue;
    const root = dsu.find(label);
    rootLabelCount.set(root, (rootLabelCount.get(root) ?? 0) + 1);
  }

  const nets: ExtractedNet[] = sortedRoots.map((root) => ({
    // Every sorted root was assigned a net id just above; the coordinate
    // spelling is only a defensive fallback, and it is the same string the
    // pre-interning code fell back to.
    id: rootToNetId.get(root) ?? rootKeys.get(root)!,
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
      pins[pin.id] = rootToNetId.get(dsu.find(pin)) ?? "";
    }
    return { component, pins };
  });

  return {
    nets,
    components: extractedComponents,
    groundNetId: groundRoot !== null ? rootToNetId.get(groundRoot) ?? null : null,
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

/** Coordinate identity as a map key, for the geometry indexes that are not the
 *  union-find. The DSU interns coordinates numerically instead (see
 *  `DisjointSet`); these callers stay on strings because their maps are built
 *  and thrown away once per extraction rather than probed per union. */
function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}
