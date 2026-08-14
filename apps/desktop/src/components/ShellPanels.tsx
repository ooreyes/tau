import { Fragment, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import { userFacingErrorMessage } from "../lib/errorMessage";
import {
  ChevronRight,
  Copy,
  File,
  FilePlus,
  FolderOpen,
  Folder,
  FolderPlus,
  FolderInput,
  FileInput,
  FoldVertical,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { componentDisplayName } from "../schematic/componentNames";
import { engineeringSpelling } from "../schematic/engineering";
import { ComponentSymbol } from "../schematic/symbols";
import type { SchematicComponent, SchematicPortDirection, SchematicWire } from "../schematic/types";
import { isPhotodiodePhotocurrentValue, isStaticSwitchValue } from "../schematic/kindGroups";
import {
  decodeParams,
  displayParamField,
  encodeParams,
  fromDisplayParamValue,
  applyLedColorDefault,
  isBoundedParamField,
  paramFields,
  paramRangeLabel,
  paramSummary,
  paramValidationMessage,
  paramValuesValidationMessage,
  toDisplayParamValue,
  type ParamField,
} from "../schematic/params";
import { buildSubcircuitPinOverride, subcircuitBankSides, subcircuitPortSlots } from "../schematic/subcircuitGeometry";
import {
  asciiFold,
  defaultProjectModelName,
  projectSheetInterfaceDrift,
  type PortSide,
  type ProjectInterfaceDrift,
  type ProjectSheetInterfaceEntry,
} from "../schematic/projectSubcircuit";
import { EngineeringInput } from "./EngineeringInput";
import { BehavioralSourceEditor } from "./BehavioralSourceEditor";
import { IndependentSourceEditor } from "./IndependentSourceEditor";
import { Palette } from "./Palette";
import { OPAMP_LIBRARY, findOpAmp } from "../library/opamps";
import { inspectOpampModel, opampIdentity } from "../engine/opampModel";
import { componentModelOptions, isModelComponentKind } from "../engine/componentModelCatalog";
import { hasLtspiceProvenance, idealJunctionModel, type IdealJunctionModel } from "../engine/idealModels";
import { definedModelNames, definedSubcktNames } from "../engine/modelDirectives";
import { bundledSubcircuitBlock, sanitizeSubcktName } from "../engine/bundledSubcircuits";
import { parseUserModelLibraries } from "../engine/userModelLibrary";
import {
  encodeSubcircuitInstanceValue,
  parseSubcircuitInstanceValue,
  subcircuitParameterValue,
  subcircuitOptions,
} from "../engine/subcircuitCatalog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { referenceRenameResult, useSchematic } from "../store/useSchematic";
import { useProject } from "../store/useProject";
import { basename, isAscFile, isProjectFile, type ProjectNode } from "../project/types";
import { projectRelativeSheetPath } from "../schematic/projectSubcircuit";
import { importDroppedFile } from "../io/fileImport";
import { IMPORT_ACCEPT, IMPORT_BUTTON_LABEL } from "../io/importUi";
import { formatEngineering, parseQuantity } from "../simulation/quantity";
import { clampPanelWidth, PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "@/components/ui/resizable";

// Keep the historical ShellPanels entry point stable while the editor chrome
// has a module of its own. App code imports the owning module directly; older
// hosts can continue importing these named exports from ShellPanels.
export { EditorTabs, EditorToolbar } from "./editor/EditorChrome";

/** Drag-to-resize bounds for the two side panels. Minimums keep
 *  every control usable (tree rows, property fields); maximums keep the canvas
 *  from being starved even at the 900px minimum window. */
export const EXPLORER_PANEL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.explorerWidth",
  defaultWidth: 226,
  minWidth: 168,
  maxWidth: 420,
  edge: "right",
};

/** Left inset of the project root row - and therefore the origin every deeper
 *  row steps out from. Written explicitly rather than left to the `<button>`
 *  UA padding (App.css's `.tree-folder-row` sets only `padding-right`), which
 *  differs between the WKWebView and the Chromium capture harness and was half
 *  of why root-level children looked flush with the row that owned them. */
const TREE_ROW_BASE_INDENT = 8;

/** One level of nesting, in px. Has to clear the 13px caret plus its 4px gap
 *  or the step is a rounding error the reader cannot see: the pre-P3-06 tree
 *  stepped by 2px between the root row and its own children, which is why
 *  img-003-005 shows files drawn outside their folder. */
const TREE_INDENT_STEP = 14;

/**
 * Indent for a tree row at `depth`, where depth 0 is the project root row
 * itself and its children are depth 1. `ProjectTree` used to be handed
 * `depth={0}` for the root's children, so they landed on the same 8px as the
 * root row - a child painted at its parent's own inset. Callers must not
 * re-derive this: the guide line's x is published from the same number.
 */
export const treeRowIndent = (depth: number): number =>
  TREE_ROW_BASE_INDENT + depth * TREE_INDENT_STEP;

/* --- P3-04A: the explorer header's pixel budget ---------------------------
 * The header used to be an all-or-nothing swap - App.css hides every primary
 * icon and reveals the ⋯ only inside `@container explorer-shell
 * (max-width: 280px)`. Since the panel ships at 226px, the shipped default hid
 * all five icons and showed a bare `SCHEMATICS ⋯` with ~186px of unused header
 * (evidence img-002-003), while every width above 280px hid the ⋯ instead and
 * left no overflow affordance at all. Both directions are now decided here, in
 * pixels, from `explorerWidth` - which is the width the panel is actually laid
 * out at (it is the inline style on `.explorer-panel`), so no ResizeObserver
 * and no post-layout measurement is needed to get the arithmetic right. */

/** `.explorer-head` padding: 10px left + 8px right (App.css). */
const EXPLORER_HEAD_PADDING = 18;
/** `.explorer-head` flex gap, `var(--sp-2)`. Also the contract's minimum clear
 *  between the ⋯ and the root name, which is why nothing may narrow it. */
const EXPLORER_HEAD_GAP = 8;
/**
 * Every header control is a `--control-hit` square (`.explorer-icons button`).
 *
 * Mirrors the CSS token deliberately rather than measuring the DOM: this number
 * feeds the icon budget below, which has to be computable before layout and in
 * jsdom, where no stylesheet is applied. It was 22px, which failed WCAG 2.2
 * SC 2.5.8's 24px floor; if `--control-hit` changes in App.css this must change
 * with it, and `explorerPrimaryActionCount`'s tests pin the arithmetic either way.
 */
const EXPLORER_ICON_SIZE = 28;
/** Extra clear left of the ⋯ on top of the flex gap. The gap alone lands
 *  exactly on the ≥8px bar, which a subpixel layout can round under. */
const EXPLORER_OVERFLOW_CLEARANCE = 2;
/** Narrowest the root identity may be squeezed to before an icon is dropped
 *  instead. This is the *measured* natural width of the default "SCHEMATICS"
 *  caption, not an invented minimum: in the evidence shot img-002-003 (2x) the
 *  caption's ink spans image columns 22-164, i.e. 71 CSS px at
 *  10px/650/0.06em uppercase; 72 is that plus a pixel of rounding.
 *
 *  It was 56 here first, which is 15px short of the caption it claimed to
 *  measure. The consequence was concrete and shipped-by-default: at the
 *  panel's 226px default the budget then approved all five icons, leaving the
 *  name box 58px and rendering "SCHEMATI…". The user's ask is explicitly
 *  conditional - show the icons "as long as it has decent space from the text
 *  of the folder name" - so the caption wins the tie and the least-essential
 *  icon goes to the ⋯ instead. */
export const EXPLORER_ROOT_NAME_MIN = 72;

/**
 * How many of the header's primary icon buttons fit beside the root name and
 * the always-present ⋯.
 *
 * Fails OPEN by design: an unmeasured, zero, or non-finite width returns every
 * action. jsdom computes no layout, and a host that renders the panel without a
 * width must not end up with an empty header - that would silently remove
 * controls a dozen callers reach for by accessible name.
 */
export function explorerPrimaryActionCount(explorerWidth: number, total: number): number {
  if (!Number.isFinite(explorerWidth) || explorerWidth <= 0) return total;
  const budget = explorerWidth
    - EXPLORER_HEAD_PADDING
    - EXPLORER_ROOT_NAME_MIN
    - (EXPLORER_ICON_SIZE + EXPLORER_OVERFLOW_CLEARANCE)
    // Both gaps are charged even at a count of zero, where the icon group
    // stops being a flex item and one gap disappears. Conservative by 8px,
    // never optimistic - the row must not be allowed to overflow.
    - EXPLORER_HEAD_GAP * 2;
  return Math.max(0, Math.min(total, Math.floor(budget / EXPLORER_ICON_SIZE)));
}

export interface ExplorerHeaderLayout {
  /** Inner width the three header groups share (panel width less padding). */
  innerWidth: number;
  visibleActions: number;
  /** What is left for the root-name span - the only flexible item in the row,
   *  so this staying at or above EXPLORER_ROOT_NAME_MIN is what proves the
   *  header does not overflow and the name is not squeezed to an ellipsis. */
  rootNameWidth: number;
  /** Clear between the root-name box and the ⋯ trigger. P3-04A's contract is
   *  ≥ 8px, measured natively by scripts/pdf3-verify.mjs as
   *  `trigger.left - rootName.right`; this is the same quantity derived from
   *  the widths that produce it. */
  overflowGap: number;
}

/**
 * The header geometry the browser will lay out for a given panel width.
 *
 * jsdom evaluates no CSS, so `getBoundingClientRect` there is all zeros and the
 * contract's measured numbers cannot be read out of a unit test. This derives
 * them from the same constants the stylesheet uses, which makes the ≥8px clear
 * and the no-overflow invariant assertable and non-circular; the native pass
 * re-measures both against real pixels. Expects a finite, laid-out width -
 * `explorerPrimaryActionCount` is where the unmeasured case fails open.
 */
export function explorerHeaderLayout(explorerWidth: number, total: number): ExplorerHeaderLayout {
  const visibleActions = explorerPrimaryActionCount(explorerWidth, total);
  const innerWidth = explorerWidth - EXPLORER_HEAD_PADDING;
  const actionsWidth = visibleActions * EXPLORER_ICON_SIZE;
  // A zero-count action group is not rendered at all, so it is not a flex item
  // and one of the two gaps disappears with it.
  const gaps = visibleActions > 0 ? EXPLORER_HEAD_GAP * 2 : EXPLORER_HEAD_GAP;
  const triggerWidth = EXPLORER_ICON_SIZE + EXPLORER_OVERFLOW_CLEARANCE;
  return {
    innerWidth,
    visibleActions,
    rootNameWidth: innerWidth - actionsWidth - gaps - triggerWidth,
    overflowGap: gaps + actionsWidth + EXPLORER_OVERFLOW_CLEARANCE,
  };
}

export const COMPONENTS_RAIL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.componentsRailWidth",
  defaultWidth: 264,
  minWidth: 208,
  maxWidth: 480,
  edge: "left",
};

/**
 * How wide the parts rail actually renders.
 *
 * The rail floats over the right of the stage, so anything else anchored to
 * the stage's right edge has to know this number or it renders underneath it -
 * which is exactly what happened to the canvas zoom cluster: the +, - and fit
 * buttons were mounted and hit-testable, and completely covered by the rail.
 * Exported so App can publish it to CSS instead of the two places guessing.
 */
export const componentsRailMaxWidth = (maxWidth?: number): number => Math.max(
  COMPONENTS_RAIL_WIDTH.minWidth,
  Math.min(COMPONENTS_RAIL_WIDTH.maxWidth, maxWidth ?? COMPONENTS_RAIL_WIDTH.maxWidth),
);

export const componentsRailWidth = (width: number, maxWidth?: number): number =>
  clampPanelWidth(width, COMPONENTS_RAIL_WIDTH.minWidth, componentsRailMaxWidth(maxWidth));


/**
 * Persistence contract for Explorer drag/drop. This is intentionally a move
 * operation, not `renameNode`: the project layer updates the source path,
 * destination directory, virtual-workspace metadata, and refreshed tree as
 * one operation.
 */
export type MoveProjectNode = (
  sourcePath: string,
  destinationDirectoryPath: string,
) => Promise<string | null>;

export type RenameProjectNode = (
  sourcePath: string,
  newName: string,
) => Promise<string | null>;

function normalizedExplorerPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function explorerParentPath(path: string): string {
  const normalized = normalizedExplorerPath(path);
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : "";
}

function explorerRelativePath(rootPath: string, path: string): string {
  const root = normalizedExplorerPath(rootPath);
  const target = normalizedExplorerPath(path);
  if (target === root) return ".";
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target;
}

async function copyExplorerText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand?.("copy") ?? false;
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function canMoveProjectNode(sourcePath: string, destinationDirectoryPath: string): boolean {
  const source = normalizedExplorerPath(sourcePath);
  const destination = normalizedExplorerPath(destinationDirectoryPath);
  return Boolean(
    source
    && destination
    && source !== destination
    && explorerParentPath(source) !== destination
    && !destination.startsWith(`${source}/`)
  );
}

const PROJECT_NODE_DRAG_TYPE = "application/x-tau-project-node";

function dragPayloadPath(dataTransfer: DataTransfer | null | undefined): string {
  if (!dataTransfer) return "";
  // getData() is empty during dragover in Chromium/WebKit; types stay visible.
  try {
    return dataTransfer.getData(PROJECT_NODE_DRAG_TYPE) || dataTransfer.getData("text/plain") || "";
  } catch {
    return "";
  }
}

function dataTransferHasProjectNode(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes(PROJECT_NODE_DRAG_TYPE) || types.includes("text/plain");
}

function findProjectNode(nodes: readonly ProjectNode[], path: string): ProjectNode | null {
  const normalized = normalizedExplorerPath(path);
  for (const node of nodes) {
    if (normalizedExplorerPath(node.path) === normalized) return node;
    const nested = node.children ? findProjectNode(node.children, normalized) : null;
    if (nested) return nested;
  }
  return null;
}

interface ProjectSheetChoice {
  path: string;
  label: string;
}

/**
 * Flatten the project sheets a block may point at.
 *
 * Every sheet the project lists, `.asc` included. An LTspice sheet is a legal
 * TARGET - it states its ports as a `FLAG` plus an adjacent `IOPIN <dir>`, and
 * the compiler derives the interface from those markers - so withholding it here
 * left that whole half of the feature unreachable: the engine would compile a
 * `.asc` child the picker refused to offer.
 *
 * The asymmetry with {@link ProjectSubcircuitLinkEditor}'s refusal is deliberate
 * and is not a contradiction: a `.asc` may be pointed AT, but may not be the
 * sheet doing the pointing, because it can record neither the link nor the pin
 * order. That second question is asked by `canonicalProjectOwnerPath`.
 */
function projectSheetChoices(
  nodes: readonly ProjectNode[],
  projectRoot: string | null,
  currentPath: string | null,
): ProjectSheetChoice[] {
  if (!projectRoot) return [];
  const currentRelative = currentPath ? projectRelativeSheetPath(projectRoot, currentPath) : null;
  const choices: ProjectSheetChoice[] = [];
  const visit = (items: readonly ProjectNode[]) => {
    for (const node of items) {
      if (node.kind === "dir") {
        visit(node.children ?? []);
        continue;
      }
      // `.asc` included: an LTspice sheet is a legal TARGET for a block, since
      // it states its ports as a `FLAG` plus an adjacent `IOPIN <dir>` and the
      // compiler derives the interface from those markers. Filtering to `.sim`
      // here left that whole half of the feature unreachable - the engine would
      // happily compile a `.asc` child that the picker refused to offer.
      //
      // The asymmetry is deliberate and is NOT a bug: a `.asc` may be pointed
      // AT, but may not be the sheet doing the pointing, because the format can
      // record neither the link nor the port order. That second question is
      // asked elsewhere, by `canonicalProjectOwnerPath`.
      if (!isProjectFile(node.name)) continue;
      const relative = projectRelativeSheetPath(projectRoot, node.path);
      if (!relative || relative === currentRelative) continue;
      choices.push({ path: relative, label: node.name });
    }
  };
  visit(nodes);
  return choices.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function ExplorerPanel({
  activeFilePath,
  onOpenSimFile,
  onOpenAscText,
  onNotice,
  onMoveNode,
  onRenameNode,
  maxWidth,
}: {
  activeFilePath: string | null;
  onOpenSimFile: (path: string, title: string, json: string) => void;
  onOpenAscText: (path: string, title: string, text: string, extraWarnings?: string[]) => void | Promise<void>;
  onNotice: (message: string) => void;
  /** Atomic project-store move action; optional only for isolated panel hosts. */
  onMoveNode?: MoveProjectNode;
  /** Rename action supplied by App so open tabs follow the new disk path. */
  onRenameNode?: RenameProjectNode;
  /** Responsive ceiling supplied by the shell after reserving the editor and
   *  whichever right-side panel is visible. */
  maxWidth?: number;
}) {
  const rootPath = useProject((s) => s.rootPath);
  const rootName = useProject((s) => s.rootName);
  const tree = useProject((s) => s.tree);
  const expanded = useProject((s) => s.expanded);
  const error = useProject((s) => s.error);
  const capability = useProject((s) => s.capability);
  const detectCapability = useProject((s) => s.detectCapability);
  const openFolder = useProject((s) => s.openFolder);
  const newProject = useProject((s) => s.newProject);
  const refresh = useProject((s) => s.refresh);
  const toggleExpanded = useProject((s) => s.toggleExpanded);
  const collapseAll = useProject((s) => s.collapseAll);
  const createFolder = useProject((s) => s.createFolder);
  const createSchematicFile = useProject((s) => s.createSchematicFile);
  const deleteNode = useProject((s) => s.deleteNode);
  const renameNodeInStore = useProject((s) => s.renameNode);
  const readSim = useProject((s) => s.readSim);
  const ascInputRef = useRef<HTMLInputElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [createDraft, setCreateDraft] = useState<{
    kind: "file" | "folder";
    parentPath: string;
    name: string;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ node: ProjectNode; name: string } | null>(null);
  const [draggedNode, setDraggedNode] = useState<ProjectNode | null>(null);
  // Drag events can reach dragover/drop before React commits setDraggedNode.
  // Keep a synchronous source and also write the path into dataTransfer so a
  // rerender (for example, creating the destination folder) cannot lose it.
  const draggedNodeRef = useRef<ProjectNode | null>(null);
  // True between `dragstart` and `dragend`. The pointer fallback consults it so
  // a late `pointercancel` cannot tear down a native drag mid-flight.
  const nativeDragActiveRef = useRef(false);
  const pointerDragRef = useRef<{
    node: ProjectNode;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const suppressClickPathRef = useRef<string | null>(null);
  const collapseSnapshotRef = useRef<{ rootPath: string; expanded: string[] } | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const explorerWidthConfig = {
    ...EXPLORER_PANEL_WIDTH,
    maxWidth: Math.max(
      EXPLORER_PANEL_WIDTH.minWidth,
      Math.min(EXPLORER_PANEL_WIDTH.maxWidth, maxWidth ?? EXPLORER_PANEL_WIDTH.maxWidth),
    ),
  };
  const resize = usePanelWidth(explorerWidthConfig);
  const explorerWidth = clampPanelWidth(
    resize.width,
    explorerWidthConfig.minWidth,
    explorerWidthConfig.maxWidth,
  );
  const resizeHandle = (
    <PanelResizeHandle
      edge="right"
      label="Resize project explorer"
      width={explorerWidth}
      minWidth={EXPLORER_PANEL_WIDTH.minWidth}
      maxWidth={explorerWidthConfig.maxWidth}
      dragging={resize.dragging}
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
    />
  );

  useEffect(() => {
    void detectCapability();
  }, [detectCapability]);

  useEffect(() => {
    // A restoration set belongs to one project. Never let a project switch
    // restore folders from the previous root.
    collapseSnapshotRef.current = null;
  }, [rootPath]);

  const openNode = async (path: string, name: string) => {
    try {
      const text = await readSim(path);
      if (isAscFile(name)) await onOpenAscText(path, name, text);
      else onOpenSimFile(path, name, text);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Could not open file.");
    }
  };

  useEffect(() => {
    if (!createDraft) return;
    createInputRef.current?.focus();
    createInputRef.current?.select();
  }, [createDraft?.kind, createDraft?.parentPath]);

  const commitCreateDraft = async () => {
    if (!createDraft) return;
    const draft = createDraft;
    const name = draft.name.trim();
    if (!name) return;
    setCreateDraft(null);
    if (draft.kind === "folder") {
      const path = await createFolder(draft.parentPath, name);
      if (path) onNotice(`Created ${name}`);
      return;
    }
    const path = await createSchematicFile(draft.parentPath, name);
    if (path) {
      onNotice(`Created ${basename(path)}`);
      await openNode(path, basename(path));
    }
  };

  const commitRenameDraft = async () => {
    if (!renameDraft) return;
    const draft = renameDraft;
    const name = draft.name.trim();
    if (!name) return;
    setRenameDraft(null);
    const rename = onRenameNode ?? renameNodeInStore;
    const renamedPath = await rename(draft.node.path, name);
    if (renamedPath) onNotice(`Renamed to ${basename(renamedPath)}`);
    else onNotice(useProject.getState().error ?? `Could not rename ${draft.node.name}.`);
  };

  const copyNodePath = async (path: string, relative: boolean) => {
    if (!rootPath) return;
    const value = relative ? explorerRelativePath(rootPath, path) : path;
    try {
      await copyExplorerText(value);
      onNotice(relative ? "Copied relative path." : "Copied path.");
    } catch (error) {
      onNotice(userFacingErrorMessage(error, "Could not copy path."));
    }
  };

  const importFileFromInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await runFileImport(file);
  };

  /** Shared by the header's file input and drag-and-drop onto the tree - see
   *  `io/fileImport.ts` for format detection, conversion, and persistence. */
  const runFileImport = async (file: File) => {
    const outcome = await importDroppedFile(file, { hasActiveSchematic: Boolean(activeFilePath) });
    if (outcome.kind === "error") {
      onNotice(outcome.message);
      return;
    }
    if (outcome.kind === "model-library") {
      onNotice(`Attached ${outcome.name}`);
      return;
    }
    onNotice(`Imported ${basename(outcome.path)}`);
    if (outcome.warnings.length > 0) {
      await onOpenAscText(outcome.path, basename(outcome.path), outcome.text, outcome.warnings);
    } else {
      await onOpenAscText(outcome.path, basename(outcome.path), outcome.text);
    }
  };

  const beginNodeDrag = (event: DragEvent<HTMLElement>, node: ProjectNode) => {
    // Now that the rows are `draggable`, the native drag is the preferred path
    // and the pointer fallback must get out of its way. Capture was taken at
    // pointerdown - before the engine decided to start a drag - so hand it back
    // and forget the gesture, or `updatePointerDrag` keeps preventDefault-ing
    // moves underneath a live native drag.
    const pointerDrag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (pointerDrag) {
      try {
        event.currentTarget.releasePointerCapture?.(pointerDrag.pointerId);
      } catch {
        // Capture may already have been lost (engine-dependent); nothing to undo.
      }
    }
    nativeDragActiveRef.current = true;
    draggedNodeRef.current = node;
    setDraggedNode(node);
    setDropTargetPath(null);
    event.dataTransfer.effectAllowed = "move";
    // text/plain is required for WKWebView/Tauri to keep the drag alive;
    // the custom type is the authoritative payload on drop.
    event.dataTransfer.setData(PROJECT_NODE_DRAG_TYPE, node.path);
    event.dataTransfer.setData("text/plain", node.path);
    event.stopPropagation();
  };

  const endNodeDrag = () => {
    nativeDragActiveRef.current = false;
    draggedNodeRef.current = null;
    setDraggedNode(null);
    setDropTargetPath(null);
  };

  const pointerDestination = (event: PointerEvent<HTMLElement>): string | null => {
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-project-dir-path]");
    return target?.dataset.projectDirPath ?? null;
  };

  const beginPointerDrag = (event: PointerEvent<HTMLElement>, node: ProjectNode) => {
    if (event.button !== 0) return;
    pointerDragRef.current = {
      node,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updatePointerDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) {
      drag.dragging = true;
      draggedNodeRef.current = drag.node;
      setDraggedNode(drag.node);
    }
    if (!drag.dragging) return;
    event.preventDefault();
    const destination = pointerDestination(event);
    setDropTargetPath(destination && canMoveProjectNode(drag.node.path, destination) ? destination : null);
  };

  const finishPointerDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (!drag || drag.pointerId !== event.pointerId || !drag.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickPathRef.current = drag.node.path;
    window.setTimeout(() => {
      if (suppressClickPathRef.current === drag.node.path) suppressClickPathRef.current = null;
    }, 0);
    const destination = pointerDestination(event);
    if (destination && canMoveProjectNode(drag.node.path, destination)) {
      void moveDraggedNode(destination);
    } else {
      endNodeDrag();
    }
  };

  const cancelPointerDrag = () => {
    pointerDragRef.current = null;
    // Starting a native drag is itself a reason engines fire `pointercancel`,
    // and the ordering relative to `dragstart` is engine-dependent. A cancel
    // that lands after dragstart must not clear the source: markDropTarget
    // would then see `source === null`, treat any dataTransfer carrying our
    // MIME type as valid, and highlight targets canMoveProjectNode had never
    // approved. `dragend` is what ends a native drag.
    if (nativeDragActiveRef.current) return;
    endNodeDrag();
  };

  const consumeSuppressedClick = (path: string): boolean => {
    if (suppressClickPathRef.current !== path) return false;
    suppressClickPathRef.current = null;
    return true;
  };

  const clearDropTarget = () => setDropTargetPath(null);

  const dragSource = (event?: DragEvent<HTMLElement>): ProjectNode | null => {
    // Prefer the live ref during dragover (getData is empty until drop).
    const fromRef = draggedNodeRef.current ?? draggedNode;
    if (fromRef) return fromRef;
    const payloadPath = dragPayloadPath(event?.dataTransfer);
    return payloadPath ? findProjectNode(tree, payloadPath) : null;
  };

  const moveDraggedNode = async (destinationDirectoryPath: string, event?: DragEvent<HTMLElement>) => {
    const source = dragSource(event);
    endNodeDrag();
    if (!source || !canMoveProjectNode(source.path, destinationDirectoryPath)) return;
    if (!onMoveNode) {
      onNotice("Moving explorer items needs a project move action.");
      return;
    }
    try {
      const movedPath = await onMoveNode(source.path, destinationDirectoryPath);
      if (movedPath) {
        onNotice(`Moved ${source.name}`);
      } else {
        onNotice(useProject.getState().error ?? `Could not move ${source.name}.`);
      }
    } catch (err) {
      onNotice(err instanceof Error ? err.message : `Could not move ${source.name}.`);
    }
  };

  const startNewSchematic = () => {
    if (!rootPath) return;
    if (!expanded.includes(rootPath)) toggleExpanded(rootPath);
    // `.sim`, not `.asc`: LTspice's format can persist neither a sheet block's
    // link nor its port order (see canonicalProjectOwnerPath), so seeding `.asc`
    // handed the reader a brand-new sheet that could never own a block.
    setCreateDraft({ kind: "file", parentPath: rootPath, name: "untitled.sim" });
  };

  const startNewFolder = () => {
    if (!rootPath) return;
    if (!expanded.includes(rootPath)) toggleExpanded(rootPath);
    setCreateDraft({ kind: "folder", parentPath: rootPath, name: "New Folder" });
  };

  const refreshExplorer = async () => {
    const ok = await refresh();
    if (ok) onNotice("Explorer refreshed.");
  };

  const toggleCollapseFolders = () => {
    if (!rootPath) return;
    const snapshot = collapseSnapshotRef.current;
    // Restore only while the tree is still as this button left it. Once the
    // reader has opened a folder themselves the button's job is to collapse
    // again: restoring at that point would discard the folder they just
    // opened and reinstate a set they had already moved on from.
    if (snapshot?.rootPath === rootPath && expanded.length === 0) {
      collapseSnapshotRef.current = null;
      useProject.setState({ expanded: snapshot.expanded });
      return;
    }
    if (expanded.length === 0) return;
    collapseSnapshotRef.current = { rootPath, expanded: [...expanded] };
    collapseAll();
  };

  const collapseRestorationAvailable =
    collapseSnapshotRef.current?.rootPath === rootPath && expanded.length === 0;
  const collapseActionLabel = collapseRestorationAvailable
    ? "Restore expanded folders in explorer"
    : "Collapse folders in explorer";

  const markDropTarget = (event: DragEvent<HTMLElement>, destinationDirectoryPath: string) => {
    const source = dragSource(event);
    // During dragover, getData is empty - accept if the MIME type is present
    // or we already know the dragged node from dragstart.
    const looksLikeInternalDrag = Boolean(source) || dataTransferHasProjectNode(event.dataTransfer);
    if (!looksLikeInternalDrag) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    if (source && !canMoveProjectNode(source.path, destinationDirectoryPath)) {
      event.dataTransfer.dropEffect = "none";
      setDropTargetPath(null);
      // The innermost row under the cursor owns the verdict. Without this the
      // refusal bubbled to `.tree-list`, which offered the project root
      // instead: hovering a file over the folder it already lives in lit the
      // root and reported dropEffect "move", while the row's own onDrop still
      // refused - the cursor promised a move that could not happen.
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetPath(destinationDirectoryPath);
  };

  if (!rootPath) {
    return (
      <aside className="explorer-panel" aria-label="Project explorer" style={{ width: explorerWidth }}>
        <div className="explorer-head">
          <span>Schematics</span>
          <div className="explorer-icons">
            <button
              type="button"
              title="Open Schematics folder"
              aria-label="Open Schematics folder"
              onClick={async () => {
                const ok = await openFolder();
                if (ok) onNotice("Opened Schematics folder.");
              }}
            >
              <FolderInput size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
            {capability === "tauri" && (
              <button
                type="button"
                title="Create Schematics folder"
                aria-label="Create Schematics folder"
                onClick={async () => {
                  const ok = await newProject("Schematics");
                  if (ok) onNotice("Created Schematics folder.");
                }}
              >
                <FolderPlus size={16} strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              title={IMPORT_BUTTON_LABEL}
              aria-label={IMPORT_BUTTON_LABEL}
              onClick={() => ascInputRef.current?.click()}
            >
              <FileInput size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
        </div>
        <input
          ref={ascInputRef}
          className="file-input"
          type="file"
          accept={IMPORT_ACCEPT}
          title={IMPORT_BUTTON_LABEL}
          onChange={importFileFromInput}
        />
        <div className="explorer-empty">
          <p className="explorer-empty-hint">Choose, create, or import a Schematics folder from the toolbar.</p>
        </div>
        {resizeHandle}
      </aside>
    );
  }

  // Ordered most- to least-essential: the tail is what leaves the header first
  // as the panel narrows. Every icon is exactly 22px, so P3-04A's "widest-first"
  // has no width to sort by and becomes a priority order - "New schematic file"
  // is the reason this header exists, "Collapse" is one menu click away.
  const primaryActions = [
    <button
      key="new-file"
      type="button"
      title="New schematic file"
      aria-label="New schematic file"
      onClick={startNewSchematic}
    >
      <FilePlus size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>,
    <button
      key="new-folder"
      type="button"
      title="New folder"
      aria-label="New folder"
      onClick={startNewFolder}
    >
      <FolderPlus size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>,
    <button
      key="import"
      type="button"
      title={IMPORT_BUTTON_LABEL}
      aria-label={IMPORT_BUTTON_LABEL}
      onClick={() => ascInputRef.current?.click()}
    >
      <FileInput size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>,
    <button
      key="refresh"
      type="button"
      title="Refresh explorer"
      aria-label="Refresh explorer"
      onClick={() => void refreshExplorer()}
    >
      <RefreshCw size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>,
    <button
      key="collapse"
      type="button"
      title={collapseActionLabel}
      aria-label={collapseActionLabel}
      aria-pressed={collapseRestorationAvailable}
      onClick={toggleCollapseFolders}
    >
      <FoldVertical size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>,
  ];
  const visiblePrimaryActions = primaryActions.slice(
    0,
    explorerPrimaryActionCount(explorerWidth, primaryActions.length),
  );

  return (
    <aside className="explorer-panel" aria-label="Project explorer" style={{ width: explorerWidth }}>
      <div className="explorer-head">
        <span className="explorer-root-name">{rootName ?? "Schematics"}</span>
        {visiblePrimaryActions.length > 0 && (
          <div className="explorer-icons explorer-primary-actions" aria-label="Explorer actions">
            {visiblePrimaryActions}
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="explorer-overflow-trigger"
              title="More explorer actions"
              aria-label="More explorer actions"
            >
              <MoreHorizontal size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="explorer-overflow-menu">
            <DropdownMenuItem onSelect={startNewSchematic}>
              <FilePlus size={16} strokeWidth={1.6} aria-hidden="true" />
              New schematic file
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={startNewFolder}>
              <FolderPlus size={16} strokeWidth={1.6} aria-hidden="true" />
              New folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ascInputRef.current?.click()}>
              <FileInput size={16} strokeWidth={1.6} aria-hidden="true" />
              {IMPORT_BUTTON_LABEL}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void refreshExplorer()}>
              <RefreshCw size={16} strokeWidth={1.6} aria-hidden="true" />
              Refresh explorer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleCollapseFolders}>
              <FoldVertical size={16} strokeWidth={1.6} aria-hidden="true" />
              {collapseActionLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input
        ref={ascInputRef}
        className="file-input"
        type="file"
        accept={IMPORT_ACCEPT}
        title={IMPORT_BUTTON_LABEL}
        onChange={importFileFromInput}
      />

      <p id="explorer-drag-help" className="sr-only">
        Drag a file or folder onto another folder, or onto the visible project root row, to move it.
      </p>

      <div
        className="tree-list"
        data-project-dir-path={rootPath}
        data-drop-target={dropTargetPath === rootPath || undefined}
        onDragOver={(event) => markDropTarget(event, rootPath)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetPath(null);
        }}
        onDrop={(event) => {
          const source = dragSource(event);
          if (!source || !canMoveProjectNode(source.path, rootPath)) return;
          event.preventDefault();
          event.stopPropagation();
          void moveDraggedNode(rootPath, event);
        }}
      >
        {/* The project root is a folder with children like any other, so it
            gets the same `.tree-dir` wrapper - otherwise the one relationship
            the reader looks at first (root → its own children, which is exactly
            what img-003-005 crops) is the only one with no guide line. No
            `data-project-dir-path` here: `.tree-list` already carries it, and a
            second copy would only give `pointerDestination`'s closest() a
            nearer element resolving to the same path. */}
        <div
          className="tree-dir tree-project-root-dir"
          style={{ "--tree-indent": `${treeRowIndent(0)}px` } as CSSProperties}
          data-open={expanded.includes(rootPath) || undefined}
        >
        <button
          type="button"
          className="tree-folder-row tree-project-root-row"
          // Depth 0. Stated explicitly so the origin of the whole indent
          // ladder is not a UA default that differs per engine.
          style={{ paddingLeft: treeRowIndent(0) }}
          data-drop-target={dropTargetPath === rootPath || undefined}
          aria-label={`Project root ${rootName ?? "Schematics"}; drop files or folders here`}
          aria-describedby="explorer-drag-help"
          title="Project root - drop files or folders here; click to collapse or expand"
          aria-expanded={expanded.includes(rootPath)}
          onClick={() => toggleExpanded(rootPath)}
          onDragOver={(event) => markDropTarget(event, rootPath)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDropTarget();
          }}
          onDrop={(event) => {
            const source = dragSource(event);
            if (!source || !canMoveProjectNode(source.path, rootPath)) return;
            event.preventDefault();
            event.stopPropagation();
            void moveDraggedNode(rootPath, event);
          }}
        >
          <span className={`tree-caret${expanded.includes(rootPath) ? " open" : ""}`} aria-hidden="true">
            <ChevronRight size={13} strokeWidth={1.6} />
          </span>
          <FolderOpen className="tree-folder-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="tree-folder">{rootName ?? "Schematics"}</span>
          <span className="tree-project-root-kind" aria-hidden="true">Project root</span>
        </button>
        {createDraft && (
          <div className="tree-create-row" data-kind={createDraft.kind}>
            <span className="tree-create-icon" aria-hidden="true">
              {createDraft.kind === "folder"
                ? <FolderPlus size={14} strokeWidth={1.6} />
                : <FilePlus size={14} strokeWidth={1.6} />}
            </span>
            <input
              ref={createInputRef}
              value={createDraft.name}
              aria-label={createDraft.kind === "folder" ? "New folder name" : "New schematic name"}
              spellCheck={false}
              onChange={(event) => setCreateDraft({ ...createDraft, name: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitCreateDraft();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setCreateDraft(null);
                }
              }}
              onBlur={() => setCreateDraft(null)}
            />
          </div>
        )}
        {expanded.includes(rootPath) && (
          <ProjectTree
            nodes={tree}
            // The root row is depth 0, so its own children are depth 1. This
            // used to be 0, which drew a root-level file at the root row's own
            // 8px inset - the "files do not look nested" report (img-003-005).
            depth={1}
            parentDirectoryPath={rootPath}
            expanded={expanded}
            activeFilePath={activeFilePath}
            onToggle={toggleExpanded}
            onOpenFile={openNode}
            onNewFolder={async (parent) => {
              setCreateDraft({ kind: "folder", parentPath: parent, name: "New Folder" });
            }}
            onNewFile={async (parent) => {
              // Same `.sim` default as the header's New schematic file action.
              setCreateDraft({ kind: "file", parentPath: parent, name: "untitled.sim" });
            }}
            onDelete={async (path, name) => {
              if (!window.confirm(`Delete “${name}”?`)) return;
              await deleteNode(path);
              onNotice(`Deleted ${name}`);
            }}
            renameDraft={renameDraft}
            onBeginRename={(node) => setRenameDraft({ node, name: node.name })}
            onRenameDraftChange={(name) => setRenameDraft((draft) => draft ? { ...draft, name } : null)}
            onCommitRename={() => { void commitRenameDraft(); }}
            onCancelRename={() => setRenameDraft(null)}
            onCopyPath={(path, relative) => { void copyNodePath(path, relative); }}
            draggedPath={draggedNode?.path ?? null}
            dropTargetPath={dropTargetPath}
            onDragStart={beginNodeDrag}
            onDragEnd={endNodeDrag}
            onDragOverFolder={markDropTarget}
            onDragLeaveFolder={clearDropTarget}
            onDropFolder={(event, destination) => { void moveDraggedNode(destination, event); }}
            onPointerDragStart={beginPointerDrag}
            onPointerDragMove={updatePointerDrag}
            onPointerDragEnd={finishPointerDrag}
            onPointerDragCancel={cancelPointerDrag}
            onConsumeSuppressedClick={consumeSuppressedClick}
          />
        )}
        </div>
      </div>

      {error && <p className="explorer-error" role="alert">{error}</p>}
      {resizeHandle}
    </aside>
  );
}

function ProjectNodeContextActions({
  node,
  onNewFolder,
  onNewFile,
  onBeginRename,
  onCopyPath,
  onDelete,
}: {
  node: ProjectNode;
  onNewFolder: (parent: string) => void;
  onNewFile: (parent: string) => void;
  onBeginRename: (node: ProjectNode) => void;
  onCopyPath: (path: string, relative: boolean) => void;
  onDelete: (path: string, name: string) => void;
}) {
  return (
    <ContextMenuContent className="explorer-context-menu">
      {node.kind === "dir" && (
        <>
          <ContextMenuItem onSelect={() => onNewFile(node.path)}>
            <FilePlus aria-hidden="true" /> New File…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onNewFolder(node.path)}>
            <FolderPlus aria-hidden="true" /> New Folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={() => onCopyPath(node.path, false)}>
        <Copy aria-hidden="true" /> Copy Path
        <ContextMenuShortcut>⌥⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onCopyPath(node.path, true)}>
        <Copy aria-hidden="true" /> Copy Relative Path
        <ContextMenuShortcut>⌥⇧⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onBeginRename(node)}>
        <Pencil aria-hidden="true" /> Rename…
        <ContextMenuShortcut>↩</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onSelect={() => onDelete(node.path, node.name)}>
        <Trash2 aria-hidden="true" /> Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function ProjectTree({
  nodes,
  depth,
  parentDirectoryPath,
  expanded,
  activeFilePath,
  onToggle,
  onOpenFile,
  onNewFolder,
  onNewFile,
  onDelete,
  renameDraft,
  onBeginRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onCopyPath,
  draggedPath,
  dropTargetPath,
  onDragStart,
  onDragEnd,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragEnd,
  onPointerDragCancel,
  onConsumeSuppressedClick,
}: {
  nodes: ProjectNode[];
  depth: number;
  /** Directory that owns these nodes - used when dropping onto a file row. */
  parentDirectoryPath: string;
  expanded: string[];
  activeFilePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onNewFolder: (parent: string) => void;
  onNewFile: (parent: string) => void;
  onDelete: (path: string, name: string) => void;
  renameDraft: { node: ProjectNode; name: string } | null;
  onBeginRename: (node: ProjectNode) => void;
  onRenameDraftChange: (name: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onCopyPath: (path: string, relative: boolean) => void;
  draggedPath: string | null;
  dropTargetPath: string | null;
  onDragStart: (event: DragEvent<HTMLElement>, node: ProjectNode) => void;
  onDragEnd: () => void;
  onDragOverFolder: (event: DragEvent<HTMLElement>, destinationDirectoryPath: string) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (event: DragEvent<HTMLElement>, destinationDirectoryPath: string) => void;
  onPointerDragStart: (event: PointerEvent<HTMLElement>, node: ProjectNode) => void;
  onPointerDragMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerDragEnd: (event: PointerEvent<HTMLElement>) => void;
  onPointerDragCancel: () => void;
  onConsumeSuppressedClick: (path: string) => boolean;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "dir") {
          const open = expanded.includes(node.path);
          const isDropTarget = dropTargetPath === node.path;
          return (
            <div
              key={node.path}
              className="tree-dir"
              // The vertical nesting guide is a ::before on this wrapper, and it
              // hangs from the centre of THIS row's caret. Publishing the row's
              // own indent as a custom property keeps the line and the padding
              // on one source of truth - hardcoding the x in CSS would silently
              // desync the moment TREE_INDENT_STEP changes. `data-open` gates
              // the guide so a collapsed folder does not draw a stub.
              style={{ "--tree-indent": `${treeRowIndent(depth)}px` } as CSSProperties}
              data-open={open || undefined}
              data-project-dir-path={node.path}
              data-drop-target={isDropTarget || undefined}
              onDragOver={(event) => onDragOverFolder(event, node.path)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeaveFolder();
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDropFolder(event, node.path);
              }}
            >
              {renameDraft?.node.path === node.path ? (
                <div className="tree-folder-row" style={{ paddingLeft: treeRowIndent(depth) }}>
                  <span className={`tree-caret${open ? " open" : ""}`} aria-hidden="true">
                    <ChevronRight size={13} strokeWidth={1.6} />
                  </span>
                  {open
                    ? <FolderOpen className="tree-folder-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
                    : <Folder className="tree-folder-icon" size={14} strokeWidth={1.5} aria-hidden="true" />}
                  <input
                    className="tree-rename-input"
                    value={renameDraft.name}
                    aria-label={`Rename ${node.name}`}
                    autoFocus
                    onChange={(event) => onRenameDraftChange(event.currentTarget.value)}
                    onBlur={onCommitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onCommitRename();
                      if (event.key === "Escape") onCancelRename();
                    }}
                  />
                </div>
              ) : (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    className="tree-folder-row"
                    style={{ paddingLeft: treeRowIndent(depth) }}
                    // P3-02. Without this the whole native protocol below is
                    // dead code - a `<button>` never fires `dragstart` unless it
                    // is draggable - and App.css's `[draggable="true"]` grab
                    // cursor and `-webkit-user-drag: element` never match, which
                    // is also why the row offered no affordance at all. Keep it
                    // the literal `true` React renders for a `true` value.
                    draggable
                    data-dragging={draggedPath === node.path || undefined}
                    aria-grabbed={draggedPath === node.path}
                    data-drop-target={isDropTarget || undefined}
                    aria-describedby="explorer-drag-help"
                    title={`Drag ${node.name} onto another folder to move it`}
                    onClick={() => {
                      if (!onConsumeSuppressedClick(node.path)) onToggle(node.path);
                    }}
                    onPointerDown={(event) => onPointerDragStart(event, node)}
                    onPointerMove={onPointerDragMove}
                    onPointerUp={onPointerDragEnd}
                    onPointerCancel={onPointerDragCancel}
                    onDragStart={(event) => onDragStart(event, node)}
                    onDragEnd={onDragEnd}
                    onDragOver={(event) => onDragOverFolder(event, node.path)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeaveFolder();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDropFolder(event, node.path);
                    }}
                  >
                    <span className={`tree-caret${open ? " open" : ""}`} aria-hidden="true">
                      <ChevronRight size={13} strokeWidth={1.6} />
                    </span>
                    {open
                      ? <FolderOpen className="tree-folder-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
                      : <Folder className="tree-folder-icon" size={14} strokeWidth={1.5} aria-hidden="true" />}
                    <span className="tree-folder">{node.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ProjectNodeContextActions
                  node={node}
                  onNewFolder={onNewFolder}
                  onNewFile={onNewFile}
                  onBeginRename={onBeginRename}
                  onCopyPath={onCopyPath}
                  onDelete={onDelete}
                />
              </ContextMenu>
              )}
              {open && node.children && (
                <ProjectTree
                  nodes={node.children}
                  depth={depth + 1}
                  parentDirectoryPath={node.path}
                  expanded={expanded}
                  activeFilePath={activeFilePath}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  onNewFolder={onNewFolder}
                  onNewFile={onNewFile}
                  onDelete={onDelete}
                  renameDraft={renameDraft}
                  onBeginRename={onBeginRename}
                  onRenameDraftChange={onRenameDraftChange}
                  onCommitRename={onCommitRename}
                  onCancelRename={onCancelRename}
                  onCopyPath={onCopyPath}
                  draggedPath={draggedPath}
                  dropTargetPath={dropTargetPath}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOverFolder={onDragOverFolder}
                  onDragLeaveFolder={onDragLeaveFolder}
                  onDropFolder={onDropFolder}
                  onPointerDragStart={onPointerDragStart}
                  onPointerDragMove={onPointerDragMove}
                  onPointerDragEnd={onPointerDragEnd}
                  onPointerDragCancel={onPointerDragCancel}
                  onConsumeSuppressedClick={onConsumeSuppressedClick}
                />
              )}
            </div>
          );
        }
        const active = node.path === activeFilePath;
        if (renameDraft?.node.path === node.path) {
          return (
            <div key={node.path} className={`tree-file${active ? " active" : ""}`} style={{ paddingLeft: treeRowIndent(depth) }}>
              <span className="tree-caret tree-caret-spacer" aria-hidden="true" />
              <File className="tree-file-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
              <input
                className="tree-rename-input"
                value={renameDraft.name}
                aria-label={`Rename ${node.name}`}
                autoFocus
                onChange={(event) => onRenameDraftChange(event.currentTarget.value)}
                onBlur={onCommitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onCommitRename();
                  if (event.key === "Escape") onCancelRename();
                }}
              />
            </div>
          );
        }
        return (
          <ContextMenu key={node.path}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                className={`tree-file${active ? " active" : ""}`}
                style={{ paddingLeft: treeRowIndent(depth) }}
                aria-current={active ? "page" : undefined}
                // P3-02, same reason as the folder row above.
                draggable
                data-dragging={draggedPath === node.path || undefined}
                aria-grabbed={draggedPath === node.path}
                aria-describedby="explorer-drag-help"
                title={`Drag ${node.name} onto a folder to move it`}
                onClick={() => {
                  if (!onConsumeSuppressedClick(node.path)) onOpenFile(node.path, node.name);
                }}
                onPointerDown={(event) => onPointerDragStart(event, node)}
                onPointerMove={onPointerDragMove}
                onPointerUp={onPointerDragEnd}
                onPointerCancel={onPointerDragCancel}
                onDragStart={(event) => onDragStart(event, node)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => onDragOverFolder(event, parentDirectoryPath)}
                // The folder row had this and the file row did not, so the
                // owning folder stayed highlighted after the cursor left a
                // child file row.
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeaveFolder();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDropFolder(event, parentDirectoryPath);
                }}
              >
                {/* Files have no caret, but they must occupy the folder's caret
                    column or a file at depth N paints a caret-width left of a
                    folder at the same depth and the row reads as un-nested -
                    the other half of img-003-005. */}
                <span className="tree-caret tree-caret-spacer" aria-hidden="true" />
                <File className="tree-file-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
                <span className="tree-file-name">{node.name}</span>
              </button>
            </ContextMenuTrigger>
            <ProjectNodeContextActions
              node={node}
              onNewFolder={onNewFolder}
              onNewFile={onNewFile}
              onBeginRename={onBeginRename}
              onCopyPath={onCopyPath}
              onDelete={onDelete}
            />
          </ContextMenu>
        );
      })}
    </>
  );
}

