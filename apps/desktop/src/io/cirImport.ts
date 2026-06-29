/**
 * SPICE `.cir` / `.net` netlist IMPORTER (FEATURE_PARITY §1 "import `.cir`").
 *
 * A SPICE deck references nets by NAME, not geometry, so there is nothing to
 * place visually. We lay each device out on a simple grid and make every
 * connection electrical via a {@link NetLabel} pinned to the device's pin
 * position — net labels with the same name merge (and `0`/`GND` become ground),
 * so the extracted netlist matches the deck without routing a single wire.
 *
 * Scope: the common two/three/four-terminal primitives (R/C/L, V/I, D, Q, M,
 * E/G VC sources, B behavioral). Subcircuit calls (`X`), couplings (`K`),
 * current-controlled sources (`F`/`H`, which name a sense source rather than two
 * control nodes), and transmission lines are reported as warnings and skipped —
 * their directives/models still survive so a later pass can use them.
 */
import type {
  ComponentKind,
  NetLabel,
  SchematicComponent,
  SchematicWire,
} from "../schematic/types";
import { getLocalPins } from "../schematic/pins";

export interface CirImportResult {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives: string[];
  comments: string[];
  warnings: string[];
}

/** SPICE node-order → Tau pin-id map per kind. Index i of the array is the i-th
 *  SPICE terminal; its value is the Tau pin id it drives. */
const PIN_ORDER: Partial<Record<ComponentKind, string[]>> = {
  resistor: ["a", "b"],
  capacitor: ["a", "b"],
  inductor: ["a", "b"],
  switch: ["a", "b"],
  vsource: ["p", "n"],
  isource: ["p", "n"],
  bsource: ["p", "n"],
  diode: ["a", "k"],
  led: ["a", "k"],
  zener: ["a", "k"],
  npn: ["c", "b", "e"],
  pnp: ["c", "b", "e"],
  nmos: ["d", "g", "s", "b"],
  pmos: ["d", "g", "s", "b"],
  // SPICE E/G: `Ename N+ N- NC+ NC- gain` → out pair then control pair.
  vcvs: ["op", "on", "cp", "cn"],
  vccs: ["op", "on", "cp", "cn"],
};

/** Min/max leading node tokens per device prefix. Where min<max (Q, M) the
 *  boundary is resolved by the model name (a token present in the .model map). */
const NODE_RANGE: Record<string, { min: number; max: number }> = {
  R: { min: 2, max: 2 },
  C: { min: 2, max: 2 },
  L: { min: 2, max: 2 },
  V: { min: 2, max: 2 },
  I: { min: 2, max: 2 },
  D: { min: 2, max: 2 },
  B: { min: 2, max: 2 },
  S: { min: 2, max: 2 },
  W: { min: 2, max: 2 },
  Q: { min: 3, max: 4 }, // C B E [substrate] model
  M: { min: 3, max: 4 }, // D G S [B] model
  E: { min: 4, max: 4 },
  G: { min: 4, max: 4 },
};

/**
 * Split a device's argument tokens into nodes and the trailing rest. For
 * variable-arity devices (Q/M) the model name marks the node/rest boundary:
 * starting at `min`, the first token that is a declared model ends the node
 * list; absent a known model we keep `min` nodes (the common case).
 */
function splitNodes(
  args: string[],
  range: { min: number; max: number },
  types: Map<string, string>,
): { nodes: string[]; rest: string[] } {
  if (range.min === range.max) {
    return { nodes: args.slice(0, range.min), rest: args.slice(range.min) };
  }
  for (let i = range.min; i <= Math.min(range.max, args.length); i += 1) {
    if (types.has((args[i] ?? "").toLowerCase())) {
      return { nodes: args.slice(0, i), rest: args.slice(i) };
    }
  }
  return { nodes: args.slice(0, range.min), rest: args.slice(range.min) };
}

const PREFIX_KIND: Record<string, ComponentKind> = {
  R: "resistor",
  C: "capacitor",
  L: "inductor",
  V: "vsource",
  I: "isource",
  D: "diode",
  Q: "npn",
  M: "nmos",
  E: "vcvs",
  G: "vccs",
  B: "bsource",
  S: "switch",
  W: "switch",
};

/** Strip an inline SPICE comment (`;` or ` $`) and trailing whitespace. */
const stripInlineComment = (line: string): string => {
  let out = line;
  const semi = out.indexOf(";");
  if (semi >= 0) out = out.slice(0, semi);
  const dollar = out.search(/\s\$/);
  if (dollar >= 0) out = out.slice(0, dollar);
  return out.trimEnd();
};

/**
 * Join SPICE continuation lines (a leading `+` folds onto the previous line) and
 * drop blank/`*`-comment lines. The first physical non-blank line is the deck's
 * title (SPICE convention) and is returned as a comment, never parsed as a
 * device. Returns logical lines plus any comment text.
 */
