import type { ProjectSheetPort, ProjectSubcircuitLink, SchematicPortDirection } from "./types";

/** A sheet interface larger than this is not practical to render or inspect. */
export const MAX_PROJECT_SUBCIRCUIT_PORTS = 64;
export const MAX_PROJECT_SHEET_PATH_LENGTH = 1_024;
export const MAX_PROJECT_SUBCIRCUIT_NAME_LENGTH = 80;

/**
 * Tau generates these names directly into a native deck. Keep the grammar
 * intentionally narrower than ngspice's full identifier grammar so a project
 * link never depends on a sanitizer silently changing an interface name.
 */
export const PROJECT_SPICE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PORT_DIRECTIONS = new Set<SchematicPortDirection>(["In", "Out", "BiDir"]);

/**
 * SPICE names and project-link keys deliberately have an ASCII-only case
 * contract. `toLocaleLowerCase()` made the persistent key depend on the
 * machine's UI locale (notably Turkish I/i), which is unacceptable for a
 * project file that can move between Macs. Project links only permit ASCII
 * port/model tokens; paths retain non-ASCII spelling but only fold A-Z.
 */
export function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

function issueForToken(value: unknown, role: string): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_PROJECT_SUBCIRCUIT_NAME_LENGTH || !PROJECT_SPICE_TOKEN.test(value)) {
    return `${role} must be a SPICE-safe name starting with a letter or underscore.`;
  }
  return null;
}

/**
 * Normalize a path that is intentionally *relative to the open project*.
 * Returning null means the input is outside that sandbox or ambiguous. The
 * persisted value is required to already equal this spelling; callers that
 * accept text input may use this once before committing an edit.
 */
export function canonicalProjectSheetPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_SHEET_PATH_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  // A persisted link is never an OS path or URI. In particular `C:\\foo.sim`
  // used to become the apparently-relative `C:/foo.sim`, and `web://…` / a
  // custom scheme could escape the active project's resolver entirely.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value.trim())) return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized || normalized.startsWith("/")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  // `.asc` is a first-class linked sheet, not a second-class one. LTspice's
  // format already carries everything a child sheet needs: components, wires,
  // and - via a `FLAG` with an adjacent `IOPIN` - the public ports WITH their
  // directions. The one thing it cannot record is Tau's `projectPorts` array,
  // and that array only ever added port ORDER, which belongs on the parent
  // anyway (see `sheetInterface` in projectHierarchy.ts). Refusing `.asc` here
  // meant a file that plainly declares its own interface was rejected before a
  // single device was examined.
  if (!/\.(?:sim|asc|tau\.json)$/i.test(normalized)) return null;
  return normalized;
}

/**
 * The narrower grammar a sheet that **owns** links must satisfy.
 *
 * A `.asc` is a legal link TARGET and an illegal link OWNER, and one regex
 * cannot say that. The two roles ask different questions:
 *
 *   target - can Tau READ an interface out of this file? For `.asc`, yes: the
 *            `FLAG`/`IOPIN` pair states each port and its direction.
 *   owner  - can Tau WRITE this file's own hierarchy back? For `.asc`, no.
 *            LTspice's format can persist neither `projectSubcircuit` (the
 *            parent's link) nor `projectPorts`, and a block instance saves
 *            through the lossy-carrier path, which carries only `TauKind` and
 *            `TauValue`. A parent saved as `.asc` would therefore lose its
 *            hierarchy silently - the one outcome the compiler exists to
 *            prevent.
 *
 * Widening only {@link canonicalProjectSheetPath} looked sufficient and was not:
 * it also governs the ROOT resolver, so an `.asc` root began resolving, the
 * root refusal stopped firing, and the sheet enumerator then dropped that same
 * file - turning one clear sentence into an incoherent failure.
 */
export function canonicalProjectOwnerPath(value: string): string | null {
  const normalized = canonicalProjectSheetPath(value);
  if (!normalized) return null;
  return /\.asc$/i.test(normalized) ? null : normalized;
}

/**
 * Turn a project-owned absolute/virtual path into the one spelling a persisted
 * project link may carry. This is a containment seam, not a general path
 * normalizer: callers must provide the open project root, and a sibling that
 * merely shares a string prefix (`/proj-old` vs `/proj`) is refused.
 *
 * `web://` roots are intentionally supported here because they are an
 * in-memory project address used by Tau's browser workspace. They are never
 * accepted by {@link canonicalProjectSheetPath}; only the resulting relative
 * path is persisted.
 */
