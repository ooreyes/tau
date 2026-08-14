import {
  buildSpiceDeck,
  type BuildSpiceDeckOptions,
  type SpiceAnalysis,
  type SpiceDeck,
} from "../engine/spiceNetlist";
import { definedSubcktNames } from "../engine/modelDirectives";
import { bundledSubcircuitBlock, sanitizeSubcktName } from "../engine/bundledSubcircuits";
// Reused rather than re-derived: a waveform or a junction must not mean one
// thing on a parent sheet and another on a child.
import { parseSourceFunction, type SourceSpec } from "../engine/sourceFunction";
import { idealJunctionModel, IDEAL_SENSE_PREFIX } from "../engine/idealModels";
import { parseUserModelLibraries } from "../engine/userModelLibrary";
import { parseQuantity } from "../simulation/quantity";
import { extractCircuit, isResistiveWire, netAtPoint, type ExtractedCircuit } from "./netlist";
import { getComponentPins } from "./pins";
import {
  canonicalProjectSheetPath,
  asciiFold,
  hasMatchingOrderedProjectPorts,
  projectSheetPortsValidation,
  projectSubcircuitLinkValidation,
} from "./projectSubcircuit";
import type {
  ComponentKind,
  ProjectSheetPort,
  ProjectSubcircuitLink,
  SchematicComponent,
  SchematicForeignSymbol,
} from "./types";
import type { SchematicDocument } from "../store/useSchematic";
import type { ParamScope } from "../simulation/paramScope";

/** Every refusal is structured so the shell can turn it into one diagnostic. */
export type ProjectHierarchyErrorCode =
  | "invalid-path"
  | "duplicate-sheet"
  | "missing-sheet"
  | "cycle"
  | "duplicate-port"
  | "duplicate-model"
  | "duplicate-definition"
  | "invalid-contract"
  | "unsupported-child";

export class ProjectHierarchyError extends Error {
  constructor(
    readonly code: ProjectHierarchyErrorCode,
    message: string,
    readonly sheetPath?: string,
    readonly componentFocus?: { componentId: string; reference: string },
  ) {
    super(message);
    this.name = "ProjectHierarchyError";
  }
}

/** A saved child sheet available to the open project resolver. */
export interface ProjectHierarchySheet {
  /** Canonical project-relative path, never an absolute filesystem path. */
  path: string;
  document: SchematicDocument;
}

/** Input is deliberately data-only: the App/Project layer owns file reads. */
export interface ProjectHierarchyBuildInput {
  rootPath: string;
  root: SchematicDocument;
  sheets: readonly ProjectHierarchySheet[];
  analysis: SpiceAnalysis;
  /**
   * The App's ordinary root-deck context. Keeping this separate from child
   * sheets is intentional: root directives/functions/options and installed
   * model attachments continue to behave exactly as they do without a project
   * link, while child sheets remain a small, explicit safe subset.
   */
  rootDeck?: {
    params?: ParamScope;
    directives?: readonly string[];
    userModelLibraries?: readonly string[];
    userModelLibraryNames?: readonly string[];
    ascForeignSymbols?: readonly SchematicForeignSymbol[];
  };
  /** Native step/Laplace packaging knobs from the normal root deck path. */
  deckOptions?: BuildSpiceDeckOptions;
}

export interface ProjectHierarchyBlock {
  model: string;
  sheetPath: string;
  text: string;
}

/** A normal SpiceDeck plus generated blocks for diagnostics/tests. */
export interface ProjectHierarchyBuildResult {
  deck: SpiceDeck;
  /** Dependency-first, deterministic `.subckt` definitions. */
  blocks: readonly ProjectHierarchyBlock[];
}

interface ResolvedSheet {
  path: string;
  key: string;
  document: SchematicDocument;
}

interface ResolvedPort {
  port: ProjectSheetPort;
  netId: string;
}

interface SheetInterface {
  circuit: ExtractedCircuit;
  ports: readonly ResolvedPort[];
}

const keyFor = (value: string): string => asciiFold(value);

function compareStable(left: string, right: string): number {
  const a = keyFor(left);
  const b = keyFor(right);
  return a === b ? (left === right ? 0 : left < right ? -1 : 1) : a < b ? -1 : 1;
}

/** Use the same restricted project-relative path grammar as persistent links. */
function canonicalPathOrThrow(path: string, role: string): string {
  const normalized = canonicalProjectSheetPath(path);
  if (!normalized) {
    throw new ProjectHierarchyError("invalid-path", `${role} must be a canonical project-relative path.`);
  }
  if (normalized !== path) {
    throw new ProjectHierarchyError("invalid-path", `${role} must use its canonical project-relative path spelling.`);
  }
  return normalized;
}

