/**
 * KiCad netlist IMPORTER - the S-expression `.net` export (Eeschem/Schematic
 * Editor: "Tools > Generate Netlist File", KiCad netlist format), NOT the
 * `.kicad_sch` schematic itself and NOT a flat SPICE netlist (see
 * `cirImport.ts` for that; KiCad's own Spice export is plain SPICE text and
 * already goes through the generic importer).
 *
 * Scope, deliberately narrow: KiCad's netlist carries no SPICE model
 * information, only a reference designator, a library part name, a value
 * string, and per-pin net membership. That is enough to safely reconstruct
 * resistors, capacitors, and inductors - two-terminal, symmetric parts where
 * pin order never matters electrically - by name (`lib "Device"`, `part`
 * "R"/"C"/"L"/their "_Small" variants). Anything else (transistors, ICs,
 * diodes, connectors, power symbols) cannot be placed with confidence: a
 * diode's pin order encodes polarity, an IC's encodes a pinout Tau has no
 * model for, and guessing either would reproduce exactly the "confidently
 * wrong answer" failure this importer exists to avoid. Those parts are
 * skipped and reported by name in `warnings`, never silently substituted.
 */
import { getLocalPins } from "../schematic/pins";
import type { ComponentKind, NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";

export interface KicadNetImportResult {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives: string[];
  warnings: string[];
}

/** A parsed S-expression node: an atom (string) or a list whose first element
 *  is conventionally its tag, e.g. `(ref "R1")` -> `["ref", "R1"]`. */
type SExpr = string | SExpr[];

// Defense in depth: `importAscFile`'s caller already caps file size before this
// ever runs, but a pathological (or hand-crafted) file with a huge number of
// short tokens could still build a very large tree cheaply. Cap it directly.
const MAX_TOKENS = 2_000_000;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    // Checked here, not per-branch: the cap used to sit only on the bare-atom
    // path, so a file of nothing but "(" pushed unbounded tokens and never
    // tripped it. 5 MB of parens tokenized in 91ms with no error.
    if (tokens.length > MAX_TOKENS) {
      throw new Error("KiCad netlist exceeds Tau's import size budget.");
    }
    const ch = text[i];
    if (ch === "(" || ch === ")") {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = '"';
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < n) {
          out += text[j] + text[j + 1];
          j += 2;
          continue;
        }
        out += text[j];
        j += 1;
      }
      out += '"';
      tokens.push(out);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s()]/.test(text[j])) j += 1;
    tokens.push(text.slice(i, j));
    i = j;
  }
  return tokens;
}

/**
 * Remove control characters from any text lifted out of a KiCad file.
 *
 * `.asc` records are single-line (`SYMATTR Value <v>`, `FLAG <x> <y> <net>`),
 * so a literal newline inside a quoted KiCad string turns into an extra line
 * that the importer then reads back as a real record. A crafted
 * `(value "10k\nTEXT 400 400 Left 2 !.tran 1 100")` forges a SPICE directive
 * into a schematic the user believes contains only passives. The engine's own
 * deck screening still blocks file and shell primitives, so this is an
 * integrity problem rather than a code-execution one, but a netlist that
 * quietly gains directives is exactly the silent-wrongness this project
 * refuses elsewhere.
 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

function unquote(token: string): string {
  if (token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"') {
    return stripControlChars(token.slice(1, -1).replace(/\\(.)/g, "$1"));
  }
  return stripControlChars(token);
}

/** Iterative (non-recursive) parse so a deeply nested or malformed file cannot
 *  blow the call stack; a stray/missing paren is reported as a clear error. */
function parseSExpr(text: string): SExpr {
  const tokens = tokenize(text);
  const stack: SExpr[][] = [[]];
  for (const token of tokens) {
    if (token === "(") {
      const list: SExpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
    } else if (token === ")") {
      if (stack.length <= 1) throw new Error("Malformed KiCad netlist: unmatched \")\".");
      stack.pop();
    } else {
      stack[stack.length - 1].push(unquote(token));
    }
  }
  if (stack.length !== 1) throw new Error("Malformed KiCad netlist: unmatched \"(\".");
  const root = stack[0];
  if (root.length !== 1) throw new Error("Malformed KiCad netlist: expected one top-level expression.");
  return root[0];
}

const isList = (node: SExpr): node is SExpr[] => Array.isArray(node);
const tagOf = (node: SExpr): string | null => (isList(node) && typeof node[0] === "string" ? node[0] : null);
const childrenOf = (node: SExpr): SExpr[] => (isList(node) ? node.slice(1) : []);
const findChild = (node: SExpr, name: string): SExpr | undefined => childrenOf(node).find((c) => tagOf(c) === name);
const findAllChildren = (node: SExpr, name: string): SExpr[] => childrenOf(node).filter((c) => tagOf(c) === name);
function textOf(node: SExpr, name: string): string {
  const child = findChild(node, name);
  if (!child) return "";
  const value = childrenOf(child)[0];
  return typeof value === "string" ? stripControlChars(value) : "";
}

/** `lib "Device"` parts whose two terminals are electrically symmetric, so
 *  KiCad's pin 1/2 numbering can be mapped onto Tau's "a"/"b" pins without
 *  knowing which physical side is which. Deliberately excludes polarized
 *  variants that still simulate fine as a plain part (`C_Polarized`) as well
 *  as anything with a third terminal (`R_Pot`). */