export function projectRelativeSheetPath(projectRoot: string, candidatePath: string): string | null {
  if (typeof projectRoot !== "string" || typeof candidatePath !== "string") return null;
  if (!projectRoot || !candidatePath) return null;
  if (/[\u0000-\u001f\u007f]/.test(projectRoot) || /[\u0000-\u001f\u007f]/.test(candidatePath)) return null;
  const normalize = (path: string) => path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  const root = normalize(projectRoot);
  const candidate = normalize(candidatePath);
  if (!root || !candidate) return null;

  // Filesystem paths are case-insensitive on the supported macOS default and
  // Windows project stores. The fold is deliberately ASCII-only, as above.
  const rootKey = asciiFold(root);
  const candidateKey = asciiFold(candidate);
  if (!candidateKey.startsWith(`${rootKey}/`)) return null;
  const relative = candidate.slice(root.length + 1);
  return canonicalProjectSheetPath(relative);
}

/** Validation result suitable for an inspector/store without throwing. */
export interface ProjectSubcircuitValidationResult {
  ok: boolean;
  error?: string;
}

/** Validate a linked-sheet instance contract without changing it. */
export function projectSubcircuitLinkValidation(
  link: Pick<ProjectSubcircuitLink, "sheetPath" | "model" | "ports">,
): ProjectSubcircuitValidationResult {
  if (!link || typeof link !== "object") return { ok: false, error: "Linked sheet contract must be an object." };
  const canonicalPath = canonicalProjectSheetPath(link.sheetPath);
  if (!canonicalPath || canonicalPath !== link.sheetPath) {
    return { ok: false, error: "Linked sheet path must be a canonical project-relative path." };
  }
  const modelIssue = issueForToken(link.model, "Linked subcircuit name");
  if (modelIssue) return { ok: false, error: modelIssue };
  if (!Array.isArray(link.ports) || link.ports.length === 0 || link.ports.length > MAX_PROJECT_SUBCIRCUIT_PORTS) {
    return { ok: false, error: `Linked subcircuit needs between 1 and ${MAX_PROJECT_SUBCIRCUIT_PORTS} ordered ports.` };
  }
  const names = new Set<string>();
  for (const port of link.ports) {
    const portIssue = issueForToken(port, "Linked port name");
    if (portIssue) return { ok: false, error: portIssue };
    const key = asciiFold(port);
    if (names.has(key)) return { ok: false, error: `Linked port name "${port}" is duplicated.` };
    names.add(key);
  }
  return { ok: true };
}

/** Validate ordered public sheet ports without inferring anything from labels. */
export function projectSheetPortsValidation(
  ports: readonly Pick<ProjectSheetPort, "name" | "labelId" | "direction">[],
): ProjectSubcircuitValidationResult {
  if (!Array.isArray(ports)) return { ok: false, error: "Sheet ports must be an array." };
  if (ports.length > MAX_PROJECT_SUBCIRCUIT_PORTS) {
    return { ok: false, error: `A sheet supports at most ${MAX_PROJECT_SUBCIRCUIT_PORTS} public ports.` };
  }
  const names = new Set<string>();
  const labels = new Set<string>();
  for (const port of ports) {
    if (!port || typeof port !== "object") return { ok: false, error: "Sheet port must be an object." };
    const nameIssue = issueForToken(port.name, "Sheet port name");
    if (nameIssue) return { ok: false, error: nameIssue };
    if (typeof port.labelId !== "string" || !port.labelId || port.labelId.length > 128 || /[\u0000-\u001f\u007f]/.test(port.labelId)) {
      return { ok: false, error: "Sheet port label identity is invalid." };
    }
    if (!PORT_DIRECTIONS.has(port.direction)) {
      return { ok: false, error: "Sheet port direction must be In, Out, or BiDir." };
    }
    const nameKey = asciiFold(port.name);
    const labelKey = asciiFold(port.labelId);
    if (names.has(nameKey)) return { ok: false, error: `Sheet port name "${port.name}" is duplicated.` };
    if (labels.has(labelKey)) return { ok: false, error: "A net label can define only one sheet port." };
    names.add(nameKey);
    labels.add(labelKey);
  }
  return { ok: true };
}

