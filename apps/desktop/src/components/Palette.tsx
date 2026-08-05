import { useEffect, useMemo, useRef, useState } from "react";
import { useSchematic } from "../store/useSchematic";
import { PALETTE_SECTIONS } from "../schematic/catalog";
import {
  matchPaletteItems,
  paletteItemsForSection,
  type PaletteItemSpec,
} from "../schematic/paletteItems";
import { ComponentSymbol } from "../schematic/symbols";
import type { ComponentKind } from "../schematic/types";
import { Input } from "@/components/ui/input";

// Explicit EveryCircuit-like browse order (not CATALOG insertion order).
const sections = [...PALETTE_SECTIONS];

// Initialize all sections as open
const initialOpen = Object.fromEntries([
  ...sections.map((s) => [s, true] as const),
  ["__tools__", true] as const,
]);

export function Palette({ focusSignal }: { focusSignal: number; onNotice: (message: string) => void }) {
  const tool = useSchematic((s) => s.tool);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen);
  const [preview, setPreview] = useState<{ kind: ComponentKind; name: string }>({
    kind: "resistor",
    name: "Resistor",
  });

  const trimmed = query.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    if (!trimmed) return null;
    return matchPaletteItems(trimmed);
  }, [trimmed]);

  const isActive = (item: PaletteItemSpec) =>
    tool.mode === "place" &&
    tool.kind === item.kind &&
    (tool.value === undefined ? item.value === undefined || item.id === item.kind : tool.value === item.value);

  const place = (item: PaletteItemSpec) => {
    setPreview({ kind: item.kind, name: item.name });
    startPlacing(item.kind, item.value);
  };

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    if (focusSignal > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [focusSignal]);

  return (
    <aside className="palette">
      <div className="palette-head">
        <span>Components</span>
      </div>

      <div className="palette-search-wrap">
        <span className="palette-search-icon" aria-hidden="true" />
        <Input
          ref={searchRef}
          size="sm"
          className="palette-search"
          type="search"
          placeholder="Filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          aria-label="Filter components"
        />
      </div>

      <div className="palette-scroll">
        {filteredItems !== null ? (
          filteredItems.length > 0 ? (
            <div className="palette-section">
              <div className="palette-list">
                {filteredItems.map((item) => (
                  <PaletteItem
                    key={item.id}
                    item={item}
                    active={isActive(item)}
                    onPlace={() => place(item)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="palette-empty">No parts match "{query.trim()}"</div>
          )
        ) : (
          <>
            {sections.map((section) => {
              const items = paletteItemsForSection(section);
              const isOpen = openSections[section] !== false;
              return (
                <div className="palette-section" key={section}>
                  <button
                    className="palette-section-header"
                    onClick={() => toggleSection(section)}
                    aria-expanded={isOpen}
                  >
                    <span className="palette-title">{section}</span>
                    <span className="palette-title-rule" aria-hidden="true" />
                    <span className={`palette-chevron${isOpen ? " open" : ""}`}>›</span>
                  </button>
                  {isOpen && (
                    <div className="palette-list">
                      {items.map((item) => (
                        <PaletteItem
                          key={item.id}
                          item={item}
                          active={isActive(item)}
                          onPlace={() => place(item)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="palette-section">
              <button
                className="palette-section-header"
                onClick={() => toggleSection("__tools__")}
                aria-expanded={openSections["__tools__"] !== false}
              >
                <span className="palette-title">Tools</span>
                <span className="palette-title-rule" aria-hidden="true" />
                <span className={`palette-chevron${openSections["__tools__"] !== false ? " open" : ""}`}>›</span>
              </button>
              {openSections["__tools__"] !== false && (
                <div className="palette-list">
                  <button
                    className={`palette-item${tool.mode === "wire" ? " active" : ""}`}
                    title="Draw wire - press W"
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
                    title="Probe voltage on a wire/pin or current through a component"
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
                  <button
                    className={`palette-item${tool.mode === "label" ? " active" : ""}`}
                    title="Name a net - press F4, click a point, type the name"
                    onClick={(ev) => {
                      startLabeling();
                      ev.currentTarget.blur();
                    }}
                  >
                    <svg className="palette-icon" viewBox="-40 -36 80 72">
                      <g className="symbol">
                        <path d="M -26 -12 H 6 L 24 0 L 6 12 H -26 Z" fill="none" />
                        <path d="M -18 -5 V 5 M -10 -5 V 5" fill="none" />
                      </g>
                    </svg>
                    <span className="palette-name">Net label</span>
                    <span className="palette-desc">name net</span>
                    <kbd className="palette-key">F4</kbd>
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
              <ComponentSymbol kind={preview.kind} />
            </g>
          </svg>
          <strong>{preview.name}</strong>
          <em>⌞</em>
        </div>
      </div>
    </aside>
  );
}

interface PaletteItemProps {
  item: PaletteItemSpec;
  active: boolean;
  onPlace: () => void;
}

function PaletteItem({ item, active, onPlace }: PaletteItemProps) {
  return (
    <button
      className={`palette-item${active ? " active" : ""}`}
      title={
        item.hotkey
          ? `Place ${item.name.toLowerCase()} - press ${item.hotkey.toUpperCase()}`
          : `Place ${item.name.toLowerCase()}`
      }
      onClick={(ev) => {
        onPlace();
        ev.currentTarget.blur();
      }}
    >
      <svg className="palette-icon" viewBox="-42 -40 84 80">
        <g className="symbol">
          <ComponentSymbol kind={item.kind} />
        </g>
      </svg>
      <span className="palette-name">{item.name}</span>
      {item.desc ? <span className="palette-desc">{item.desc}</span> : null}
      {item.hotkey ? <kbd className="palette-key">{item.hotkey.toUpperCase()}</kbd> : null}
    </button>
  );
}
