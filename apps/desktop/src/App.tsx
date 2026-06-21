import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import "./App.css";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { SimulationPanel } from "./components/SimulationPanel";
import { AnalysisErrorBoundary } from "./components/AnalysisErrorBoundary";
import { EmptyState } from "./components/EmptyState";
import { CommandPalette } from "./components/CommandPalette";
import {
  ActivityRail,
  AskSimPanel,
  BottomPanel,
  ConfirmDialog,
  EditorTabs,
  EditorToolbar,
  ExplorerPanel,
  MinimizedPanelDock,
  SettingsPanel,
} from "./components/ShellPanels";
import { useSchematic, type SchematicDocument } from "./store/useSchematic";
import { CATALOG } from "./schematic/catalog";
import { type ExampleCircuit } from "./examples/circuits";
import { runTransientAnalysis, type AnalysisOptions, type AnalysisResult } from "./simulation/linearTransient";

const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  stopTime: 0.006,
  steps: 240,
};

/** One open editor tab. `doc` is the in-memory snapshot of its schematic; the
 *  active tab's live content is held in the store and snapshotted on switch. */
interface OpenTab {
  id: string;
  title: string;
  doc: SchematicDocument | null;
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A draggable vertical divider that reports horizontal deltas while dragged. */
function ColumnResizeHandle({ onResize, label }: { onResize: (dx: number) => void; label: string }) {
  const lastX = useRef(0);
  const dragging = useRef(false);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastX.current;
    lastX.current = e.clientX;
    if (dx !== 0) onResize(dx);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <div
      className="col-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <span />
    </div>
  );
}

