import { useEffect, useMemo, useRef, useState } from "react";
import { useSchematic } from "../store/useSchematic";
import { PALETTE_SECTIONS } from "../schematic/catalog";
import {
  allPaletteItems,
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

// The visual disclosure affordance is intentionally very quiet, but it still
// needs to form a complete control relationship for a keyboard or screen-reader
// user. These ids are derived from the stable catalog labels, rather than from
// render order, so filtering or a future section reorder cannot make a stored
// accessibility relationship point at the wrong list.
function sectionListId(section: string) {
  return `palette-section-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function Palette({ focusSignal }: { focusSignal: number; onNotice: (message: string) => void }) {
  const tool = useSchematic((s) => s.tool);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpen);
  // The preview carries the row's VALUE as well as its kind: a logic gate's
  // drawing is its function and input count, and a contact's is its position,
  // so a kind-only preview showed all seven gates as the same picture.
  const [preview, setPreview] = useState<{ kind: ComponentKind; name: string; value?: string }>({
    kind: "resistor",
    name: "Resistor",
    value: "1k",
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

  // A keyboard selection can make a row active without a pointer entering it.
  // Follow that active row as well as hover/focus so the viewer always shows
  // the currently highlighted catalog item using the exact ComponentSymbol
  // geometry, including five-terminal CT transformers.
  const activeItem = useMemo(
    () => tool.mode === "place" ? allPaletteItems().find((item) => isActive(item)) ?? null : null,
    [tool],
  );
  useEffect(() => {
    if (activeItem) setPreview({ kind: activeItem.kind, name: activeItem.name, value: activeItem.value });
  }, [activeItem]);

  const place = (item: PaletteItemSpec) => {
    setPreview({ kind: item.kind, name: item.name, value: item.value });
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
    // ComponentsRail already supplies the named complementary landmark. This
    // content is a panel within that landmark, not a second complementary
    // region: an unlabelled nested <aside> makes screen-reader landmark
    // navigation announce a duplicate, context-free "complementary" entry.
    <div className="palette">
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
                    onPreview={() => setPreview({ kind: item.kind, name: item.name, value: item.value })}
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
              const listId = sectionListId(section);
              return (
                <div className="palette-section" key={section}>
                  <button
                    className="palette-section-header"
                    onClick={() => toggleSection(section)}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? listId : undefined}
                  >
                    <span className="palette-title">{section}</span>
                    <span className="palette-title-rule" aria-hidden="true" />
                    <span className={`palette-chevron${isOpen ? " open" : ""}`} aria-hidden="true">›</span>
                  </button>
                  {isOpen && (
                    <div id={listId} className="palette-list">
                      {items.map((item) => (
                        <PaletteItem
                          key={item.id}
                          item={item}
                          active={isActive(item)}
                          onPlace={() => place(item)}
                          onPreview={() => setPreview({ kind: item.kind, name: item.name, value: item.value })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="palette-section">
              {/** See sectionListId above: the disclosure name must not include the decorative chevron. */}
              <button
                className="palette-section-header"
                onClick={() => toggleSection("__tools__")}
                aria-expanded={openSections["__tools__"] !== false}
                aria-controls={openSections["__tools__"] !== false ? sectionListId("tools") : undefined}
              >
                <span className="palette-title">Tools</span>
                <span className="palette-title-rule" aria-hidden="true" />
                <span className={`palette-chevron${openSections["__tools__"] !== false ? " open" : ""}`} aria-hidden="true">›</span>
              </button>
              {openSections["__tools__"] !== false && (
                <div id={sectionListId("tools")} className="palette-list">
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
          <svg
            viewBox="-44 -40 88 80"
            role="img"
            aria-label={`${preview.name} symbol`}
            data-component-preview={preview.kind}
          >
            <g className="symbol">
              {/* `catalog`: this panel previews the part TYPE under the
                  cursor, so an LED here must not wear its colour parameter.
                  See ComponentSymbol's doc comment. */}
              <ComponentSymbol kind={preview.kind} value={preview.value} catalog />
            </g>
          </svg>
          <strong>{preview.name}</strong>
          <em>⌞</em>
        </div>
      </div>
    </div>
  );
}

interface PaletteItemProps {
  item: PaletteItemSpec;
  active: boolean;
  onPlace: () => void;
  onPreview: () => void;
}

function PaletteItem({ item, active, onPlace, onPreview }: PaletteItemProps) {
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
      onMouseEnter={onPreview}
      onFocus={onPreview}
    >
      <svg className="palette-icon" viewBox="-42 -40 84 80">
        <g className="symbol">
          {/* `catalog`: a browse row is an index of part types, not a placed
              part - the LED row is drawn in the rail's monochrome stroke. */}
          <ComponentSymbol kind={item.kind} value={item.value} catalog />
        </g>
      </svg>
      <span className="palette-name">{item.name}</span>
      {item.desc ? <span className="palette-desc">{item.desc}</span> : null}
      {item.hotkey ? <kbd className="palette-key">{item.hotkey.toUpperCase()}</kbd> : null}
    </button>
  );
}
