import { extractCircuit, netAtPoint, type ExtractedCircuit } from "./netlist";
import { asciiFold, type PortSide } from "./projectSubcircuit";
import { subcircuitBankSides } from "./subcircuitGeometry";
import type {
  PinOverride,
  ProjectSheetPort,
  ProjectSubcircuitLink,
  SchematicComponent,
  SchematicPortDirection,
} from "./types";
import type { ProjectHierarchySheet } from "./projectHierarchy";
import type { SchematicDocument } from "../store/useSchematic";

/* ======================================================================
 * The hierarchy graph, read only.
 *
 * What a project's sheets declare, who instantiates whom, and which parent net
 * is sitting on each block terminal right now. This is the data a port-pairing
 * surface reads; it is not a second opinion about whether any of it is legal.
 *
 * ADVISORY ONLY, in the sense projectSubcircuit.ts:206-209 means it. No
 * compiler path may read anything here, because `buildProjectHierarchyDeck`
 * stays the only judge of whether a link is legal. This module therefore
 * refuses nothing that judge refuses: a mis-kinded instance, a duplicated port
 * name, a bank that does not match its contract all still appear, because a
 * review surface that hides the broken case is worse than no surface at all.
 *
 * PURE, for the reason projectHierarchy.ts:700-704 gives about its own seam.
 * No store, no React, no file reads, nothing asynchronous. The caller supplies
 * every sheet it wants considered, which makes an unread sheet a visible
 * absence instead of a silent assumption.
 *
 * ABSENCE IS NEVER AGREEMENT. An empty block list means this sheet instantiates
 * nothing; a null `boundNet` means nothing is on that terminal; a child sheet
 * the caller did not pass contributes no directions at all. None of the three
 * may be read as "checked, and fine" - App.tsx:1021-1023 records what
 * conflating silence with a verdict costs a reader looking at a stale link.
 * ====================================================================== */

/**
 * The direction a port declares.
 *
 * An alias, deliberately, and never a second union: two spellings of the same
 * three words drift apart the first time a fourth is added to one of them.
 */
export type PortDirection = SchematicPortDirection;

/** The parts of a sheet this module reads. A full document satisfies it. */
export type HierarchySheetDocument = Pick<
  SchematicDocument,
  "components" | "wires" | "netLabels" | "projectPorts"
>;

export interface HierarchyPortRow {
  /** 1-based terminal ordinal, the same one the emitted X card uses. */
  position: number;
  /** The child sheet's port name. */
  name: string;
  direction: PortDirection;
  /** Which column the block draws it in; from `subcircuitBankSides`. */
  side: PortSide;
  /** The parent net currently sitting at this terminal, or null if unbound. */
  boundNet: string | null;
}

export interface HierarchyBlockView {
  componentId: string;
  /** The ref-des, e.g. "X1". */
  reference: string;
  model: string;
  sheetPath: string;
  ports: HierarchyPortRow[];
}

/** One instantiation of a child sheet, from the owning sheet's point of view. */
export interface HierarchySheetUse {
  /** The sheet holding the instance, spelled as the caller spelled its path. */
  ownerPath: string;
  componentId: string;
  /** The ref-des, under the same fallback {@link HierarchyBlockView} uses. */
  reference: string;
  model: string;
  /** The child path as this one link spells it, before folding. */
  sheetPath: string;
}

/** Every instantiation of one child sheet: the "used by" relation, one row. */
export interface HierarchySheetUsers {
  /**
   * `asciiFold`ed child path. Two links reach the same sheet when and only when
   * these match, which is the same key `buildProjectHierarchyDeck` resolves on.
   */
  sheetPathKey: string;
  /** The first spelling seen for that key, for display only. */
  sheetPath: string;
  usedBy: readonly HierarchySheetUse[];
}

/**
 * The ref-des a human sees for an instance.
 *
 * The same fallback `displayInstance` (projectHierarchy.ts:137-139) applies
 * when the compiler has to name an instance in a refusal: an unlabelled block
 * is identified by its id rather than by an empty caption. That rule is private
 * to the compiler, so this restates it rather than importing it; the one thing
 * that must not happen is a pairing table with a blank row heading.
 */
function referenceOf(component: SchematicComponent): string {
  return component.label.trim() || component.id;
}

/**
 * The public interface a sheet declares, in the order it declares it.
 *
 * The precedence is projectHierarchy.ts:227-229's, exactly: an explicit
 * `projectPorts` array wins whenever it holds an entry, and only a sheet
 * without one falls back to its port-marked net labels. Derivation exists
 * because LTspice's format has nowhere to keep the explicit array, not as a
 * second source of truth competing with one that is present.
 *
 * ORDER IS NOT MEANINGFUL in the derived case, and nothing here pretends it is.
 * Flag order is an artifact of how the file was edited, which is why the
 * compiler re-orders derived ports onto the parent's bank before comparing
 * (`labelDeclaredPorts`). {@link hierarchyBlockViews} looks a direction up by
 * folded name for the same reason, never by index.
 *
 * Nothing is validated here. A sheet whose ports would fail
 * `projectSheetPortsValidation` is reported as it stands, because the reader
 * needs to see the duplicate that Run is about to refuse.
 */