function App() {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const toolMode = useSchematic((s) => s.tool.mode);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const loadCircuit = useSchematic((s) => s.loadCircuit);
  const newCircuit = useSchematic((s) => s.newCircuit);
  const cancel = useSchematic((s) => s.cancel);
  const rotate = useSchematic((s) => s.rotate);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped" | "paused">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "boost converter.sim", doc: null }]);
  const [activeId, setActiveId] = useState("tab-0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [scopeWidth, setScopeWidth] = useState(440);
  const [askWidth, setAskWidth] = useState(330);
  const [notice, setNotice] = useState<string | null>(null);

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.sim";

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  }, []);

  const runAnalysis = useCallback(() => {
    const result = runTransientAnalysis({ components, wires }, analysisOptions);
    setAnalysis(result);
    setRunState(result.ok ? "complete" : "error");
  }, [components, wires, analysisOptions]);

  const runAndShowSimulator = useCallback(() => {
    const result = runTransientAnalysis({ components, wires }, analysisOptions);
    setAnalysis(result);
    setRunState(result.ok ? "complete" : "error");
    setMode("simulator");
    setGraphOpen(true);
  }, [components, wires, analysisOptions]);

  const pauseAnalysis = useCallback(() => {
    if (!analysis) {
      showNotice("Run a transient analysis before pausing.");
      return;
    }
    setRunState((state) => {
      if (state === "paused") {
        showNotice("Simulation resumed.");
        return analysis.ok ? "complete" : "error";
      }
      showNotice("Simulation paused.");
      return "paused";
    });
  }, [analysis, showNotice]);

  const stepAnalysis = useCallback(() => {
    const nextOptions = { ...analysisOptions, steps: Math.min(1000, analysisOptions.steps + 1) };
    const result = runTransientAnalysis({ components, wires }, nextOptions);
    setAnalysisOptions(nextOptions);
    setAnalysis(result);
    setRunState(result.ok ? "complete" : "error");
    setMode("simulator");
    setGraphOpen(true);
    showNotice("Advanced transient by one sample.");
  }, [analysisOptions, components, wires, showNotice]);

  const stopAnalysis = useCallback(() => {
    if (!analysis) {
      showNotice("No simulation result to stop.");
      return;
    }
    setAnalysis(null);
    setRunState("stopped");
    showNotice("Simulation stopped. Run again when ready.");
  }, [analysis, showNotice]);

  // Snapshot the live store into the active tab, so its edits survive a switch.
  const snapshotActive = useCallback(
    (list: OpenTab[]) => list.map((tab) => (tab.id === activeId ? { ...tab, doc: { components, wires } } : tab)),
    [activeId, components, wires],
  );

  // Open a document: focus its tab if already open, otherwise add a new one.
  const openDocument = useCallback((doc: SchematicDocument, title: string) => {
    const snap = snapshotActive(tabs);
    const existing = snap.find((tab) => tab.title === title);
    if (existing) {
      setTabs(snap.map((tab) => (tab.id === existing.id ? { ...tab, doc } : tab)));
      setActiveId(existing.id);
    } else {
      const id = newTabId();
      setTabs([...snap, { id, title, doc }]);
      setActiveId(id);
    }
    loadCircuit(doc);
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    showNotice(`Opened ${title}`);
  }, [tabs, snapshotActive, loadCircuit, showNotice]);

  const openExample = useCallback((example: ExampleCircuit) => {
    openDocument(example, `${example.name.toLowerCase().replace(/\s+/g, "-")}.sim`);
  }, [openDocument]);

  // Switch to an already-open tab, preserving each tab's content in memory.
  const switchTab = useCallback((id: string) => {
    if (id === activeId) return;
    const snap = snapshotActive(tabs);
    const target = snap.find((tab) => tab.id === id);
    if (!target) return;
    setTabs(snap);
    setActiveId(id);
    loadCircuit(target.doc ?? { components: [], wires: [] });
    setAnalysis(null);
    setRunState("idle");
  }, [activeId, tabs, snapshotActive, loadCircuit]);

  const startNewCircuit = useCallback(() => {
    const snap = snapshotActive(tabs);
    const taken = new Set(snap.map((tab) => tab.title));
    let title = "untitled.sim";
    for (let n = 2; taken.has(title); n += 1) title = `untitled-${n}.sim`;
    const id = newTabId();
    setTabs([...snap, { id, title, doc: { components: [], wires: [] } }]);
    setActiveId(id);
    newCircuit();
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Started a new blank circuit.");
  }, [tabs, snapshotActive, newCircuit, showNotice]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const blank: OpenTab = { id: newTabId(), title: "untitled.sim", doc: { components: [], wires: [] } };
      setTabs([blank]);
      setActiveId(blank.id);
      newCircuit();
    } else {
      const next = remaining[Math.max(0, idx - 1)];
      setTabs(remaining);
      if (id === activeId) {
        setActiveId(next.id);
        loadCircuit(next.doc ?? { components: [], wires: [] });
      }
    }
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
  }, [tabs, activeId, loadCircuit, newCircuit]);

  const clearScratchpad = useCallback(() => {
    newCircuit();
    setTabs((prev) => prev.map((tab) => (tab.id === activeId ? { ...tab, doc: { components: [], wires: [] } } : tab)));
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    setConfirmClearOpen(false);
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Scratchpad cleared.");
  }, [activeId, newCircuit, showNotice]);

  useEffect(() => {
    setAnalysis(null);
    setRunState("idle");
  }, [components, wires]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (k === "y") {
          e.preventDefault();
          redo();
        } else if (k === "k") {
          e.preventDefault();
          setPaletteOpen(true);
        }
        return; // leave other OS / app shortcuts alone
      }

      if (e.key === "/") {
        e.preventDefault();
        return setPaletteOpen(true);
      }
      if (e.key === "Escape") return cancel();
      if (e.key === " ") {
        e.preventDefault();
        return rotate();
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        return deleteSelected();
      }
      if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        return startWiring();
      }

      const entry = CATALOG.find((c) => c.hotkey === e.key.toLowerCase());
      if (entry) {
        e.preventDefault();
        startPlacing(entry.kind);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startPlacing, startWiring, cancel, rotate, deleteSelected, undo, redo]);

  return (
    <div className={`app app-${mode}`}>
      <Toolbar
        mode={mode}
        result={analysis}
        runState={runState}
        title={documentTitle}
        onModeChange={setMode}
        onRun={runAndShowSimulator}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div
        className="shell-body"
        style={{ "--scope-w": `${scopeWidth}px`, "--ask-w": `${askWidth}px` } as CSSProperties}
      >
        <ActivityRail
          mode={mode}
          partsOpen={partsOpen && mode === "schematic"}
          onModeChange={setMode}
          onSearch={() => setPaletteOpen(true)}
          onFocusComponents={() => {
            setMode("schematic");
            setPartsOpen((open) => {
              const next = !open;
              if (next) setComponentFocusSignal((value) => value + 1);
              return next;
            });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {mode === "schematic" && (
          <ExplorerPanel
            activeTitle={documentTitle}
            onOpenExample={openExample}
            onNewCircuit={startNewCircuit}
            onSearch={() => setPaletteOpen(true)}
          />
        )}
        <section className="editor-shell" aria-label="Schematic editor">
          <EditorToolbar
            runState={runState}
            onRun={runAndShowSimulator}
            onPause={pauseAnalysis}
            onStep={stepAnalysis}
            onStop={stopAnalysis}
            onNewCircuit={startNewCircuit}
            onClearScratchpad={() => setConfirmClearOpen(true)}
            onOpenCircuit={(doc, title) => openDocument(doc, title)}
            onOpenExample={openExample}
          />
          <EditorTabs
            tabs={tabs}
            activeId={activeId}
            mode={mode}
            onSelectTab={switchTab}
            onCloseTab={closeTab}
            onNewCircuit={startNewCircuit}
            onHideSimulator={() => setMode("schematic")}
          />
          <main className="stage">
            <Canvas analysis={analysis} interactive={mode === "schematic"} />
            {components.length === 0 && wires.length === 0 && toolMode === "select" && mode === "schematic" && (
              <EmptyState />
            )}
          </main>
          <BottomPanel mode={mode} result={analysis} />
        </section>
        {mode === "simulator" && graphOpen && (
          <>
            <ColumnResizeHandle
              label="Resize analysis panel"
              onResize={(dx) => setScopeWidth((w) => clamp(w - dx, 300, 820))}
            />
            <AnalysisErrorBoundary>
              <SimulationPanel
                result={analysis}
                options={analysisOptions}
                onOptionsChange={setAnalysisOptions}
                onRun={runAnalysis}
                onStop={stopAnalysis}
                onPause={pauseAnalysis}
                onStep={stepAnalysis}
                onClose={() => setGraphOpen(false)}
              />
            </AnalysisErrorBoundary>
          </>
        )}
        {mode === "simulator" && aiOpen && (
          <>
            <ColumnResizeHandle
              label="Resize Ask Sim panel"
              onResize={(dx) => setAskWidth((w) => clamp(w - dx, 260, 640))}
            />
            <AskSimPanel result={analysis} onClose={() => setAiOpen(false)} />
          </>
        )}
        {mode === "simulator" && (!graphOpen || !aiOpen) && (
          <MinimizedPanelDock
            graphHidden={!graphOpen}
            aiHidden={!aiOpen}
            onRestoreGraph={() => setGraphOpen(true)}
            onRestoreAi={() => setAiOpen(true)}
          />
        )}
        {mode === "schematic" && partsOpen && (
          <Palette focusSignal={componentFocusSignal} onNotice={showNotice} />
        )}
      </div>
      <StatusBar mode={mode} result={analysis} title={documentTitle} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {settingsOpen && (
        <SettingsPanel
          title={documentTitle}
          onClose={() => setSettingsOpen(false)}
          onNewCircuit={startNewCircuit}
          onOpenCommandPalette={() => {
            setSettingsOpen(false);
            setPaletteOpen(true);
          }}
          onNotice={showNotice}
        />
      )}
      {confirmClearOpen && (
        <ConfirmDialog
          title="Clear scratchpad?"
          body="This removes all components, wires, labels, probes, and the current analysis from the scratchpad."
          confirmLabel="Clear scratchpad"
          onConfirm={clearScratchpad}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
      {notice && <div className="shell-toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
