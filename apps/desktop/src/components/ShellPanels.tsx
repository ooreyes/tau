import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import {
  ChevronRight,
  CopyMinus,
  File,
  FolderOpen,
  Folder,
  Search,
  FilePlus,
  FolderPlus,
  RefreshCw,
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
import { useSchematic } from "../store/useSchematic";
import { useProject } from "../store/useProject";
import { basename, isAscFile, type ProjectNode } from "../project/types";
import type { AnalysisResult } from "../simulation/linearTransient";
import { formatEngineering } from "../simulation/quantity";
import { loadAssistantApiKey, saveAssistantApiKey } from "../lib/assistant";
import { PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "./panelResize";

/** Drag-to-resize bounds for the two side panels (§11 Unit B). Minimums keep
 *  every control usable (tree rows, property fields); maximums keep the canvas
 *  from being starved even at the 900px minimum window. */
const EXPLORER_PANEL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.explorerWidth",
  defaultWidth: 226,
  minWidth: 168,
  maxWidth: 420,
  edge: "right",
};

const COMPONENTS_RAIL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.ui.componentsRailWidth",
  defaultWidth: 264,
  minWidth: 208,
  maxWidth: 480,
  edge: "left",
};

interface ModeProps {
  mode: "schematic" | "simulator";
  partsOpen: boolean;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onSearch: () => void;
  onFocusComponents: () => void;
  onOpenSettings: () => void;
}