export function sheetDeclaredPorts(document: HierarchySheetDocument): readonly ProjectSheetPort[] {
  const explicit = document.projectPorts ?? [];
  if (explicit.length > 0) return explicit;
  return (document.netLabels ?? [])
    .filter((label) => label.port !== undefined)
    .map((label) => ({ name: label.text, labelId: label.id, direction: label.port! }));
}

/**
 * Folded child path -> folded port name -> the direction that sheet declares.
 *
 * First declaration wins on a duplicated name, and on a duplicated sheet path.
 * Both are already refusals (`projectSheetPortsValidation`, `duplicate-sheet`),
 * so the only job left here is to be deterministic about which one is shown.
 */
function declaredDirections(
  sheets: readonly ProjectHierarchySheet[],
): Map<string, Map<string, PortDirection>> {
  const byPath = new Map<string, Map<string, PortDirection>>();
  for (const sheet of sheets) {
    const pathKey = asciiFold(sheet.path);
    if (byPath.has(pathKey)) continue;
    const directions = new Map<string, PortDirection>();
    for (const port of sheetDeclaredPorts(sheet.document)) {
      const nameKey = asciiFold(port.name);
      if (!directions.has(nameKey)) directions.set(nameKey, port.direction);
    }
    byPath.set(pathKey, directions);
  }
  return byPath;
}

/**
 * The parent net a terminal is sitting on, or null when it is sitting on
 * nothing.
 *
 * `netAtPoint` is the probe-resolution authority (netlist.ts:594-597), so a
 * terminal that lands mid-segment resolves the same way a dropped probe would.
 * What it cannot answer is the question a pairing table is actually asking,
 * because `extractCircuit` mints a net for every pin including a dangling one:
 * a floating terminal comes back as a perfectly real-looking `N004`. Reporting
 * that would be a false positive of the worst kind here, a name in a column
 * headed "connected to" for a pin with nothing on it.
 *
 * So a net is only a binding when something other than this terminal is on it.
 * "Something" is read exactly as netlist.ts:15-18 reads it - a net label alone
 * counts, because the label is what makes the node nameable and joinable, and
 * named nets are the whole currency of the surface this feeds. Ground counts
 * for the same reason: node "0" is a real node whoever else is on it.
 */
function boundNetAt(
  circuit: ExtractedCircuit,
  wires: HierarchySheetDocument["wires"],
  componentId: string,
  terminal: PinOverride,
): string | null {
  const net = netAtPoint(circuit.nets, wires, terminal);
  if (!net) return null;
  const somethingElse = net.pins.some(
    (pin) => pin.componentId !== componentId || pin.id !== terminal.id,
  );
  if (!somethingElse && net.labelCount === 0 && !net.isGround) return null;
  return net.id;
}

/**
 * The terminals of one block, keyed by the ordinal they carry.
 *
 * Keyed rather than indexed, on purpose. The ordered contract is stated by the
 * pin ids themselves (projectHierarchy.ts:167-178 sorts the bank by the numeric
 * part of `p{n}` and then asserts id and label position by position), so a bank
 * that is short, gapped or out of order must not be re-aligned by counting
 * array slots - that is precisely how a shorter `pinOverride` than `link.ports`
 * turns into a row claiming a net that belongs to a different pin.
 *
 * The bank index travels with each entry because {@link subcircuitBankSides}
 * reports sides in `pinOverride` order, and reading it by ordinal would
 * reintroduce the same misalignment on the side column.
 */
function bankByPosition(
  component: SchematicComponent,
): Map<number, { terminal: PinOverride; bankIndex: number }> {
  const bank = new Map<number, { terminal: PinOverride; bankIndex: number }>();
  (component.pinOverride ?? []).forEach((terminal, bankIndex) => {
    const ordinal = /^p(\d+)$/.exec(terminal.id);
    if (!ordinal) return;
    const position = Number(ordinal[1]);
    if (!bank.has(position)) bank.set(position, { terminal, bankIndex });
  });
  return bank;
}