const SAFE_DEVICE_PARTS: Record<string, ComponentKind> = {
  r: "resistor",
  r_small: "resistor",
  c: "capacitor",
  c_small: "capacitor",
  c_polarized: "capacitor",
  c_polarized_small: "capacitor",
  l: "inductor",
  l_small: "inductor",
};

function inferSafeKind(libPart: string, ref: string): ComponentKind | null {
  const byPart = SAFE_DEVICE_PARTS[libPart.toLowerCase()];
  if (byPart) return byPart;
  if (libPart) return null; // a known-but-unsafe part name is a definite skip, not a guess
  // No `libsource` at all (a hand-built or trimmed netlist): fall back to the
  // reference designator prefix, but only for the exact single-letter SPICE
  // convention so "RV1" (a potentiometer) and "RN1" (a resistor network)
  // don't get misread as a plain two-terminal resistor.
  const prefixMatch = /^([A-Za-z]+)\d/.exec(ref);
  const prefix = prefixMatch?.[1]?.toUpperCase();
  if (prefix === "R") return "resistor";
  if (prefix === "C") return "capacitor";
  if (prefix === "L") return "inductor";
  return null;
}

const GROUND_NAMES = new Set(["gnd", "ground", "0"]);

/**
 * Parse a KiCad S-expression netlist export (`(export (version D) ...)`).
 * Reconstructs resistors, capacitors, and inductors with real connectivity;
 * every other component is named in `warnings` and left out of the circuit
 * rather than approximated.
 */
export function parseKicadNet(text: string): KicadNetImportResult {
  const root = parseSExpr(text);
  if (tagOf(root) !== "export") {
    throw new Error("Not a KiCad netlist export (missing the top-level \"export\" record).");
  }
  const netsNode = findChild(root, "nets");
  if (!netsNode) throw new Error("This KiCad netlist has no \"nets\" section to reconstruct connectivity from.");
  const componentsNode = findChild(root, "components");

  const meta = new Map<string, { value: string; libPart: string }>();
  if (componentsNode) {
    for (const comp of findAllChildren(componentsNode, "comp")) {
      const ref = textOf(comp, "ref");
      if (!ref) continue;
      const value = textOf(comp, "value");
      const libsource = findChild(comp, "libsource");
      const libPart = libsource ? textOf(libsource, "part") : "";
      meta.set(ref, { value, libPart });
    }
  }

  const components: SchematicComponent[] = [];
  const netLabels: NetLabel[] = [];
  const warnings: string[] = [];
  const placed = new Map<string, SchematicComponent>();
  const warnedRefs = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

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

  const ensurePlaced = (ref: string): SchematicComponent | null => {
    const existing = placed.get(ref);
    if (existing) return existing;
    // "#PWR01" / "#FLG01" are KiCad's power-symbol and no-connect pseudo
    // components, not real parts - their only job is naming the net they sit
    // on, which the net's own `name` record already captures.
    if (ref.startsWith("#")) return null;
    const info = meta.get(ref);
    const kind = inferSafeKind(info?.libPart ?? "", ref);
    if (!kind) {
      if (!warnedRefs.has(ref)) {
        warnedRefs.add(ref);
        const identity = info?.value ? `"${info.value}"` : info?.libPart ? `"${info.libPart}"` : "unrecognized part";
        warnings.push(
          `${ref}: KiCad part ${identity} was not imported. Tau only reconstructs resistors, `
          + "capacitors, and inductors from a KiCad netlist; add this part in Tau directly, or "
          + "bring in a SPICE netlist that includes its model.",
        );
      }
      return null;
    }
    const slot = nextSlot();
    const component: SchematicComponent = {
      id: nextId("c"),
      kind,
      x: slot.x,
      y: slot.y,
      rotation: 0,
      value: info?.value ?? "",
      label: ref,
    };
    components.push(component);
    placed.set(ref, component);
    return component;
  };

  for (const net of findAllChildren(netsNode, "net")) {
    const code = textOf(net, "code");
    const rawName = textOf(net, "name").replace(/^\//, "");
    const netName = rawName === ""
      ? `Net-${code || String(counter)}`
      : (GROUND_NAMES.has(rawName.toLowerCase()) ? "0" : rawName);
    for (const node of findAllChildren(net, "node")) {
      const ref = textOf(node, "ref");
      const pinNum = textOf(node, "pin");
      if (!ref || !pinNum) continue;
      const component = ensurePlaced(ref);
      if (!component) continue;
      // Every kind this importer places is two-terminal, so KiCad pin 1/2
      // maps directly onto Tau's "a"/"b" local pins.
      const localId = pinNum === "1" ? "a" : pinNum === "2" ? "b" : null;
      if (!localId) continue;
      const pin = getLocalPins(component.kind).find((p) => p.id === localId);
      if (!pin) continue;
      netLabels.push({
        id: nextId("n"),
        x: component.x + pin.x,
        y: component.y + pin.y,
        text: netName,
      });
    }
  }

  if (components.length === 0 && warnings.length > 0) {
    warnings.unshift(
      "No parts from this KiCad netlist could be reconstructed; only the warnings below were imported.",
    );
  }

  return { components, wires: [], netLabels, directives: [], warnings };
}