function placedIdealJunction(
  component: SchematicComponent,
  directives: readonly string[],
): IdealJunctionModel | null {
  const requested = component.value.trim().split(/\s+/)[0] ?? "";
  if (requested && definedModelNames(directives).has(requested.toLowerCase())) return null;
  return idealJunctionModel(component);
}

/** The kinds `engine/idealModels.ts` can make ideal (its `GENERIC_VALUES`). */
const JUNCTION_KINDS: ReadonlySet<string> = new Set(["diode", "led", "zener"]);

/** What the generic option really does for this part, said without lying about
 *  which of the two device models the deck will emit. */
function junctionModelSummary(
  component: SchematicComponent,
  ideal: IdealJunctionModel | null,
): string {
  if (ideal) {
    if (component.kind === "zener") {
      return `Generic Zener · ${ideal.forwardVolts} V forward · ${ideal.breakdownVolts ?? 5.1} V reverse.`;
    }
    if (component.kind === "led") {
      return `Generic LED · Vf ${ideal.forwardVolts} V typical/default; color sets the default, Vfwd overrides.`;
    }
    return `Generic diode · ${ideal.forwardVolts} V forward.`;
  }
  if (hasLtspiceProvenance(component)) {
    const identity = component.ltModelName?.trim()
      || component.value.trim().split(/\s+/)[0]
      || "authored model";
    const source = component.ltModelFile?.trim() ? ` from ${component.ltModelFile.trim()}` : "";
    return `Imported exact model · identity and provenance are read-only (${identity}${source}).`;
  }
  if (component.kind === "diode" && /(?:^|[\s,;])(?:is|n)\s*=/i.test(` ${component.value}`)) {
    return "Generic diode · validated Shockley parameters.";
  }
  return "Document model · the authored .model card is used exactly.";
}

