import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Folder,
  FolderOpen,
  Search,
  Plus,
  FilePlus,
  FolderPlus,
  FileInput,
  Trash2,
  MousePointer2,
  Spline,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSchematic } from "../store/useSchematic";
import { useProject } from "../store/useProject";
import { basename, isAscFile } from "../project/types";
import type { AnalysisResult } from "../simulation/linearTransient";
import { formatEngineering } from "../simulation/quantity";

interface ModeProps {
  mode: "schematic" | "simulator";
  partsOpen: boolean;
  onModeChange: (mode: "schematic" | "simulator") => void;
  onSearch: () => void;
  onFocusComponents: () => void;
  onOpenSettings: () => void;
}

export function ActivityRail({ mode, partsOpen, onModeChange, onSearch, onFocusComponents, onOpenSettings }: ModeProps) {
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

export function ExplorerPanel({
  activeFilePath,
  onOpenSimFile,
  onOpenAscText,
  onNotice,
}: {
  activeFilePath: string | null;
  onOpenSimFile: (path: string, title: string, json: string) => void;
  onOpenAscText: (path: string, title: string, text: string) => void;
  onNotice: (message: string) => void;
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
  const toggleExpanded = useProject((s) => s.toggleExpanded);
  const createFolder = useProject((s) => s.createFolder);
  const createSimFile = useProject((s) => s.createSimFile);
  const importAscFile = useProject((s) => s.importAscFile);
  const deleteNode = useProject((s) => s.deleteNode);
  const readSim = useProject((s) => s.readSim);
  const ascInputRef = useRef<HTMLInputElement | null>(null);

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

  const promptName = (label: string, fallback: string) => {
    const value = window.prompt(label, fallback);
    return value?.trim() || null;
  };

  if (!rootPath) {
    return (
      <aside className="explorer-panel" aria-label="Project explorer">
        <div className="explorer-head">
          <span>project</span>
        </div>
        <div className="explorer-empty">
          <p>Loading workspace…</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="explorer-panel" aria-label="Project explorer">
      <div className="explorer-head">
        <span>{rootName ?? "Powerboard"}</span>
        <div className="explorer-icons">
          <button
            title="Open folder on disk"
            aria-label="Open folder on disk"
            onClick={async () => {
              if (capability === "none") {
                onNotice("Opening a disk folder needs the Tau desktop app.");
                return;
              }
              const ok = await openFolder();
              if (ok) onNotice("Opened project folder.");
            }}
          >
            <Folder size={14} strokeWidth={1.6} />
          </button>
          <button
            title="New folder"
            aria-label="New folder"
            onClick={async () => {
              const name = promptName("Folder name", "circuits");
              if (!name) return;
              const path = await createFolder(rootPath, name);
              if (path) onNotice(`Created ${name}`);
            }}
          >
            <FolderPlus size={14} strokeWidth={1.6} />
          </button>
          <button
            title="New simulation"
            aria-label="New simulation"
            onClick={async () => {
              const name = promptName("Simulation name", "untitled.sim");
              if (!name) return;
              const path = await createSimFile(rootPath, name);
              if (path) {
                onNotice(`Created ${basename(path)}`);
                await openNode(path, basename(path));
              }
            }}
          >
            <FilePlus size={14} strokeWidth={1.6} />
          </button>
          <button
            title="Import LTspice .asc"
            aria-label="Import LTspice .asc"
            onClick={() => ascInputRef.current?.click()}
          >
            <FileInput size={14} strokeWidth={1.6} />
          </button>
          <input
            ref={ascInputRef}
            className="file-input"
            type="file"
            accept=".asc"
            title="Import LTspice schematic"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              const path = await importAscFile(rootPath, file);
              if (path) {
                onNotice(`Imported ${basename(path)}`);
                await openNode(path, basename(path));
              }
            }}
          />
        </div>
      </div>

      <div className="explorer-actions">
        <button
          type="button"
          onClick={async () => {
            const name = promptName("Folder name", "circuits");
            if (!name) return;
            const path = await createFolder(rootPath, name);
            if (path) onNotice(`Created folder ${name}`);
          }}
        >
          <FolderPlus size={12} strokeWidth={1.6} /> New Folder
        </button>
        <button
          type="button"
          onClick={async () => {
            const name = promptName("Simulation name", "untitled.sim");
            if (!name) return;
            const path = await createSimFile(rootPath, name);
            if (path) {
              onNotice(`Created ${basename(path)}`);
              await openNode(path, basename(path));
            }
          }}
        >
          <Plus size={12} strokeWidth={1.6} /> New .sim
        </button>
        <button type="button" onClick={() => ascInputRef.current?.click()}>
          <FileInput size={12} strokeWidth={1.6} /> Import .asc
        </button>
      </div>

      <div className="tree-list">
        <ProjectTree
          nodes={tree}
          depth={0}
          expanded={expanded}
          activeFilePath={activeFilePath}
          onToggle={toggleExpanded}
          onOpenFile={openNode}
          onNewFolder={async (parent) => {
            const name = promptName("Folder name", "circuits");
            if (!name) return;
            await createFolder(parent, name);
          }}
          onNewSim={async (parent) => {
            const name = promptName("Simulation name", "untitled.sim");
            if (!name) return;
            const path = await createSimFile(parent, name);
            if (path) await openNode(path, basename(path));
          }}
          onDelete={async (path, name) => {
            if (!window.confirm(`Delete “${name}”?`)) return;
            await deleteNode(path);
            onNotice(`Deleted ${name}`);
          }}
        />
      </div>

      {error && <p className="explorer-error" role="alert">{error}</p>}
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
  onNewSim,
  onDelete,
}: {
  nodes: import("../project/types").ProjectNode[];
  depth: number;
  expanded: string[];
  activeFilePath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onNewFolder: (parent: string) => void;
  onNewSim: (parent: string) => void;
  onDelete: (path: string, name: string) => void;
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
                onClick={() => onToggle(node.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const action = window.prompt(`Folder “${node.name}”: type folder / sim / delete`, "folder");
                  if (action === "folder") onNewFolder(node.path);
                  else if (action === "sim") onNewSim(node.path);
                  else if (action === "delete") onDelete(node.path, node.name);
                }}
              >
                <span className="tree-caret">{open ? "▾" : "▸"}</span>
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
                  onNewSim={onNewSim}
                  onDelete={onDelete}
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
            onClick={() => onOpenFile(node.path, node.name)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`Delete “${node.name}”?`)) onDelete(node.path, node.name);
            }}
          >
            <i className={active ? "amber" : "blue"} />
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

  return (
    <div className="editor-toolbar" aria-label="Editor toolbar">
      <IconButton title="Select" active={tool.mode === "select"} onClick={cancel}>
        <MousePointer2 size={16} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Wire" active={tool.mode === "wire"} disabled={readOnly} onClick={startWiring}>
        <Spline size={16} strokeWidth={1.6} />
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
      <IconButton title="Clear scratchpad" disabled={readOnly} onClick={onClearScratchpad}>
        <Trash2 size={16} strokeWidth={1.6} />
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

  return (
    <section
      className={`bottom-panel${hasIssues ? " has-issues" : ""}`}
      aria-label="Errors"
    >
      <div className="bottom-panel-head">
        <span className="bottom-panel-title">Errors</span>
        {hasIssues ? (
          <span className="bottom-panel-count" aria-live="polite">
            {messages.length}
          </span>
        ) : (
          <span className="bottom-panel-clear">Clear</span>
        )}
      </div>
      <div className="bottom-errors">
        {hasIssues ? (
          messages.map((message, index) => (
            <div
              key={`${message}-${index}`}
              className={result && !result.ok && index === 0 ? "error" : "warning"}
            >
              {message}
            </div>
          ))
        ) : (
          <p className="bottom-errors-idle">No build or simulation issues.</p>
        )}
      </div>
    </section>
  );
}