function displayInstance(component: SchematicComponent): string {
  return component.label.trim() || component.id;
}

function exactLinkForComponent(component: SchematicComponent, ownerPath: string): ProjectSubcircuitLink {
  const componentFocus = { componentId: component.id, reference: displayInstance(component) };
  const link = component.projectSubcircuit;
  if (!link || component.kind !== "subckt") {
    throw new ProjectHierarchyError("invalid-contract", `${displayInstance(component)} is not a Tau project-linked subcircuit.`, ownerPath, componentFocus);
  }
  const validation = projectSubcircuitLinkValidation(link);
  if (!validation.ok) {
    throw new ProjectHierarchyError("invalid-contract", `${displayInstance(component)} has an invalid project link: ${validation.error}`, ownerPath, componentFocus);
  }
  if (component.value !== link.model) {
    throw new ProjectHierarchyError(
      "invalid-contract",
      `${displayInstance(component)} must use project model "${link.model}" as its exact value.`,
      ownerPath,
      componentFocus,
    );
  }
  if (component.ltSymbolType || component.ltModelName || component.ltModelFile || component.ltWindows || component.ltExtraAttrs) {
    throw new ProjectHierarchyError(
      "invalid-contract",
      `${displayInstance(component)} cannot combine a Tau project link with imported file-backed symbol metadata.`,
      ownerPath,
      componentFocus,
    );
  }
  const pins = getComponentPins(component)
    .filter((pin) => /^p\d+$/.test(pin.id))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  if (pins.length !== link.ports.length || pins.some((pin, index) =>
    pin.id !== `p${index + 1}` || pin.label !== link.ports[index])) {
    throw new ProjectHierarchyError(
      "invalid-contract",
      `${displayInstance(component)} needs an exact ordered p1…pN bank for ${link.model}.`,
      ownerPath,
      componentFocus,
    );
  }
  return link;
}

/**
 * The ports a sheet declares on its net labels, which is the only way a `.asc`
 * file can state an interface: LTspice writes a hierarchy port as a `FLAG` plus
 * an adjacent `IOPIN <dir>`, and Tau's importer carries that direction on the
 * label itself.
 *
 * `preferredOrder` is the parent link's ordered port names, and derived ports
 * come back in THAT order. This is the whole reason the derivation is safe. An
 * `.asc` cannot record port order - flag order is an artifact of how the file
 * was edited, not a statement of intent - so order stays where it is already
 * pinned: the parent's `p1…pN` bank. Ordering to match also keeps the existing
 * order-sensitive check honest rather than defeating it: any port the parent did
 * not name is appended, so a set mismatch still leaves a slot unmatched and
 * `hasMatchingOrderedProjectPorts` reports it in its own words.
 */
function labelDeclaredPorts(
  sheet: ResolvedSheet,
  preferredOrder: readonly string[] | undefined,
): ProjectSheetPort[] {
  const declared: ProjectSheetPort[] = (sheet.document.netLabels ?? [])
    .filter((label) => label.port !== undefined)
    .map((label) => ({ name: label.text, labelId: label.id, direction: label.port! }));
  if (declared.length === 0 || preferredOrder === undefined) return declared;
  const remaining = new Map(declared.map((port) => [keyFor(port.name), port]));
  const ordered: ProjectSheetPort[] = [];
  for (const name of preferredOrder) {
    const hit = remaining.get(keyFor(name));
    if (hit) {
      ordered.push(hit);
      remaining.delete(keyFor(name));
    }
  }
  return [...ordered, ...remaining.values()];
}

/**
 * Resolve a linked sheet's public interface to real electrical nets.
 *
 * A Tau `.sim`/`.tau.json` sheet states its interface explicitly in
 * `projectPorts` and that stays authoritative and unchanged. A `.asc` sheet has
 * nowhere to store that array, so its interface is derived from the port
 * markers it does carry - see {@link labelDeclaredPorts}. Explicit always wins:
 * derivation is a fallback for a format that cannot hold the explicit form, not
 * a second source of truth competing with it.
 */
