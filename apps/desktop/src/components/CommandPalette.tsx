import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import { useSchematic } from "../store/useSchematic";
import type { ComponentKind } from "../schematic/types";

interface Entry {
  kind: ComponentKind | "__wire__" | "__probe__";
  name: string;
  section: string;
  hotkey: string;
}

const ENTRIES: Entry[] = [
  ...CATALOG.map((c) => ({ kind: c.kind, name: c.name, section: c.section, hotkey: c.hotkey })),
  { kind: "__wire__", name: "Wire", section: "Tools", hotkey: "w" },
  { kind: "__probe__", name: "Probe", section: "Tools", hotkey: "" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENTRIES;
    return ENTRIES.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.section.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.kind === "__wire__") startWiring();
    else if (entry.kind === "__probe__") startProbing();
    else startPlacing(entry.kind);
    onClose();
  };

  return (
    <div className="cmdk-backdrop" onPointerDown={onClose}>
      <div className="cmdk" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Add component">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search parts to place…   ↑↓ navigate · ↵ place · esc close"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="cmdk-list">
          {results.map((entry, idx) => (
            <li
              key={entry.kind}
              className={`cmdk-item${idx === active ? " active" : ""}`}
              onPointerEnter={() => setActive(idx)}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(entry);
              }}
            >
              <svg className="cmdk-icon" viewBox="-42 -34 84 68">
                {entry.kind === "__wire__" ? (
                  <path className="wire-icon" d="M -30 16 H 0 V -16 H 30" />
                ) : entry.kind === "__probe__" ? (
                  <g className="symbol">
                    <circle cx={0} cy={0} r={7} fill="none" />
                    <circle cx={0} cy={0} r={2.5} />
                  </g>
                ) : (
                  <g className="symbol">
                    <ComponentSymbol kind={entry.kind} />
                  </g>
                )}
              </svg>
              <span className="cmdk-name">{entry.name}</span>
              <span className="cmdk-section">{entry.section}</span>
              <kbd className="cmdk-key">{entry.hotkey.toUpperCase()}</kbd>
            </li>
          ))}
          {results.length === 0 && <li className="cmdk-empty">No matching parts</li>}
        </ul>
      </div>
    </div>
  );
}