/** Case-insensitive but order-sensitive comparison of a link and child sheet. */
export function hasMatchingOrderedProjectPorts(
  linkPorts: readonly string[],
  sheetPorts: readonly Pick<ProjectSheetPort, "name">[],
): boolean {
  return linkPorts.length === sheetPorts.length && linkPorts.every((port, index) =>
    asciiFold(port) === asciiFold(sheetPorts[index]?.name ?? ""));
}

/**
 * One confirmed parent -> child edge in the open-tab project view.
 *
 * Parent discovery is advisory (closed sheets are intentionally not guessed),
 * but the rows must still be stable when tabs are opened in a different order.
 * Keeping this ordering rule next to the path/contract rules means every
 * surface that presents the graph can use the same deterministic spelling.
 */
export interface ProjectSheetUse {
  sheetPath: string;
  reference: string;
}

export function orderedProjectSheetUses(uses: readonly ProjectSheetUse[]): ProjectSheetUse[] {
  return [...uses].sort((left, right) => {
    const path = asciiFold(left.sheetPath).localeCompare(asciiFold(right.sheetPath));
    if (path !== 0) return path;
    return asciiFold(left.reference).localeCompare(asciiFold(right.reference));
  });
}

/* ======================================================================
 * Item 14 vocabulary: what a project sheet offers, and how a parent's
 * stored contract differs from it. Everything below is PURE and imports
 * nothing but ./types, deliberately:
 *
 *  - no store and no component import, so the classifier can be called from
 *    a store action, a renderer, a dialog and a headless test alike;
 *  - no subcircuitGeometry import, which is why {@link projectSheetInterfaceDrift}
 *    takes `sides` as a parameter instead of computing them. The single rule
 *    about which side a pin lands on lives in subcircuitGeometry; duplicating
 *    it here would create a second rule that could disagree with the drawing.
 * ====================================================================== */

/**
 * What an authoring-time index knows about one project sheet.
 *
 * ADVISORY ONLY. No compiler path may read this: `buildProjectHierarchyDeck`
 * stays the only judge of whether a link is legal, and the equivalence test
 * (spec D5) exists to prove an index entry is never `ok` where Run refuses.
 *
 * `reason` carries the loader's own words verbatim - paraphrasing a parse
 * error into house prose is how a user loses the one string that would have
 * told them which byte of their file is wrong.
 *
 * `status: "missing"` records a sheet the link names but the project does not
 * contain. It is deliberately a status rather than an absent entry, because an
 * absent entry means "not looked at yet" ({@link ProjectInterfaceDrift}
 * `not-checked`) and the two must never be confused: one is silence, the other
 * is a fact.
 */
export interface ProjectSheetInterfaceEntry {
  /** Canonical project-relative path, i.e. {@link canonicalProjectSheetPath} output. */
  sheetPath: string;
  fileName: string;
  status: "ok" | "no-interface" | "unreadable" | "missing";
  /** Empty unless `status === "ok"`. */
  ports: readonly ProjectSheetPort[];
  /** The loader's own words, verbatim, when it had any. */
  reason?: string;
}

/** Which column of a linked block's body a terminal sits in. */
export type PortSide = "left" | "right" | null;

export interface ProjectInterfaceDriftRow {
  /** 1-based terminal position - the same ordinal the emitted X card uses. */
  position: number;
  /** The parent's stored belief at this position, if it has one. */
  was?: { name: string; side: PortSide };
  /** The child sheet's live declaration at this position, if it has one. */
  now?: { name: string; direction: SchematicPortDirection; side: PortSide };
  change: "same" | "renamed" | "moved" | "direction" | "added" | "removed";
  /** Generated from this row by {@link driftRowConsequence}; never a per-case literal. */
  consequence: string;
}

export type ProjectInterfaceDrift =
  | { kind: "in-sync" }
  | { kind: "not-checked" }
  | { kind: "missing-sheet" }
  | { kind: "sheet-unreadable"; reason: string }
  | { kind: "no-interface" }
  | {
      kind: "drifted";
      rows: ProjectInterfaceDriftRow[];
      /** Same names, different order: the case that silently changes the netlist. */
      reordered: boolean;
      /** True iff nothing in this diff changes an emitted node. */
      electricallyInert: boolean;
      summary: string;
    };

