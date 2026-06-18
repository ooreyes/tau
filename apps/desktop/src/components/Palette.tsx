import { useSchematic } from "../store/useSchematic";
import { CATALOG } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";

export function Palette() {
  const tool = useSchematic((s) => s.tool);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const activeKind = tool.mode === "place" ? tool.kind : null;

  return (
    <aside className="palette">
      <div className="palette-title">Components</div>
      <div className="palette-list">
        {CATALOG.map((e) => (
          <button
            key={e.kind}
            className={`palette-item${activeKind === e.kind ? " active" : ""}`}
            title={`Place ${e.name.toLowerCase()} — press ${e.hotkey.toUpperCase()}`}
            onClick={(ev) => {
              startPlacing(e.kind);
              ev.currentTarget.blur();
            }}
          >
            <svg className="palette-icon" viewBox="-40 -36 80 72">
              <g className="symbol">
                <ComponentSymbol kind={e.kind} />
              </g>
            </svg>
            <span className="palette-name">{e.name}</span>
            <kbd className="palette-key">{e.hotkey.toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      <div className="palette-hint">
        Click a part or press its key, then click the canvas to place it. Keep
        clicking to place more.
      </div>
    </aside>
  );
}