function sheetInterface(sheet: ResolvedSheet, preferredOrder?: readonly string[]): SheetInterface {
  const explicit = sheet.document.projectPorts ?? [];
  const ports = explicit.length > 0 ? explicit : labelDeclaredPorts(sheet, preferredOrder);
  const portValidation = projectSheetPortsValidation(ports);
  if (!portValidation.ok || ports.length === 0) {
    const detail = portValidation.ok
      ? "at least one port is required - mark a net label as an In/Out/BiDir port"
      : portValidation.error;
    throw new ProjectHierarchyError("invalid-contract", `Linked sheet "${sheet.path}" has an invalid port contract: ${detail}.`, sheet.path);
  }
  const circuit = extractCircuit(sheet.document.components, sheet.document.wires, sheet.document.netLabels ?? []);
  const labels = new Map((sheet.document.netLabels ?? []).map((label) => [label.id, label]));
  const usedNets = new Set<string>();
  const resolved: ResolvedPort[] = [];
  for (const port of ports) {
    const label = labels.get(port.labelId);
    if (!label) {
      throw new ProjectHierarchyError("invalid-contract", `Port "${port.name}" on "${sheet.path}" references a missing label.`, sheet.path);
    }
    if (label.text !== port.name || label.port !== port.direction) {
      throw new ProjectHierarchyError(
        "invalid-contract",
        `Port "${port.name}" on "${sheet.path}" must exactly match its labelled ${port.direction} marker.`,
        sheet.path,
      );
    }
    const net = netAtPoint(circuit.nets, sheet.document.wires, label);
    if (!net || net.pins.length === 0) {
      throw new ProjectHierarchyError("invalid-contract", `Port "${port.name}" on "${sheet.path}" does not connect to a component net.`, sheet.path);
    }
    if (usedNets.has(net.id)) {
      throw new ProjectHierarchyError("duplicate-port", `Ports on "${sheet.path}" cannot share one electrical net ("${port.name}").`, sheet.path);
    }
    usedNets.add(net.id);
    resolved.push({ port, netId: net.id });
  }
  return { circuit, ports: resolved };
}

function literalPassiveValue(component: SchematicComponent, unit: string, positive: boolean, sheetPath: string): string {
  let numeric: number;
  try {
    numeric = parseQuantity(component.value, unit);
  } catch {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `${displayInstance(component)} on "${sheetPath}" needs a literal ${unit} value; expressions and extra parameters are not supported in project-sheet blocks.`,
      sheetPath,
    );
  }
  if (!Number.isFinite(numeric) || (positive ? numeric <= 0 : numeric < 0)) {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `${displayInstance(component)} on "${sheetPath}" needs a ${positive ? "positive" : "non-negative"} ${unit} value.`,
      sheetPath,
    );
  }
  return numeric.toString();
}

function pinNet(
  pins: Record<string, string>,
  pin: string,
  component: SchematicComponent,
  sheetPath: string,
): string {
  const net = pins[pin];
  if (!net) {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `${displayInstance(component)} on "${sheetPath}" is missing terminal ${pin}.`,
      sheetPath,
    );
  }
  return net;
}

/** What one device rule is handed to emit its lines. */
interface ChildEmitContext {
  component: SchematicComponent;
  sheetPath: string;
  childLinks: ReadonlyMap<string, ProjectSubcircuitLink>;
  /** This instance's deck reference for a given SPICE prefix letter. */
  ref: (prefix: string) => string;
  /** The node one of this component's terminals sits on. */
  at: (pin: string) => string;
  /** Refuse this component, appending `reason` to a sentence naming it. */
  refuse: (reason: string) => never;
  /** Declare a `.model` card the block body must carry. */
  addModelCard: (name: string, card: string) => void;
}

/**
 * A child-sheet device is either emitted, or refused with its own reason.
 * One entry per kind means there is exactly ONE place to look and ONE place to
 * change; a rule that emitted from one table while a separate switch decided
 * admission is how the two fall out of step.
 */
type ChildDeviceRule =
  | { readonly emit: (ctx: ChildEmitContext) => string[] }
  | { readonly refuse: string };

const notYet = (what: string): ChildDeviceRule => ({
  refuse: `is not yet supported inside a linked sheet. ${what}`,
});

/** Kinds that expand to several ngspice devices, or need a support net. */
const COMPOSITE = notYet(
  "It expands to several ngspice devices, which a linked sheet's block body does not generate yet.",
);
/** Kinds whose behaviour is carried by a model library a child cannot hold. */
const NEEDS_LIBRARY = notYet(
  "Its behaviour comes from a model library, and a linked sheet carries no attached models.",
);
/** Digital/mixed-signal parts that need XSPICE bridges and a shared clock domain. */
const MIXED_SIGNAL = notYet(
  "It needs XSPICE bridge devices, which a linked sheet's block body does not generate yet.",
);

/**
 * Every component kind, and what a linked child sheet does with it.
 *
 * This is deliberately an EXHAUSTIVE `Record<ComponentKind, …>` rather than a
 * `switch` with a `default`, and the shape is the point. The defect this feature
 * shipped with was not that its whitelist was too small - it was that the
 * whitelist could fall out of step with the palette in silence, so a part a user
 * could place and wire refused only at Run, with a message that named no way
 * forward. Adding a kind to `ComponentKind` now fails `tsc` here until somebody
 * records admit-or-refuse and says why. A missing decision is a build error, not
 * a support ticket.
 *
 * Refusals are specific on purpose. "not yet supported" alone tells a user
 * nothing about whether to wait, redraw, or restructure.
 */