function portRows(
  link: ProjectSubcircuitLink,
  component: SchematicComponent,
  circuit: ExtractedCircuit,
  wires: HierarchySheetDocument["wires"],
  directions: Map<string, PortDirection> | undefined,
): HierarchyPortRow[] {
  const bank = bankByPosition(component);
  // The side rule is read back through subcircuitGeometry and nowhere else;
  // there must never be a second answer to which column a terminal is in.
  const sides = subcircuitBankSides(component);
  const names = Array.isArray(link.ports) ? link.ports : [];
  return names.map((name, index) => {
    const position = index + 1;
    const seat = bank.get(position);
    return {
      position,
      name,
      // A direction we were not given is BiDir, which is the reading
      // `subcircuitPortSlots` already settled on: it states no intent the child
      // never declared. A caller that must tell "declared BiDir" apart from
      // "nothing declared" asks {@link sheetDeclaredPorts} directly.
      direction: directions?.get(asciiFold(name)) ?? "BiDir",
      // No seat means no terminal at this ordinal: the bank is shorter than the
      // contract, or an id is missing from it. Nothing is padded and nothing is
      // borrowed from a neighbour; the terminal is reported unbound and
      // unplaced, which is what it is.
      side: seat ? sides[seat.bankIndex] ?? null : null,
      boundNet: seat ? boundNetAt(circuit, wires, component.id, seat.terminal) : null,
    };
  });
}

/**
 * Every linked block on one sheet, in document order, with each terminal's
 * declared direction, drawn side and currently bound parent net.
 *
 * `sheets` is the project the child directions are read from, root included if
 * the caller wants it considered; a child that is not in it simply contributes
 * no direction, which is the "not checked" reading and not an agreement. Pass
 * nothing and every row reports the parent's own stored belief alone.
 *
 * An instance is anything carrying a `projectSubcircuit`, the same gate the
 * compiler's dependency scan uses (projectHierarchy.ts:815-816). Whether that
 * instance is legal is not asked: a block whose kind or bank the compiler will
 * refuse is one the reader most needs to see.
 *
 * Rows run to the length of `link.ports`, because that array is the emitted
 * node order. A bank longer than its contract has terminals the X card never
 * mentions, and inventing rows for them here would describe a circuit that is
 * not the one that would be run.
 */
export function hierarchyBlockViews(
  document: HierarchySheetDocument,
  sheets: readonly ProjectHierarchySheet[] = [],
): HierarchyBlockView[] {
  const blocks = document.components.filter((component) => component.projectSubcircuit !== undefined);
  if (blocks.length === 0) return [];
  // One extraction for the whole sheet. It is the expensive part of this
  // module and it is why the early return above exists.
  const circuit = extractCircuit(document.components, document.wires, document.netLabels ?? []);
  const directionsByPath = declaredDirections(sheets);
  return blocks.map((component) => {
    const link = component.projectSubcircuit!;
    return {
      componentId: component.id,
      reference: referenceOf(component),
      model: link.model,
      sheetPath: link.sheetPath,
      ports: portRows(link, component, circuit, document.wires, directionsByPath.get(asciiFold(link.sheetPath))),
    };
  });
}

/**
 * The "used by" relation: for each child sheet some link names, every place it
 * is instantiated.
 *
 * Keyed on the folded path because that is the identity the resolver uses, and
 * a project can perfectly well hold two links spelling the same sheet with
 * different case. Rows come back in first-mention order, sheets outer and
 * components inner, so the relation is stable enough to diff between runs.
 *
 * A named sheet that the project does not contain still gets a row. Its absence
 * is a fact about the project, and dropping the row would make the surface
 * silently agree that nothing points there.
 */
export function hierarchySheetUsers(
  sheets: readonly ProjectHierarchySheet[],
): readonly HierarchySheetUsers[] {
  const relation = new Map<string, { sheetPath: string; usedBy: HierarchySheetUse[] }>();
  for (const sheet of sheets) {
    for (const component of sheet.document.components) {
      const link = component.projectSubcircuit;
      if (!link) continue;
      const sheetPathKey = asciiFold(link.sheetPath);
      let row = relation.get(sheetPathKey);
      if (!row) {
        row = { sheetPath: link.sheetPath, usedBy: [] };
        relation.set(sheetPathKey, row);
      }
      row.usedBy.push({
        ownerPath: sheet.path,
        componentId: component.id,
        reference: referenceOf(component),
        model: link.model,
        sheetPath: link.sheetPath,
      });
    }
  }
  return [...relation].map(([sheetPathKey, row]) => ({ sheetPathKey, ...row }));
}

/**
 * The one row of {@link hierarchySheetUsers} for a given child path, or an
 * empty list when nothing instantiates it.
 *
 * A thin lookup over the whole relation rather than its own scan, so there is
 * only ever one rule about what counts as an instantiation.
 */
export function hierarchySheetUsedBy(
  sheets: readonly ProjectHierarchySheet[],
  sheetPath: string,
): readonly HierarchySheetUse[] {
  const key = asciiFold(sheetPath);
  return hierarchySheetUsers(sheets).find((row) => row.sheetPathKey === key)?.usedBy ?? [];
}
