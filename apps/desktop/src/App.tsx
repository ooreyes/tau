import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSchematic, type SchematicDocument, type SchematicHistory } from "./store/useSchematic";
import { CATALOG } from "./schematic/catalog";
import { type ExampleCircuit } from "./examples/circuits";
import {
  MAX_TRANSIENT_STEPS,
  runTransientAnalysis,
  type AnalysisOptions,
  type AnalysisResult,
} from "./simulation/linearTransient";
import { runOperatingPoint, type OperatingPointResult } from "./simulation/operatingPoint";
import { runAcSweep, type AcResult } from "./simulation/acSweep";
import { buildParamScope, EMPTY_SCOPE, type ParamScope } from "./simulation/paramScope";
import { analysesFromDirectives } from "./io/directiveAnalysis";
import { runMeasurements, type MeasResult } from "./simulation/measure";
import {
  isNativeSpiceRuntime,
  MAX_NATIVE_OUTPUT_POINTS,
  runNativeAcSweep,
  runNativeOperatingPoint,
  runNativeTransient,
} from "./engine/nativeSpice";

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
  history: SchematicHistory;
}

const newTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const blankDocument = (): SchematicDocument => ({ components: [], wires: [], probes: [], netLabels: [] });
const emptyHistory = (): SchematicHistory => ({ past: [], future: [] });

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
  const restoreCircuit = useSchematic((s) => s.restoreCircuit);
  const newCircuit = useSchematic((s) => s.newCircuit);
  const probes = useSchematic((s) => s.probes);
  const netLabels = useSchematic((s) => s.netLabels);
  const directives = useSchematic((s) => s.directives);
  const past = useSchematic((s) => s.past);
  const future = useSchematic((s) => s.future);
  const cancel = useSchematic((s) => s.cancel);
  const rotate = useSchematic((s) => s.rotate);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [opAnalysis, setOpAnalysis] = useState<OperatingPointResult | null>(null);
  const [acAnalysis, setAcAnalysis] = useState<AcResult | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const [tabs, setTabs] = useState<OpenTab[]>([{ id: "tab-0", title: "boost converter.sim", doc: null, history: emptyHistory() }]);
  const [activeId, setActiveId] = useState("tab-0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [scopeWidth, setScopeWidth] = useState(440);
  const [askWidth, setAskWidth] = useState(330);
  const [notice, setNotice] = useState<string | null>(null);
  // ngspice runs outside React's lifecycle. A request version prevents a late
  // result from an edited, closed, or stopped circuit overwriting current UI.
  const analysisRequestRef = useRef(0);

  const documentTitle = (tabs.find((tab) => tab.id === activeId) ?? tabs[0])?.title ?? "untitled.sim";

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  }, []);

  const invalidateAnalysis = useCallback((state: "idle" | "stopped" = "idle") => {
    analysisRequestRef.current += 1;
    setAnalysisRunning(false);
    setAnalysis(null);
    setOpAnalysis(null);
    setAcAnalysis(null);
    setRunState(state);
  }, []);

  // Build the param scope (.param/.func) from the document's directives once per
  // change so every analysis resolves {expr}/{param} values the same way. A bad
  // set of directives (cycle/undefined) falls back to an empty scope rather than
  // crashing the run; the per-value resolver still surfaces unresolved refs.
  const params = useMemo<ParamScope>(() => {
    if (directives.length === 0) return EMPTY_SCOPE;
    try {
      return buildParamScope(directives);
    } catch {
      return EMPTY_SCOPE;
    }
  }, [directives]);

  // Evaluate the document's `.meas` directives against the latest transient
  // result. Recomputed only when the result or directives change; measurements
  // chain by name through a scope seeded with the circuit's `.param` values.
  const measurements = useMemo<MeasResult[]>(() => {
    if (!analysis || !analysis.ok || directives.length === 0) return [];
    return runMeasurements(directives, analysis, params.scope, params.funcs);
  }, [analysis, directives, params]);

  const executeTransient = useCallback(async (options: AnalysisOptions) => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      const result = await runNativeTransient({ components, wires, netLabels, params }, options) ?? runTransientAnalysis({ components, wires, netLabels, params }, options);
      if (analysisRequestRef.current !== requestId) return;
      setAnalysis(result);
      setRunState(result.ok ? "complete" : "error");
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setAnalysis({
        ok: false,
        title: "ngspice transient",
        message: error instanceof Error ? error.message : "ngspice could not run this transient analysis.",
        warnings: [],
      });
      setRunState("error");
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params]);

  const runAnalysis = useCallback(async () => {
    await executeTransient(analysisOptions);
  }, [analysisOptions, executeTransient]);

  const runAndShowSimulator = useCallback(async () => {
    setMode("simulator");
    setGraphOpen(true);
    await executeTransient(analysisOptions);
  }, [analysisOptions, executeTransient]);

  const runOperatingAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      const result = await runNativeOperatingPoint({ components, wires, netLabels, params }) ?? runOperatingPoint({ components, wires, netLabels, params });
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setOpAnalysis({ ok: false, message: error instanceof Error ? error.message : "ngspice could not calculate the operating point.", warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params]);

  const runAcAnalysis = useCallback(async () => {
    const requestId = ++analysisRequestRef.current;
    setAnalysisRunning(true);
    try {
      const result = await runNativeAcSweep(
        { components, wires, netLabels, params },
        { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 },
      ) ?? runAcSweep({ components, wires, netLabels, params }, { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis(result);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      setAcAnalysis({ ok: false, message: error instanceof Error ? error.message : "ngspice could not run this AC sweep.", warnings: [] });
    } finally {
      if (analysisRequestRef.current === requestId) setAnalysisRunning(false);
    }
  }, [components, wires, netLabels, params]);

  const stepAnalysis = useCallback(async () => {
    // Native ngspice may return an endpoint in addition to requested samples.
    const maxSteps = isNativeSpiceRuntime() ? MAX_NATIVE_OUTPUT_POINTS - 1 : MAX_TRANSIENT_STEPS;
    const nextOptions = {
      ...analysisOptions,
      steps: Math.min(maxSteps, Math.max(analysisOptions.steps + 1, Math.ceil(analysisOptions.steps * 1.25))),
    };
    setAnalysisOptions(nextOptions);
    setMode("simulator");
    setGraphOpen(true);
    await executeTransient(nextOptions);
    showNotice(`Re-ran transient at ${nextOptions.steps.toLocaleString()} samples.`);
  }, [analysisOptions, executeTransient, showNotice]);

  const stopAnalysis = useCallback(() => {
    if (!analysis && !analysisRunning) {
      showNotice("No simulation result to stop.");
      return;
    }
    invalidateAnalysis("stopped");
    showNotice("Simulation stopped. Run again when ready.");
  }, [analysis, analysisRunning, invalidateAnalysis, showNotice]);

  // Snapshot the live store into the active tab so schematic annotations and
  // undo/redo history are isolated from every other open circuit.
  const snapshotActive = useCallback(
    (list: OpenTab[]) =>
      list.map((tab) => (tab.id === activeId
        ? {
            ...tab,
            doc: { components, wires, probes, netLabels, directives },
            history: { past, future },
          }
        : tab)),
    [activeId, components, wires, probes, netLabels, directives, past, future],
  );

  // Adopt an imported circuit's own `.tran` settings (stop time / sample count)
  // so it simulates as authored instead of with the editor's default window.
  const adoptDirectiveOptions = useCallback((doc: SchematicDocument) => {
    const { tran } = analysesFromDirectives(doc.directives ?? []);
    if (tran) setAnalysisOptions(tran);
  }, []);

  // Open a document: focus its tab if already open, otherwise add a new one.
  const openDocument = useCallback((doc: SchematicDocument, title: string) => {
    const snap = snapshotActive(tabs);
    const existing = snap.find((tab) => tab.title === title);
    if (existing) {
      setTabs(snap.map((tab) => (tab.id === existing.id ? { ...tab, doc, history: emptyHistory() } : tab)));
      setActiveId(existing.id);
      loadCircuit(doc);
    } else {
      const id = newTabId();
      setTabs([...snap, { id, title, doc, history: emptyHistory() }]);
      setActiveId(id);
      loadCircuit(doc);
    }
    adoptDirectiveOptions(doc);
    invalidateAnalysis();
    setMode("schematic");
    showNotice(`Opened ${title}`);
  }, [tabs, snapshotActive, loadCircuit, adoptDirectiveOptions, invalidateAnalysis, showNotice]);

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
    const restored = target.doc ?? blankDocument();
    restoreCircuit(restored, target.history);
    adoptDirectiveOptions(restored);
    invalidateAnalysis();
  }, [activeId, tabs, snapshotActive, restoreCircuit, adoptDirectiveOptions, invalidateAnalysis]);

  const startNewCircuit = useCallback(() => {
    const snap = snapshotActive(tabs);
    const taken = new Set(snap.map((tab) => tab.title));
    let title = "untitled.sim";
    for (let n = 2; taken.has(title); n += 1) title = `untitled-${n}.sim`;
    const id = newTabId();
    setTabs([...snap, { id, title, doc: blankDocument(), history: emptyHistory() }]);
    setActiveId(id);
    newCircuit();
    invalidateAnalysis();
    setMode("schematic");
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Started a new blank circuit.");
  }, [tabs, snapshotActive, newCircuit, invalidateAnalysis, showNotice]);

  const closeTab = useCallback((id: string, confirmed = false) => {
    const snap = snapshotActive(tabs);
    const idx = snap.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    const closing = snap[idx];
    const isLastPopulatedTab = snap.length === 1
      && Boolean(closing.doc && (closing.doc.components.length > 0 || closing.doc.wires.length > 0));
    if (isLastPopulatedTab && !confirmed) {
      setConfirmCloseTabId(id);
      return;
    }
    const remaining = snap.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      const blank: OpenTab = { id: newTabId(), title: "untitled.sim", doc: blankDocument(), history: emptyHistory() };
      setTabs([blank]);
      setActiveId(blank.id);
      newCircuit();
    } else {
      const next = remaining[Math.max(0, idx - 1)];
      setTabs(remaining);
      if (id === activeId) {
        setActiveId(next.id);
        restoreCircuit(next.doc ?? blankDocument(), next.history);
      }
    }
    invalidateAnalysis();
    setMode("schematic");
  }, [tabs, activeId, snapshotActive, restoreCircuit, newCircuit, invalidateAnalysis]);

  const clearScratchpad = useCallback(() => {
    newCircuit();
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeId ? { ...tab, doc: blankDocument(), history: emptyHistory() } : tab
    )));
    invalidateAnalysis();
    setMode("schematic");
    setConfirmClearOpen(false);
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Scratchpad cleared.");
  }, [activeId, newCircuit, invalidateAnalysis, showNotice]);

  useEffect(() => {
    invalidateAnalysis();
  }, [components, wires, invalidateAnalysis]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, [role='button'], [role='tab'], [role='dialog'], [contenteditable='true']")) {
        return;
      }

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
            isRunning={analysisRunning}
            onRun={runAndShowSimulator}
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
                opResult={opAnalysis}
                acResult={acAnalysis}
                measurements={measurements}
                options={analysisOptions}
                isRunning={analysisRunning}
                onOptionsChange={setAnalysisOptions}
                onRun={runAnalysis}
                onRunOperatingPoint={runOperatingAnalysis}
                onRunAcSweep={runAcAnalysis}
                onStop={stopAnalysis}
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
      {confirmCloseTabId && (
        <ConfirmDialog
          title="Close this scratchpad?"
          body="Save a .tau.json copy first if you need this circuit later. Closing the only open scratchpad starts a new blank circuit."
          confirmLabel="Close scratchpad"
          onConfirm={() => {
            closeTab(confirmCloseTabId, true);
            setConfirmCloseTabId(null);
          }}
          onCancel={() => setConfirmCloseTabId(null)}
        />
      )}
      {notice && <div className="shell-toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