const CHILD_DEVICE_RULES: Record<ComponentKind, ChildDeviceRule> = {
  // ── Emitted ────────────────────────────────────────────────────────────────
  ground: { emit: () => [] },
  resistor: {
    emit: (ctx) => [`${ctx.ref("R")} ${ctx.at("a")} ${ctx.at("b")} ${literalPassiveValue(ctx.component, "Ω", false, ctx.sheetPath)}`],
  },
  capacitor: {
    emit: (ctx) => [`${ctx.ref("C")} ${ctx.at("a")} ${ctx.at("b")} ${literalPassiveValue(ctx.component, "F", true, ctx.sheetPath)}`],
  },
  polarizedCapacitor: {
    emit: (ctx) => [`${ctx.ref("C")} ${ctx.at("a")} ${ctx.at("b")} ${literalPassiveValue(ctx.component, "F", true, ctx.sheetPath)}`],
  },
  inductor: {
    emit: (ctx) => [`${ctx.ref("L")} ${ctx.at("a")} ${ctx.at("b")} ${literalPassiveValue(ctx.component, "H", true, ctx.sheetPath)}`],
  },
  diode: {
    emit: (ctx) => {
      // A part with LTspice provenance keeps its real junction; a part placed in
      // Tau gets the textbook ideal one. That decision is `idealJunctionModel`'s
      // and is deliberately NOT re-made here - a diode must not drop a different
      // voltage merely because it was moved onto a linked sheet.
      const ideal = idealJunctionModel(ctx.component);
      if (ideal) {
        ctx.addModelCard(ideal.model, ideal.card);
        // The ideal junction is an XSPICE device with no current of its own, so
        // it carries the same zero-volt sense source in series that the root
        // deck gives it. The name must keep `IDEAL_SENSE_PREFIX` for the later
        // rewrite to recognise it.
        const midpoint = `${ctx.ref("n")}_id`;
        return [
          `${ctx.ref("D")} ${ctx.at("a")} ${midpoint} ${ideal.model}`,
          `${IDEAL_SENSE_PREFIX}${ctx.ref("D")} ${midpoint} ${ctx.at("k")} 0`,
        ];
      }
      // Not the ideal path, so either the part carries LTspice provenance and
      // keeps its real junction, or its value spells explicit Shockley
      // parameters. The root deck turns the latter into a per-instance `.model`;
      // a block body does not emit those yet, and quietly dropping numbers the
      // author typed would change the diode. Refuse instead.
      const value = ctx.component.value.trim();
      const params = value.split(/[\s,;]+/).filter((token) => token.includes("="));
      if (params.length > 0) {
        ctx.refuse(
          `carries explicit junction parameters (${params.join(" ")}), which a linked sheet cannot emit as a per-instance model yet.`,
        );
      }
      const named = value.split(/\s+/)[0] ?? "";
      if (named && !/^(?:d|tau_diode)$/i.test(named)) {
        ctx.refuse(
          `names diode model "${named}", which a linked sheet cannot resolve: a child carries no attached model library. Use Tau's generic diode.`,
        );
      }
      ctx.addModelCard("TAU_DIODE", ".model TAU_DIODE D(Is=1e-14 N=1)");
      return [`${ctx.ref("D")} ${ctx.at("a")} ${ctx.at("k")} TAU_DIODE`];
    },
  },
  switch: {
    emit: (ctx) => {
      const value = ctx.component.value.trim();
      // Tau's static open/closed switch is a fixed resistance, exactly as the
      // root deck emits it. No control pins are involved.
      if (/^(?:open|closed|on|off|1|0|pressed)$/i.test(value)) {
        const closed = /^(?:closed|on|1|pressed)$/i.test(value);
        return [`${ctx.ref("R")} ${ctx.at("a")} ${ctx.at("b")} ${closed ? "1m" : "1e12"}`];
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        ctx.refuse(
          `has switch value "${value}", which is neither Tau's Open/Closed grammar nor one exact SW model name.`,
        );
      }
      if (!/^tau_sw$/i.test(value)) {
        ctx.refuse(
          `names switch model "${value}", which a linked sheet cannot resolve: a child carries no attached model library. Use Tau's generic switch.`,
        );
      }
      // A voltage-controlled switch with no control pair has no controlling
      // voltage. The root deck degrades it to a fixed resistance and warns; a
      // block is compiled once and has no warning channel, so refuse instead of
      // silently emitting a switch that cannot switch.
      const control = ctx.component.value && ctx.at("cp") && ctx.at("cn");
      if (!control) ctx.refuse("is a voltage-controlled switch whose NC+/NC- control pins do not both reach a net.");
      ctx.addModelCard("TAU_SW", ".model TAU_SW SW(Ron=1m Roff=1e9 Vt=0.5 Vh=0)");
      return [`${ctx.ref("S")} ${ctx.at("a")} ${ctx.at("b")} ${ctx.at("cp")} ${ctx.at("cn")} TAU_SW`];
    },
  },
  vsource: {
    emit: (ctx) => {
      const raw = ctx.component.value.trim();
      // A stimulus a child may legally carry: an internal rail, a bias, or - as
      // the buck's gate drive needs - a PULSE. Parsed by the SAME parser the
      // root deck uses, so a waveform cannot mean one thing on a parent sheet
      // and another on a child.
      let spec: SourceSpec | null = null;
      try {
        spec = parseSourceFunction(raw, "V");
      } catch {
        ctx.refuse(`has a source waveform Tau could not parse: "${raw}".`);
      }
      if (spec) return [`${ctx.ref("V")} ${ctx.at("p")} ${ctx.at("n")} ${spec.text}`];
      return [`${ctx.ref("V")} ${ctx.at("p")} ${ctx.at("n")} DC ${literalPassiveValue(ctx.component, "V", false, ctx.sheetPath)}`];
    },
  },
  subckt: {
    emit: (ctx) => {
      const link = ctx.childLinks.get(ctx.component.id);
      if (!link) {
        ctx.refuse("is a file-backed or unlinked subcircuit; only explicit Tau project links are supported inside a linked sheet.");
      }
      const nodes = link!.ports.map((_, portIndex) => ctx.at(`p${portIndex + 1}`));
      return [`${ctx.ref("X")} ${nodes.join(" ")} ${link!.model}`];
    },
  },

  // ── Refused, each for its own stated reason ────────────────────────────────
  // Sources beyond a plain V: these carry stimulus semantics (AC sweep rows,
  // current drive, logic levels) that a block body does not model yet.
  isource: notYet("Only voltage sources are emitted into a block body so far."),
  vac: notYet("An AC sweep stimulus belongs to the analysis, which a child sheet does not own."),
  iac: notYet("An AC sweep stimulus belongs to the analysis, which a child sheet does not own."),
  vpulse: notYet("Use a voltage source with a PULSE(...) value, which a linked sheet does emit."),
  logicConstant: notYet("Use a voltage source with the constant as its value."),
  // Junctions and transistors: each needs its starter or vendor model resolved,
  // and several expand to more than one device.
  led: NEEDS_LIBRARY,
  zener: NEEDS_LIBRARY,
  photodiode: NEEDS_LIBRARY,
  nmos: NEEDS_LIBRARY,
  pmos: NEEDS_LIBRARY,
  njf: NEEDS_LIBRARY,
  pjf: NEEDS_LIBRARY,
  npn: NEEDS_LIBRARY,
  pnp: NEEDS_LIBRARY,
  // Analog blocks that are themselves subcircuits or multi-device expansions.
  opamp: COMPOSITE,
  comparator: COMPOSITE,
  potentiometer: COMPOSITE,
  transformer: COMPOSITE,
  ctTransformer: COMPOSITE,
  relay: COMPOSITE,
  motor: COMPOSITE,
  spdt: COMPOSITE,
  tline: COMPOSITE,
  // Controlled sources reference another branch by name, which is a whole-deck
  // identity a block body cannot yet resolve to its own interior.
  vcvs: notYet("A controlled source names a controlling branch, which a block body cannot resolve yet."),
  vccs: notYet("A controlled source names a controlling branch, which a block body cannot resolve yet."),
  cccs: notYet("A controlled source names a controlling branch, which a block body cannot resolve yet."),
  ccvs: notYet("A controlled source names a controlling branch, which a block body cannot resolve yet."),
  bsource: notYet("A behavioural expression may reference nodes by name, which a block body cannot rewrite yet."),
  // Digital and mixed-signal.
  digitalGate: MIXED_SIGNAL,
  dflop: MIXED_SIGNAL,
  srflop: MIXED_SIGNAL,
  tflop: MIXED_SIGNAL,
  jkflop: MIXED_SIGNAL,
  counter: MIXED_SIGNAL,
  timer555: MIXED_SIGNAL,
  adc: MIXED_SIGNAL,
  dac: MIXED_SIGNAL,
  sevenSeg: MIXED_SIGNAL,
  sampleHold: MIXED_SIGNAL,
  modulator: MIXED_SIGNAL,
  // A bulb is a resistor electrically, but its power readout is a root-deck
  // concern; emit it as a resistor only once that is carried too.
  bulb: notYet("Use a resistor for the filament; a bulb's power readout is not carried into a block yet."),
  pushButton: notYet("Use a switch, which a linked sheet does emit."),
};