export function ActivityRail({
  mode,
  partsOpen,
  onModeChange,
  onSearch,
  onFocusComponents,
  onOpenSettings,
}: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic"} label="Explorer" onClick={() => onModeChange("schematic")}>
        <FolderOpen size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton label="Search" shortcut="⌘K" onClick={onSearch}>
        <Search size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton active={partsOpen} label="Components" onClick={onFocusComponents}>
        <CircuitBoard size={18} strokeWidth={1.6} />
      </RailButton>
      <RailButton active={mode === "simulator"} label="Waveforms" onClick={() => onModeChange("simulator")}>
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
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={`rail-btn${active ? " active" : ""}`} aria-label={label} onClick={onClick}>
          {active && <span className="rail-active" />}
          <span className="rail-lucide" aria-hidden="true">
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{shortcut ? `${label} — ${shortcut}` : label}</TooltipContent>
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

function normalizedExplorerPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function explorerParentPath(path: string): string {
  const normalized = normalizedExplorerPath(path);
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : "";
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

export function ExplorerPanel({
  activeFilePath,
  onOpenSimFile,
  onOpenAscText,
  onNotice,
  onMoveNode,
}: {
  activeFilePath: string | null;
  onOpenSimFile: (path: string, title: string, json: string) => void;
  onOpenAscText: (path: string, title: string, text: string) => void;
  onNotice: (message: string) => void;
  /** Atomic project-store move action; optional only for isolated panel hosts. */
  onMoveNode?: MoveProjectNode;
}) {
  const rootPath = useProject((s) => s.rootPath);
  const rootName = useProject((s) => s.rootName);
  const tree = useProject((s) => s.tree);
  const expanded = useProject((s) => s.expanded);
  const error = useProject((s) => s.error);
  const capability = useProject((s) => s.capability);
  const detectCapability = useProject((s) => s.detectCapability);
  const ensureDefaultWorkspace = useProject((s) => s.ensureDefaultWorkspace);
  const openFolder = useProject((s) => s.openFolder);
  const newProject = useProject((s) => s.newProject);
  const refresh = useProject((s) => s.refresh);
  const toggleExpanded = useProject((s) => s.toggleExpanded);
  const collapseAll = useProject((s) => s.collapseAll);
  const createFolder = useProject((s) => s.createFolder);
  const createSchematicFile = useProject((s) => s.createSchematicFile);
  const importAscFile = useProject((s) => s.importAscFile);
  const deleteNode = useProject((s) => s.deleteNode);
  const readSim = useProject((s) => s.readSim);
  const ascInputRef = useRef<HTMLInputElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [createDraft, setCreateDraft] = useState<{
    kind: "file" | "folder";
    parentPath: string;
    name: string;
  } | null>(null);
  const [draggedNode, setDraggedNode] = useState<ProjectNode | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const resize = usePanelWidth(EXPLORER_PANEL_WIDTH);
  const resizeHandle = (
    <PanelResizeHandle
      edge="right"
      label="Resize project explorer"
      width={resize.width}
      minWidth={EXPLORER_PANEL_WIDTH.minWidth}
      maxWidth={EXPLORER_PANEL_WIDTH.maxWidth}
      dragging={resize.dragging}
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
    />
  );

  useEffect(() => {
    void detectCapability().then(() => {
      ensureDefaultWorkspace();
    });
  }, [detectCapability, ensureDefaultWorkspace]);

  const openNode = async (path: string, name: string) => {
    try {
      const text = await readSim(path);
      if (isAscFile(name)) onOpenAscText(path, name, text);
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

  const beginNodeDrag = (event: DragEvent<HTMLButtonElement>, node: ProjectNode) => {
    setDraggedNode(node);
    setDropTargetPath(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-tau-project-node", node.path);
    event.dataTransfer.setData("text/plain", node.path);
  };

  const endNodeDrag = () => {
    setDraggedNode(null);
    setDropTargetPath(null);
  };

  const clearDropTarget = () => setDropTargetPath(null);

  const moveDraggedNode = async (destinationDirectoryPath: string) => {
    const source = draggedNode;
    endNodeDrag();
    if (!source || !canMoveProjectNode(source.path, destinationDirectoryPath)) return;
    if (!onMoveNode) {
      onNotice("Moving explorer items needs a project move action.");
      return;
    }
    try {
      const movedPath = await onMoveNode(source.path, destinationDirectoryPath);
      if (movedPath) onNotice(`Moved ${source.name}`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : `Could not move ${source.name}.`);
    }
  };

  const markDropTarget = (event: DragEvent<HTMLElement>, destinationDirectoryPath: string) => {
    if (!draggedNode || !canMoveProjectNode(draggedNode.path, destinationDirectoryPath)) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetPath(destinationDirectoryPath);
  };

  if (!rootPath) {
    return (
      <aside className="explorer-panel" aria-label="Project explorer" style={{ width: resize.width }}>
        <div className="explorer-head">
          <span>Schematics</span>
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
          <p className="explorer-empty-hint">Open a folder of LTspice schematics, or create one for Tau.</p>
          <div className="explorer-empty-actions">
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                const ok = await openFolder();
                if (ok) onNotice("Opened Schematics folder.");
              }}
            >
              Open Folder
            </Button>
            {capability === "tauri" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await newProject("Schematics");
                  if (ok) onNotice("Created Schematics folder.");
                }}
              >
                Create Folder
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => ascInputRef.current?.click()}>
              Import .asc…
            </Button>
          </div>
        </div>
        {resizeHandle}
      </aside>
    );
  }

  return (
    <aside className="explorer-panel" aria-label="Project explorer" style={{ width: resize.width }}>
      <div className="explorer-head">
        <span>{rootName ?? "Schematics"}</span>
        <div className="explorer-icons">
          <button
            type="button"
            title="New schematic file"
            aria-label="New schematic file"
            onClick={() => setCreateDraft({ kind: "file", parentPath: rootPath, name: "untitled.asc" })}
          >
            <FilePlus size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            onClick={() => setCreateDraft({ kind: "folder", parentPath: rootPath, name: "New Folder" })}
          >
            <FolderPlus size={15} strokeWidth={1.7} />
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
            <RefreshCw size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            title="Collapse folders in explorer"
            aria-label="Collapse folders in explorer"
            onClick={collapseAll}
          >
            <CopyMinus size={15} strokeWidth={1.7} />
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
        Drag a file or folder onto a folder, or onto empty explorer space, to move it.
      </p>

      <div
        className="tree-list"
        data-drop-target={dropTargetPath === rootPath || undefined}
        onDragOver={(event) => markDropTarget(event, rootPath)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetPath(null);
        }}
        onDrop={(event) => {
          if (!draggedNode || !canMoveProjectNode(draggedNode.path, rootPath)) return;
          event.preventDefault();
          event.stopPropagation();
          void moveDraggedNode(rootPath);
        }}
      >
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
        <ProjectTree
          nodes={tree}
          depth={0}
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
          draggedPath={draggedNode?.path ?? null}
          dropTargetPath={dropTargetPath}
          onDragStart={beginNodeDrag}
          onDragEnd={endNodeDrag}
          onDragOverFolder={markDropTarget}
          onDragLeaveFolder={clearDropTarget}
          onDropFolder={moveDraggedNode}
        />
      </div>

      <div className="explorer-secondary-actions" aria-label="Project actions">
        <button
          type="button"
          onClick={async () => {
            if (capability === "none") {
              onNotice("Opening a disk folder needs the Tau desktop app.");
              return;
            }
            const ok = await openFolder();
            if (ok) onNotice("Opened project folder.");
          }}
        >
          Open Folder…
        </button>
        <button type="button" onClick={() => ascInputRef.current?.click()}>
          Import .asc…
        </button>
      </div>

      {error && <p className="explorer-error" role="alert">{error}</p>}
      {resizeHandle}
    </aside>
  );
}

