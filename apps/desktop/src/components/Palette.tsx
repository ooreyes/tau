import { useSchematic } from "../store/useSchematic";
import { CATALOG } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";

const sections = [...new Set(CATALOG.map((entry) => entry.section))];

export function Palette() {
  const tool = useSchematic((s) => s.tool);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const activeKind = tool.mode === "place" ? tool.kind : null;

  return (
    <aside className="palette">
      <div className="palette-scroll">
        {sections.map((section) => (
          <div className="palette-section" key={section}>
            <div className="palette-title">{section}</div>
            <div className="palette-list">
              {CATALOG.filter((entry) => entry.section === section).map((e) => (
                <button
                  key={e.kind}
                  className={`palette-item${activeKind === e.kind ? " active" : ""}`}
                  title={`Place ${e.name.toLowerCase()} — press ${e.hotkey.toUpperCase()}`}
                  onClick={(ev) => {
                    startPlacing(e.kind);
                    ev.currentTarget.blur();
                  }}
                >
                  <svg className="palette-icon" viewBox="-42 -40 84 80">
                    <g className="symbol">
                      <ComponentSymbol kind={e.kind} />
                    </g>
                  </svg>
                  <span className="palette-name">{e.name}</span>
                  <kbd className="palette-key">{e.hotkey.toUpperCase()}</kbd>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="palette-title palette-tools-title">Tools</div>
      <button
        className={`palette-item${tool.mode === "wire" ? " active" : ""}`}
        title="Draw wire — press W"
        onClick={(ev) => {
          startWiring();
          ev.currentTarget.blur();
        }}
      >
        <svg className="palette-icon" viewBox="-40 -36 80 72">
          <path className="wire-icon" d="M -30 18 H 0 V -18 H 30" />
        </svg>
        <span className="palette-name">Wire</span>
        <kbd className="palette-key">W</kbd>
      </button>
      <div className="palette-hint">
        Click a part or press its key, then click the canvas to place it. Use
        Wire to connect grid points. Semiconductor and op-amp models are
        placeable now; ngspice support comes next.
      </div>
    </aside>
  );
}
