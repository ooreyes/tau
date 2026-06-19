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
import { useSchematic } from "./store/useSchematic";
import { CATALOG } from "./schematic/catalog";
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
  const cancel = useSchematic((s) => s.cancel);
  const rotate = useSchematic((s) => s.rotate);
  const deleteSelected = useSchematic((s) => s.deleteSelected);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const runAnalysis = useCallback(() => {
    setAnalysis(runTransientAnalysis({ components, wires }, analysisOptions));
  }, [components, wires, analysisOptions]);

  useEffect(() => {
    setAnalysis(null);
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
    <div className="app">
      <Toolbar onRun={runAnalysis} />
      <Palette />
      <main className="stage">
        <Canvas analysis={analysis} />
        {components.length === 0 && wires.length === 0 && <EmptyState />}
      </main>
      <AnalysisErrorBoundary>
        <SimulationPanel
          result={analysis}
          options={analysisOptions}
          onOptionsChange={setAnalysisOptions}
          onRun={runAnalysis}
        />
      </AnalysisErrorBoundary>
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