/**
 * Which side of the body each `.subckt` terminal sits on, in declaration order
 * (the order the netlist writes the nodes in). Read off the instance's own pin
 * bank when it has one, so an imported symbol reports where its pins really
 * are; otherwise off the bank a native placement is about to be given. Either
 * way the answer comes from `subcircuitGeometry`, never from a second rule.
 */
function subcircuitPortSides(
  component: SchematicComponent,
  ports: readonly string[],
  directions?: readonly SchematicPortDirection[],
): readonly PortSide[] {
  // A placed instance reports where its terminals REALLY are, read back out of
  // the persisted bank, because that geometry is electrically live. An instance
  // with no bank yet reports where the one slot rule would put them.
  const sides = component.pinOverride?.length
    ? subcircuitBankSides(component)
    : subcircuitPortSlots(ports, directions).map((slot) => slot.side);
  if (sides.length !== ports.length) return ports.map(() => null);
  return sides;
}

/**
 * Inspector help is short because the schema says it short, not because the
 * panel cuts it off.
 *
 * This used to truncate at the first sentence and cap at 120 characters, with
 * two hardcoded string rewrites for the paragraphs that survived the cap. That
 * is a display bandage over authoring: it left the long text in the schema, so
 * screen readers and tooltips still got the paragraph, and every new paragraph
 * needed another special case. The prose now lives nowhere - see the length
 * ceiling enforced in `params.test.ts` - and this only normalises whitespace.
 */
