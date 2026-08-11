/**
 * Schematic editor chrome, moved out of ShellPanels.tsx.
 *
 * This module owns the editor's tool strip and tab row. The components are
 * deliberately kept as a pure relocation: their props, store reads, markup,
 * and interaction semantics remain the same so editor behavior can be
 * reviewed independently from Explorer and inspector work.
 */
import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Crosshair,
  Eraser,
  Library,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useSchematic } from "../../store/useSchematic";

export function EditorToolbar({
  mode,
  isRunning,
  onRun,
  onStop,
  onClearScratchpad,
  modelLibraryCount,
  onOpenModelLibraries,
  onOpenSimulationSetup,
}: {
  mode: "schematic" | "simulator";
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onClearScratchpad: () => void;
  modelLibraryCount: number;
  onOpenModelLibraries: () => void;
  onOpenSimulationSetup: () => void;
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
      <IconButton title="Clear schematic" disabled={readOnly} onClick={onClearScratchpad}>
        <Eraser size={16} strokeWidth={1.6} />
      </IconButton>
      <span className="toolbar-divider" />
      <IconButton title="Model libraries" onClick={onOpenModelLibraries}>
        <Library size={16} strokeWidth={1.6} />
        {modelLibraryCount > 0 && (
          <span className="toolbar-count" aria-hidden="true">{modelLibraryCount}</span>
        )}
      </IconButton>
      <IconButton title="Simulation setup" disabled={readOnly} onClick={onOpenSimulationSetup}>
        <SlidersHorizontal size={16} strokeWidth={1.6} />
      </IconButton>
      <div className="editor-toolbar-spacer" />
      <div className="transport">
        <button className="transport-play" title="Run simulation" aria-label="Run simulation" onClick={onRun} disabled={isRunning}>
          <Play size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          className="transport-stop"
          title="Clear current simulation result"
          aria-label="Stop simulation"
          onClick={onStop}
        >
          <Square size={12} strokeWidth={1.6} aria-hidden="true" />
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
              />
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
              <X size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button className="editor-tab add" aria-label="New tab" onClick={onNewCircuit}>
        <Plus size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <div className="editor-tab-spacer" />
      {mode === "simulator" && (
        <button className="editor-hide" aria-label="Return to schematic editor" onClick={onHideSimulator}>
          <ArrowLeft size={12} strokeWidth={1.8} aria-hidden="true" />
          Schematic
        </button>
      )}
    </div>
  );
}