function foldLines(text: string): { logical: string[]; comments: string[] } {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const logical: string[] = [];
  const comments: string[] = [];
  let titleSeen = false;
  for (const original of raw) {
    const line = original.trimEnd();
    if (line.trim() === "") continue;
    if (!titleSeen) {
      // First physical line is always the title card.
      titleSeen = true;
      comments.push(line.trimStart().replace(/^\*+\s?/, ""));
      continue;
    }
    if (line.trimStart().startsWith("*")) {
      comments.push(line.trimStart().replace(/^\*+\s?/, ""));
      continue;
    }
    const stripped = stripInlineComment(line);
    if (stripped.trim() === "") continue;
    if (stripped.trimStart().startsWith("+") && logical.length > 0) {
      logical[logical.length - 1] += " " + stripped.trimStart().slice(1).trim();
    } else {
      logical.push(stripped.trim());
    }
  }
  return { logical, comments };
}

/** Scan `.model name TYPE(...)` lines so Q/M get the right polarity kind. */
function modelTypes(logical: string[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const line of logical) {
    const m = /^\.model\s+(\S+)\s+([a-zA-Z]+)/i.exec(line);
    if (m) types.set(m[1].toLowerCase(), m[2].toUpperCase());
  }
  return types;
}

/** Refine a device kind from its model's type keyword (PNP, PMOS, …). */
function refineKind(kind: ComponentKind, modelName: string | undefined, types: Map<string, string>): ComponentKind {
  if (!modelName) return kind;
  const t = types.get(modelName.toLowerCase());
  if (!t) return kind;
  if (kind === "npn" && t.startsWith("PNP")) return "pnp";
  if (kind === "nmos" && t.startsWith("PMOS")) return "pmos";
  if (kind === "diode" && t === "D") return "diode";
  return kind;
}

const GROUND_TOKENS = new Set(["0", "gnd"]);

/**
 * Parse SPICE netlist text into Tau schematic content. Each device lands on a
 * grid; its connections become net labels at the device's pin positions.
 */
export function parseCir(text: string): CirImportResult {
  const { logical, comments } = foldLines(text);
  const types = modelTypes(logical);

  const components: SchematicComponent[] = [];
  const netLabels: NetLabel[] = [];
  const directives: string[] = [];
  const warnings: string[] = [];
  let counter = 0;
  const id = (p: string) => `${p}-${(counter += 1)}`;

  let col = 0;
  let row = 0;
  const COLS = 6;
  const DX = 192;
  const DY = 160;
  const nextSlot = (): { x: number; y: number } => {
    const x = 96 + col * DX;
    const y = 96 + row * DY;
    col += 1;
    if (col >= COLS) { col = 0; row += 1; }
    return { x, y };
  };

  for (const line of logical) {
    if (line.startsWith(".")) {
      if (/^\.end\b/i.test(line)) continue;
      directives.push(line);
      continue;
    }

    const tokens = line.split(/\s+/);
    const name = tokens[0];
    const prefix = name[0].toUpperCase();
    const baseKind = PREFIX_KIND[prefix];
    if (!baseKind) {
      if (prefix === "X") warnings.push(`${name}: subcircuit instance not imported (needs .subckt expansion).`);
      else if (prefix === "K") warnings.push(`${name}: coupling K not imported.`);
      else if (prefix === "F" || prefix === "H") warnings.push(`${name}: current-controlled source not imported.`);
      else if (prefix === "T" || prefix === "O" || prefix === "U") warnings.push(`${name}: transmission line not imported.`);
      else warnings.push(`${name}: unrecognized device prefix "${prefix}".`);
      continue;
    }

    const range = NODE_RANGE[prefix] ?? { min: 2, max: 2 };
    const { nodes, rest } = splitNodes(tokens.slice(1), range, types);
    if (nodes.length < range.min) {
      warnings.push(`${name}: expected ${range.min} nodes, found ${nodes.length}; skipped.`);
      continue;
    }
    // For semiconductors the next token is the model name; refine the kind.
    const modelName = (prefix === "Q" || prefix === "M" || prefix === "D") ? rest[0] : undefined;
    const kind = refineKind(baseKind, modelName, types);

    const value = rest.join(" ").trim();
    const slot = nextSlot();
    const component: SchematicComponent = {
      id: id("c"),
      kind,
      x: slot.x,
      y: slot.y,
      rotation: 0,
      value,
      label: name,
    };
    components.push(component);

    // Attach a net label at each pin position so connectivity is electrical.
    const pinOrder = PIN_ORDER[kind] ?? [];
    const pins = getLocalPins(kind);
    for (let p = 0; p < nodes.length && p < pinOrder.length; p += 1) {
      const pin = pins.find((lp) => lp.id === pinOrder[p]);
      if (!pin) continue;
      const net = nodes[p];
      netLabels.push({
        id: id("n"),
        x: slot.x + pin.x,
        y: slot.y + pin.y,
        text: GROUND_TOKENS.has(net.toLowerCase()) ? "0" : net,
      });
    }
    // 3-terminal MOS (no bulk node): tie bulk to source so the 4th pin resolves.
    if ((kind === "nmos" || kind === "pmos") && nodes.length === 3) {
      const bulk = pins.find((lp) => lp.id === "b");
      const sourceNet = nodes[2];
      if (bulk) {
        netLabels.push({
          id: id("n"),
          x: slot.x + bulk.x,
          y: slot.y + bulk.y,
          text: GROUND_TOKENS.has(sourceNet.toLowerCase()) ? "0" : sourceNet,
        });
      }
    }
  }

  return { components, wires: [], netLabels, directives, comments, warnings };
}
