import { useCallback, useEffect, useState } from "react";
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

function App() {
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
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
  const [documentTitle, setDocumentTitle] = useState("boost converter.sim");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(true);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
  const [partsOpen, setPartsOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

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

  const openDocument = useCallback((doc: SchematicDocument, title: string) => {
    loadCircuit(doc);
    setDocumentTitle(title);
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    showNotice(`Opened ${title}`);
  }, [loadCircuit, showNotice]);

  const openExample = useCallback((example: ExampleCircuit) => {
    openDocument(example, `${example.name.toLowerCase().replace(/\s+/g, "-")}.sim`);
  }, [openDocument]);

  const startNewCircuit = useCallback(() => {
    newCircuit();
    setDocumentTitle("untitled.sim");
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Started a new blank circuit.");
  }, [newCircuit, showNotice]);

  const clearScratchpad = useCallback(() => {
    newCircuit();
    setDocumentTitle("untitled.sim");
    setAnalysis(null);
    setRunState("idle");
    setMode("schematic");
    setConfirmClearOpen(false);
    setGraphOpen(true);
    setAiOpen(true);
    showNotice("Scratchpad cleared.");
  }, [newCircuit, showNotice]);

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
      <div className="shell-body">
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
            mode={mode}
            title={documentTitle}
            onOpenExample={openExample}
            onNewCircuit={startNewCircuit}
            onCloseCurrent={() => setConfirmClearOpen(true)}
            onHideSimulator={() => setMode("schematic")}
          />
          <main className="stage">
            <Canvas analysis={analysis} interactive={mode === "schematic"} />
            {components.length === 0 && wires.length === 0 && <EmptyState />}
          </main>
          <BottomPanel mode={mode} result={analysis} />
        </section>
        {mode === "simulator" && graphOpen && (
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
        )}
        {mode === "simulator" && aiOpen && <AskSimPanel result={analysis} onClose={() => setAiOpen(false)} />}
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