const FALLBACK_UNREADABLE_REASON = "This sheet could not be read.";

function directionWord(direction: SchematicPortDirection): string {
  return asciiFold(direction);
}

function sideWord(side: PortSide): string {
  return side ?? "unplaced";
}

/**
 * The ONE place a row's prose is produced. The wording differs per change kind
 * because the consequences genuinely differ, but every sentence is composed
 * from this row's own fields, so a case cannot quietly start describing a
 * position, pin number or name other than its own.
 */
function driftRowConsequence(row: Omit<ProjectInterfaceDriftRow, "consequence">): string {
  const pin = `pin ${row.position}`;
  const was = row.was;
  const now = row.now;
  switch (row.change) {
    case "same":
      return `Position ${row.position} is unchanged.`;
    case "renamed":
      // There is no cross-file port identity to appeal to (labelId is reminted
      // on every load), so this states the positional fact and nothing more.
      return `Node order is unchanged. The generated .subckt header will name terminal ${row.position} ${now?.name ?? ""} instead of ${was?.name ?? ""}.`;
    case "moved":
      return `Position ${row.position} was ${was?.name ?? ""} and is now ${now?.name ?? ""}. This changes which net becomes which node, so the wire on ${pin} will move.`;
    case "direction":
      return `${now?.name ?? ""} is now ${directionWord(now?.direction ?? "BiDir")}, so ${pin} moves from the ${sideWord(was?.side ?? null)} side to the ${sideWord(now?.side ?? null)} side. Nothing electrical changes.`;
    case "added":
      return `${now?.name ?? ""} is new on the sheet and would become ${pin}.`;
    case "removed":
      return `${was?.name ?? ""} is gone from the sheet, so the wire on ${pin} would be left unconnected.`;
  }
}

/** Plural nouns for the summary, so the count line is also built once. */
const CHANGE_NOUNS: Record<ProjectInterfaceDriftRow["change"], readonly [string, string]> = {
  same: ["unchanged", "unchanged"],
  renamed: ["renamed", "renamed"],
  moved: ["moved", "moved"],
  direction: ["direction change", "direction changes"],
  added: ["added", "added"],
  removed: ["removed", "removed"],
};

const SUMMARY_ORDER: readonly ProjectInterfaceDriftRow["change"][] = [
  "moved", "renamed", "added", "removed", "direction",
];

function driftSummary(
  fileName: string,
  linkPorts: readonly string[],
  nowNames: readonly string[],
  rows: readonly ProjectInterfaceDriftRow[],
  reordered: boolean,
  electricallyInert: boolean,
): string {
  const counts = new Map<ProjectInterfaceDriftRow["change"], number>();
  for (const row of rows) counts.set(row.change, (counts.get(row.change) ?? 0) + 1);
  const parts = SUMMARY_ORDER.flatMap((change) => {
    const count = counts.get(change) ?? 0;
    if (count === 0) return [];
    const [singular, plural] = CHANGE_NOUNS[change];
    return [`${count} ${count === 1 ? singular : plural}`];
  });
  // The reorder headline is loud on purpose: it is the only drift that keeps a
  // legal-looking contract while changing which net becomes which node.
  const headline = reordered
    ? `${fileName} reordered its connections: ${linkPorts.join(", ")} -> ${nowNames.join(", ")}.`
    : `${fileName} changed its interface.`;
  const sentences = [headline];
  if (parts.length > 0) sentences.push(`${parts.join(", ")}.`);
  if (electricallyInert) sentences.push("Nothing electrical changes.");
  return sentences.join(" ");
}

/**
 * Compare a parent's STORED ordered contract against a child sheet's live
 * interface, plus the sides the instance is actually drawn with against the
 * sides the child's directions now imply.
 *
 * Nothing here reconciles anything: the verdict is advice for a human, and a
 * real mismatch is still refused by the compiler with its own words.
 *
 * @param linkPorts the parent's `link.ports`, in emitted node order.
 * @param entry the index entry, or null when the index has not resolved yet.
 * @param sides `current` = the instance's actual bank sides (one per
 *   `linkPorts` entry, read back out of `pinOverride`); `expected` = the sides
 *   the child's live directions imply (one per `entry.ports` entry). Both are
 *   computed by the caller from subcircuitGeometry's single slot rule.
 */
