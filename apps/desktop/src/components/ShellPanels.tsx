import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import type { SchematicComponent } from "../schematic/types";
import { decodeParams, paramFields } from "../schematic/params";
import { useSchematic, type SchematicDocument } from "../store/useSchematic";
import { EXAMPLE_CIRCUITS, type ExampleCircuit } from "../examples/circuits";
import type { AnalysisResult } from "../simulation/linearTransient";
import { componentCurrents } from "../simulation/currents";
import { formatEngineering, parseQuantity } from "../simulation/quantity";

interface ModeProps {
  mode: "schematic" | "simulator";
  onModeChange: (mode: "schematic" | "simulator") => void;
  onSearch: () => void;
  onFocusComponents: () => void;
  onOpenSettings: () => void;
}

export function ActivityRail({ mode, onModeChange, onSearch, onFocusComponents, onOpenSettings }: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic"} title="Explorer" onClick={() => onModeChange("schematic")}>
        <path d="M3 3h7l2 2h5v12H3z" />
      </RailButton>
      <RailButton title="Search" onClick={onSearch}>
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5 18 18" />
      </RailButton>
      <RailButton title="Components" onClick={onFocusComponents}>
        <rect x="5" y="5" width="10" height="10" rx="1.5" />
        <path d="M8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3" />
      </RailButton>
      <RailButton active={mode === "simulator"} title="Waveforms" onClick={() => onModeChange("simulator")}>
        <path d="M3 14 8 7l3 3 6-7" />
      </RailButton>
      <div className="rail-spacer" />
      <RailButton title="Settings" onClick={onOpenSettings}>
        <path d="M10 2.5l1.8 1.2 2.1-.5.9 2 1.9.9-.5 2.1 1.2 1.8-1.2 1.8.5 2.1-1.9.9-.9 2-2.1-.5L10 17.5l-1.8-1.2-2.1.5-.9-2-1.9-.9.5-2.1L2.6 10l1.2-1.8-.5-2.1 1.9-.9.9-2 2.1.5z" />
        <circle cx="10" cy="10" r="2.4" />
      </RailButton>
    </nav>
  );
}

