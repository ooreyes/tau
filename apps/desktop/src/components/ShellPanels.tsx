import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { userFacingErrorMessage } from "../lib/errorMessage";
import {
  ChevronRight,
  Copy,
  File,
  FilePlus,
  FolderOpen,
  Folder,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  Eraser,
  MousePointer2,
  Tag,
  Crosshair,
  Undo2,
  Redo2,
  Settings,
  CircuitBoard,
  Activity,
} from "lucide-react";
import {
  VscodeCollapseAllIcon,
  VscodeImportFileIcon,
  VscodeImportFolderIcon,
  VscodeNewFileIcon,
  VscodeNewFolderIcon,
  VscodeRefreshIcon,
} from "./VscodeExplorerIcons";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import type { SchematicComponent, SchematicWire } from "../schematic/types";
import { decodeParams, encodeParams, paramFields } from "../schematic/params";
import { EngineeringInput } from "./EngineeringInput";
import { Palette } from "./Palette";
import { OPAMP_LIBRARY, findOpAmp } from "../library/opamps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import type { AnalysisResult } from "../simulation/linearTransient";
import { formatEngineering } from "../simulation/quantity";
import { loadAssistantApiKey, saveAssistantApiKey, useAssistantApiKey } from "../lib/assistant";
import {
  saveAssistantPreferences,
  useAssistantPreferences,
  type AssistantProviderChoice,
} from "../lib/assistantPreferences";
import {
  LOCAL_AI_PRESETS,
  getLocalAiStatus,
  installLocalAiRuntime,
  startLocalAi,
  stopLocalAi,
  type LocalAiPresetInfo,
  type LocalAiStatus,
} from "../lib/localAiRuntime";
import {
  importCustomLocalAiModel,
  loadCustomLocalAiModels,
  removeCustomLocalAiModel,
} from "../lib/localAiModels";
import { clampPanelWidth, PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "./panelResize";

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

interface ModeProps {
  mode: "schematic" | "simulator";
  explorerOpen: boolean;
  partsOpen: boolean;
  projectOpen?: boolean;
  schematicOpen?: boolean;
  onFocusExplorer: () => void;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onSearch: () => void;
  onFocusComponents: () => void;
  onOpenSettings: () => void;
}

export function ActivityRail({
  mode,
  explorerOpen,
  partsOpen,
  projectOpen = true,
  schematicOpen = true,
  onFocusExplorer,
  onModeChange,
  onSearch,
  onFocusComponents,
  onOpenSettings,
}: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic" && explorerOpen} label="Explorer" onClick={onFocusExplorer}>
        <FolderOpen size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton label="Search" shortcut="⌘K" onClick={onSearch} disabled={!projectOpen}>
        <Search size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton active={partsOpen && schematicOpen} label="Components" onClick={onFocusComponents} disabled={!schematicOpen}>
        <CircuitBoard size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton active={mode === "simulator"} label="Waveforms" onClick={() => onModeChange("simulator")} disabled={!schematicOpen}>
        <Activity size={18} strokeWidth={1.6} />
      </RailButton>
      <div className="rail-spacer" />
      <RailButton label="Settings" onClick={onOpenSettings}>
        <Settings size={18} strokeWidth={1.6} />
      </RailButton>
    </nav>
  );
}