/**
 * What a linked sheet does with one component kind: emit it, or refuse it with
 * this exact reason. Exposed so a test can walk every kind in `ComponentKind`
 * without having to build a valid sheet per kind, which is what makes the
 * anti-drift check cheap enough to actually keep.
 */
export function childDeviceDisposition(kind: ComponentKind): "emit" | string {
  const rule = CHILD_DEVICE_RULES[kind];
  return "refuse" in rule ? rule.refuse : "emit";
}

/**
 * Compile the child-sheet subset into one `.subckt` body.
 *
 * The body is generated device-by-device from {@link CHILD_DEVICE_RULES} rather
 * than by calling the root emitter, because a child must not inherit a global
 * source, a model library, or an analysis card by accident. What a child MAY
 * contain is the table's business; this function owns node naming, model-card
 * placement, and the `.subckt` header.
 */
function compileChildBlock(
  sheet: ResolvedSheet,
  model: string,
  childLinks: ReadonlyMap<string, ProjectSubcircuitLink>,
  /**
   * The already-resolved interface, passed in rather than recomputed. The
   * `.subckt` header this emits must list ports in exactly the order the
   * parent's `X` line passes nodes, and the caller is what knows that order -
   * recomputing here would let the two drift apart for a sheet whose ports were
   * derived from labels. It also saves a second `extractCircuit` over the sheet.
   */
  interfaceSpec: SheetInterface,
): string {
  const nonIdealWire = sheet.document.wires.find(isResistiveWire);
  if (nonIdealWire) {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `Linked sheet "${sheet.path}" has non-ideal wire "${nonIdealWire.id}". Project-sheet wire resistance is not emitted yet, so Tau refused to change its electrical meaning.`,
      sheet.path,
    );
  }
  const unsupportedDocumentState = [
    ...(sheet.document.directives ?? []).filter((line) => line.trim() !== ""),
    ...(sheet.document.userModelLibraries ?? []).map((library) => library.name),
    ...(sheet.document.ascForeignSymbols ?? []).map((symbol) => symbol.type),
    ...(sheet.document.ascHierarchicalBlocks ?? []).map((symbol) => symbol.type),
  ];
  if (unsupportedDocumentState.length > 0) {
    throw new ProjectHierarchyError(
      "unsupported-child",
      `Linked sheet "${sheet.path}" carries directives, attached models, or imported hierarchy that the project-sheet compiler cannot safely omit.`,
      sheet.path,
    );
  }
  const portNodes = new Map(interfaceSpec.ports.map(({ port, netId }) => [netId, port.name]));
  // A child author can legally name a public port `__tau_Foo_n1`. Do not turn
  // an unrelated internal net into that port merely because the generated
  // node allocator happened to pick the same case-insensitive SPICE token.
  const reservedNodeNames = new Set([
    "0",
    ...interfaceSpec.ports.map(({ port }) => keyFor(port.name)),
  ]);
  const internalNodes = new Map<string, string>();
  let internalIndex = 0;
  const node = (netId: string): string => {
    const port = portNodes.get(netId);
    if (port) return port;
    const net = interfaceSpec.circuit.nets.find((candidate) => candidate.id === netId);
    if (net?.isGround) return "0";
    let internal = internalNodes.get(netId);
    if (!internal) {
      do {
        internalIndex += 1;
        internal = `__tau_${asciiFold(model)}_n${internalIndex}`;
      } while (reservedNodeNames.has(keyFor(internal)));
      reservedNodeNames.add(keyFor(internal));
      internalNodes.set(netId, internal);
    }
    return internal;
  };
  /**
   * `.model` cards this block's own devices need, emitted INSIDE the
   * `.subckt … .ends` body.
   *
   * They cannot be left to the root deck. `buildSpiceDeck` decides whether to
   * emit its starter cards from the ROOT's component kinds alone, so a parent
   * that is just a source, a load and a block would emit none - and every
   * `TAU_DIODE`/`TAU_SW` reference inside the block would name an undefined
   * model. Carrying them in the body instead is both self-contained and
   * correctly scoped: ngspice scopes a `.model` to the `.subckt` that holds it,
   * so two blocks may each declare the same name without colliding, and an
   * identically-named root card is shadowed by an identical definition.
   */
  const modelCards = new Map<string, string>();
  const lines: string[] = [];
  interfaceSpec.circuit.components.forEach(({ component, pins }, index) => {
    const ordinal = index + 1;
    /** This instance's deck reference, per the block's own naming convention. */
    const ref = (prefix: string) => `${prefix}__tau_${model}_${ordinal}`;
    /** The node one of this component's terminals sits on. */
    const at = (pin: string) => node(pinNet(pins, pin, component, sheet.path));
    const refuse = (reason: string): never => {
      throw new ProjectHierarchyError(
        "unsupported-child",
        `${displayInstance(component)} (${component.kind}) on "${sheet.path}" ${reason}`,
        sheet.path,
      );
    };

    const rule = CHILD_DEVICE_RULES[component.kind];
    // Thrown inline rather than through `refuse` so the union narrows: a call to
    // a `never`-returning closure does not end a control-flow branch for tsc.
    if ("refuse" in rule) {
      throw new ProjectHierarchyError(
        "unsupported-child",
        `${displayInstance(component)} (${component.kind}) on "${sheet.path}" ${rule.refuse}`,
        sheet.path,
      );
    }
    const context: ChildEmitContext = {
      component,
      sheetPath: sheet.path,
      childLinks,
      ref,
      at,
      refuse,
      addModelCard: (name, card) => modelCards.set(name, card),
    };
    lines.push(...rule.emit(context));
  });
  return [
    `.subckt ${model} ${interfaceSpec.ports.map(({ port }) => port.name).join(" ")}`,
    ...modelCards.values(),
    ...lines,
    `.ends ${model}`,
  ].join("\n");
}