function RailButton({
  active = false,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`rail-btn${active ? " active" : ""}`} title={title} aria-label={title} onClick={onClick}>
      {active && <span className="rail-active" />}
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function ExplorerPanel({
  onOpenExample,
  onNewCircuit,
  onSearch,
}: {
  onOpenExample: (example: ExampleCircuit) => void;
  onNewCircuit: () => void;
  onSearch: () => void;
}) {
  const examples = EXAMPLE_CIRCUITS.slice(0, 4);

  return (
    <aside className="explorer-panel" aria-label="Project explorer">
      <div className="explorer-head">
        <span>explorer</span>
        <div className="explorer-icons">
          <button title="New scratchpad" aria-label="New scratchpad" onClick={onNewCircuit}>＋</button>
          <button title="Search commands" aria-label="Search commands" onClick={onSearch}>▣</button>
          <button title="Reload first example" aria-label="Reload first example" onClick={() => onOpenExample(examples[0])}>↻</button>
        </div>
      </div>
      <button className="explorer-search" onClick={onSearch}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <span>find schematic</span>
      </button>
      <div className="tree-list">
        <div className="tree-root">
          <span className="tree-caret">▸</span>
          <span className="tree-folder">Powerboard</span>
        </div>
        <div className="tree-children">
          {examples.map((example, index) => (
            <button
              key={example.id}
              className={`tree-file${index === 0 ? " active" : ""}`}
              onClick={() => onOpenExample(example)}
            >
              <i className={index === 0 ? "amber" : "blue"} />
              {example.name.toLowerCase().replace(/\s+/g, "-")}.sim
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function EditorToolbar({
  runState,
  onRun,
  onPause,
  onStep,
  onStop,
  onNewCircuit,
  onClearScratchpad,
  onOpenCircuit,
  onOpenExample,
}: {
  runState: "idle" | "complete" | "error" | "stopped" | "paused";
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onStop: () => void;
  onNewCircuit: () => void;
  onClearScratchpad: () => void;
  onOpenCircuit: (doc: SchematicDocument, title: string) => void;
  onOpenExample: (example: ExampleCircuit) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const tool = useSchematic((s) => s.tool);
  const cancel = useSchematic((s) => s.cancel);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const canUndo = useSchematic((s) => s.past.length > 0);
  const canRedo = useSchematic((s) => s.future.length > 0);
  const hasDocument = components.length > 0 || wires.length > 0;
  const isPaused = runState === "paused";

  const saveCircuit = () => {
    const payload = {
      app: "Tau",
      version: 1,
      savedAt: new Date().toISOString(),
      components,
      wires,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tau-circuit-${new Date().toISOString().slice(0, 10)}.tau.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openCircuit = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.components) || !Array.isArray(parsed.wires)) {
        throw new Error("File does not contain a Tau schematic document.");
      }
      onOpenCircuit({ components: parsed.components, wires: parsed.wires }, file.name.replace(/\.tau\.json$/i, ".sim"));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not open circuit file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="editor-toolbar" aria-label="Editor toolbar">
      <IconButton title="Select" active={tool.mode === "select"} onClick={cancel}>
        <path d="M4 3l10 5-4.2 1.4L8 14.5z" />
      </IconButton>
      <IconButton title="Wire" active={tool.mode === "wire"} onClick={startWiring}>
        <circle cx="4" cy="14" r="2" />
        <circle cx="14" cy="4" r="2" />
        <path d="M5.5 12.5 12.5 5.5" />
      </IconButton>
      <IconButton title="Probe" active={tool.mode === "probe"} onClick={startProbing}>
        <circle cx="8" cy="8" r="4" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
      </IconButton>
      <span className="toolbar-divider" />
      <IconButton title="Undo" disabled={!canUndo} onClick={undo}>
        <path d="M6 4 2 8l4 4" />
        <path d="M2 8h9a4 4 0 0 1 4 4v2" />
      </IconButton>
      <IconButton title="Redo" disabled={!canRedo} onClick={redo}>
        <path d="M12 4l4 4-4 4" />
        <path d="M16 8H7a4 4 0 0 0-4 4v2" />
      </IconButton>
      <IconButton title="Clear scratchpad" onClick={onClearScratchpad}>
        <path d="M4 5h10M7 5V3h4v2M6 7v7M10 7v7M13 5l-.8 10H5.8L5 5" />
      </IconButton>
      <span className="toolbar-divider" />
      <button className="editor-text-btn" onClick={onNewCircuit}>New</button>
      <button className="editor-text-btn" onClick={() => fileInputRef.current?.click()}>Open</button>
      <button className="editor-text-btn" disabled={!hasDocument} onClick={saveCircuit}>Save</button>
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".tau.json,application/json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void openCircuit(file);
        }}
      />
      <label className="example-picker">
        <span>Examples</span>
        <select
          value=""
          onChange={(event) => {
            const example = EXAMPLE_CIRCUITS.find((circuit) => circuit.id === event.currentTarget.value);
            if (example) onOpenExample(example);
          }}
          aria-label="Open example circuit"
        >
          <option value="" disabled>Open...</option>
          {EXAMPLE_CIRCUITS.map((circuit) => (
            <option key={circuit.id} value={circuit.id}>{circuit.name}</option>
          ))}
        </select>
      </label>
      <div className="editor-toolbar-spacer" />
      <div className="transport">
        <button className="transport-play" title="Run simulation" aria-label="Run simulation" onClick={onRun}>▶</button>
        <button
          className={isPaused ? "transport-pause active" : "transport-pause"}
          title={isPaused ? "Resume simulation state" : "Pause simulation state"}
          aria-label="Pause simulation"
          aria-pressed={isPaused}
          onClick={onPause}
        >
          Ⅱ
        </button>
        <button
          className="transport-stop"
          title="Clear current simulation result"
          aria-label="Stop simulation"
          onClick={onStop}
        >
          ■
        </button>
        <button
          title="Advance transient by one sample"
          aria-label="Step simulation"
          onClick={onStep}
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
      <svg viewBox="0 0 18 18" aria-hidden="true">{children}</svg>
    </button>
  );
}

export function EditorTabs({
  mode,
  title,
  onOpenExample,
  onNewCircuit,
  onCloseCurrent,
  onHideSimulator,
}: {
  mode: "schematic" | "simulator";
  title: string;
  onOpenExample: (example: ExampleCircuit) => void;
  onNewCircuit: () => void;
  onCloseCurrent: () => void;
  onHideSimulator: () => void;
}) {
  const referenceExample = EXAMPLE_CIRCUITS[0];

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open schematics">
      <button className="editor-tab" onClick={() => onOpenExample(referenceExample)}>
        <i className="blue" />
        {referenceExample.name.toLowerCase()}
      </button>
      <div
        className="editor-tab active"
        role="tab"
        aria-current="page"
        onClick={mode === "simulator" ? onHideSimulator : undefined}
      >
        <i className="amber" />
        {title.replace(/\.sim$/i, "")}
        <button
          type="button"
          aria-label="Close current scratchpad"
          className="tab-close"
          onClick={(event) => {
            event.stopPropagation();
            onCloseCurrent();
          }}
        >
          ×
        </button>
      </div>
      <button className="editor-tab add" aria-label="New tab" onClick={onNewCircuit}>＋</button>
      <div className="editor-tab-spacer" />
      {mode === "simulator" && <button className="editor-hide" onClick={onHideSimulator}>× hide</button>}
    </div>
  );
}

export function BottomPanel({ mode, result }: { mode: "schematic" | "simulator"; result: AnalysisResult | null }) {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const probes = useSchematic((s) => s.probes);
  const selectedId = useSchematic((s) => s.selectedId);
  const selectedWireId = useSchematic((s) => s.selectedWireId);
  const selected = components.find((component) => component.id === selectedId) ?? components[0] ?? null;
  const [activeTab, setActiveTab] = useState<"primary" | "secondary" | "errors">("primary");

  useEffect(() => {
    setActiveTab("primary");
  }, [mode]);

  const primaryLabel = mode === "simulator" ? "results" : "component";
  const secondaryLabel = mode === "simulator" ? "log" : "output";
  const hasError = result && !result.ok;
  const content = activeTab === "primary"
    ? mode === "simulator"
      ? <SimulatorResults result={result} />
      : <ComponentInspector selected={selected} />
    : activeTab === "secondary"
      ? (
        <OutputPanel
          mode={mode}
          componentCount={components.length}
          wireCount={wires.length}
          probeCount={probes.length}
          selectedLabel={selected?.label || selectedWireId || "none"}
          result={result}
        />
      )
      : <ErrorPanel result={result} />;

  return (
    <section className="bottom-panel" aria-label={mode === "simulator" ? "Simulation results" : "Component inspector"}>
      <div className="bottom-resize-handle"><span /></div>
      <div className="bottom-tabs">
        <button className={activeTab === "primary" ? "active" : ""} onClick={() => setActiveTab("primary")}>
          {primaryLabel}
        </button>
        <button className={activeTab === "secondary" ? "active" : ""} onClick={() => setActiveTab("secondary")}>
          {secondaryLabel}
        </button>
        <button className={activeTab === "errors" ? "active" : ""} onClick={() => setActiveTab("errors")}>
          errors{hasError ? " •" : ""}
        </button>
      </div>
      {content}
    </section>
  );
}

function OutputPanel({
  mode,
  componentCount,
  wireCount,
  probeCount,
  selectedLabel,
  result,
}: {
  mode: "schematic" | "simulator";
  componentCount: number;
  wireCount: number;
  probeCount: number;
  selectedLabel: string;
  result: AnalysisResult | null;
}) {
  const rows = mode === "simulator" && result?.ok
    ? [
        ["status", "transient complete"],
        ["samples", String(result.stats.sampleCount)],
        ["stop", formatEngineering(result.stats.stopTime, "s", 3)],
        ["step", formatEngineering(result.stats.stepSize, "s", 3)],
      ]
    : [
        ["parts", String(componentCount)],
        ["wires", String(wireCount)],
        ["probes", String(probeCount)],
        ["selected", selectedLabel],
      ];

  return (
    <div className="bottom-output">
      {rows.map(([label, value]) => (
        <div key={label} className="bottom-output-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ErrorPanel({ result }: { result: AnalysisResult | null }) {
  const messages = [
    ...(result && !result.ok ? [result.message] : []),
    ...(result?.warnings ?? []),
  ];

  return (
    <div className="bottom-errors">
      {messages.length > 0 ? messages.map((message, index) => (
        <div key={`${message}-${index}`} className={result && !result.ok && index === 0 ? "error" : "warning"}>
          {message}
        </div>
      )) : (
        <p>No errors or warnings.</p>
      )}
    </div>
  );
}

function ComponentInspector({ selected }: { selected: SchematicComponent | null }) {
  const entry = selected ? CATALOG_BY_KIND[selected.kind] : null;
  const fields = selected && entry
    ? paramFields(selected.kind).map((field) => ({
        label: field.label,
        value: decodeParams(selected.kind, selected.value)[field.key] || selected.value || "—",
      }))
    : [];
  const visibleFields = fields.length > 0 ? fields : [{ label: "Value", value: selected?.value || "—" }];

  return (
    <div className="component-inspector">
      <div className="inspector-summary">
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
      <div className="property-grid">
        {visibleFields.slice(0, 6).map((field) => (
          <label key={field.label} className="property-field">
            <span>{field.label}</span>
            <input value={field.value} readOnly />
          </label>
        ))}
      </div>
    </div>
  );
}

function SimulatorResults({ result }: { result: AnalysisResult | null }) {
  const ok = result?.ok ? result : null;
  const sampleIndex = ok ? Math.max(0, ok.times.length - 1) : 0;
  const currents = useMemo(() => (ok ? componentCurrents(ok, sampleIndex) : new Map<string, number>()), [ok, sampleIndex]);
  const currentRows = ok
    ? [...currents.entries()].slice(0, 5).map(([id, current]) => {
        const component = ok.circuit.components.find((entry) => entry.component.id === id)?.component;
        return { name: component?.label || id, value: formatEngineering(current, "A", 3) };
      })
    : [];
  const voltageRows = ok
    ? ok.traces.slice(0, 5).map((trace) => ({
        name: trace.label.replace(/^V\(|\)$/g, ""),
        value: formatEngineering(trace.values[sampleIndex] ?? 0, "V", 3),
        color: trace.color,
      }))
    : [];
  const powerRows = ok
    ? [...currents.entries()].flatMap(([id, current]) => {
        const entry = ok.circuit.components.find((candidate) => candidate.component.id === id);
        if (!entry || entry.component.kind !== "resistor") return [];
        try {
          const resistance = parseQuantity(entry.component.value, "Ω");
          return [{ name: entry.component.label || id, value: formatEngineering(current * current * resistance, "W", 3) }];
        } catch {
          return [];
        }
      }).slice(0, 5)
    : [];

  return (
    <div className="sim-results">
      <ResultList title="current" rows={currentRows} empty="Run a transient analysis to derive branch currents." />
      <ResultList title="voltage" rows={voltageRows} empty="Voltage traces appear here after Run." />
      <ResultList title="power" rows={powerRows} empty="Resistor power estimates appear after Run." />
    </div>
  );
}

function ResultList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { name: string; value: string; color?: string }[];
  empty: string;
}) {
  return (
    <div className="result-list">
      <h3>{title}</h3>
      {rows.length > 0 ? rows.map((row) => (
        <div key={`${title}-${row.name}`} className="result-row">
          <span style={{ color: row.color }}>
            <i style={{ background: row.color }} />
            {row.name}
          </span>
          <strong>{row.value}</strong>
        </div>
      )) : <p>{empty}</p>}
    </div>
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
        <button className="panel-close" aria-label="Close Ask Sim" title="Close Ask Sim" onClick={onClose}>×</button>
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

  const clearAutosave = () => {
    try {
      localStorage.removeItem("tau.schematic.v1");
      onNotice("Local autosave cleared.");
    } catch {
      onNotice("Local autosave could not be cleared in this webview.");
    }
  };

  return (
    <div className="settings-backdrop" onPointerDown={onClose}>
      <section className="settings-panel" role="dialog" aria-label="Tau settings" onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>settings</span>
            <strong>{title}</strong>
          </div>
          <button aria-label="Close settings" onClick={onClose}>×</button>
        </header>
        <div className="settings-list">
          <button onClick={onOpenCommandPalette}>
            <span>Command palette</span>
            <strong>Open</strong>
          </button>
          <button
            onClick={() => {
              clearProbes();
              onNotice(probes.length > 0 ? "Cleared all probes." : "No probes to clear.");
            }}
          >
            <span>Meter probes</span>
            <strong>Clear {probes.length}</strong>
          </button>
          <button onClick={clearAutosave}>
            <span>Local autosave</span>
            <strong>Clear</strong>
          </button>
          <button
            onClick={() => {
              onNewCircuit();
              onClose();
            }}
          >
            <span>Document</span>
            <strong>New blank</strong>
          </button>
        </div>
      </section>
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
        <button className="restore-orb graph" aria-label="Restore graphs" title="Restore graphs" onClick={onRestoreGraph}>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M5 19 11 10l4 5 8-11" />
            <path d="M20 4h4v4" />
          </svg>
          <span>Graphs</span>
        </button>
      )}
      {aiHidden && (
        <button className="restore-orb ai" aria-label="Restore Ask Sim" title="Restore Ask Sim" onClick={onRestoreAi}>
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
    <div className="confirm-backdrop" role="presentation" onPointerDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong id="confirm-title">{title}</strong>
          <button aria-label="Cancel" onClick={onCancel}>×</button>
        </header>
        <p id="confirm-body">{body}</p>
        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