function compactInspectorHint(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function InspectorHint({ text }: { text: string }) {
  const compact = compactInspectorHint(text);
  return (
    <p className="property-hint" title={compact} aria-label={compact}>
      {compact}
    </p>
  );
}

/**
 * A number the schema puts bounds on.
 *
 * The controlled input this replaces committed every keystroke and never
 * checked the range, so `min: 2, max: 5` on the gate's input count was a
 * comment: typing 21000 stored 21000, the symbol drew its five-lead maximum,
 * and the file and the drawing were describing different parts.
 *
 * Draft state is kept locally until Enter or blur. Invalid values remain visible
 * with an associated error and never reach the document; rejecting per
 * keystroke would make the box uneditable because every half-typed number is
 * temporarily invalid. The bound is printed next to the field, so it is
 * something you can see instead of something you hit.
 */
function BoundedParamInput({
  field,
  value,
  onBeginChange,
  onFocusField,
  onCommit,
  externalValidationMessage,
}: {
  field: ParamField;
  value: string;
  onBeginChange: () => void;
  onFocusField: () => void;
  onCommit: (next: string) => void;
  externalValidationMessage?: string | null;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const errorId = useId();
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const error = paramValidationMessage(field, draft);
    // Invalid finite values are drafts too: the schema's range is a contract,
    // not a request to silently change what the user typed.
    if (error) return;
    const next = draft;
    if (next.trim() === value.trim()) return;
    onBeginChange();
    onCommit(next);
  };

  const error = paramValidationMessage(field, draft) ?? externalValidationMessage ?? null;

  return (
    <>
      <input
        className="mono-num"
        value={draft}
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        inputMode={field.kind === "number" ? "decimal" : undefined}
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
          onFocusField();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
      {error && <span id={errorId} className="property-validation-error" role="alert">{error}</span>}
    </>
  );
}

/**
 * A component reference is a draft for the same reason a bounded parameter is:
 * a collision must remain readable long enough for its author to fix it. The
 * store owns the case-insensitive rule; this control asks that exact rule
 * before opening an undo transaction, then uses the store result again on
 * commit in case another edit changed the selection underneath it.
 */
function ComponentIdInput({
  component,
  components,
  onBeginChange,
  onFocusField,
  onCommit,
}: {
  component: SchematicComponent;
  components: readonly SchematicComponent[];
  onBeginChange: () => void;
  onFocusField: () => void;
  onCommit: (label: string) => ReturnType<typeof referenceRenameResult>;
}) {
  const [draft, setDraft] = useState(component.label);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const errorId = useId();

  useEffect(() => {
    if (!focused.current) {
      setDraft(component.label);
      setError(null);
    }
  }, [component.label]);

  const validate = (next: string) => referenceRenameResult(components, component.id, next);
  const commit = () => {
    const next = draft.trim();
    const result = validate(next);
    if (!result.ok) {
      setError(result.error ?? "Choose a unique component ID.");
      return;
    }
    if (next === component.label) {
      setError(null);
      if (draft !== component.label) setDraft(component.label);
      return;
    }
    onBeginChange();
    const committed = onCommit(next);
    setError(committed.ok ? null : committed.error ?? "Choose a unique component ID.");
  };

  return (
    <>
      <input
        className="mono-num"
        value={draft}
        aria-label="Component ID"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        placeholder="none"
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
          onFocusField();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          const result = validate(next);
          setError(result.ok ? null : result.error ?? "Choose a unique component ID.");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(component.label);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error && <span id={errorId} className="property-validation-error" role="alert">{error}</span>}
    </>
  );
}