export function projectSheetInterfaceDrift(
  linkPorts: readonly string[],
  entry: ProjectSheetInterfaceEntry | null,
  sides: { current: readonly PortSide[]; expected: readonly PortSide[] },
): ProjectInterfaceDrift {
  if (!entry) return { kind: "not-checked" };
  if (entry.status === "missing") return { kind: "missing-sheet" };
  if (entry.status === "unreadable") {
    return { kind: "sheet-unreadable", reason: entry.reason ?? FALLBACK_UNREADABLE_REASON };
  }
  const sheetPorts = entry.ports ?? [];
  if (entry.status === "no-interface" || sheetPorts.length === 0) return { kind: "no-interface" };

  const foldedLink = linkPorts.map(asciiFold);
  const foldedNow = sheetPorts.map((port) => asciiFold(port.name));
  const sameLength = foldedLink.length === foldedNow.length;
  const namesInOrder = sameLength && foldedLink.every((name, index) => name === foldedNow[index]);
  const sidesAgree = sides.current.length === sides.expected.length
    && sides.current.every((side, index) => side === sides.expected[index]);
  // In-sync is exactly `hasMatchingOrderedProjectPorts` AND identical sides.
  // The property test (B5) pins this equality, because a friendly "fine" that
  // Run then refuses is worse than no indicator at all.
  if (namesInOrder && sidesAgree) return { kind: "in-sync" };

  // A pure permutation is provable exactly, and only when nothing was added or
  // removed; anything else is reported as the positional fact it is.
  const multiset = (names: readonly string[]) => [...names].sort().join("\u0000");
  const reordered = sameLength && !namesInOrder && multiset(foldedLink) === multiset(foldedNow);

  const rows: ProjectInterfaceDriftRow[] = [];
  const positions = Math.max(foldedLink.length, foldedNow.length);
  for (let index = 0; index < positions; index += 1) {
    const hasWas = index < linkPorts.length;
    const hasNow = index < sheetPorts.length;
    const was = hasWas ? { name: linkPorts[index]!, side: sides.current[index] ?? null } : undefined;
    const nowPort = hasNow ? sheetPorts[index]! : undefined;
    const now = nowPort
      ? { name: nowPort.name, direction: nowPort.direction, side: sides.expected[index] ?? null }
      : undefined;
    let change: ProjectInterfaceDriftRow["change"];
    if (!hasNow) change = "removed";
    else if (!hasWas) change = "added";
    else if (foldedLink[index] === foldedNow[index]) {
      change = was!.side === now!.side ? "same" : "direction";
    } else change = reordered ? "moved" : "renamed";
    const partial = { position: index + 1, was, now, change } as Omit<ProjectInterfaceDriftRow, "consequence">;
    rows.push({ ...partial, consequence: driftRowConsequence(partial) });
  }

  const electricallyInert = rows.every((row) => row.change === "same" || row.change === "direction");
  return {
    kind: "drifted",
    rows,
    reordered,
    electricallyInert,
    summary: driftSummary(
      entry.fileName,
      linkPorts,
      sheetPorts.map((port) => port.name),
      rows,
      reordered,
      electricallyInert,
    ),
  };
}

/**
 * The model name a parent gets offered when it links a sheet, so a student
 * never types one. Case is not identity here (every project-link comparison
 * folds ASCII case), so capitalising the stem changes spelling only.
 *
 * Returns NULL rather than sanitizing. `boost-converter.sim` has no default
 * name, and saying so is the point: PROJECT_SPICE_TOKEN is deliberately
 * narrower than ngspice's grammar precisely so a link never depends on a
 * sanitizer quietly renaming an interface behind the user's back.
 */
export function defaultProjectModelName(fileName: string): string | null {
  if (typeof fileName !== "string" || !fileName) return null;
  const leaf = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = /\.tau\.json$/i.test(leaf)
    ? leaf.slice(0, -".tau.json".length)
    : leaf.replace(/\.[^.]*$/, "");
  if (!stem || stem.length > MAX_PROJECT_SUBCIRCUIT_NAME_LENGTH) return null;
  const capitalized = stem.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return PROJECT_SPICE_TOKEN.test(capitalized) ? capitalized : null;
}
