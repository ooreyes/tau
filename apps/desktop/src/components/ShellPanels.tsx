import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
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
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { componentDisplayName } from "../schematic/componentNames";
import { engineeringSpelling } from "../schematic/engineering";
import { ComponentSymbol } from "../schematic/symbols";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import {
  clampParamValue,
  decodeParams,
  displayParamField,
  encodeParams,
  fromDisplayParamValue,
  isBoundedParamField,
  paramFields,
  paramRangeLabel,
  paramSummary,
  toDisplayParamValue,
  type ParamField,
} from "../schematic/params";
import { buildSubcircuitPinOverride, localSubcircuitPins } from "../schematic/subcircuitGeometry";
import { EngineeringInput } from "./EngineeringInput";
import { BehavioralSourceEditor } from "./BehavioralSourceEditor";
import { IndependentSourceEditor } from "./IndependentSourceEditor";
import { Palette } from "./Palette";
import { OPAMP_LIBRARY, findOpAmp } from "../library/opamps";
import { inspectOpampModel, opampIdentity } from "../engine/opampModel";
import { componentModelOptions, isModelComponentKind } from "../engine/componentModelCatalog";
import { hasLtspiceProvenance, idealJunctionModel, type IdealJunctionModel } from "../engine/idealModels";
import { definedModelNames } from "../engine/modelDirectives";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSchematic } from "../store/useSchematic";
import { useProject } from "../store/useProject";
import { basename, isAscFile, type ProjectNode } from "../project/types";
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
const EXPLORER_PANEL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.explorerWidth",
  defaultWidth: 226,
  minWidth: 168,
  maxWidth: 420,
  edge: "right",
};

export const COMPONENTS_RAIL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.componentsRailWidth",
  defaultWidth: 264,
  minWidth: 208,
  maxWidth: 480,
  edge: "left",
};

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
  const pointerDragRef = useRef<{
    node: ProjectNode;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const suppressClickPathRef = useRef<string | null>(null);
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

  return (
    <aside className="explorer-panel" aria-label="Project explorer" style={{ width: explorerWidth }}>
      <div className="explorer-head">
        <span>{rootName ?? "Schematics"}</span>
        <div className="explorer-icons">
          <button
            type="button"
            title="New schematic file"
            aria-label="New schematic file"
            onClick={() => {
              if (!expanded.includes(rootPath)) toggleExpanded(rootPath);
              setCreateDraft({ kind: "file", parentPath: rootPath, name: "untitled.asc" });
            }}
          >
            <FilePlus size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            onClick={() => {
              if (!expanded.includes(rootPath)) toggleExpanded(rootPath);
              setCreateDraft({ kind: "folder", parentPath: rootPath, name: "New Folder" });
            }}
          >
            <FolderPlus size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            title={IMPORT_BUTTON_LABEL}
            aria-label={IMPORT_BUTTON_LABEL}
            onClick={() => ascInputRef.current?.click()}
          >
            <FileInput size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Refresh explorer"
            aria-label="Refresh explorer"
            onClick={async () => {
              const ok = await refresh();
              if (ok) onNotice("Explorer refreshed.");
            }}
          >
            <RefreshCw size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Collapse folders in explorer"
            aria-label="Collapse folders in explorer"
            onClick={collapseAll}
          >
            <FoldVertical size={16} strokeWidth={1.6} aria-hidden="true" />
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
        <button
          type="button"
          className="tree-folder-row tree-project-root-row"
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
            depth={0}
            parentDirectoryPath={rootPath}
            expanded={expanded}
            activeFilePath={activeFilePath}
            onToggle={toggleExpanded}
            onOpenFile={openNode}
            onNewFolder={async (parent) => {
              setCreateDraft({ kind: "folder", parentPath: parent, name: "New Folder" });
            }}
            onNewFile={async (parent) => {
              setCreateDraft({ kind: "file", parentPath: parent, name: "untitled.asc" });
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
                <div className="tree-folder-row" style={{ paddingLeft: 8 + depth * 12 }}>
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
                    style={{ paddingLeft: 8 + depth * 12 }}
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
            <div key={node.path} className={`tree-file${active ? " active" : ""}`} style={{ paddingLeft: 8 + depth * 12 }}>
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
                style={{ paddingLeft: 8 + depth * 12 }}
                aria-current={active ? "page" : undefined}
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
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDropFolder(event, parentDirectoryPath);
                }}
              >
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
    const breakdown = ideal.breakdownVolts ? `, ${ideal.breakdownVolts} V reverse breakdown` : "";
    return `Ideal model · a fixed ${ideal.forwardVolts} V forward drop${breakdown}, no junction capacitance and no reverse recovery.`
      + " A part placed in Tau is the textbook device; one imported from an LTspice schematic keeps its real model.";
  }
  if (hasLtspiceProvenance(component)) {
    return "Generic starter · Tau's own Shockley junction, whose forward drop moves with current."
      + " This part came from an LTspice schematic, so it keeps that real model rather than Tau's ideal one.";
  }
  return "Defined by this schematic · a .model of this name is declared here, so Tau runs that card rather than its ideal part.";
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
): readonly (string | null)[] {
  const pins = component.pinOverride?.length
    ? localSubcircuitPins(component)
    : buildSubcircuitPinOverride({ x: 0, y: 0, rotation: 0, mirrored: false }, ports);
  if (pins.length !== ports.length) return ports.map(() => null);
  return pins.map((pin) => (pin.x < 0 ? "left" : pin.x > 0 ? "right" : null));
}

