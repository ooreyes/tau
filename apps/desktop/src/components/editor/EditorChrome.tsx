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
  MousePointer2,
  Play,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import { useSchematic } from "../../store/useSchematic";
/* P3-12/P3-13: the tool glyphs moved to their own module so this file stays a
 * strip of controls rather than a sheet of path data. Select and Simulation
 * setup keep their lucide glyphs - they depict no object, so DESIGN_SYSTEM 0.1
 * keeps them neutral and there was nothing to redraw. */
import { EraserIcon, MultimeterIcon, RedoIcon, TagIcon, TOOL_ICON_SIZE, TrashIcon, UndoIcon, WireIcon } from "./ToolIcons";

export function EditorToolbar({
  mode,
  isRunning,
  onRun,
  onStop,
  onClearScratchpad,
  onOpenSimulationSetup,
}: {
  mode: "schematic" | "simulator";
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onClearScratchpad: () => void;
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
        <MousePointer2 size={TOOL_ICON_SIZE} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Wire" tone="wire" active={tool.mode === "wire"} disabled={readOnly} onClick={startWiring}>
        <WireIcon />
      </IconButton>
      <IconButton title="Net label (F4)" tone="tag" active={tool.mode === "label"} disabled={readOnly} onClick={startLabeling}>
        <TagIcon />
      </IconButton>
      <IconButton title="Probe" tone="probe" active={tool.mode === "probe"} onClick={startProbing}>
        {/* The METER, not a lead: the button is the instrument you pick up,
            and the cursor (probeCursor) is the red lead you touch to a node. */}
        <MultimeterIcon />
      </IconButton>
      <span className="toolbar-divider" />
      <IconButton title="Undo" tone="undo" disabled={!canUndo || readOnly} onClick={undo}>
        <UndoIcon />
      </IconButton>
      <IconButton title="Redo" tone="redo" disabled={!canRedo || readOnly} onClick={redo}>
        <RedoIcon />
      </IconButton>
      <IconButton title="Delete selection (Delete)" tone="trash" disabled={!hasSelection || readOnly} onClick={deleteSelected}>
        <TrashIcon />
      </IconButton>
      <IconButton title="Clear schematic" tone="eraser" disabled={readOnly} onClick={onClearScratchpad}>
        <EraserIcon />
      </IconButton>
      <IconButton title="Simulation setup" disabled={readOnly} onClick={onOpenSimulationSetup}>
        <SlidersHorizontal size={TOOL_ICON_SIZE} strokeWidth={1.6} />
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
  tone,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  /**
   * Names the real object this tool depicts, and is the button's only colour
   * channel (P3-13). It arrives twice on purpose: as a `tool-<tone>` class,
   * which is what styles/editorToolbarIcons.css feeds the glyph's two paint
   * slots from, and as `data-tone`, which is what a test can read without
   * asserting on a class name that is really a stylesheet's private business.
   * Omitted for tools with no real-world counterpart - they stay neutral, per
   * DESIGN_SYSTEM 0.1.
   */
  tone?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`editor-icon-btn${tone ? ` tool-${tone}` : ""}${active ? " active" : ""}`}
      data-tone={tone}
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
