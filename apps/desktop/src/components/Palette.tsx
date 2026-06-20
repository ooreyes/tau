import { useMemo, useState } from "react";
import { useSchematic } from "../store/useSchematic";
import { CATALOG } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import type { ComponentKind } from "../schematic/types";

const sections = [...new Set(CATALOG.map((entry) => entry.section))];

// Initialize all sections as open
const initialOpen = Object.fromEntries(sections.map((s) => [s, true]));

export function Palette() {
  const tool = useSchematic((s) => s.tool);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const activeKind = tool.mode === "place" ? tool.kind : null;

  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen);
  const [selectedKind, setSelectedKind] = useState<ComponentKind>("resistor");

  const trimmed = query.trim().toLowerCase();

  const filteredBySection = useMemo(() => {
    if (!trimmed) return null; // null = use sections normally
    const matched = CATALOG.filter(
      (e) =>
        e.name.toLowerCase().includes(trimmed) ||
        e.section.toLowerCase().includes(trimmed) ||
        e.kind.toLowerCase().includes(trimmed) ||
        e.hotkey.toLowerCase() === trimmed,
    );
    return matched;
  }, [trimmed]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <aside className="palette">
      <div className="palette-head">
        <span>component selection</span>
        <div>
          <button title="Add library">＋</button>
          <button title="Remove library">−</button>
        </div>
      </div>

      <div className="palette-search-wrap">
        <input
          className="palette-search"
          type="search"
          placeholder="Filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          aria-label="Filter components"
        />
      </div>

      <div className="palette-table-head">
        <span>item</span>
        <span>description</span>
      </div>

      <div className="palette-scroll">
        {filteredBySection !== null ? (
          /* Flat search results */
          filteredBySection.length > 0 ? (
            <div className="palette-section">
              <div className="palette-list">
                {filteredBySection.map((e) => (
                  <PaletteItem
                    key={e.kind}
                    kind={e.kind}
                    name={e.name}
                    hotkey={e.hotkey}
                    active={activeKind === e.kind}
                    onPlace={() => {
                      setSelectedKind(e.kind);
                      startPlacing(e.kind);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="palette-empty">No parts match "{query.trim()}"</div>
          )
        ) : (
          /* Grouped sections */
          <>
            {sections.map((section) => {
              const items = CATALOG.filter((e) => e.section === section);
              const isOpen = openSections[section] !== false;
              return (
                <div className="palette-section" key={section}>
                  <button
                    className="palette-section-header"
                    onClick={() => toggleSection(section)}
                    aria-expanded={isOpen}
                  >
                    <span className="palette-title">{section}</span>
                    <span className={`palette-chevron${isOpen ? " open" : ""}`}>›</span>
                  </button>
                  {isOpen && (
                    <div className="palette-list">
                      {items.map((e) => (
                        <PaletteItem
                          key={e.kind}
                          kind={e.kind}
                          name={e.name}
                          hotkey={e.hotkey}
                          active={activeKind === e.kind}
                          onPlace={() => {
                            setSelectedKind(e.kind);
                            startPlacing(e.kind);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tools section */}
            <div className="palette-section">
              <button
                className="palette-section-header"
                onClick={() => toggleSection("__tools__")}
                aria-expanded={openSections["__tools__"] !== false}
              >
                <span className="palette-title">Tools</span>
                <span className={`palette-chevron${openSections["__tools__"] !== false ? " open" : ""}`}>›</span>
              </button>
              {openSections["__tools__"] !== false && (
                <div className="palette-list">
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
                    <span className="palette-desc">route net</span>
                    <kbd className="palette-key">W</kbd>
                  </button>
                  <button
                    className={`palette-item${tool.mode === "probe" ? " active" : ""}`}
                    title="Probe a node — then click a wire or pin to plot it"
                    onClick={(ev) => {
                      startProbing();
                      ev.currentTarget.blur();
                    }}
                  >
                    <svg className="palette-icon" viewBox="-40 -36 80 72">
                      <g className="symbol">
                        <circle cx={0} cy={0} r={11} fill="none" />
                        <line x1={0} y1={-18} x2={0} y2={-11} />
                      </g>
                    </svg>
                    <span className="palette-name">Probe</span>
                    <span className="palette-desc">plot net</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="symbol-preview">
        <span>symbol</span>
        <div>
          <svg viewBox="-44 -40 88 80">
            <g className="symbol">
              <ComponentSymbol kind={selectedKind} />
            </g>
          </svg>
          <strong>{CATALOG.find((entry) => entry.kind === selectedKind)?.name ?? selectedKind}</strong>
          <em>⌞</em>
        </div>
      </div>
    </aside>
  );
}

interface PaletteItemProps {
  kind: ComponentKind;
  name: string;
  hotkey: string;
  active: boolean;
  onPlace: () => void;
}

function PaletteItem({ kind, name, hotkey, active, onPlace }: PaletteItemProps) {
  return (
    <button
      className={`palette-item${active ? " active" : ""}`}
      title={`Place ${name.toLowerCase()} — press ${hotkey.toUpperCase()}`}
      onClick={(ev) => {
        onPlace();
        ev.currentTarget.blur();
      }}
    >
      <svg className="palette-icon" viewBox="-42 -40 84 80">
        <g className="symbol">
          <ComponentSymbol kind={kind} />
        </g>
      </svg>
      <span className="palette-name">{name}</span>
      <span className="palette-desc">{kind}</span>
      <kbd className="palette-key">{hotkey.toUpperCase()}</kbd>
    </button>
  );
}
