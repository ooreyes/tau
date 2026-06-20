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
  EditorTabs,
  EditorToolbar,
  ExplorerPanel,
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
  const [runState, setRunState] = useState<"idle" | "complete" | "error" | "stopped">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<"schematic" | "simulator">("schematic");
  const [documentTitle, setDocumentTitle] = useState("boost converter.sim");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [componentFocusSignal, setComponentFocusSignal] = useState(0);
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
  }, [components, wires, analysisOptions]);

  const stopAnalysis = useCallback(() => {
    setAnalysis(null);
    setRunState("stopped");
    showNotice("Simulation stopped. Run again when ready.");
  }, [showNotice]);

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
    showNotice("Started a new blank circuit.");
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
          onModeChange={setMode}
          onSearch={() => setPaletteOpen(true)}
          onFocusComponents={() => {
            setMode("schematic");
            setComponentFocusSignal((value) => value + 1);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {mode === "schematic" && <ExplorerPanel onOpenExample={openExample} />}
        <section className="editor-shell" aria-label="Schematic editor">
          <EditorToolbar
            runState={runState}
            onRun={runAndShowSimulator}
            onStop={stopAnalysis}
            onNewCircuit={startNewCircuit}
            onOpenCircuit={(doc, title) => openDocument(doc, title)}
            onOpenExample={openExample}
            onNotice={showNotice}
          />
          <EditorTabs
            mode={mode}
            title={documentTitle}
            onOpenExample={openExample}
            onNewCircuit={startNewCircuit}
            onHideSimulator={() => setMode("schematic")}
          />
          <main className="stage">
            <Canvas analysis={analysis} />
            {components.length === 0 && wires.length === 0 && <EmptyState />}
          </main>
          <BottomPanel mode={mode} result={analysis} />
        </section>
        {mode === "simulator" && (
          <AnalysisErrorBoundary>
            <SimulationPanel
              result={analysis}
              options={analysisOptions}
              onOptionsChange={setAnalysisOptions}
              onRun={runAnalysis}
              onStop={stopAnalysis}
            />
          </AnalysisErrorBoundary>
        )}
        {mode === "simulator" ? <AskSimPanel result={analysis} /> : <Palette focusSignal={componentFocusSignal} onNotice={showNotice} />}
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
      {notice && <div className="shell-toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