/**
 * A number the schema puts bounds on.
 *
 * The controlled input this replaces committed every keystroke and never
 * checked the range, so `min: 2, max: 5` on the gate's input count was a
 * comment: typing 21000 stored 21000, the symbol drew its five-lead maximum,
 * and the file and the drawing were describing different parts.
 *
 * Draft state committed on Enter or blur is the shape `OutputPointsControl`
 * already uses for exactly this problem. It CLAMPS rather than refuses -
 * rejecting per keystroke makes the box uneditable, because every half-typed
 * number is out of range - and the bound is printed next to the field, so it
 * is something you can see instead of something you hit.
 */
function BoundedParamInput({
  field,
  value,
  onBeginChange,
  onFocusField,
  onCommit,
}: {
  field: ParamField;
  value: string;
  onBeginChange: () => void;
  onFocusField: () => void;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = clampParamValue(field, draft);
    setDraft(next);
    if (next.trim() === value.trim()) return;
    onBeginChange();
    onCommit(next);
  };

  return (
    <input
      className="mono-num"
      value={draft}
      aria-label={field.label}
      inputMode="decimal"
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
}: {
  field: ParamField;
  value: string;
  onBeginChange: () => void;
  onFocusField: () => void;
  onValueChange: (next: string) => void;
}) {
  // Bounds, unit and the number itself, all in the unit the reader sees.
  const shown = displayParamField(field);
  const shownValue = toDisplayParamValue(field, value);
  const commit = (next: string) => onValueChange(fromDisplayParamValue(field, next));
  const range = paramRangeLabel(shown);
  const control = field.display ? (
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
    />
  ) : isBoundedParamField(shown) ? (
    <BoundedParamInput
      field={shown}
      value={shownValue}
      onBeginChange={onBeginChange}
      onFocusField={onFocusField}
      onCommit={commit}
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
  onOpenModelLibraries,
  groupCount = 1,
}: {
  component: SchematicComponent;
  onOpenModelLibraries?: () => void;
  /** How many groups are on screen; see the aria-label note below. */
  groupCount?: number;
}) {
  const selected = component;
  const entry = CATALOG_BY_KIND[selected.kind];
  const [groupOpen, setGroupOpen] = useState(true);
  const setValue = useSchematic((s) => s.setValue);
  const setSubcircuitModel = useSchematic((s) => s.setSubcircuitModel);
  const setOpampModel = useSchematic((s) => s.setOpampModel);
  const setLabel = useSchematic((s) => s.setLabel);
  const beginChange = useSchematic((s) => s.beginChange);
  const directives = useSchematic((s) => s.directives);
  const modelLibraries = useSchematic((s) => s.userModelLibraries);
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
  const modelKind = selected && isModelComponentKind(selected.kind) ? selected.kind : null;
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
    setValue(selected.id, encodeParams(selected.kind, { ...decodeParams(selected.kind, base), [key]: value }));
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

  // The model chooser, its per-field knobs and the library action are one set
  // of controls that live in two places: inline for a part whose real model is
  // the point, and behind Advanced for a part that is ideal until you go
  // looking. Built once so the two placements cannot drift apart.
  const modelChooserField = selected && modelKind ? (
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
            // KP/VTO belong to Tau's editable generic Level-1 model,
            // never to an exact vendor model. A VDMOS also has no W/L
            // instance geometry in ngspice. Drop stale, inapplicable
            // values at the model transition instead of emitting a
            // plausible-looking card the selected model ignores.
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
              {/* A marking the ideal path understands (a zener's `12V`) names
                  no library part, but it is not missing - the deck runs it. */}
              {selectedModelName} · {idealJunction ? "Tau ideal part" : "missing or incompatible"}
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

  const modelParamFields = modelKind ? visibleFields.filter((field) => {
    if (field.key === "model") return false;
    if (selectedModelOption?.modelType === "vdmos") return false;
    if (selectedModelOption?.source !== "generic" && (field.key === "kp" || field.key === "vto")) return false;
    return true;
  }).map((field) => (
    <label key={field.key} className="property-field">
      <span>{field.label}</span>
      <ParamValueControl
        field={field}
        value={field.value}
        onBeginChange={() => beginParamChange(field.key)}
        onFocusField={() => { editKeyRef.current = null; }}
        onValueChange={(value) => updateParam(field.key, value)}
      />
    </label>
  )) : null;

  const attachLibraryAction = onOpenModelLibraries
    && (!selectedModelOption || selectedModelOption.source === "generic") ? (
      <Button type="button" variant="outline" size="sm" onClick={onOpenModelLibraries}>
        Attach Model Library
      </Button>
    ) : null;

  // Ideal is tested FIRST: a zener marked `12V` names no library part, so the
  // missing-model branch would otherwise report a part the deck runs happily.
  const modelStatusHint = !selected || !modelKind ? "" : idealJunction
    ? junctionModelSummary(selected, idealJunction)
    : !selectedModelOption
      ? `Needs a model · ${selectedModelName || "No model"} isn't available. Run won't substitute a generic ${modelKind.toUpperCase()} — attach the library or choose Generic.`
      : selectedModelOption.source !== "generic"
        ? `Ready · exact ${selectedModelOption.modelType.toUpperCase()} model from ${selectedModelOption.sourceLabel}`
        : JUNCTION_KINDS.has(modelKind)
          ? junctionModelSummary(selected, null)
          : `Generic starter · fine for topology checks; not a manufacturer part.`;

  const title = componentDisplayName(selected.kind);
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
          <label className="property-field">
            <span>Refdes</span>
            <input
              className="mono-num"
              value={selected.label}
              aria-label="Reference designator"
              // An empty box says nothing; "none" says the part has no
              // designator yet, which is a different and true statement.
              placeholder="none"
              spellCheck={false}
              onFocus={() => {
                editKeyRef.current = null;
              }}
              onChange={(event) => {
                beginParamChange("label");
                setLabel(selected.id, event.currentTarget.value);
              }}
            />
          </label>
          {selected.kind === "vsource" || selected.kind === "isource" ? (
            <IndependentSourceEditor
              value={valueSource}
              unit={selected.kind === "vsource" ? "V" : "A"}
              onBeginChange={beginParamChange}
              onValueChange={(value) => setValue(selected.id, value)}
            />
          ) : selected.kind === "bsource" ? (
            <BehavioralSourceEditor
              value={valueSource}
              onBeginChange={beginParamChange}
              onValueChange={(value) => setValue(selected.id, value)}
            />
          ) : selected.kind === "subckt" ? (
            <>
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
              <p className="property-hint" role="status">
                {selectedSubcircuit
                  ? `Ready · ${selectedSubcircuit.ports.length} named terminals (${selectedSubcircuit.ports.join(", ")}) from ${selectedSubcircuit.sourceLabel}`
                  : `Needs a definition · ${subcircuitInstance?.name || "No subcircuit"} isn't in an attached library or this sheet. Run won't invent pins.`}
              </p>
              {/* The status line names the terminals; it cannot say which pin on
                  the drawing is which. This does, in the declaration order the
                  netlist writes the nodes in, so a reader can wire the block
                  without opening the .lib that defines it. */}
              {selectedSubcircuit && (
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
              {selectedSubcircuit?.parameters.map((parameter) => {
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
                    {parameter.description && <p className="property-hint">{parameter.description}</p>}
                  </div>
                );
              })}
              {selectedSubcircuit && selectedSubcircuit.parameters.length === 0 && (
                <p className="property-hint">This model defines terminals only; it has no instance parameters.</p>
              )}
              {/* The route from "I have a .lib" to "it is on my sheet" was only
                  offered once the value was already broken. It is the same two
                  steps whether or not a model is resolved, so it is stated
                  whenever this panel is open. */}
              {onOpenModelLibraries && (
                <>
                  <p className="property-hint">
                    Attach a .lib or .sub file in Model Libraries and every subcircuit it defines
                    joins the list above, terminals and parameters included.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={onOpenModelLibraries}>
                    Attach Model Library
                  </Button>
                </>
              )}
            </>
          ) : modelKind ? (
            idealJunction ? (
              // Ideal by default, real behind Advanced: the part already
              // behaves as the textbook device, so the headline states that in
              // numbers and the controls that take it off the ideal path are
              // the disclosed ones. A part that is NOT ideal keeps them inline
              // below - hiding the only control that describes it would be the
              // opposite of this rule.
              <>
                <p className="property-hint" role="status">{modelStatusHint}</p>
                <div className="advanced-settings property-advanced">
                  <button
                    type="button"
                    className="disclosure-header"
                    onClick={() => setAdvancedOpen((open) => !open)}
                    aria-expanded={advancedOpen}
                    aria-label="Toggle advanced settings"
                  >
                    <span className="disclosure-label">Advanced</span>
                    <span className="disclosure-rule" aria-hidden="true" />
                    <span className={`disclosure-chevron${advancedOpen ? " open" : ""}`}>›</span>
                  </button>
                  {advancedOpen && (
                    <div className="advanced-body">
                      <p className="property-hint">
                        Naming a manufacturer part, or attaching a library that defines one,
                        replaces the ideal device with its measured curve: the forward drop
                        then moves with current and temperature.
                      </p>
                      {modelChooserField}
                      {modelParamFields}
                      {attachLibraryAction}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {modelChooserField}
                <p className="property-hint" role="status">{modelStatusHint}</p>
                {modelParamFields}
                {attachLibraryAction}
              </>
            )
          ) : selected.kind === "opamp" ? (
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
                      ? `Ready · exact five-terminal subcircuit from ${opampStatus.source === "library" ? "Model Libraries" : "this document"}`
                      : opampStatus?.kind === "incompatible"
                        ? `Pin count · model has ${opampStatus.portCount} terminals; this symbol needs five`
                        : "Needs a library model · Tau will not substitute a generic gain block"}
                  </p>
                  {opampStatus?.kind !== "ready" && onOpenModelLibraries && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onOpenModelLibraries}
                    >
                      Attach Model Library
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
                      {customOpamp && (
                        <SelectItem value="__custom__">Universal / behavioral</SelectItem>
                      )}
                      {OPAMP_LIBRARY.map((p) => (
                        <SelectItem key={p.part} value={p.part}>
                          {p.part}
                          {p.part === "Ideal" ? "" : ` · ${p.manufacturer}`}
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
              {/* A part whose meaning lives in pins the panel has no field for
                  (the modulator's FM, AM and COM) says so above its numbers. */}
              {partSummary && <p className="property-hint">{partSummary}</p>}
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
                  {field.description && <p className="property-hint">{field.description}</p>}
                </Fragment>
              ))}
              {visibleFields.length === 0 && entry && (
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
  onOpenModelLibraries,
}: {
  selected: SchematicComponent | readonly SchematicComponent[] | null;
  onOpenModelLibraries?: () => void;
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
          onOpenModelLibraries={onOpenModelLibraries}
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
  const responsiveMaxWidth = Math.max(
    COMPONENTS_RAIL_WIDTH.minWidth,
    Math.min(COMPONENTS_RAIL_WIDTH.maxWidth, maxWidth ?? COMPONENTS_RAIL_WIDTH.maxWidth),
  );
  const componentsWidth = clampPanelWidth(
    resize.width,
    COMPONENTS_RAIL_WIDTH.minWidth,
    responsiveMaxWidth,
  );

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
