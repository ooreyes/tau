import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { CATALOG } from "../schematic/catalog";
import { ComponentSymbol } from "../schematic/symbols";
import { useSchematic } from "../store/useSchematic";
import type { ComponentKind } from "../schematic/types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

interface Entry {
  kind: ComponentKind | "__wire__" | "__probe__" | "__label__" | "__settings__";
  name: string;
  section: string;
  hotkey: string;
  /** Words the search matches but never renders. Carried through from the
   *  catalog so a part named for the act stays reachable by the jargon. */
  searchTerms?: readonly string[];
}

const ENTRIES: Entry[] = [
  ...CATALOG
    .filter((entry) => entry.paletteVisible !== false)
    .map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      section: entry.section,
      hotkey: entry.hotkey,
      ...(entry.searchTerms ? { searchTerms: entry.searchTerms } : {}),
    })),
  { kind: "__wire__", name: "Wire", section: "Tools", hotkey: "w" },
  { kind: "__probe__", name: "Probe", section: "Tools", hotkey: "" },
  { kind: "__label__", name: "Net label", section: "Tools", hotkey: "f4" },
  { kind: "__settings__", name: "Settings", section: "Tau", hotkey: "⌘," },
];

export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const startProbing = useSchematic((s) => s.startProbing);
  const startLabeling = useSchematic((s) => s.startLabeling);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENTRIES;
    // Two filters run in series here: this one, and cmdk's own matching against
    // each item's `value`. Both have to know about `searchTerms`, or this one
    // drops the row before cmdk ever gets a chance to match it.
    return ENTRIES.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.section.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q) ||
        (e.searchTerms?.some((term) => term.toLowerCase().includes(q)) ?? false),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of results) {
      const list = map.get(entry.section) ?? [];
      list.push(entry);
      map.set(entry.section, list);
    }
    return [...map.entries()];
  }, [results]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.kind === "__wire__") startWiring();
    else if (entry.kind === "__probe__") startProbing();
    else if (entry.kind === "__label__") startLabeling();
    else if (entry.kind === "__settings__") onOpenSettings?.();
    else startPlacing(entry.kind);
    onClose();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add component"
      className="cmdk-dialog"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search parts to place…   ↑↓ navigate · ↵ place · esc close"
        className="cmdk-input"
      />
      <CommandList className="cmdk-list">
        <CommandEmpty className="cmdk-empty">No matching parts</CommandEmpty>
        {grouped.map(([section, entries]) => (
          <CommandGroup key={section} heading={section}>
            {entries.map((entry) => (
              <CommandItem
                key={entry.kind}
                // `searchTerms` is part of the match string, not decoration. A
                // part whose NAME is deliberately the act rather than the jargon
                // ("Sheet block", not "Subcircuit (X)") still has to be findable
                // by the jargon - otherwise renaming it for clarity silently
                // removes it from Cmd-K for everyone who knows the old word,
                // which is a discoverability regression dressed as an
                // improvement. `kind` alone does not cover it: it spells the
                // abbreviated "subckt" and never "subcircuit".
                value={[entry.name, entry.section, entry.kind, ...(entry.searchTerms ?? [])].join(" ")}
                className="cmdk-item"
                onSelect={() => choose(entry)}
              >
                {entry.kind === "__settings__" ? (
                  <Settings className="cmdk-icon" size={18} strokeWidth={1.6} aria-hidden="true" />
                ) : (
                  <svg className="cmdk-icon" viewBox="-42 -34 84 68" aria-hidden="true">
                    {entry.kind === "__wire__" ? (
                      <path className="wire-icon" d="M -30 16 H 0 V -16 H 30" />
                    ) : entry.kind === "__probe__" ? (
                      <g className="symbol">
                        <circle cx={0} cy={0} r={7} fill="none" />
                        <circle cx={0} cy={0} r={2.5} />
                      </g>
                    ) : entry.kind === "__label__" ? (
                      <g className="symbol">
                        <path d="M -26 -12 H 6 L 24 0 L 6 12 H -26 Z" fill="none" />
                        <path d="M -18 -5 V 5 M -10 -5 V 5" fill="none" />
                      </g>
                    ) : (
                      <g className="symbol">
                        <ComponentSymbol kind={entry.kind} />
                      </g>
                    )}
                  </svg>
                )}
                <span className="cmdk-name">{entry.name}</span>
                {entry.hotkey ? (
                  <CommandShortcut className="cmdk-key">{entry.hotkey.toUpperCase()}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
