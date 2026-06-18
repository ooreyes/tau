import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { SimulationPanel } from "./components/SimulationPanel";
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
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS_OPTIONS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const runAnalysis = useCallback(() => {
    setAnalysis(runTransientAnalysis({ components, wires }, analysisOptions));
  }, [components, wires, analysisOptions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey) return; // leave OS / app shortcuts alone

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
  }, [startPlacing, startWiring, cancel, rotate, deleteSelected]);

  return (
    <div className="app">
      <Toolbar onRun={runAnalysis} />
      <Palette />
      <main className="stage">
        <Canvas />
      </main>
      <SimulationPanel
        result={analysis}
        options={analysisOptions}
        onOptionsChange={setAnalysisOptions}
        onRun={runAnalysis}
      />
      <StatusBar />
    </div>
  );
}

export default App;