function rootDeckInput(
  document: SchematicDocument,
  directives: readonly string[],
  rootDeck: ProjectHierarchyBuildInput["rootDeck"],
) {
  return {
    components: document.components,
    wires: document.wires,
    netLabels: document.netLabels ?? [],
    directives: [...directives],
    ...(rootDeck?.params ? { params: rootDeck.params } : {}),
    ascForeignSymbols: rootDeck?.ascForeignSymbols ?? document.ascForeignSymbols,
    userModelLibraries: rootDeck?.userModelLibraries ?? document.userModelLibraries?.map((library) => library.text),
    userModelLibraryNames: rootDeck?.userModelLibraryNames ?? document.userModelLibraries?.map((library) => library.name),
  };
}

/**
 * Build a root deck with recursively resolved Tau project sheets. File I/O is
 * intentionally absent: the caller has to provide every readable sheet, which
 * makes missing files a deterministic refusal and keeps the deck compiler pure.
 */
export function buildProjectHierarchyDeck(input: ProjectHierarchyBuildInput): ProjectHierarchyBuildResult {
  const rootPath = canonicalPathOrThrow(input.rootPath, "Root sheet path");
  const root: ResolvedSheet = { path: rootPath, key: keyFor(rootPath), document: input.root };
  const sheets = new Map<string, ResolvedSheet>([[root.key, root]]);
  for (const candidate of input.sheets) {
    const path = canonicalPathOrThrow(candidate.path, "Project sheet path");
    const key = keyFor(path);
    if (sheets.has(key)) {
      throw new ProjectHierarchyError("duplicate-sheet", `Project contains duplicate sheet path "${path}".`, path);
    }
    sheets.set(key, { path, key, document: candidate.document });
  }

  const rootDirectives = input.rootDeck?.directives ?? input.root.directives ?? [];
  const rootLibraryTexts = input.rootDeck?.userModelLibraries
    ?? input.root.userModelLibraries?.map((library) => library.text)
    ?? [];
  const reservedDefinitions = new Set<string>();
  for (const name of definedSubcktNames(rootDirectives)) {
    reservedDefinitions.add(keyFor(name));
    reservedDefinitions.add(keyFor(sanitizeSubcktName(name)));
  }
  for (const name of parseUserModelLibraries(rootLibraryTexts).subckts.keys()) {
    reservedDefinitions.add(keyFor(name));
  }
  const generatedByModel = new Map<string, { sheetKey: string; model: string }>();
  const modelBySheet = new Map<string, string>();
  // A root-level ordinary X instance is deliberately NOT a project link. If a
  // generated block used its model name, that ordinary X would start resolving
  // against a different implementation without the author ever linking it.
  const ordinaryRootXModels = new Map<string, SchematicComponent>();
  for (const component of input.root.components) {
    if (component.kind !== "subckt" || component.projectSubcircuit) continue;
    const raw = component.value.trim().split(/\s+/)[0] ?? "";
    if (!raw) continue;
    ordinaryRootXModels.set(keyFor(sanitizeSubcktName(raw)), component);
  }
  const compiling: string[] = [root.key];
  const compiled = new Set<string>();
  const blocks: ProjectHierarchyBlock[] = [];

  const visit = (link: ProjectSubcircuitLink, ownerPath: string, ownerComponent?: SchematicComponent): void => {
    const componentFocus = ownerComponent
      ? { componentId: ownerComponent.id, reference: displayInstance(ownerComponent) }
      : undefined;
    const target = sheets.get(keyFor(link.sheetPath));
    if (!target) {
      throw new ProjectHierarchyError("missing-sheet", `Linked sheet "${link.sheetPath}" used by ${ownerComponent ? `instance "${displayInstance(ownerComponent)}" in ` : ""}"${ownerPath}" is missing from the open project.`, ownerPath, componentFocus);
    }
    // The link's own order is offered to the resolver so a label-declared
    // (`.asc`) interface can be read in the order the parent already fixed.
    // An explicit `projectPorts` array ignores it and stays authoritative.
    const targetInterface = sheetInterface(target, link.ports);
    if (!hasMatchingOrderedProjectPorts(link.ports, targetInterface.ports.map(({ port }) => port))) {
      throw new ProjectHierarchyError(
        "invalid-contract",
        `Linked sheet "${target.path}" ports do not exactly match ${link.model}'s ordered instance contract.`,
        ownerPath,
        componentFocus,
      );
    }
    const modelKey = keyFor(link.model);
    const ordinaryRootX = ordinaryRootXModels.get(modelKey);
    if (ordinaryRootX) {
      throw new ProjectHierarchyError(
        "duplicate-definition",
        `Project model "${link.model}" collides with ordinary root X instance "${displayInstance(ordinaryRootX)}". Link that instance explicitly or choose a different project model name.`,
        ownerPath,
        componentFocus,
      );
    }
    const existingModel = generatedByModel.get(modelKey);
    if (existingModel && existingModel.sheetKey !== target.key) {
      throw new ProjectHierarchyError(
        "duplicate-model",
        `Project model "${link.model}" is linked to both "${sheets.get(existingModel.sheetKey)?.path}" and "${target.path}".`,
        ownerPath,
        componentFocus,
      );
    }
    const priorModel = modelBySheet.get(target.key);
    if (priorModel && priorModel !== modelKey) {
      throw new ProjectHierarchyError(
        "invalid-contract",
        `Linked sheet "${target.path}" is used as both "${priorModel}" and "${link.model}"; choose one stable project model name.`,
        ownerPath,
        componentFocus,
      );
    }
    if (reservedDefinitions.has(modelKey) || bundledSubcircuitBlock(modelKey) !== null) {
      throw new ProjectHierarchyError(
        "duplicate-definition",
        `Project model "${link.model}" collides with an inline, attached, or Tau-owned subcircuit definition.`,
        ownerPath,
        componentFocus,
      );
    }
    generatedByModel.set(modelKey, { sheetKey: target.key, model: link.model });
    modelBySheet.set(target.key, modelKey);
    const cycleStart = compiling.indexOf(target.key);
    if (cycleStart >= 0) {
      const chain = [...compiling.slice(cycleStart), target.key]
        .map((key) => sheets.get(key)?.path ?? key)
        .join(" → ");
      throw new ProjectHierarchyError("cycle", `Project-linked hierarchy contains a cycle: ${chain}.`, ownerPath, componentFocus);
    }
    if (compiled.has(target.key)) return;

    compiling.push(target.key);
    const childLinks = new Map<string, ProjectSubcircuitLink>();
    const dependencies = target.document.components
      .filter((component) => component.projectSubcircuit !== undefined)
      .map((component) => ({ component, link: exactLinkForComponent(component, target.path) }))
      .sort((left, right) =>
        compareStable(left.link.model, right.link.model)
        || compareStable(left.link.sheetPath, right.link.sheetPath)
        || compareStable(left.component.id, right.component.id));
    try {
      for (const dependency of dependencies) {
        childLinks.set(dependency.component.id, dependency.link);
        visit(dependency.link, target.path, dependency.component);
      }
      const text = compileChildBlock(target, link.model, childLinks, targetInterface);
      blocks.push({ model: link.model, sheetPath: target.path, text });
      compiled.add(target.key);
    } finally {
      compiling.pop();
    }
  };

  const rootLinks = input.root.components
    .filter((component) => component.projectSubcircuit !== undefined)
    .map((component) => ({ component, link: exactLinkForComponent(component, root.path) }))
    .sort((left, right) =>
      compareStable(left.link.model, right.link.model)
      || compareStable(left.link.sheetPath, right.link.sheetPath)
      || compareStable(left.component.id, right.component.id));
  for (const { component, link } of rootLinks) visit(link, root.path, component);

  const deck = buildSpiceDeck(
    rootDeckInput(
      input.root,
      [...rootDirectives, ...blocks.map((block) => block.text)],
      input.rootDeck,
    ),
    input.analysis,
    input.deckOptions,
  );
  return { deck, blocks };
}
