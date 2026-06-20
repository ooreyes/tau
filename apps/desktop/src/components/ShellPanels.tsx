import { useMemo, useRef, type ReactNode } from "react";
import { CATALOG_BY_KIND } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import type { SchematicComponent } from "../schematic/types";
import { decodeParams, paramFields } from "../schematic/params";
import { useSchematic } from "../store/useSchematic";
import { EXAMPLE_CIRCUITS } from "../examples/circuits";
import type { AnalysisResult } from "../simulation/linearTransient";
import { componentCurrents } from "../simulation/currents";
import { formatEngineering, parseQuantity } from "../simulation/quantity";

interface ModeProps {
  mode: "schematic" | "simulator";
  onModeChange: (mode: "schematic" | "simulator") => void;
}

export function ActivityRail({ mode, onModeChange }: ModeProps) {
  return (
    <nav className="activity-rail" aria-label="Workspace sections">
      <RailButton active={mode === "schematic"} title="Explorer" onClick={() => onModeChange("schematic")}>
        <path d="M3 3h7l2 2h5v12H3z" />
      </RailButton>
      <RailButton title="Search">
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5 18 18" />
      </RailButton>
      <RailButton title="Components">
        <rect x="5" y="5" width="10" height="10" rx="1.5" />
        <path d="M8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3" />
      </RailButton>
      <RailButton active={mode === "simulator"} title="Waveforms" onClick={() => onModeChange("simulator")}>
        <path d="M3 14 8 7l3 3 6-7" />
      </RailButton>
      <div className="rail-spacer" />
      <RailButton title="Settings">
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

export function ExplorerPanel() {
  const loadCircuit = useSchematic((s) => s.loadCircuit);
  const examples = EXAMPLE_CIRCUITS.slice(0, 4);

  return (
    <aside className="explorer-panel" aria-label="Project explorer">
      <div className="explorer-head">
        <span>explorer</span>
        <div className="explorer-icons" aria-hidden="true">
          <span>＋</span>
          <span>▣</span>
          <span>↻</span>
        </div>
      </div>
      <div className="explorer-search">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <span>find schematic</span>
      </div>
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
              onClick={() => loadCircuit(example)}
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

export function EditorToolbar({ onRun }: { onRun: () => void }) {
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
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const newCircuit = useSchematic((s) => s.newCircuit);
  const loadCircuit = useSchematic((s) => s.loadCircuit);
  const hasDocument = components.length > 0 || wires.length > 0;

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
      loadCircuit({ components: parsed.components, wires: parsed.wires });
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
      <IconButton title="Delete" onClick={deleteSelected}>
        <path d="M4 5h10M7 5V3h4v2M6 7v7M10 7v7M13 5l-.8 10H5.8L5 5" />
      </IconButton>
      <span className="toolbar-divider" />
      <button className="editor-text-btn" onClick={newCircuit}>New</button>
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
            if (example) loadCircuit(example);
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
        <button title="Pause" aria-label="Pause simulation">Ⅱ</button>
        <button className="transport-stop" title="Stop" aria-label="Stop simulation">■</button>
        <button title="Step" aria-label="Step simulation">▸▌</button>
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

export function EditorTabs({ mode }: { mode: "schematic" | "simulator" }) {
  return (
    <div className="editor-tabs" role="tablist" aria-label="Open schematics">
      <button className="editor-tab">
        <i className="blue" />
        load switch
      </button>
      <button className="editor-tab active">
        <i className="amber" />
        boost converter
        <span>×</span>
      </button>
      <button className="editor-tab add" aria-label="New tab">＋</button>
      <div className="editor-tab-spacer" />
      {mode === "simulator" && <button className="editor-hide">× hide</button>}
    </div>
  );
}

export function BottomPanel({ mode, result }: { mode: "schematic" | "simulator"; result: AnalysisResult | null }) {
  const components = useSchematic((s) => s.components);
  const selectedId = useSchematic((s) => s.selectedId);
  const selected = components.find((component) => component.id === selectedId) ?? components[0] ?? null;

  return (
    <section className="bottom-panel" aria-label={mode === "simulator" ? "Simulation results" : "Component inspector"}>
      <div className="bottom-resize-handle"><span /></div>
      <div className="bottom-tabs">
        <button className="active">{mode === "simulator" ? "results" : "component"}</button>
        <button>{mode === "simulator" ? "log" : "output"}</button>
        <button>errors</button>
      </div>
      {mode === "simulator" ? <SimulatorResults result={result} /> : <ComponentInspector selected={selected} />}
    </section>
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

export function AskSimPanel({ result }: { result: AnalysisResult | null }) {
  const componentCount = useSchematic((s) => s.components.length);
  const wireCount = useSchematic((s) => s.wires.length);
  const state = result?.ok ? "analysis ready" : result && !result.ok ? "needs attention" : "waiting for run";

  return (
    <aside className="ask-panel" aria-label="Ask Sim">
      <div className="ask-head">
        <span className="spark">✦</span>
        <strong>Ask Sim</strong>
        <small>analysis · agent</small>
      </div>
      <div className="chat-scroll">
        <div className="chat-message user">
          <span>you</span>
          <p>Summarize my board.</p>
        </div>
        <div className="chat-message assistant">
          <span>sim</span>
          <p>
            This schematic has {componentCount} parts and {wireCount} wires. Run transient, OP, or AC analysis, then probe a node for focused measurements.
          </p>
        </div>
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
      <div className="ask-composer">
        <span>Summarize my board…</span>
        <div>
          <i>datasheet</i>
          <i>sim · temp</i>
          <button aria-label="Send">↑</button>
        </div>
      </div>
    </aside>
  );
}