function ComponentInspector({ selected }: { selected: SchematicComponent | null }) {
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
            <strong>No component selected</strong>
            <span>Select a symbol to edit parameters.</span>
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

  return (
    <aside className="components-rail" aria-label="Components">
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

export function AskSimPanel({ result, onClose }: { result: AnalysisResult | null; onClose: () => void }) {
  const componentCount = useSchematic((s) => s.components.length);
  const wireCount = useSchematic((s) => s.wires.length);
  const state = result?.ok ? "analysis ready" : result && !result.ok ? "needs attention" : "waiting for run";
  const [draft, setDraft] = useState("Summarize my board.");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "user", text: "Summarize my board." },
  ]);
  const summary = result?.ok
    ? `This schematic has ${componentCount} parts, ${wireCount} wires, and ${result.stats.sampleCount} transient samples across ${formatEngineering(result.stats.stopTime, "s", 3)}.`
    : result && !result.ok
      ? `The last run needs attention: ${result.message}`
      : `This schematic has ${componentCount} parts and ${wireCount} wires. Run TRAN, OP, or AC analysis, then probe a node for focused measurements.`;

  const send = () => {
    const question = draft.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: question },
      { role: "assistant", text: summary },
    ]);
    setDraft("");
  };

  return (
    <aside className="ask-panel" aria-label="Ask Sim">
      <div className="ask-head">
        <span className="spark">✦</span>
        <strong>Ask Sim</strong>
        <small>analysis · agent</small>
        <button className="panel-close" aria-label="Minimize Ask Sim" title="Minimize Ask Sim" onClick={onClose}>×</button>
      </div>
      <div className="chat-scroll">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}-${message.text}`} className={`chat-message ${message.role}`}>
            <span>{message.role === "user" ? "you" : "sim"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        <div className="board-summary">
          <h3><i />board summary</h3>
          <dl>
            <div><dt>state</dt><dd>{state}</dd></div>
            <div><dt>parts</dt><dd>{componentCount}</dd></div>
            <div><dt>wires</dt><dd>{wireCount}</dd></div>
            <div><dt>samples</dt><dd>{result?.ok ? result.stats.sampleCount : "—"}</dd></div>
          </dl>
        </div>
      </div>
      <form
        className="ask-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Summarize my board..."
          aria-label="Ask Sim prompt"
        />
        <div>
          <i>datasheet</i>
          <i>sim · temp</i>
          <button aria-label="Send" disabled={!draft.trim()}>↑</button>
        </div>
      </form>
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
  aiHidden,
  onRestoreGraph,
  onRestoreAi,
}: {
  graphHidden: boolean;
  aiHidden: boolean;
  onRestoreGraph: () => void;
  onRestoreAi: () => void;
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
      {aiHidden && (
        <button className="restore-orb ai" aria-label="Restore Ask Sim panel" title="Restore Ask Sim panel" onClick={onRestoreAi}>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M14 3 16.5 11.5 25 14 16.5 16.5 14 25 11.5 16.5 3 14 11.5 11.5z" />
          </svg>
          <span>Ask Sim</span>
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
