import { useRef } from "react";
import { useSchematic } from "../store/useSchematic";
import { EXAMPLE_CIRCUITS } from "../examples/circuits";

interface ToolbarProps {
  onRun: () => void;
}

export function Toolbar({ onRun }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const components = useSchematic((s) => s.components);
  const wires = useSchematic((s) => s.wires);
  const undo = useSchematic((s) => s.undo);
  const redo = useSchematic((s) => s.redo);
  const canUndo = useSchematic((s) => s.past.length > 0);
  const canRedo = useSchematic((s) => s.future.length > 0);
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
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">τ</span>
        <span className="brand-name">Tau</span>
        <span className="brand-sub">circuit simulator</span>
      </div>

      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          className="tool-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          aria-label="Redo"
        >
          ↷
        </button>
      </div>

      <div className="toolbar-group">
        <button className="text-btn" onClick={newCircuit} title="Start a blank circuit">
          New
        </button>
        <button className="text-btn" onClick={() => fileInputRef.current?.click()} title="Open a Tau circuit file">
          Open
        </button>
        <button className="text-btn" onClick={saveCircuit} disabled={!hasDocument} title="Save circuit as a Tau JSON file">
          Save
        </button>
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
            <option value="" disabled>
              Open...
            </option>
            {EXAMPLE_CIRCUITS.map((circuit) => (
              <option key={circuit.id} value={circuit.id}>
                {circuit.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar-spacer" />

      <button className="run-btn" onClick={onRun} title="Run transient analysis">
        ▶&nbsp; Run
      </button>
      <span className="version-tag">v0.2 · pre-alpha</span>
    </header>
  );
}