function ProjectTree({
  nodes,
  depth,
  expanded,
  activeFilePath,
  onToggle,
  onOpenFile,
  onNewFolder,
  onNewFile,
  onDelete,
  draggedPath,
  dropTargetPath,
  onDragStart,
  onDragEnd,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder,
}: {
  nodes: ProjectNode[];
  depth: number;
  expanded: string[];
  activeFilePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onNewFolder: (parent: string) => void;
  onNewFile: (parent: string) => void;
  onDelete: (path: string, name: string) => void;
  draggedPath: string | null;
  dropTargetPath: string | null;
  onDragStart: (event: DragEvent<HTMLButtonElement>, node: ProjectNode) => void;
  onDragEnd: () => void;
  onDragOverFolder: (event: DragEvent<HTMLElement>, destinationDirectoryPath: string) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (destinationDirectoryPath: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "dir") {
          const open = expanded.includes(node.path);
          return (
            <div key={node.path} className="tree-dir">
              <button
                type="button"
                className="tree-folder-row"
                style={{ paddingLeft: 8 + depth * 12 }}
                draggable
                data-dragging={draggedPath === node.path || undefined}
                data-drop-target={dropTargetPath === node.path || undefined}
                aria-describedby="explorer-drag-help"
                title={`Drag ${node.name} onto another folder to move it`}
                onClick={() => onToggle(node.path)}
                onDragStart={(event) => onDragStart(event, node)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => onDragOverFolder(event, node.path)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragLeaveFolder();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDropFolder(node.path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const action = window.prompt(`Folder “${node.name}”: type folder / asc / delete`, "folder");
                  if (action === "folder") onNewFolder(node.path);
                  else if (action === "asc") onNewFile(node.path);
                  else if (action === "delete") onDelete(node.path, node.name);
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
              {open && node.children && (
                <ProjectTree
                  nodes={node.children}
                  depth={depth + 1}
                  expanded={expanded}
                  activeFilePath={activeFilePath}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  onNewFolder={onNewFolder}
                  onNewFile={onNewFile}
                  onDelete={onDelete}
                  draggedPath={draggedPath}
                  dropTargetPath={dropTargetPath}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOverFolder={onDragOverFolder}
                  onDragLeaveFolder={onDragLeaveFolder}
                  onDropFolder={onDropFolder}
                />
              )}
            </div>
          );
        }
        const active = node.path === activeFilePath;
        return (
          <button
            key={node.path}
            type="button"
            className={`tree-file${active ? " active" : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            aria-current={active ? "page" : undefined}
            draggable
            data-dragging={draggedPath === node.path || undefined}
            aria-describedby="explorer-drag-help"
            title={`Drag ${node.name} onto a folder to move it`}
            onClick={() => onOpenFile(node.path, node.name)}
            onDragStart={(event) => onDragStart(event, node)}
            onDragEnd={onDragEnd}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`Delete “${node.name}”?`)) onDelete(node.path, node.name);
            }}
          >
            <File className="tree-file-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
            <span className="tree-file-name">{node.name}</span>
          </button>
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
  // The simulator view is read-only (pan/zoom/probe only — see Canvas's
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
        {/* Orthogonal wire with junction endpoints — schematic wires are
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
  onNewCircuit,
  onHideSimulator,
}: {
  tabs: { id: string; title: string }[];
  activeId: string;
  mode: "schematic" | "simulator";
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewCircuit: () => void;
  onHideSimulator: () => void;
}) {
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
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              }
            }}
          >
            <i className={active ? "amber" : "blue"} />
            {tab.title.replace(/\.sim$/i, "")}
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

export function BottomPanel({ result }: { mode?: "schematic" | "simulator"; result: AnalysisResult | null }) {
  const messages = [
    ...(result && !result.ok ? [result.message] : []),
    ...(result?.warnings ?? []),
  ];
  const hasIssues = messages.length > 0;
  const hasError = Boolean(result && !result.ok);
  const isIdle = result === null;
  const isClean = Boolean(result?.ok) && !hasIssues;
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
      className={`bottom-panel${hasIssues ? " has-issues" : ""}${hasError ? " has-error" : ""}${hasIssues && !hasError ? " has-warning" : ""}${isClean ? " is-clean" : ""}${isIdle ? " is-idle" : ""}${panelExpanded ? "" : " is-collapsed"}`}
      aria-label="Simulation diagnostics"
    >
      {isIdle || isClean ? (
        <div className="bottom-panel-head bottom-panel-head--static">
          <span className="bottom-panel-state" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              {isIdle ? <path d="M3 6h6" /> : <path d="M2.3 6.3 4.8 8.8 9.8 3.5" />}
            </svg>
          </span>
          <span className="bottom-panel-title">Diagnostics</span>
          <span className="bottom-panel-clear" role="status">
            {isIdle ? "Not run" : "No issues"}
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
                    : "Ideal — infinite gain & bandwidth"}
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
}: {
  focusSignal: number;
  onNotice: (message: string) => void;
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

  const resize = usePanelWidth(COMPONENTS_RAIL_WIDTH);

  return (
    <aside className="components-rail" aria-label="Components" style={{ width: resize.width }}>
      <PanelResizeHandle
        edge="left"
        label="Resize properties panel"
        width={resize.width}
        minWidth={COMPONENTS_RAIL_WIDTH.minWidth}
        maxWidth={COMPONENTS_RAIL_WIDTH.maxWidth}
        dragging={resize.dragging}
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
      />
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
  const [apiKeyInput, setApiKeyInput] = useState(loadAssistantApiKey);

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
            <label className="settings-field" htmlFor="assistant-api-key">
              <span>Anthropic API key</span>
              <Input
                id="assistant-api-key"
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
              <span className="settings-field-hint">Kept only for this Tau session and sent only to api.anthropic.com.</span>
            </label>
          </div>
          <SettingsRow label="Command palette" hint="⌘K · F2 · / — search & place parts">
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
        // destructive action — Radix otherwise focuses the content itself.
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