function RailButton({
  active = false,
  label,
  shortcut,
  disabled = false,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={`rail-btn${active ? " active" : ""}`} aria-label={label} onClick={onClick} disabled={disabled}>
          {active && <span className="rail-active" />}
          <span className="rail-lucide" aria-hidden="true">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{shortcut ? `${label} - ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  );
}

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
  onOpenAscText: (path: string, title: string, text: string) => void | Promise<void>;
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
  const importAscFile = useProject((s) => s.importAscFile);
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

  const importAscFromInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    let destination = useProject.getState().rootPath;
    if (!destination) {
      const created = capability === "tauri"
        ? await newProject("Schematics")
        : await openFolder();
      destination = created ? useProject.getState().rootPath : null;
    }
    if (!destination) {
      onNotice("Choose a Schematics folder to import this file.");
      return;
    }

    const path = await importAscFile(destination, file);
    if (path) {
      onNotice(`Imported ${basename(path)}`);
      await openNode(path, basename(path));
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
              <VscodeImportFolderIcon />
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
                <VscodeNewFolderIcon />
              </button>
            )}
            <button
              type="button"
              title="Import LTspice schematic"
              aria-label="Import LTspice schematic"
              onClick={() => ascInputRef.current?.click()}
            >
              <VscodeImportFileIcon />
            </button>
          </div>
        </div>
        <input
          ref={ascInputRef}
          className="file-input"
          type="file"
          accept=".asc"
          title="Import LTspice schematic"
          onChange={importAscFromInput}
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
            <VscodeNewFileIcon />
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
            <VscodeNewFolderIcon />
          </button>
          <button
            type="button"
            title="Import LTspice schematic"
            aria-label="Import LTspice schematic"
            onClick={() => ascInputRef.current?.click()}
          >
            <VscodeImportFileIcon />
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
            <VscodeRefreshIcon />
          </button>
          <button
            type="button"
            title="Collapse folders in explorer"
            aria-label="Collapse folders in explorer"
            onClick={collapseAll}
          >
            <VscodeCollapseAllIcon />
          </button>
        </div>
      </div>

      <input
        ref={ascInputRef}
        className="file-input"
        type="file"
        accept=".asc"
        title="Import LTspice schematic"
        onChange={importAscFromInput}
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

export function EditorToolbar({
  mode,
  isRunning,
  onRun,
  onStep,
  onStop,
  onClearScratchpad,
}: {
  mode: "schematic" | "simulator";
  isRunning: boolean;
  onRun: () => void;
  onStep: () => void;
  onStop: () => void;
  onClearScratchpad: () => void;
}) {
  // The simulator view is read-only (pan/zoom/probe only - see Canvas's
  // `interactive` prop and App.tsx's keydown gate); every editing control in
  // this toolbar must be inert there too. Select (cancel) and Probe stay
  // enabled: cancel doesn't mutate the document, and probing is how traces
  // get added while viewing the simulator.
  const readOnly = mode !== "schematic";
  const tool = useSchematic((s) => s.tool);
  const cancel = useSchematic((s) => s.cancel);
  const startWiring = useSchematic((s) => s.startWiring);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const startProbing = useSchematic((s) => s.startProbing);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const canUndo = useSchematic((s) => s.past.length > 0);
  const canRedo = useSchematic((s) => s.future.length > 0);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const hasSelection = useSchematic((s) => Boolean(
    s.selectedId
    || s.selectedIds.length > 0
    || s.selectedWireId
    || s.selectedWireIds.length > 0
    || s.selectedLabelIds.length > 0
    || s.selectedProbeIds.length > 0
  ));

  return (
    <div className="editor-toolbar" aria-label="Editor toolbar">
      <IconButton title="Select" active={tool.mode === "select"} onClick={cancel}>
        <MousePointer2 size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Wire" active={tool.mode === "wire"} disabled={readOnly} onClick={startWiring}>
        {/* Orthogonal wire with junction endpoints - schematic wires are
            axis-aligned, so the glyph is a dogleg, not a freeform spline. */}
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.2 12.2 H8 V3.8 H12.8" />
          <circle cx="3.2" cy="12.2" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12.8" cy="3.8" r="1.7" fill="currentColor" stroke="none" />
        </svg>
      </IconButton>
      <IconButton title="Net label (F4)" active={tool.mode === "label"} disabled={readOnly} onClick={startLabeling}>
        <Tag size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Probe" active={tool.mode === "probe"} onClick={startProbing}>
        <Crosshair size={16} strokeWidth={1.6} />
      </IconButton>
      <span className="toolbar-divider" />
      <IconButton title="Undo" disabled={!canUndo || readOnly} onClick={undo}>
        <Undo2 size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Redo" disabled={!canRedo || readOnly} onClick={redo}>
        <Redo2 size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Delete selection (Delete)" disabled={!hasSelection || readOnly} onClick={deleteSelected}>
        <Trash2 size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Clear scratchpad" disabled={readOnly} onClick={onClearScratchpad}>
        <Eraser size={16} strokeWidth={1.6} />
      </IconButton>
      <div className="editor-toolbar-spacer" />
      <div className="transport">
        <button className="transport-play" title="Run simulation" aria-label="Run simulation" onClick={onRun} disabled={isRunning}>▶</button>
        <button
          className="transport-stop"
          title="Clear current simulation result"
          aria-label="Stop simulation"
          onClick={onStop}
        >
          ■
        </button>
        <button
          title="Re-run transient at finer resolution"
          aria-label="Refine transient resolution"
          onClick={onStep}
          disabled={isRunning}
        >
          ▸▌
        </button>
      </div>
    </div>
  );
}

function IconButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`editor-icon-btn${active ? " active" : ""}`}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <span className="editor-lucide" aria-hidden="true">{children}</span>
    </button>
  );
}

export function EditorTabs({
  tabs,
  activeId,
  mode,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewCircuit,
  onHideSimulator,
}: {
  tabs: { id: string; title: string; dirty?: boolean }[];
  activeId: string;
  mode: "schematic" | "simulator";
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onNewCircuit: () => void;
  onHideSimulator: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const cancelTabRenameRef = useRef(false);
  const commitTabRename = () => {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (cancelTabRenameRef.current) {
      cancelTabRenameRef.current = false;
      return;
    }
    if (id && name) onRenameTab(id, name);
  };
  return (
    <div className="editor-tabs" role="tablist" aria-label="Open schematics">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`editor-tab${active ? " active" : ""}`}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              cancelTabRenameRef.current = false;
              setRenamingId(tab.id);
              setRenameValue(tab.title);
            }}
            onKeyDown={(event) => {
              if (renamingId === tab.id) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              }
            }}
          >
            <i className={active ? "amber" : "blue"} />
            {renamingId === tab.id ? (
              <input
                className="editor-tab-rename"
                value={renameValue}
                aria-label={`Rename ${tab.title}`}
                autoFocus
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onChange={(event) => setRenameValue(event.currentTarget.value)}
                onBlur={commitTabRename}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    cancelTabRenameRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : tab.title.replace(/\.sim$/i, "")}
            {tab.dirty && (
              <span
                className="tab-dirty-indicator"
                role="img"
                aria-label={`${tab.title} has unsaved changes`}
                title="Unsaved changes"
              >
                ●
              </span>
            )}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="editor-tab add" aria-label="New tab" onClick={onNewCircuit}>＋</button>
      <div className="editor-tab-spacer" />
      {mode === "simulator" && <button className="editor-hide" aria-label="Return to schematic editor" onClick={onHideSimulator}>× back to schematic</button>}
    </div>
  );
}

export function BottomPanel({
  result,
  isRunning = false,
  notices = [],
}: {
  mode?: "schematic" | "simulator";
  result: AnalysisResult | null;
  isRunning?: boolean;
  /** Document-level warnings independent of a run (e.g. ASC import warnings -
   *  previously console-only, so "Opened with 2 warning(s)" was a dead end). */
  notices?: string[];
}) {
  // A live run supersedes the previous result's diagnostics. Keeping stale
  // success/error classes during a rerun would contradict the amber Run state.
  const messages = isRunning ? [] : [
    ...(result && !result.ok ? [result.message] : []),
    ...(result?.warnings ?? []),
    ...notices,
  ];
  const hasIssues = messages.length > 0;
  const hasError = !isRunning && Boolean(result && !result.ok);
  // Import notices must surface even before the first run - "idle" only when
  // there is genuinely nothing to show.
  const isIdle = !isRunning && result === null && !hasIssues;
  const isClean = !isRunning && Boolean(result?.ok) && !hasIssues;
  const issueSignature = messages.join("\u0000");
  const [expanded, setExpanded] = useState(hasIssues);

  // New issues must never remain hidden; returning to all-clear collapses the
  // panel back to its quiet one-line status rather than keeping empty chrome.
  useEffect(() => {
    setExpanded(Boolean(issueSignature));
  }, [issueSignature]);

  const panelExpanded = hasIssues && expanded;

  return (
    <section
      className={`bottom-panel${isRunning ? " is-running" : ""}${hasIssues ? " has-issues" : ""}${hasError ? " has-error" : ""}${hasIssues && !hasError ? " has-warning" : ""}${isClean ? " is-clean" : ""}${isIdle ? " is-idle" : ""}${panelExpanded ? "" : " is-collapsed"}`}
      aria-label="Simulation diagnostics"
    >
      {isRunning || isIdle || isClean ? (
        <div className="bottom-panel-head bottom-panel-head--static">
          <span className="bottom-panel-state" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              {isRunning
                ? <circle cx="6" cy="6" r="3.2" />
                : isIdle
                  ? <path d="M3 6h6" />
                  : <path d="M2.3 6.3 4.8 8.8 9.8 3.5" />}
            </svg>
          </span>
          <span className="bottom-panel-title">Diagnostics</span>
          <span className="bottom-panel-clear" role="status">
            {isRunning ? "Running" : isIdle ? "Not run" : "No issues"}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="bottom-panel-head"
          aria-expanded={panelExpanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <svg className="bottom-panel-chevron" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.2 6 7.8l3.5-3.6" />
          </svg>
          <span className="bottom-panel-state" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              {hasError ? (
                <path d="m4.2 4.2 3.6 3.6m0-3.6L4.2 7.8" />
              ) : (
                <path d="M6 1.8 10.4 10H1.6L6 1.8Zm0 2.9v2.5M6 8.7v.1" />
              )}
            </svg>
          </span>
          <span className="bottom-panel-title">{hasError ? "Errors" : "Warnings"}</span>
          <span
            className={`bottom-panel-count${hasError ? "" : " warnings-only"}`}
            aria-live="polite"
          >
            {messages.length}
          </span>
        </button>
      )}
      {panelExpanded && <div className="bottom-errors">
        {messages.map((message, index) => {
          const isErrorMessage = Boolean(result && !result.ok && index === 0);
          return (
            <div
              key={`${message}-${index}`}
              className={isErrorMessage ? "error" : "warning"}
              role={isErrorMessage ? "alert" : undefined}
            >
              <span className="bottom-error-glyph" aria-hidden="true">
                <svg viewBox="0 0 12 12">
                  {isErrorMessage ? (
                    <path d="m4.2 4.2 3.6 3.6m0-3.6L4.2 7.8" />
                  ) : (
                    <path d="M6 1.8 10.4 10H1.6L6 1.8Zm0 2.9v2.5M6 8.7v.1" />
                  )}
                </svg>
              </span>
              <span className="bottom-error-message">{message}</span>
            </div>
          );
        })}
      </div>}
    </section>
  );
}

// Exported for component tests only (same pattern as the plot components).
export function ComponentInspector({ selected }: { selected: SchematicComponent | null }) {
  const entry = selected ? CATALOG_BY_KIND[selected.kind] : null;
  const setValue = useSchematic((s) => s.setValue);
  const setLabel = useSchematic((s) => s.setLabel);
  const beginChange = useSchematic((s) => s.beginChange);
  const editKeyRef = useRef<string | null>(null);
  const fields = selected && entry ? paramFields(selected.kind) : [];
  // Empty catalog values (e.g. Class-D MOSFETs) still show editable defaults.
  const valueSource = selected
    ? (selected.value.trim() || entry?.defaultValue || "")
    : "";
  const decoded = selected ? decodeParams(selected.kind, valueSource) : {};
  const visibleFields = fields.map((field) => ({
    ...field,
    value: decoded[field.key] ?? "",
    editable: true,
  }));

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

  const opampPart = selected?.kind === "opamp" ? findOpAmp(selected.value) : null;

  return (
    <div className="component-inspector">
      <div className={`inspector-summary${selected && entry ? "" : " empty"}`}>
        {selected && entry ? (
          <>
            <svg viewBox="-44 -40 88 80">
              <g className="symbol">
                <ComponentSymbol kind={selected.kind} />
              </g>
            </svg>
            <strong>{selected.label || entry.name}</strong>
            <span>{entry.name} · {selected.kind}</span>
          </>
        ) : (
          <>
            <strong>No Selection</strong>
            <span>Select a component, wire, node, or label to view and edit its properties.</span>
          </>
        )}
      </div>
      {selected && (
        <div className="property-grid">
          <label className="property-field">
            <span>Refdes</span>
            <input
              className="mono-num"
              value={selected.label}
              aria-label="Reference designator"
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
          {selected.kind === "opamp" ? (
            <>
              <label className="property-field">
                <span>Model</span>
                <select
                  className="mono-num"
                  aria-label="Op-amp model"
                  value={OPAMP_LIBRARY.some((p) => p.part === selected.value) ? selected.value : "Ideal"}
                  onChange={(event) => {
                    beginParamChange("model");
                    setValue(selected.id, event.currentTarget.value);
                  }}
                >
                  {OPAMP_LIBRARY.map((p) => (
                    <option key={p.part} value={p.part}>
                      {p.part}
                      {p.part === "Ideal" ? "" : ` · ${p.manufacturer}`}
                    </option>
                  ))}
                </select>
              </label>
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
              {visibleFields.map((field) => (
                <label key={field.key} className="property-field">
                  <span>{field.label}</span>
                  {field.unit ? (
                    <EngineeringInput
                      label={field.label}
                      value={field.value}
                      unit={field.unit}
                      onBeginChange={() => beginParamChange(field.key)}
                      onValueChange={(value) => updateParam(field.key, value)}
                    />
                  ) : (
                    <input
                      className="mono-num"
                      value={field.value}
                      aria-label={field.label}
                      spellCheck={false}
                      onFocus={() => {
                        editKeyRef.current = null;
                      }}
                      onChange={(event) => {
                        beginParamChange(field.key);
                        updateParam(field.key, event.currentTarget.value);
                      }}
                    />
                  )}
                </label>
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
    </div>
  );
}

function WireInspector({ wire }: { wire: SchematicWire }) {
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
}: {
  focusSignal: number;
  onNotice: (message: string) => void;
  /** Width state is shell-owned so Explorer and this rail update in one render. */
  resize: ReturnType<typeof usePanelWidth>;
  /** Responsive ceiling supplied by the shell after reserving Explorer and the editor. */
  maxWidth?: number;
  /** When inside the shared right dock, the dock owns width and the resize handle. */
  embedded?: boolean;
}) {
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const selected = components.find((c) => c.id === selectedId) ?? null;
  const selectedWire = wires.find((w) => w.id === selectedWireId) ?? null;
  const [segment, setSegment] = useState<"properties" | "library">(
    selected || selectedWire ? "properties" : "library",
  );

  useEffect(() => {
    if (selected || selectedWire) setSegment("properties");
  }, [selected?.id, selectedWire?.id]);

  useEffect(() => {
    // A blank sheet is the one state where Properties cannot help. Reset the
    // persistent rail to Library whenever the active document becomes empty,
    // including when switching from a populated tab to a new blank tab.
    if (components.length === 0 && wires.length === 0) setSegment("library");
  }, [components.length, wires.length]);

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
      style={embedded ? undefined : { width: componentsWidth }}
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
      <div className="components-rail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={segment === "properties"}
          className={segment === "properties" ? "active" : undefined}
          onClick={() => setSegment("properties")}
        >
          Properties
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === "library"}
          className={segment === "library" ? "active" : undefined}
          onClick={() => setSegment("library")}
        >
          Library
        </button>
      </div>
      <div className="components-rail-body">
        {segment === "properties" ? (
          selected ? (
            <ComponentInspector selected={selected} />
          ) : selectedWire ? (
            <WireInspector wire={selectedWire} />
          ) : (
            <ComponentInspector selected={null} />
          )
        ) : (
          <Palette focusSignal={focusSignal} onNotice={onNotice} />
        )}
      </div>
    </aside>
  );
}

export function SettingsPanel({
  title,
  onClose,
  onNewCircuit,
  onOpenCommandPalette,
  onNotice,
}: {
  title: string;
  onClose: () => void;
  onNewCircuit: () => void;
  onOpenCommandPalette: () => void;
  onNotice: (message: string) => void;
}) {
  const probes = useSchematic((s) => s.probes);
  const clearProbes = useSchematic((s) => s.clearProbes);
  const setProbeColor = useSchematic((s) => s.setProbeColor);
  const storedApiKey = useAssistantApiKey();
  const [apiKeyInput, setApiKeyInput] = useState(loadAssistantApiKey);
  const assistantPreferences = useAssistantPreferences();
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [localAiError, setLocalAiError] = useState<string | null>(null);
  const [customLocalModels, setCustomLocalModels] = useState(loadCustomLocalAiModels);
  const [customModelRepository, setCustomModelRepository] = useState("");

  useEffect(() => setApiKeyInput(storedApiKey), [storedApiKey]);

  useEffect(() => {
    if (assistantPreferences.provider !== "local-mlx") return;
    let cancelled = false;
    setLocalAiStatus(null);
    setLocalAiError(null);
    void getLocalAiStatus().then((status) => {
      if (!cancelled) setLocalAiStatus(status);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLocalAiError(userFacingErrorMessage(error, "Could not inspect the local MLX runtime."));
      }
    });
    return () => { cancelled = true; };
  }, [assistantPreferences.provider, assistantPreferences.localModel]);

  // Starting is asynchronous in native code: poll only while weights are
  // loading, and stop immediately once the endpoint reports ready/error.
  useEffect(() => {
    if (assistantPreferences.provider !== "local-mlx" || localAiStatus?.state !== "starting") return;
    let cancelled = false;
    const timer = globalThis.setInterval(() => {
      void getLocalAiStatus().then((status) => {
        if (!cancelled) setLocalAiStatus(status);
      }).catch((error: unknown) => {
        if (!cancelled) setLocalAiError(userFacingErrorMessage(error, "Could not inspect the local MLX runtime."));
      });
    }, 900);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [assistantPreferences.provider, localAiStatus?.state]);

  const runLocalAiAction = async (action: () => Promise<LocalAiStatus>) => {
    setLocalAiBusy(true);
    setLocalAiError(null);
    try {
      setLocalAiStatus(await action());
    } catch (error) {
      setLocalAiError(userFacingErrorMessage(error, "The local MLX runtime action failed."));
    } finally {
      setLocalAiBusy(false);
    }
  };

  const localPresets = [
    ...(localAiStatus?.presets.length ? localAiStatus.presets : LOCAL_AI_PRESETS),
    ...customLocalModels,
  ];
  const selectedLocalPreset = localPresets.find((preset) => preset.id === assistantPreferences.localModel)
    ?? LOCAL_AI_PRESETS.find((preset) => preset.id === assistantPreferences.localModel)!;
  const localStateLabel = localAiStatus
    ? localAiStatus.state === "ready"
      ? "Ready"
      : localAiStatus.state === "starting"
        ? "Starting"
        : localAiStatus.state === "error"
          ? "Error"
          : "Stopped"
    : "Checking";

  const PROBE_SWATCHES = [
    "var(--trace-red)",
    "var(--trace-purple)",
    "var(--trace-cyan)",
    "var(--trace-green)",
    "var(--trace-amber)",
    "var(--trace-cream)",
  ];

  const clearAutosave = () => {
    try {
      localStorage.removeItem("tau.schematic.v1");
      onNotice("Local autosave cleared.");
    } catch {
      onNotice("Local autosave could not be cleared in this webview.");
    }
  };

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent className="settings-panel" closeLabel="Close settings">
        <SheetHeader>
          <span className="settings-sheet-kicker">Settings</span>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">Workspace and document settings for this scratchpad.</SheetDescription>
        </SheetHeader>
        <div className="settings-list">
          <div className="settings-section">
            <span className="settings-sheet-kicker">Assistant</span>
            <div className="settings-field-grid">
              <label className="settings-field" htmlFor="assistant-provider">
                <span>Provider</span>
                <select
                  id="assistant-provider"
                  className="settings-select"
                  aria-label="Provider"
                  value={assistantPreferences.provider}
                  onChange={(event) => saveAssistantPreferences({
                    ...assistantPreferences,
                    provider: event.currentTarget.value as AssistantProviderChoice,
                  })}
                >
                  <option value="local-mlx">Local MLX</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <span className="settings-field-hint">
                  {assistantPreferences.provider === "local-mlx"
                    ? "Runs on this Mac through Tau's fixed loopback endpoint. Circuit context stays local."
                    : "Uses Claude Sonnet 5 through api.anthropic.com with your Keychain-protected key."}
                </span>
              </label>

              {assistantPreferences.provider === "local-mlx" ? (
                <>
                  <label className="settings-field" htmlFor="assistant-local-model">
                    <span>Local model</span>
                    <select
                      id="assistant-local-model"
                      className="settings-select"
                      aria-label="Local model"
                      value={assistantPreferences.localModel}
                      onChange={(event) => saveAssistantPreferences({
                        ...assistantPreferences,
                        localModel: event.currentTarget.value as LocalAiPresetInfo["id"],
                      })}
                    >
                      {localPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                    <span className="settings-field-hint">4B is recommended for circuit proposals and fits 8 GB Macs; 1.7B is a lighter explanation-first fallback.</span>
                  </label>

                  <div className="settings-field" aria-label="Custom local models">
                    <span>Import your MLX model</span>
                    <div className="settings-inline-actions">
                      <Input
                        value={customModelRepository}
                        aria-label="Hugging Face model repository"
                        placeholder="owner/model-name"
                        onChange={(event) => setCustomModelRepository(event.currentTarget.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!customModelRepository.trim()}
                        onClick={() => {
                          try {
                            const models = importCustomLocalAiModel(customModelRepository);
                            const imported = models.find((model) => model.repository === customModelRepository.trim());
                            setCustomLocalModels(models);
                            setCustomModelRepository("");
                            if (imported) saveAssistantPreferences({ provider: "local-mlx", localModel: imported.id });
                            onNotice("Local model imported. Choose Download & Start to fetch its weights.");
                          } catch (error) {
                            setLocalAiError(userFacingErrorMessage(error, "Could not import that model."));
                          }
                        }}
                      >
                        Import
                      </Button>
                      {selectedLocalPreset && "custom" in selectedLocalPreset && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!window.confirm(`Remove ${selectedLocalPreset.label} from Tau? Downloaded Hugging Face cache files are left untouched.`)) return;
                            setCustomLocalModels(removeCustomLocalAiModel(selectedLocalPreset.id));
                            saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
                            onNotice("Removed custom model from Tau.");
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <span className="settings-field-hint">Paste any MLX-compatible Hugging Face repository. Tau validates the name and passes it directly to the local MLX runtime-never through a shell.</span>
                  </div>

                  <div className="settings-local-runtime" data-state={localAiStatus?.state ?? "checking"}>
                    <div className="settings-local-runtime-head">
                      <span className="settings-local-state-dot" aria-hidden="true" />
                      <strong>Local inference · {localStateLabel}</strong>
                    </div>
                    <p role="status">
                      {localAiStatus?.detail ?? "Checking the native MLX runtime and model cache…"}
                    </p>
                    {localAiStatus && !selectedLocalPreset.downloaded && localAiStatus.state !== "ready" && (
                      <span className="settings-local-download">
                        {selectedLocalPreset.downloadMb > 0
                          ? `Download size: ${selectedLocalPreset.downloadMb.toLocaleString("en-US")} MB`
                          : "Download size is set by the imported repository."}
                      </span>
                    )}
                    {localAiError && <span className="settings-local-error" role="alert">{localAiError}</span>}
                    {localAiStatus && (
                      <div className="settings-local-actions">
                        {localAiStatus.state === "ready" || localAiStatus.state === "starting" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={localAiBusy || !localAiStatus.managed}
                            onClick={() => void runLocalAiAction(stopLocalAi)}
                          >
                            Stop
                          </Button>
                        ) : !localAiStatus.installed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={localAiBusy}
                            onClick={() => void runLocalAiAction(installLocalAiRuntime)}
                          >
                            Set up local AI
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={localAiBusy}
                            onClick={() => void runLocalAiAction(() => "custom" in selectedLocalPreset
                              ? startLocalAi(assistantPreferences.localModel, !selectedLocalPreset.downloaded, selectedLocalPreset.repository)
                              : startLocalAi(assistantPreferences.localModel, !selectedLocalPreset.downloaded))}
                          >
                            {selectedLocalPreset.downloaded ? "Start" : "Download & Start"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <label className="settings-field" htmlFor="assistant-api-key">
                  <span>Anthropic API key</span>
                  <Input
                    id="assistant-api-key"
                    aria-label="Anthropic API key"
                    type="password"
                    variant="mono"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-…"
                    value={apiKeyInput}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setApiKeyInput(next);
                      saveAssistantApiKey(next);
                    }}
                  />
                  <span className="settings-field-hint">Stored securely in your system keychain and sent only to api.anthropic.com.</span>
                </label>
              )}
            </div>
          </div>
          <SettingsRow label="Command palette" hint="⌘K · F2 · / - search & place parts">
            <Button size="sm" variant="outline" onClick={onOpenCommandPalette}>Open</Button>
          </SettingsRow>
          <SettingsRow label="Meter probes" hint={`${probes.length} placed on this schematic`}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearProbes();
                onNotice(probes.length > 0 ? "Cleared all probes." : "No probes to clear.");
              }}
            >
              Clear
            </Button>
          </SettingsRow>
          {probes.length > 0 && (
            <div className="probe-swatch-list" aria-label="Probe colors">
              {probes.map((probe, index) => (
                <div key={probe.id} className="probe-swatch-row">
                  <span className="probe-swatch-label">
                    {probe.componentId ? `I(${probe.componentId})` : `V${index + 1}`}
                  </span>
                  <div className="probe-swatches" role="group" aria-label={`Color for probe ${index + 1}`}>
                    {PROBE_SWATCHES.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`probe-swatch${probe.color === color ? " active" : ""}`}
                        style={{ background: color }}
                        aria-label={color.replace("var(--", "").replace(")", "")}
                        aria-pressed={probe.color === color}
                        onClick={() => setProbeColor(probe.id, color)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <SettingsRow label="Local autosave" hint="browser localStorage snapshot">
            <Button size="sm" variant="outline" onClick={clearAutosave}>Clear</Button>
          </SettingsRow>
          <SettingsRow label="Document" hint="discard this scratchpad, start blank">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onNewCircuit();
                onClose();
              }}
            >
              New blank
            </Button>
          </SettingsRow>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingsRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">{label}</span>
        <span className="settings-row-hint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

export function MinimizedPanelDock({
  graphHidden,
  onRestoreGraph,
}: {
  graphHidden: boolean;
  onRestoreGraph: () => void;
}) {
  return (
    <aside className="minimized-panel-dock" aria-label="Minimized panels">
      {graphHidden && (
        <button className="restore-orb graph" aria-label="Restore graphs panel" title="Restore graphs panel" onClick={onRestoreGraph}>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M5 19 11 10l4 5 8-11" />
            <path d="M20 4h4v4" />
          </svg>
          <span>Graphs</span>
        </button>
      )}
    </aside>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        role="alertdialog"
        className="confirm-dialog"
        // Focus Cancel, not Confirm, on open so a stray Enter can't fire the
        // destructive action - Radix otherwise focuses the content itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="confirm-dialog-body">{body}</DialogDescription>
        <DialogFooter className="confirm-actions">
          <Button data-autofocus variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