function ChoiceParamInput({
  field,
  value,
  onBeginChange,
  onFocusField,
  onValueChange,
}: {
  field: ParamField;
  value: string;
  onBeginChange: () => void;
  onFocusField: () => void;
  onValueChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const errorId = useId();
  const valid = !paramValidationMessage(field, draft);
  useEffect(() => setDraft(value), [value]);
  if (!valid) {
    const error = paramValidationMessage(field, draft) ?? "Choose a listed option.";
    return (
      <>
        <input
          className="mono-num property-text"
          value={draft}
          aria-label={field.label}
          aria-invalid="true"
          aria-describedby={errorId}
          spellCheck={false}
          onFocus={onFocusField}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            if (!paramValidationMessage(field, next)) {
              onBeginChange();
              onValueChange(next);
            }
          }}
        />
        <span id={errorId} className="property-validation-error" role="alert">{error}</span>
      </>
    );
  }
  return (
    <Select
      value={value}
      onOpenChange={(open) => {
        if (open) onFocusField();
      }}
      onValueChange={(next) => {
        onBeginChange();
        onValueChange(next);
      }}
    >
      <SelectTrigger size="sm" className="property-select mono-num w-full max-w-[168px]" aria-label={field.label}>
        <SelectValue placeholder={field.label} />
      </SelectTrigger>
      <SelectContent>
        {field.choices?.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The editor for one schema field, whichever kind it is.
 *
 * Built once because bounds are a property of the SCHEMA, not of a kind: a
 * potentiometer's wiper, a pulse source's duty and a gate's input count all
 * declare a range, and enforcing it at one of those three call sites is how the
 * other two stay broken. The display unit rides the same argument: the panel
 * asks `displayParamField` what the field looks like to a reader, and converts
 * on the way in and out, so nothing here knows a percentage from an ohm.
 */
function ParamValueControl({
  field,
  value,
  onBeginChange,
  onFocusField,
  onValueChange,
  externalValidationMessage,
}: {
  field: ParamField;
  value: string;
  onBeginChange: () => void;
  onFocusField: () => void;
  onValueChange: (next: string) => void;
  externalValidationMessage?: string | null;
}) {
  // Bounds, unit and the number itself, all in the unit the reader sees.
  const shown = displayParamField(field);
  const shownValue = toDisplayParamValue(field, value);
  const commit = (next: string) => onValueChange(fromDisplayParamValue(field, next));
  const range = paramRangeLabel(shown);
  const control = field.kind === "choice" ? (
    <ChoiceParamInput
      field={shown}
      value={shownValue}
      onBeginChange={onBeginChange}
      onFocusField={onFocusField}
      onValueChange={commit}
    />
  ) : field.display ? (
    // A display unit is deliberately NOT SI-prefixable - "m%" is not a quantity
    // - so it is a static suffix beside a clamped box rather than the prefix
    // picker an engineering field gets.
    <span className="property-quantity">
      <BoundedParamInput
        field={shown}
        value={shownValue}
        onBeginChange={onBeginChange}
        onFocusField={onFocusField}
        onCommit={commit}
        externalValidationMessage={externalValidationMessage}
      />
      <span className="property-unit" aria-hidden="true">{shown.unit}</span>
    </span>
  ) : shown.unit ? (
    <EngineeringInput
      label={shown.label}
      // Display spelling only: a value saved as `1000` shows as 1 + kΩ, and is
      // still stored as `1000` until the reader edits it.
      value={engineeringSpelling(shownValue, shown.unit)}
      unit={shown.unit}
      min={shown.min}
      max={shown.max}
      onBeginChange={onBeginChange}
      onValueChange={commit}
      externalValidationMessage={externalValidationMessage}
    />
  ) : isBoundedParamField(shown) || field.kind === "number" || Boolean(field.validate) ? (
    <BoundedParamInput
      field={shown}
      value={shownValue}
      onBeginChange={onBeginChange}
      onFocusField={onFocusField}
      onCommit={commit}
      externalValidationMessage={externalValidationMessage}
    />
  ) : (
    // Unbounded text: nothing to clamp, so it keeps committing as you type.
    <input
      // An expression is prose, so it reads from the left; a number is a
      // number and belongs in the right-aligned value column with the rest.
      className={`mono-num${shown.kind === "text" ? " property-text" : ""}`}
      value={shownValue}
      aria-label={shown.label}
      placeholder="none"
      spellCheck={false}
      onFocus={onFocusField}
      onChange={(event) => {
        onBeginChange();
        commit(event.currentTarget.value);
      }}
    />
  );
  if (!range) return control;
  return (
    <span className="property-value">
      {/* Ahead of the control, not after it: the value column ends at the
          panel's right edge, and a bound parked past it was the one thing on
          the row that got clipped. */}
      <small className="property-range mono-num">{range}</small>
      {control}
    </span>
  );
}

/**
 * The one number that identifies a part, spelled the way a datasheet spells it.
 *
 * A collapsed group would otherwise be a title and nothing else, which is
 * exactly the state a reader collapses INTO once they know what the part is and
 * only want its value. `formatEngineering` is the app's single number
 * formatter, so `10000` reads `10 kΩ` here for the same reason it does on a
 * measurement card.
 */
function componentHeadline(component: SchematicComponent): string {
  const entry = CATALOG_BY_KIND[component.kind];
  const source = component.value.trim() || entry?.defaultValue || "";
  const field = paramFields(component.kind, source)
    .find((candidate) => candidate.kind === "number" && (candidate.unit || candidate.display));
  if (!field) return source.split(/\s+/)[0] ?? "";
  const shown = displayParamField(field);
  const raw = toDisplayParamValue(field, decodeParams(component.kind, source)[field.key] ?? "");
  if (!raw.trim()) return "";
  try {
    return formatEngineering(parseQuantity(raw, shown.unit), shown.unit);
  } catch {
    // An expression or a parameter reference is not a quantity; show it as
    // written rather than inventing a number for it.
    return raw;
  }
}

/** Direction as the drawing and the netlist both say it, in one short word. */
function portDirectionWord(direction: SchematicPortDirection): string {
  return direction === "BiDir" ? "bidir" : direction.toLowerCase();
}

/**
 * Every model name a generated `.subckt` may NOT take, folded the way the
 * compiler folds it.
 *
 * This is the pre-check that keeps a student out of a Run refusal about a name
 * they never typed: `buildProjectHierarchyDeck` refuses a project model that
 * collides with an inline `.subckt`, an attached library, a Tau-owned bundled
 * block, an ordinary root X instance, or a second sheet already linked under
 * the same name. Those are exactly the sets read here - the same helpers, so
 * this can only ever be as strict as Run, never more permissive in a way that
 * matters. It is ADVISORY: Run remains the judge and its strings are unchanged.
 */
function reservedProjectModelKeys(
  components: readonly SchematicComponent[],
  directives: readonly string[],
  libraryTexts: readonly string[],
  selfId: string,
): ReadonlySet<string> {
  const reserved = new Set<string>();
  for (const name of definedSubcktNames(directives)) {
    reserved.add(asciiFold(name));
    reserved.add(asciiFold(sanitizeSubcktName(name)));
  }
  for (const name of parseUserModelLibraries(libraryTexts).subckts.keys()) {
    reserved.add(asciiFold(name));
  }
  for (const component of components) {
    if (component.kind !== "subckt") continue;
    if (component.projectSubcircuit) {
      // Another instance's model name is only reserved when it names a
      // DIFFERENT sheet; two instances of the same sheet share one model.
      if (component.id !== selfId) reserved.add(asciiFold(component.projectSubcircuit.model));
      continue;
    }
    const raw = component.value.trim().split(/\s+/)[0] ?? "";
    if (raw) reserved.add(asciiFold(sanitizeSubcktName(raw)));
  }
  return reserved;
}

/** First free spelling of a derived model name, or null when there is none. */
function availableProjectModelName(base: string | null, reserved: ReadonlySet<string>): string | null {
  if (!base) return null;
  const free = (candidate: string) =>
    !reserved.has(asciiFold(candidate)) && bundledSubcircuitBlock(asciiFold(candidate)) === null;
  if (free(base)) return base;
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (free(candidate)) return candidate;
  }
  return null;
}

/** The index's entry for a path, or null when the index has not resolved it. */
function sheetInterfaceFor(
  entries: readonly ProjectSheetInterfaceEntry[],
  sheetPath: string | null,
): ProjectSheetInterfaceEntry | null {
  if (!sheetPath) return null;
  const key = asciiFold(sheetPath);
  return entries.find((entry) => asciiFold(entry.sheetPath) === key) ?? null;
}

/**
 * What a sheet option says about itself before you pick it. The port names are
 * on the option because "3 ports" answers a different question than "IN, OUT,
 * GND": the first tells you the block's shape, the second tells you it is the
 * block you meant.
 *
 * The names are a SAMPLE, not the list. A 20-port sheet made this string 400+
 * characters inside a 168px trigger, which is an ellipsis carrying no
 * information; the count leads because the count is what survives truncation,
 * and the full ordered pinout is the table below, which is where a reader can
 * actually read it.
 */
const SHEET_OPTION_NAME_BUDGET = 28;
function sheetOptionAnnotation(entry: ProjectSheetInterfaceEntry | null): string {
  if (!entry) return "not checked yet";
  switch (entry.status) {
    case "ok": {
      const shown: string[] = [];
      let used = 0;
      for (const port of entry.ports) {
        // Always show at least one name, then only what fits the budget.
        if (shown.length > 0 && used + port.name.length + 2 > SHEET_OPTION_NAME_BUDGET) break;
        used += port.name.length + (shown.length > 0 ? 2 : 0);
        shown.push(port.name);
      }
      const names = shown.length < entry.ports.length
        ? `${shown.join(", ")}…`
        : shown.join(", ");
      return `${entry.ports.length} ${entry.ports.length === 1 ? "port" : "ports"}: ${names}`;
    }
    case "no-interface":
      return "no interface yet";
    case "unreadable":
      return "unreadable";
    case "missing":
      return "missing from this project";
  }
}

/** One diff row's two columns plus its generated consequence. */
function ProjectInterfaceDiffTable({
  drift,
  fileName,
}: {
  drift: Extract<ProjectInterfaceDrift, { kind: "drifted" }>;
  fileName: string;
}) {
  return (
    <table className="sheet-drift-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">This block’s contract</th>
          <th scope="col">{fileName} now</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {drift.rows.map((row) => (
          <tr key={row.position} className={`sheet-drift-row is-${row.change}`}>
            <td className="mono-num">{row.position}</td>
            <td className="mono-num">{row.was ? row.was.name : "—"}</td>
            <td className="mono-num">
              {row.now ? `${row.now.name} · ${portDirectionWord(row.now.direction)}` : "—"}
            </td>
            <td>{row.change}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The review act. Nothing is reconciled without it, and its DEFAULT is to
 * change nothing: a stale contract that still netlists what it says is a
 * legitimate state, and Run will refuse it in its own words if the mismatch is
 * real. Adopting is the deliberate, single, undoable alternative.
 */
function ProjectInterfaceReviewDialog({
  open,
  onOpenChange,
  fileName,
  drift,
  summary,
  title,
  comparedSource,
  onAdopt,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  fileName: string;
  drift: Extract<ProjectInterfaceDrift, { kind: "drifted" }>;
  /** The sentence the panel decided on, so the dialog cannot contradict it. */
  summary?: string;
  /** Overridden when the difference is this block's old layout, not a file edit. */
  title?: string;
  comparedSource?: "open-tab" | "disk";
  onAdopt: () => void;
}) {
  // A badge that cannot say WHICH copy of the child it read is a badge that
  // gets ignored the first time it disagrees with an unsaved tab.
  const sourceSentence = comparedSource === "open-tab"
    ? `Compared against ${fileName} as it is open now, including unsaved edits.`
    : comparedSource === "disk"
      ? `Compared against ${fileName} as saved on disk.`
      : `Compared against the copy of ${fileName} in this project’s index.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sheet-drift-dialog">
        <DialogHeader>
          <DialogTitle>{title ?? "Sheet interface changed"}</DialogTitle>
          <DialogDescription>{summary ?? drift.summary}</DialogDescription>
        </DialogHeader>
        <ProjectInterfaceDiffTable drift={drift} fileName={fileName} />
        <div className="sheet-drift-consequence">
          {drift.rows
            .filter((row) => row.change !== "same")
            .map((row) => (
              <p key={row.position}>{row.consequence}</p>
            ))}
        </div>
        <p className="sheet-drift-source">{sourceSentence}</p>
        <DialogFooter>
          {/* Default = keep. The parent's file is not degraded by another
              file's edit unless someone says so. */}
          <Button type="button" size="sm" autoFocus onClick={() => onOpenChange(false)}>
            Keep current contract
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onAdopt}>
            {drift.electricallyInert ? "Re-lay out this block" : "Adopt sheet interface"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The parent half of "a sheet is a block" (PDF5 item 14).
 *
 * What changed and why: this used to make you TYPE the interface into a
 * free-text "Ordered block ports" box, read off the child sheet from memory,
 * in the right order, with Run refusing order-sensitively afterwards. That is
 * PDF5 reason 1. Now the pinout ARRIVES from the chosen sheet - names, order
 * and directions - and linking is one button and zero keystrokes.
 *
 * Three things are deliberate:
 *
 *  - The free-text field is DEMOTED, not deleted. An experienced EE genuinely
 *    wants a terminal order the child did not declare, or a contract for a
 *    sheet that is not written yet, and a difference on purpose is framed as
 *    "your contract, deliberately different" rather than as an error.
 *  - The index this panel reads is ADVISORY. `buildProjectHierarchyDeck` is
 *    still the only judge; every refusal string it throws is unchanged. Drift
 *    is an earlier, friendlier voice for the same fact, never the authority.
 *  - Nothing is reconciled automatically. A child sheet that vanished, or
 *    changed, leaves this instance's stored contract AND its pin bank exactly
 *    as they are, because both are electrically live and a parent's netlist must
 *    never change as a side effect of another file's edit.
 */
function ProjectSubcircuitLinkEditor({
  component,
  choices,
  sheetInterfaces = [],
  projectFilePath = null,
  comparedSource,
  onOpenSheet,
  onSaveSheetAsSim,
}: {
  component: SchematicComponent;
  choices: readonly ProjectSheetChoice[];
  /** Advisory authoring index, supplied by App; empty means "not checked". */
  sheetInterfaces?: readonly ProjectSheetInterfaceEntry[];
  /**
   * Current tab path. An `.asc` may be a link TARGET but never a link OWNER, so
   * this panel is a single explanatory row on one - see
   * `canonicalProjectOwnerPath`.
   */
  projectFilePath?: string | null;
  /** Which copy of a child the index read, so the drift review can say so. */
  comparedSource?: "open-tab" | "disk";
  onOpenSheet?: (sheetPath: string) => void;
  onSaveSheetAsSim?: () => void;
}) {
  const setProjectSubcircuitLink = useSchematic((s) => s.setProjectSubcircuitLink);
  const resyncProjectSubcircuit = useSchematic((s) => s.resyncProjectSubcircuit);
  const components = useSchematic((s) => s.components);
  const directives = useSchematic((s) => s.directives);
  const modelLibraries = useSchematic((s) => s.userModelLibraries);
  const link = component.projectSubcircuit;

  // NOT `choices[0]`. Pre-selecting the alphabetically first sibling meant the
  // panel's one prominent button linked this block to a file the reader never
  // chose - the same sin as auto-picking a net, on the one decision here that
  // rewrites the netlist. An unlinked block starts with nothing selected.
  const [sheetPath, setSheetPath] = useState(link?.sheetPath ?? "");
  const [manualPorts, setManualPorts] = useState(link?.ports.join(", ") ?? "");
  const [manualModel, setManualModel] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSheetPath(link?.sheetPath ?? "");
    setManualPorts(link?.ports.join(", ") ?? "");
    setManualModel(null);
    setError(null);
    setSaved(false);
    setReviewOpen(false);
  }, [choices, component.id, component.label, link?.model, link?.ports, link?.sheetPath]);

  const availableChoices = link && !choices.some((choice) => choice.path === link.sheetPath)
    ? [{ path: link.sheetPath, label: `${link.sheetPath} · saved link` }, ...choices]
    : choices;
  const linkedSheetPresent = Boolean(link && choices.some((choice) => choice.path === link.sheetPath));

  const selectedEntry = sheetInterfaceFor(sheetInterfaces, sheetPath || null);
  const selectedFileName = selectedEntry?.fileName
    ?? availableChoices.find((choice) => choice.path === sheetPath)?.label
    ?? basename(sheetPath || "");
  const proposedPorts = selectedEntry?.status === "ok" ? selectedEntry.ports : [];
  const proposedNames = proposedPorts.map((port) => port.name);
  const proposedDirections = proposedPorts.map((port) => port.direction);
  const proposedSides = subcircuitPortSlots(proposedNames, proposedDirections).map((slot) => slot.side);

  // ZERO TYPING: the model name is derived from the file stem and pre-checked
  // against the collision sets the compiler checks, so the offered default is
  // one Run will accept. `null` means the stem cannot make a SPICE-safe name -
  // said out loud rather than sanitized behind the user's back.
  const reserved = useMemo(
    () => reservedProjectModelKeys(components, directives, modelLibraries.map((library) => library.text), component.id),
    [component.id, components, directives, modelLibraries],
  );
  const derivedModel = useMemo(
    () => availableProjectModelName(defaultProjectModelName(selectedFileName), reserved),
    [reserved, selectedFileName],
  );
  const sheetIsLinked = link?.sheetPath === sheetPath;
  const modelValue = manualModel ?? (sheetIsLinked ? link!.model : derivedModel ?? "");

  const linkedEntry = sheetInterfaceFor(sheetInterfaces, link?.sheetPath ?? null);
  const linkedFileName = linkedEntry?.fileName
    ?? (link ? basename(link.sheetPath) : "");
  const linkedDirections = linkedEntry?.status === "ok"
    ? linkedEntry.ports.map((port) => port.direction)
    : [];
  const drift: ProjectInterfaceDrift | null = link
    ? projectSheetInterfaceDrift(link.ports, linkedEntry, {
        // current = where this instance's terminals REALLY are; expected = where
        // the child's live directions would put them. Both from the one slot
        // rule in subcircuitGeometry.
        current: subcircuitBankSides(component),
        expected: linkedEntry?.status === "ok"
          ? subcircuitPortSlots(linkedEntry.ports.map((port) => port.name), linkedDirections).map((slot) => slot.side)
          : [],
      })
    : null;
  const drifted = drift?.kind === "drifted" ? drift : null;

  // A link stored before Item 14 has the historical half-split bank, so its pin
  // SIDES disagree with the child's directions even though the child never
  // changed. Saying "child.sim changed its interface" there is a statement about
  // a file edit that did not happen - on every existing document - and a lamp
  // that cries wolf on open is a lamp nobody reads. The evidence is exact: the
  // bank IS the undirected layout for this contract, so the picture is old, not
  // the contract. Only the wording changes; the offer (re-lay out) is the same,
  // and a real rename or reorder on the same bank still reads as drift because
  // those rows are not direction-only.
  const laidOutByLegacyRule = useMemo(() => {
    const bank = component.pinOverride;
    if (!link || !bank || bank.length !== link.ports.length) return false;
    const legacy = buildSubcircuitPinOverride(component, link.ports);
    return legacy.every((pin, index) => (
      pin.id === bank[index]?.id && pin.x === bank[index]?.x && pin.y === bank[index]?.y
    ));
  }, [component, link]);
  const staleLayoutOnly = Boolean(drifted?.electricallyInert && laidOutByLegacyRule);
  const driftSentence = staleLayoutOnly
    ? `This block is drawn with Tau’s older side layout, not ${linkedFileName}’s pin directions. Nothing electrical changes; Run is unaffected.`
    : drifted?.summary ?? "";

  const commit = (
    ports: readonly string[],
    model: string,
    directions?: readonly SchematicPortDirection[],
  ) => {
    const result = setProjectSubcircuitLink(
      component.id,
      { sheetPath, model, ports: [...ports] },
      directions ? { directions } : undefined,
    );
    if (!result.ok) {
      setError(result.error ?? "Could not save this sheet block.");
      setSaved(false);
      return;
    }
    setError(null);
    setSaved(true);
  };

  const adopt = () => {
    if (linkedEntry?.status !== "ok") return;
    const result = resyncProjectSubcircuit(component.id, {
      ports: linkedEntry.ports.map((port) => port.name),
      directions: linkedEntry.ports.map((port) => port.direction),
    });
    if (!result.ok) {
      setError(result.error ?? "Could not adopt the sheet interface.");
      return;
    }
    setError(null);
    setReviewOpen(false);
  };

  // The `.asc` trap, refused where the decision is made instead of at save
  // time - but only HALF of it is a trap, and the old sentence said the wrong
  // half. `canonicalProjectSheetPath` accepts `.asc` as a link TARGET (a `FLAG`
  // plus `IOPIN` states each port and its direction), while
  // `canonicalProjectOwnerPath` still refuses it as an OWNER, because LTspice's
  // format cannot persist `projectSubcircuit` - the link naming the sheet and
  // its pin order. (It CAN persist `projectPorts`: those round-trip as the same
  // FLAG/IOPIN records, which is why `serializeSchematicFile` no longer treats
  // them as loss.) So the copy has to distinguish being a block from holding one.
  //
  // The button is rendered only when a caller actually supplied the handler. It
  // used to render always, `disabled` whenever the prop was absent - which is
  // every caller in the app - so the one offered way out was a control that
  // could not be pressed and did not say why.
  if (projectFilePath && isAscFile(projectFilePath)) {
    return (
      <div className="property-advanced project-sheet-link" role="group" aria-label="Sheet block">
        {/*
          The remedy has to be one the reader can actually carry out. "Save this
          sheet as .sim" was not: no Save-As in the app changes an extension, and
          renaming the file to `.sim` in the Explorer keeps the LTspice bytes, so
          the result would not reopen. Making a new .sim sheet works today, so
          that is what this says.
        */}
        <p className="property-hint" role="status">
          This .asc sheet can be used as a sheet block on a .sim parent, but it cannot hold one:
          LTspice’s format has nowhere to store the link or its port order. To place blocks, put
          them on a Tau .sim sheet — a new sheet is one by default.
        </p>
        {onSaveSheetAsSim && (
          <Button type="button" variant="outline" size="sm" onClick={() => onSaveSheetAsSim()}>
            Save as .sim
          </Button>
        )}
      </div>
    );
  }

  const manualContract = manualPorts.split(/[\s,]+/).map((port) => port.trim()).filter(Boolean);
  const manualDiffers = selectedEntry?.status === "ok"
    && manualContract.length > 0
    && !(manualContract.length === proposedNames.length
      && manualContract.every((port, index) => asciiFold(port) === asciiFold(proposedNames[index] ?? "")));

  return (
    <div className="property-advanced project-sheet-link" role="group" aria-label="Sheet block">
      <div className="project-sheet-link-head">
        <p className="property-hint">
          Choose a sibling Tau sheet; its ports arrive in order. Run checks that contract against the child sheet; it never infers ports.
        </p>
        {link && linkedSheetPresent && onOpenSheet && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenSheet(link.sheetPath)}
          >
            {`Open ${linkedFileName}`}
          </Button>
        )}
      </div>
      {link && (
        <p className="property-hint" role="status">
          {linkedSheetPresent
            ? `Sheet block · ${link.sheetPath} is present in this project; Run checks its exact ordered port contract.`
            : `Sheet block · ${link.sheetPath} is not present in the open project; Run is refused until that sheet is available.`}
        </p>
      )}
      <label className="property-field">
        <span>Sheet interface</span>
        {/* Controlled for its whole lifetime - "" is "nothing chosen yet", which
            is now the starting state, and flipping between undefined and a
            string makes React warn on every link. */}
        <Select value={sheetPath} onValueChange={(next) => { setSheetPath(next); setManualModel(null); setSaved(false); }}>
          <SelectTrigger size="sm" className="property-select mono-num w-full max-w-[168px]" aria-label="Sheet interface">
            <SelectValue placeholder="Choose a Tau sheet" />
          </SelectTrigger>
          <SelectContent>
            {availableChoices.map((choice) => {
              const entry = sheetInterfaceFor(sheetInterfaces, choice.path);
              // An unreadable child is the one option that must not be
              // selectable: there is nothing to copy from it, and the loader's
              // own reason is the only useful thing to show.
              return (
                <SelectItem key={choice.path} value={choice.path} disabled={entry?.status === "unreadable"}>
                  {entry ? `${choice.label} · ${sheetOptionAnnotation(entry)}` : choice.label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </label>
      {selectedEntry?.status === "unreadable" && (
        <p className="property-validation-error" role="alert">{selectedEntry.reason ?? "This sheet could not be read."}</p>
      )}
      {selectedEntry?.status === "ok" && (
        <>
          <label className="property-field">
            <span>Sheet block name</span>
            <input
              className="mono-num property-text"
              value={modelValue}
              aria-label="Sheet block name"
              spellCheck={false}
              onChange={(event) => { setManualModel(event.currentTarget.value); setSaved(false); }}
            />
          </label>
          {!derivedModel && !sheetIsLinked && (
            <p className="property-hint">
              {`“${selectedFileName}” has no SPICE-safe default name; type one for this block.`}
            </p>
          )}
          {/* The proposed pinout, read-only: this is the thing you used to have
              to retype. Ordinal, name, direction and the side the direction
              puts it on, so the drawing and this list cannot disagree. */}
          <ol className="port-list project-sheet-pin-table" aria-label="Proposed pin order">
            {proposedPorts.map((port, index) => (
              <li key={`${index}-${port.name}`}>
                <span className="port-index mono-num">{index + 1}</span>
                <span className="port-name mono-num">{port.name}</span>
                <span className="port-direction">{portDirectionWord(port.direction)}</span>
                {proposedSides[index] && <span className="port-side">{proposedSides[index]}</span>}
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!sheetPath || !modelValue.trim()}
            onClick={() => commit(proposedNames, modelValue.trim(), proposedDirections)}
          >
            {link ? "Relink this sheet" : "Link this sheet"}
          </Button>
        </>
      )}
      {selectedEntry?.status === "no-interface" && (
        <>
          <p className="property-hint" role="status">
            {`${selectedFileName} has no inputs or outputs marked yet, so there is no pinout to copy.`}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!onOpenSheet}
            onClick={() => onOpenSheet?.(sheetPath)}
          >
            {`Open ${selectedFileName} and mark its nets`}
          </Button>
        </>
      )}
      {/* "Not checked" is never rendered as "fine": an unresolved index is
          silence, and saying so is the only honest thing to print. Printed once
          - for a chosen sheet, or (below) as this instance's drift verdict. */}
      {sheetPath && !selectedEntry && !(link && link.sheetPath === sheetPath) && (
        <p className="property-hint" role="status">
          {`${selectedFileName} has not been checked yet. Use “Edit contract manually” to state the ordered contract yourself.`}
        </p>
      )}
      {drift && drift.kind === "not-checked" && (
        <p className="property-hint" role="status">
          {`${linkedFileName} has not been checked yet, so this block's contract is not compared. Run still checks it exactly.`}
        </p>
      )}
      {drift && drift.kind === "no-interface" && (
        <p className="property-hint" role="status">
          {`${linkedFileName} has no inputs or outputs marked, so Run refuses this block until it does.`}
        </p>
      )}
      {choices.length === 0 && !link && (
        <p className="property-hint">No sibling .sim or .tau.json sheet is available in the open project yet.</p>
      )}
      {drift && drift.kind === "missing-sheet" && link && (
        <div className="project-sheet-drift is-missing">
          <p className="property-validation-error" role="alert">
            {`${link.sheetPath} is missing from this project. This block keeps its contract and its pins exactly as they are; Run refuses until that sheet is back. Point this block at another sheet in “Sheet interface” above, or unlink it.`}
          </p>
          {/* A "Choose another sheet" button stood here and opened the MANUAL
              CONTRACT editor - a different thing than its own label, two rows
              under the Select that really does choose the sheet. The recovery
              is the Select; the sentence says so instead of miming it. */}
          {/* Never automatic. Unlinking rewrites the parent's netlist, so it is
              always a thing a person did. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const result = setProjectSubcircuitLink(component.id, null);
              if (!result.ok) setError(result.error ?? "Could not unlink this sheet.");
            }}
          >
            Unlink
          </Button>
        </div>
      )}
      {drift && drift.kind === "sheet-unreadable" && (
        <p className="property-validation-error" role="alert">{drift.reason}</p>
      )}
      {drifted && (
        <div className="project-sheet-drift">
          <p className="project-sheet-drift-summary" role="status">{driftSentence}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
            Review interface change…
          </Button>
          <ProjectInterfaceReviewDialog
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            fileName={linkedFileName}
            drift={drifted}
            summary={driftSentence}
            title={staleLayoutOnly ? "Block layout is out of date" : undefined}
            comparedSource={comparedSource}
            onAdopt={adopt}
          />
        </div>
      )}
      {/* ADVANCED. The order a child declares is the common case, not the only
          legitimate one: an EE may want a different terminal order, or a
          contract for a sheet that does not exist yet. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        Edit contract manually
      </Button>
      {advancedOpen && (
        <div className="project-sheet-advanced">
          <label className="property-field">
            <span>Sheet block name</span>
            <input
              className="mono-num property-text"
              value={modelValue}
              aria-label="Manual sheet block name"
              spellCheck={false}
              onChange={(event) => { setManualModel(event.currentTarget.value); setSaved(false); }}
            />
          </label>
          <label className="property-field">
            <span>Ordered block ports</span>
            <input
              className="mono-num property-text"
              value={manualPorts}
              aria-label="Ordered block ports"
              placeholder="IN, OUT, GND"
              spellCheck={false}
              onChange={(event) => { setManualPorts(event.currentTarget.value); setSaved(false); }}
            />
          </label>
          {manualDiffers && (
            <p className="property-hint" role="status">
              {`Your contract, deliberately different from ${selectedFileName}: ${manualContract.join(", ")} against ${proposedNames.join(", ")}. Run compares this instance against the sheet exactly and in order.`}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!sheetPath}
            onClick={() => commit(manualContract, modelValue.trim())}
          >
            {link ? "Update sheet block" : "Link sheet block"}
          </Button>
        </div>
      )}
      {error && <p className="property-validation-error" role="alert">{error}</p>}
      {/* The confirmation is a VERDICT, not a toast. `saved` is local state, and
          in the running app the very next render arrives with a fresh component
          prop, which resets it - so a student's zero-typing link used to land
          with no confirmation at all. An in-sync link says so from the link
          itself, and keeps saying it. */}
      {drift?.kind === "in-sync" && link && (
        <p className="property-hint" role="status">
          {`Linked · this block’s ${link.ports.length} ${link.ports.length === 1 ? "port" : "ports"} match ${linkedFileName} in order, so Run will compile it.`}
        </p>
      )}
      {saved && drift?.kind !== "in-sync" && <p className="property-hint" role="status">Sheet block contract saved; Run will refuse until the child’s public ports match in order.</p>}
    </div>
  );
}

/**
 * One collapsible, titled group of properties for one part.
 *
 * This is the unit the reference builds its panel out of, and the reason a
 * two-part selection can be a two-group panel instead of an empty state: every
 * piece of per-part editor state - which row is mid-edit, whether Advanced is
 * open, whether the group itself is open - lives in this component, so a second
 * group is a second instance and nothing has to be threaded through a shared
 * inspector.
 */
function ComponentPropertyGroup({
  component,
  onAttachModelFile,
  manualModelControls = true,
  groupCount = 1,
  projectFilePath = null,
  sheetInterfaces = [],
  comparedSource,
  onOpenSheet,
  onSaveSheetAsSim,
}: {
  component: SchematicComponent;
  /** Explicit file-driven recovery path; the default shell keeps it hidden. */
  onAttachModelFile?: () => void;
  manualModelControls?: boolean;
  /** How many groups are on screen; see the aria-label note below. */
  groupCount?: number;
  /** Current tab path, used to offer sibling project sheets only. */
  projectFilePath?: string | null;
  /** Advisory sheet-interface index from App (see ProjectSubcircuitLinkEditor). */
  sheetInterfaces?: readonly ProjectSheetInterfaceEntry[];
  /** Which copy of a child sheet the index read, for the drift review's sake. */
  comparedSource?: "open-tab" | "disk";
  onOpenSheet?: (sheetPath: string) => void;
  onSaveSheetAsSim?: () => void;
}) {
  const selected = component;
  const entry = CATALOG_BY_KIND[selected.kind];
  const [groupOpen, setGroupOpen] = useState(true);
  const setValue = useSchematic((s) => s.setValue);
  const setSourceIdentity = useSchematic((s) => s.setSourceIdentity);
  const setSubcircuitModel = useSchematic((s) => s.setSubcircuitModel);
  const setOpampModel = useSchematic((s) => s.setOpampModel);
  const setLabel = useSchematic((s) => s.setLabel);
  const beginChange = useSchematic((s) => s.beginChange);
  const components = useSchematic((s) => s.components);
  const directives = useSchematic((s) => s.directives);
  const modelLibraries = useSchematic((s) => s.userModelLibraries);
  const projectTree = useProject((s) => s.tree);
  const projectRootPath = useProject((s) => s.rootPath);
  const projectSheetOptions = useMemo(
    () => projectSheetChoices(projectTree, projectRootPath, projectFilePath),
    [projectFilePath, projectRootPath, projectTree],
  );
  const editKeyRef = useRef<string | null>(null);
  // Empty catalog values (e.g. Class-D MOSFETs) still show editable defaults.
  const valueSource = selected
    ? (selected.value.trim() || entry?.defaultValue || "")
    : "";
  const fields = selected && entry ? paramFields(selected.kind, valueSource) : [];
  const partSummary = selected && entry ? paramSummary(selected.kind, valueSource) : "";
  const decoded = selected ? decodeParams(selected.kind, valueSource) : {};
  const visibleFields = fields.map((field) => ({
    ...field,
    value: decoded[field.key] ?? "",
    editable: true,
  }));
  // A palette SPST state is Tau's own two-terminal contact. A different
  // value, including an imported `MYSW`, is an authored SW model identity and
  // must reach the exact-model surface without being coerced through State.
  const modelKind = selected && isModelComponentKind(selected.kind)
    && !(selected.kind === "switch" && isStaticSwitchValue(valueSource))
    && !(selected.kind === "photodiode" && isPhotodiodePhotocurrentValue(valueSource))
    ? selected.kind
    : null;
  const modelOptions = useMemo(
    () => modelKind ? componentModelOptions(modelKind, directives, modelLibraries) : [],
    [modelKind, directives, modelLibraries],
  );
  const selectedModelName = selected && modelKind
    ? (modelKind === "nmos" || modelKind === "pmos"
      ? decoded.model ?? ""
      : selected.value.trim().split(/\s+/)[0] ?? "")
    : "";
  const selectedModelOption = modelOptions.find(
    (option) => option.name.toLowerCase() === selectedModelName.toLowerCase(),
  );
  const subcircuitInstance = selected?.kind === "subckt"
    ? parseSubcircuitInstanceValue(selected.value)
    : null;
  const availableSubcircuits = useMemo(
    () => selected?.kind === "subckt" ? subcircuitOptions(directives, modelLibraries) : [],
    [selected?.kind, directives, modelLibraries],
  );
  const selectedSubcircuit = subcircuitInstance
    ? availableSubcircuits.find((option) => option.name.toLowerCase() === subcircuitInstance.name.toLowerCase())
    : undefined;
  // Ideal-by-default is invisible otherwise: the shared model dropdown reads
  // "Tau generic D" for a placed part and for an imported one, and only the
  // first of those is ideal. `componentModelCatalog`'s label is deliberately
  // NOT changed - it is honest for both - so the panel states the difference
  // beside it instead.
  const idealJunction = selected ? placedIdealJunction(selected, directives) : null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [crossFieldError, setCrossFieldError] = useState<string | null>(null);

  const beginParamChange = (key: string) => {
    if (!selected) return;
    const changeKey = `${selected.id}:${key}`;
    if (editKeyRef.current !== changeKey) {
      beginChange();
      editKeyRef.current = changeKey;
    }
  };

  const updateParam = (key: string, value: string) => {
    if (!selected) return;
    const base = selected.value.trim() || entry?.defaultValue || "";
    const values = applyLedColorDefault(selected.kind, base, decodeParams(selected.kind, base), key, value);
    const field = fields.find((candidate) => candidate.key === key);
    if (field && paramValidationMessage(field, value)) return;
    const crossError = paramValuesValidationMessage(selected.kind, values);
    if (crossError) {
      setCrossFieldError(crossError);
      return;
    }
    setCrossFieldError(null);
    setValue(selected.id, encodeParams(selected.kind, values));
  };

  const updateSubcircuitParameter = (name: string, value: string, defaultValue: string) => {
    if (!selected || !subcircuitInstance) return;
    const overrides = new Map(subcircuitInstance.overrides);
    for (const key of overrides.keys()) {
      if (key.toLowerCase() === name.toLowerCase()) overrides.delete(key);
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === defaultValue.trim()) overrides.delete(name);
    else overrides.set(name, trimmed);
    setValue(selected.id, encodeSubcircuitInstanceValue(subcircuitInstance.name, overrides));
  };

  const opamp = selected?.kind === "opamp" ? opampIdentity(selected) : null;
  const opampPart = opamp ? findOpAmp(opamp.partName) : null;
  const customOpamp = opamp?.mode === "behavioral"
    && !OPAMP_LIBRARY.some((part) => part.part === selected?.value);
  const opampStatus = selected?.kind === "opamp"
    ? inspectOpampModel(selected, directives, modelLibraries.map((library) => library.text))
    : null;

  const genericModel = Boolean(
    selected
    && !hasLtspiceProvenance(selected)
    && selectedModelOption?.source === "generic",
  );
  const modelParameterFields = modelKind && (genericModel || manualModelControls || Boolean(idealJunction)) ? visibleFields.filter((field) => {
    if (field.key === "model") return false;
    if (selectedModelOption?.modelType === "vdmos") return false;
    if (!genericModel && (field.key === "kp" || field.key === "vto")) return false;
    return true;
  }) : [];
  const basicModelParameterFields = modelParameterFields.filter((field) => !field.advanced);
  const advancedModelParameterFields = modelParameterFields.filter((field) => field.advanced);
  const renderModelParamField = (field: typeof visibleFields[number]) => (
    <Fragment key={field.key}>
      <label className="property-field">
        <span>{field.label}</span>
        <ParamValueControl
          field={field}
          value={field.value}
          onBeginChange={() => beginParamChange(field.key)}
          onFocusField={() => { editKeyRef.current = null; }}
          onValueChange={(value) => updateParam(field.key, value)}
        />
      </label>
      {field.description && <InspectorHint text={field.description} />}
    </Fragment>
  );
  const modelParamFields = modelParameterFields.length > 0 ? (
    <>
      {modelParameterFields.filter((field) => !field.advanced).map(renderModelParamField)}
      {modelParameterFields.some((field) => field.advanced) && (
        <div className="property-advanced-fields" role="group" aria-label="Advanced device model parameters">
          {modelParameterFields.filter((field) => field.advanced).map(renderModelParamField)}
        </div>
      )}
    </>
  ) : null;
  const modelAdvancedDisclosure = advancedModelParameterFields.length > 0 ? (
    <div className="advanced-settings property-advanced">
      <button
        type="button"
        className="disclosure-header"
        onClick={() => setAdvancedOpen((open) => !open)}
        aria-expanded={advancedOpen}
        aria-label="Toggle Advanced device model parameters"
      >
        <span className="disclosure-label">Advanced device model parameters</span>
        <span className="disclosure-rule" aria-hidden="true" />
        <span className={`disclosure-chevron${advancedOpen ? " open" : ""}`}>›</span>
      </button>
      {advancedOpen && (
        <div className="advanced-body" role="group" aria-label="Advanced device model parameters">
          {advancedModelParameterFields.map(renderModelParamField)}
        </div>
      )}
    </div>
  ) : null;
  const basicModelParamFields = basicModelParameterFields.length > 0
    ? <>{basicModelParameterFields.map(renderModelParamField)}</>
    : null;

  // The full chooser is intentionally an explicit host opt-in. The desktop
  // shell keeps it out of the default inspector, but the small compatibility
  // surface remains usable for library-management tests/embedders that pass a
  // callback. No selection here changes the exact resolver's precedence.
  const modelChooserField = manualModelControls && selected && modelKind ? (
    <label className="property-field">
      <span>Simulation model</span>
      <Select
        value={(selectedModelOption?.name ?? selectedModelName) || undefined}
        onOpenChange={(open) => {
          if (open) editKeyRef.current = null;
        }}
        onValueChange={(nextModel) => {
          beginParamChange("model");
          if (modelKind === "nmos" || modelKind === "pmos") {
            const choice = modelOptions.find((option) => option.name === nextModel);
            const next: Record<string, string> = {
              ...decodeParams(modelKind, selected.value.trim() || entry?.defaultValue || ""),
              model: nextModel,
            };
            if (choice?.source !== "generic") {
              next.kp = "";
              next.vto = "";
            }
            if (choice?.modelType === "vdmos") {
              next.w = "";
              next.l = "";
            }
            setValue(selected.id, encodeParams(modelKind, next));
          } else {
            setValue(selected.id, nextModel);
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="property-select mono-num w-full max-w-[168px]"
          aria-label="Simulation model"
        >
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {!selectedModelOption && selectedModelName && (
            <SelectItem value={selectedModelName}>
              {selectedModelName} · missing or incompatible
            </SelectItem>
          )}
          {modelOptions.map((option) => (
            <SelectItem
              key={`${option.source}:${option.sourceLabel}:${option.name}`}
              value={option.name}
            >
              {option.name} · {option.sourceLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  ) : null;

  const attachLibraryAction = onAttachModelFile && !selectedModelOption && !idealJunction ? (
      <Button type="button" variant="outline" size="sm" onClick={onAttachModelFile}>
        Attach .lib/.sub file
      </Button>
    ) : null;

  const genericOpampFields = selected?.kind === "opamp"
    && opamp?.mode === "behavioral"
    && !opamp.imported
    ? visibleFields.filter((field) => field.key !== "model").map((field) => (
      <Fragment key={field.key}>
        <label className="property-field">
          <span>{field.label}</span>
          <ParamValueControl
            field={field}
            value={field.value}
            onBeginChange={() => beginParamChange(field.key)}
            onFocusField={() => {
              editKeyRef.current = null;
              setCrossFieldError(null);
            }}
            externalValidationMessage={
              field.key === "vmin" || field.key === "vmax" ? crossFieldError : null
            }
            onValueChange={(value) => updateParam(field.key, value)}
          />
        </label>
        {field.description && <InspectorHint text={field.description} />}
      </Fragment>
    ))
    : null;

  // Ideal is tested FIRST: a zener marked `12V` names no library part, so the
  // missing-model branch would otherwise report a part the deck runs happily.
  const modelStatusHint = !selected || !modelKind ? "" : idealJunction
    ? junctionModelSummary(selected, idealJunction)
    : !selectedModelOption
      ? `Needs exact ${modelKind.toUpperCase()} "${selectedModelName || "No model"}"; attach .lib/.sub. Run is refused; no generic substitution.`
      : selectedModelOption.source !== "generic"
        ? `Ready · exact ${selectedModelOption.modelType.toUpperCase()} model from ${selectedModelOption.sourceLabel}`
        : JUNCTION_KINDS.has(modelKind)
          ? junctionModelSummary(selected, null)
          : `Generic starter · fine for topology checks; not a manufacturer part.`;

  /* The value, not just the kind: a `vsource` holding `SINE(...)` is a sine
   * source and must say so. Titling it from the kind alone is the exact frame
   * the report photographed - "DC source" above a Waveform reading Sine. The
   * second argument is optional and ignored for every non-source kind, so it is
   * safe to pass unconditionally. */
  const title = componentDisplayName(selected.kind, selected.value);
  const headline = componentHeadline(selected);

  return (
    /*
     * Named only when there are several parts to tell apart.
     *
     * The floating inspector's own dialog is called `R1 properties`, and this
     * section used to be called the same thing unconditionally - two live
     * nodes under one accessible name, which makes `getByRole` ambiguous and
     * is exactly the "old and new are both mounted" signature the shell
     * contract test watches for. With one part the dialog has already said
     * whose properties these are; with several, each group has to.
     */
    <section
      className="property-group"
      aria-label={groupCount > 1 ? `${selected.label || title} properties` : undefined}
    >
      <button
        type="button"
        className="property-group-header"
        aria-expanded={groupOpen}
        onClick={() => setGroupOpen((open) => !open)}
      >
        <span className={`property-group-chevron${groupOpen ? " open" : ""}`} aria-hidden="true">›</span>
        {/* The symbol rides in the header rather than in a separate identity
            block above the grid. One group looks like every other group that
            way, and in a multi-part selection the drawing is what tells a
            resistor's group from a capacitor's at a glance. */}
        <svg className="property-group-symbol" viewBox="-44 -40 88 80" aria-hidden="true">
          <g className="symbol">
            <ComponentSymbol kind={selected.kind} value={selected.value} />
          </g>
        </svg>
        <span className="property-group-title">{title}</span>
        {/* Collapsed, the title alone is not enough to tell two resistors
            apart, so the group keeps carrying its identity and its value. */}
        <span className="property-group-aside mono-num">
          {groupOpen ? selected.label : [selected.label, headline].filter(Boolean).join(" · ")}
        </span>
      </button>
      {groupOpen && (
        <div className="property-grid">
          {selected.kind === "ground" ? (
            <>
              <div className="property-field">
                <span>Electrical node</span>
                <span className="mono-num property-readonly" aria-label="Electrical node">0 · ground</span>
              </div>
              <label className="property-field">
                <span>Display label</span>
                <input
                  className="mono-num property-text"
                  value={selected.label}
                  aria-label="Ground display label"
                  placeholder="optional"
                  spellCheck={false}
                  onFocus={() => { editKeyRef.current = null; }}
                  onChange={(event) => {
                    beginParamChange("label");
                    setLabel(selected.id, event.currentTarget.value);
                  }}
                />
              </label>
            </>
          ) : (
            <label className="property-field">
              <span>Component ID</span>
              <ComponentIdInput
                component={selected}
                components={components}
                onBeginChange={() => beginParamChange("label")}
                onFocusField={() => { editKeyRef.current = null; }}
                onCommit={(label) => setLabel(selected.id, label)}
              />
            </label>
          )}
          {selected.kind === "vsource" || selected.kind === "isource" || selected.kind === "vac" || selected.kind === "iac" || selected.kind === "vpulse" ? (
            <IndependentSourceEditor
              value={valueSource}
              unit={selected.kind === "isource" || selected.kind === "iac" ? "A" : "V"}
              legacyKind={selected.kind === "vac" || selected.kind === "iac" || selected.kind === "vpulse" ? selected.kind : undefined}
              onBeginChange={beginParamChange}
              onValueChange={(value) => setValue(selected.id, value)}
              /* Alias convergence. A part stored as vac/vpulse whose new
               * waveform that dialect cannot hold becomes canonical vsource in
               * the SAME undoable transaction as the value rewrite, so kind and
               * value can never disagree. No beginParamChange beside it - the
               * store action snapshots itself. */
              onIdentityChange={(kind, value) => { setSourceIdentity(selected.id, kind, value); }}
            />
          ) : selected.kind === "bsource" ? (
            <BehavioralSourceEditor
              value={valueSource}
              onBeginChange={beginParamChange}
              onValueChange={(value) => setValue(selected.id, value)}
            />
          ) : selected.kind === "subckt" ? (
            <>
              <ProjectSubcircuitLinkEditor
                component={selected}
                choices={projectSheetOptions}
                sheetInterfaces={sheetInterfaces}
                projectFilePath={projectFilePath}
                comparedSource={comparedSource}
                onOpenSheet={onOpenSheet}
                onSaveSheetAsSim={onSaveSheetAsSim}
              />
              {selected.projectSubcircuit ? (
                <>
                  <div className="property-field">
                    {/* Deliberately not "Sheet block name": the editable field
                        of that name sits a few rows up, and two identical
                        labels in one panel is how a reader edits the wrong
                        one. This row is the saved value, read-only. */}
                    <span>Linked sheet block</span>
                    <span className="mono-num property-readonly">{selected.projectSubcircuit.model}</span>
                  </div>
                  <ol className="port-list" aria-label="Sheet block port order">
                    {selected.projectSubcircuit.ports.map((port, index) => (
                      <li key={`${index}-${port}`}>
                        <span className="port-index mono-num">{index + 1}</span>
                        <span className="port-name mono-num">{port}</span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : manualModelControls ? (
                <label className="property-field">
                  <span>Subcircuit model</span>
                  <Select
                    value={(selectedSubcircuit?.name ?? subcircuitInstance?.name) || undefined}
                    onOpenChange={(open) => {
                      if (open) editKeyRef.current = null;
                    }}
                    onValueChange={(nextName) => {
                      const choice = availableSubcircuits.find((option) => option.name === nextName);
                      if (!choice) return;
                      beginParamChange("subcircuit-model");
                      setSubcircuitModel(selected.id, choice.name, choice.ports);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="property-select mono-num w-full max-w-[168px]"
                      aria-label="Subcircuit model"
                    >
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      {!selectedSubcircuit && subcircuitInstance?.name && (
                        <SelectItem value={subcircuitInstance.name}>
                          {subcircuitInstance.name} · missing
                        </SelectItem>
                      )}
                      {availableSubcircuits.map((option) => (
                        <SelectItem
                          key={`${option.source}:${option.sourceLabel}:${option.name}`}
                          value={option.name}
                        >
                          {option.name} · {option.ports.length} terminals · {option.sourceLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <div className="property-field">
                  <span>Subcircuit identity</span>
                  <span className="mono-num property-readonly">{subcircuitInstance?.name || "none"}</span>
                </div>
              )}
              {!selected.projectSubcircuit && (
                <p className="property-hint" role="status">
                  {selectedSubcircuit
                    ? `Ready · ${selectedSubcircuit.ports.length} terminals from ${selectedSubcircuit.sourceLabel}`
                    : `Needs definition · ${subcircuitInstance?.name || "No subcircuit"} is not attached; Run is refused.`}
                </p>
              )}
              {/* The status line names the terminals; it cannot say which pin on
                  the drawing is which. This does, in the declaration order the
                  netlist writes the nodes in, so a reader can wire the block
                  without opening the .lib that defines it. */}
              {!selected.projectSubcircuit && selectedSubcircuit && (
                <ol className="port-list" aria-label="Terminal order">
                  {selectedSubcircuit.ports.map((port, index) => {
                    const side = subcircuitPortSides(selected, selectedSubcircuit.ports)[index];
                    return (
                      <li key={`${index}-${port}`}>
                        <span className="port-index mono-num">{index + 1}</span>
                        <span className="port-name mono-num">{port}</span>
                        {side && <span className="port-side">{side}</span>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {!selected.projectSubcircuit && selectedSubcircuit?.parameters.map((parameter) => {
                const parameterLabel = parameter.label ?? parameter.name;
                const parameterValue = subcircuitInstance
                  ? subcircuitParameterValue(subcircuitInstance.overrides, parameter.name) ?? parameter.defaultValue
                  : parameter.defaultValue;
                return (
                  <div key={parameter.name} className="property-parameter">
                    <label className="property-field">
                      <span>{parameterLabel}</span>
                      {parameter.label ? (
                        <EngineeringInput
                          value={parameterValue}
                          unit={parameter.unit ?? ""}
                          label={parameterLabel}
                          min={parameter.min}
                          max={parameter.max}
                          minExclusive={parameter.minExclusive}
                          onBeginChange={() => beginParamChange(`subcircuit-${parameter.name}`)}
                          onValueChange={(value) => updateSubcircuitParameter(
                            parameter.name,
                            value,
                            parameter.defaultValue,
                          )}
                        />
                      ) : (
                        <input
                          className="mono-num property-text"
                          value={parameterValue}
                          aria-label={`Subcircuit parameter ${parameter.name}`}
                          spellCheck={false}
                          onFocus={() => {
                            editKeyRef.current = null;
                          }}
                          onChange={(event) => {
                            beginParamChange(`subcircuit-${parameter.name}`);
                            updateSubcircuitParameter(parameter.name, event.currentTarget.value, parameter.defaultValue);
                          }}
                        />
                      )}
                    </label>
                    {parameter.description && <InspectorHint text={parameter.description} />}
                  </div>
                );
              })}
              {!selected.projectSubcircuit && selectedSubcircuit && selectedSubcircuit.parameters.length === 0 && (
                <p className="property-hint">Terminals only; this model has no instance parameters.</p>
              )}
              {!selected.projectSubcircuit && onAttachModelFile && (
                <>
                  <p className="property-hint">Open or drop a compatible .lib/.sub into this schematic.</p>
                  <Button type="button" variant="outline" size="sm" onClick={onAttachModelFile}>
                    Attach .lib/.sub file
                  </Button>
                </>
              )}
            </>
          ) : modelKind ? (
            manualModelControls && idealJunction ? (
              <>
                <p className="property-hint" role="status">{modelStatusHint}</p>
                <div className="advanced-settings property-advanced">
                  <button
                    type="button"
                    className="disclosure-header"
                    onClick={() => setAdvancedOpen((open) => !open)}
                    aria-expanded={advancedOpen}
                    aria-label="Toggle Advanced device model parameters"
                  >
                    <span className="disclosure-label">Advanced device model parameters</span>
                    <span className="disclosure-rule" aria-hidden="true" />
                    <span className={`disclosure-chevron${advancedOpen ? " open" : ""}`}>›</span>
                  </button>
                  {advancedOpen && (
                    <div className="advanced-body">
                      <p className="property-hint">
                        Named or attached models replace this ideal; Tau never substitutes a generic named device.
                      </p>
                      {modelChooserField}
                      {modelParamFields}
                      {attachLibraryAction}
                    </div>
                  )}
                </div>
              </>
            ) : manualModelControls ? (
              <>
                {modelChooserField}
                <p className="property-hint" role="status">{modelStatusHint}</p>
                {modelParamFields}
                {attachLibraryAction}
              </>
            ) : (
              <>
                <p className="property-hint" role="status">{modelStatusHint}</p>
                {basicModelParamFields}
                {modelAdvancedDisclosure}
                {attachLibraryAction}
              </>
            )
          ) : selected.kind === "opamp" ? (
            manualModelControls ? (
              <>
                {opamp?.mode === "vendor" ? (
                  <>
                    <label className="property-field">
                      <span>Part</span>
                      <input
                        className="mono-num property-text"
                        value={opamp.partName}
                        aria-label="Op-amp part"
                        readOnly
                      />
                    </label>
                    <label className="property-field">
                      <span>Simulation model</span>
                      <input
                        className="mono-num property-text"
                        value={opamp.modelName}
                        aria-label="Op-amp simulation model"
                        spellCheck={false}
                        maxLength={160}
                        pattern="[^\\s=(){};]+"
                        title="Use one SPICE subcircuit name (no spaces or parameter syntax)."
                        onFocus={() => {
                          editKeyRef.current = null;
                        }}
                        onChange={(event) => {
                          beginParamChange("model");
                          setOpampModel(selected.id, event.currentTarget.value);
                        }}
                      />
                    </label>
                    <p className="property-hint" role="status">
                      {opampStatus?.kind === "ready"
                        ? `Ready · exact five-terminal subcircuit from ${opampStatus.source === "library" ? "an attached vendor file" : "this document"}`
                        : opampStatus?.kind === "incompatible"
                          ? `Pin count · model has ${opampStatus.portCount} terminals; this symbol needs five`
                          : "Needs a library model · Tau will not substitute a generic gain block"}
                    </p>
                    {opampStatus?.kind !== "ready" && onAttachModelFile && (
                      <Button type="button" variant="outline" size="sm" onClick={onAttachModelFile}>
                        Attach .lib/.sub file
                      </Button>
                    )}
                  </>
                ) : (
                  <label className="property-field">
                    <span>Model</span>
                    <Select
                      value={customOpamp ? "__custom__" : selected.value}
                      onValueChange={(next) => {
                        beginParamChange("model");
                        setValue(selected.id, next);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="property-select mono-num w-full max-w-[168px]"
                        aria-label="Op-amp model"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent>
                        {customOpamp && <SelectItem value="__custom__">Universal / behavioral</SelectItem>}
                        {OPAMP_LIBRARY.map((part) => (
                          <SelectItem key={part.part} value={part.part}>
                            {part.part}{part.part === "Ideal" ? "" : ` · ${part.manufacturer}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                {customOpamp && opamp?.mode === "behavioral" && (
                  <label className="property-field">
                    <span>Advanced parameters</span>
                    <input
                      className="mono-num property-text"
                      value={selected.value}
                      aria-label="Advanced op-amp parameters"
                      spellCheck={false}
                      onFocus={() => {
                        editKeyRef.current = null;
                      }}
                      onChange={(event) => {
                        beginParamChange("parameters");
                        setValue(selected.id, event.currentTarget.value);
                      }}
                    />
                  </label>
                )}
                {opampPart && (
                  <p className="property-hint">
                    {Number.isFinite(opampPart.gbwHz) && opampPart.gbwHz > 0
                      ? `${formatEngineering(opampPart.gbwHz, "Hz", 2)} GBW · ${opampPart.slewRate} V/µs · ±${opampPart.supplyMax} V · ${opampPart.package}`
                      : "Ideal - infinite gain & bandwidth"}
                  </p>
                )}
              </>
            ) : (
              <>
                {opamp?.mode === "vendor" ? (
                  <>
                    <div className="property-field">
                      <span>Exact identity</span>
                      <span className="mono-num property-readonly">{opamp.partName}</span>
                    </div>
                    {opamp.modelName !== opamp.partName && (
                      <div className="property-field">
                        <span>Exact model</span>
                        <span className="mono-num property-readonly" aria-label="Exact model">{opamp.modelName}</span>
                      </div>
                    )}
                    <p className="property-hint" role="status">
                      {opampStatus?.kind === "ready"
                        ? `Ready · exact five-terminal subcircuit from ${opampStatus.source === "library" ? "an attached vendor file" : "this document"}`
                        : opampStatus?.kind === "incompatible"
                          ? `Pin count · model has ${opampStatus.portCount} terminals; this symbol needs five`
                          : "Needs a library model · Tau will not substitute a generic gain block"}
                    </p>
                    {opampStatus?.kind !== "ready" && onAttachModelFile && (
                      <Button type="button" variant="outline" size="sm" onClick={onAttachModelFile}>
                        Attach .lib/.sub file
                      </Button>
                    )}
                  </>
                ) : opamp?.imported ? (
                  <p className="property-hint" role="status">
                    Imported behavioral op-amp · exact identity and provenance are read-only. Identity: {opamp.partName}.
                  </p>
                ) : (
                  <>
                    <p className="property-hint" role="status">Generic Tau op-amp · validated gain and output limits.</p>
                    {genericOpampFields}
                  </>
                )}
              </>
            )
          ) : (
            <>
              {/* A part whose meaning lives in pins the panel has no field for
                  (the modulator's FM, AM and COM) says so above its numbers. */}
              {partSummary && <InspectorHint text={partSummary} />}
              {visibleFields.map((field) => (
                <Fragment key={field.key}>
                  <label className="property-field">
                    <span>{field.label}</span>
                    <ParamValueControl
                      field={field}
                      value={field.value}
                      onBeginChange={() => beginParamChange(field.key)}
                      onFocusField={() => { editKeyRef.current = null; }}
                      onValueChange={(value) => updateParam(field.key, value)}
                    />
                  </label>
                  {field.description && <InspectorHint text={field.description} />}
                </Fragment>
              ))}
              {/*
                * The raw-value escape hatch, for a part with no field schema
                * but something to edit. A flip-flop has neither: its catalog
                * default is "" and nothing writes to it, so this rendered a
                * row labelled `Value` containing an empty box - a control that
                * looks broken because there is no value for it to hold.
                */}
              {visibleFields.length === 0 && entry
                && Boolean(selected.value.trim() || entry.defaultValue.trim()) && (
                <label className="property-field">
                  <span>Value</span>
                  <input
                    className="mono-num"
                    value={selected.value}
                    aria-label="Value"
                    spellCheck={false}
                    onFocus={() => {
                      editKeyRef.current = null;
                    }}
                    onChange={(event) => {
                      beginParamChange("value");
                      setValue(selected.id, event.currentTarget.value);
                    }}
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The Properties panel: a titled group per selected part.
 *
 * Selection has been a LIST in the store for as long as marquee select has
 * existed (`selectedIds`), but this panel took one component and the store
 * nulls `selectedId` unless exactly one thing is selected - so selecting two
 * parts produced "No Selection · Select a component…" while two components sat
 * highlighted on the canvas. Taking the list is what fixes that, and it is also
 * what the reference does: one group per part, each collapsible, each editing
 * its own component.
 *
 * A single component is still passed as a single component, because that is
 * what every caller and every test already had.
 */
// Exported for component tests only (same pattern as the plot components).
export function ComponentInspector({
  selected,
  onAttachModelFile,
  manualModelControls = false,
  projectFilePath = null,
  sheetInterfaces = [],
  comparedSource,
  onOpenSheet,
  onSaveSheetAsSim,
}: {
  selected: SchematicComponent | readonly SchematicComponent[] | null;
  onAttachModelFile?: () => void;
  manualModelControls?: boolean;
  projectFilePath?: string | null;
  /** Advisory path -> interface index, built and memoised by App. */
  sheetInterfaces?: readonly ProjectSheetInterfaceEntry[];
  comparedSource?: "open-tab" | "disk";
  /** Open a project sheet in a tab (parent -> child navigation). */
  onOpenSheet?: (sheetPath: string) => void;
  /**
   * Save the current `.asc` tab as a `.sim`, so it can own sheet blocks. OMIT it
   * and no such button is drawn: App does not implement this yet, and a control
   * that is only ever disabled tells the reader nothing.
   */
  onSaveSheetAsSim?: () => void;
}) {
  const parts: readonly SchematicComponent[] = !selected
    ? []
    : Array.isArray(selected)
      ? selected
      : [selected as SchematicComponent];

  if (parts.length === 0) {
    return (
      <div className="component-inspector">
        <div className="inspector-summary empty">
          <strong>No Selection</strong>
          <span>Select a component, wire, node, or label to view and edit its properties.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`component-inspector${parts.length > 1 ? " component-inspector--multi" : ""}`}>
      {/* One part identifies itself in its own group header. Several need a
          line saying how many, because the groups below are then a list and a
          reader has to know whether they are looking at all of it. */}
      {parts.length > 1 && (
        <div className="inspector-summary multi">
          <strong className="mono-num">{parts.length} components</strong>
          <span>Each group edits its own part.</span>
        </div>
      )}
      {parts.map((part) => (
        <ComponentPropertyGroup
          key={part.id}
          component={part}
          groupCount={parts.length}
          manualModelControls={manualModelControls}
          onAttachModelFile={onAttachModelFile}
          projectFilePath={projectFilePath}
          sheetInterfaces={sheetInterfaces}
          comparedSource={comparedSource}
          onOpenSheet={onOpenSheet}
          onSaveSheetAsSim={onSaveSheetAsSim}
        />
      ))}
    </div>
  );
}

export function WireInspector({ wire }: { wire: SchematicWire }) {
  const setWireResistance = useSchematic((s) => s.setWireResistance);
  const beginChange = useSchematic((s) => s.beginChange);
  const editKeyRef = useRef<string | null>(null);
  const resistance = wire.resistance ?? "";
  const ideal = !resistance.trim() || resistance.trim() === "0";

  return (
    <div className="component-inspector">
      <div className="inspector-summary">
        <strong>Wire</strong>
        <span>{ideal ? "Ideal conductor" : `Series ${resistance}Ω`}</span>
      </div>
      <div className="property-grid">
        <label className="property-field">
          <span>Resistance</span>
          <EngineeringInput
            label="Wire series resistance"
            value={ideal ? "0" : resistance}
            unit="Ω"
            onBeginChange={() => {
              if (editKeyRef.current !== wire.id) {
                beginChange();
                editKeyRef.current = wire.id;
              }
            }}
            onValueChange={(value) => {
              const trimmed = value.trim();
              setWireResistance(wire.id, trimmed === "0" ? "" : trimmed);
            }}
          />
        </label>
        <p className="property-hint">0 / empty = ideal short. Non-zero (e.g. 10 mΩ) inserts a series resistor in the netlist.</p>
      </div>
    </div>
  );
}

/** Right-rail panel: Properties (inspector) + Library (place palette). */
export function ComponentsRail({
  focusSignal,
  onNotice,
  resize,
  maxWidth,
  embedded = false,
  offsetRight = 0,
}: {
  focusSignal: number;
  onNotice: (message: string) => void;
  /** Width state is shell-owned so Explorer and this rail update in one render. */
  resize: ReturnType<typeof usePanelWidth>;
  /** Responsive ceiling supplied by the shell after reserving Explorer and the editor. */
  maxWidth?: number;
  /** When inside the shared right dock, the dock owns width and the resize handle. */
  embedded?: boolean;
  /**
   * Pixels to leave clear on the right, so the overlay lands beside the
   * assistant rather than on top of it. Zero when the assistant is closed.
   */
  offsetRight?: number;
}) {
  const responsiveMaxWidth = componentsRailMaxWidth(maxWidth);
  const componentsWidth = componentsRailWidth(resize.width, maxWidth);

  return (
    <aside
      className={`components-rail${embedded ? " components-rail--embedded" : ""}`}
      aria-label="Components"
      style={embedded ? undefined : { width: componentsWidth, right: offsetRight }}
    >
      {!embedded && (
        <PanelResizeHandle
          edge="left"
          label="Resize properties panel"
          width={componentsWidth}
          minWidth={COMPONENTS_RAIL_WIDTH.minWidth}
          maxWidth={responsiveMaxWidth}
          dragging={resize.dragging}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
        />
      )}
      {/*
        * Just the parts library now.
        *
        * A "Properties | Library" segmented control stood here, which is two
        * unrelated things crammed into one column to justify the column: the
        * parts you might add, and the settings of the part you already have.
        * Properties moved to the selection itself (inspector/), where you can
        * read a resistor's value without looking 900px away from the resistor,
        * and the segmented control went with it - there is nothing left to
        * segment. The rail keeps its "Components" name because the thing it
        * names, the place parts come from, has not changed.
        */}
      <div className="components-rail-body">
        <Palette focusSignal={focusSignal} onNotice={onNotice} />
      </div>
    </aside>
  );
}

/*
 * `MinimizedPanelDock` stood here: a floating orb offering to restore the
 * analysis panel. It is gone with stage 4a, and it was already dead before
 * that - the `onClose` that hid the panel was declared, passed and never
 * destructured, so nothing could reach the state the orb existed to undo.
 *
 * Nothing replaces it. The results drawer's peek state is a readout, not an
 * icon: the lamp, the run facts and the issue count are all still on screen
 * when it is collapsed, which is strictly more than an orb labelled "Graphs"
 * ever said.
 */
