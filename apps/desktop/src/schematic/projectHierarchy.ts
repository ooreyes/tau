import {
  buildSpiceDeck,
  type BuildSpiceDeckOptions,
  type SpiceAnalysis,
  type SpiceDeck,
} from "../engine/spiceNetlist";
import { definedSubcktNames } from "../engine/modelDirectives";
import { bundledSubcircuitBlock, sanitizeSubcktName } from "../engine/bundledSubcircuits";
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

/**
 * Compile the deliberately small, real child-sheet subset. It is explicit
 * rather than reusing the top-level emitter because a child must not inherit a
 * global source, a model library, or an analysis card by accident. New child
 * kinds must be added here with their exact SPICE semantics and fixture proof.
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
  const lines: string[] = [];
  interfaceSpec.circuit.components.forEach(({ component, pins }, index) => {
    const ordinal = index + 1;
    switch (component.kind) {
      case "ground":
        return;
      case "resistor":
        lines.push(`R__tau_${model}_${ordinal} ${node(pinNet(pins, "a", component, sheet.path))} ${node(pinNet(pins, "b", component, sheet.path))} ${literalPassiveValue(component, "Ω", false, sheet.path)}`);
        return;
      case "capacitor":
      case "polarizedCapacitor":
        lines.push(`C__tau_${model}_${ordinal} ${node(pinNet(pins, "a", component, sheet.path))} ${node(pinNet(pins, "b", component, sheet.path))} ${literalPassiveValue(component, "F", true, sheet.path)}`);
        return;
      case "inductor":
        lines.push(`L__tau_${model}_${ordinal} ${node(pinNet(pins, "a", component, sheet.path))} ${node(pinNet(pins, "b", component, sheet.path))} ${literalPassiveValue(component, "H", true, sheet.path)}`);
        return;
      case "subckt": {
        const link = childLinks.get(component.id);
        if (!link) {
          throw new ProjectHierarchyError(
            "unsupported-child",
            `${displayInstance(component)} on "${sheet.path}" is a file-backed or unlinked subcircuit; only explicit Tau project links are supported inside a project sheet.`,
            sheet.path,
          );
        }
        const nodes = link.ports.map((_, portIndex) => node(pinNet(pins, `p${portIndex + 1}`, component, sheet.path)));
        lines.push(`X__tau_${model}_${ordinal} ${nodes.join(" ")} ${link.model}`);
        return;
      }
      default:
        throw new ProjectHierarchyError(
          "unsupported-child",
          `${displayInstance(component)} (${component.kind}) on "${sheet.path}" is not yet supported inside a project-linked sheet.`,
          sheet.path,
        );
    }
  });
  return [
    `.subckt ${model} ${interfaceSpec.ports.map(({ port }) => port.name).join(" ")}`,
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
