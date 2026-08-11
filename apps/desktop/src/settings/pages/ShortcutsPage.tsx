/**
 * Keyboard shortcuts: the bindings, read off the resolver rather than retyped.
 *
 * Justification: Tau ships LTspice's function-key layout (F3 wire, F4 label,
 * F5 delete, F9 undo) alongside Mac conventions, and until now the only way to
 * discover that was to read `schematic/shortcuts.ts`. A user migrating from
 * LTspice needs to know their reflexes still work.
 *
 * `SHORTCUT_BINDINGS` is the data form of the resolver's switch and is held to
 * it by `shortcuts.test.ts`, so this table cannot quietly describe bindings the
 * app does not have. Placement hotkeys come straight from `CATALOG`, which is
 * the same list the palette and the keydown handler read.
 */
import { useMemo } from "react";
import { CATALOG } from "../../schematic/catalog";
import {
  SHORTCUT_ACTION_LABELS,
  SHORTCUT_BINDINGS,
  type ShortcutAction,
} from "../../schematic/shortcuts";
import { SettingsGroup, SettingsNotice, SettingsPage } from "../SettingsPrimitives";

/** Display order: editing first, then tools, then the view-level pair. */
const ACTION_ORDER: readonly ShortcutAction[] = [
  "undo",
  "redo",
  "copy",
  "paste",
  "duplicate",
  "delete",
  "rotate",
  "mirror",
  "wire",
  "label",
  "palette",
  "cancel",
];

function Keycap({ children }: { children: string }) {
  return <kbd className="tau-keycap">{children}</kbd>;
}

export function ShortcutsPage() {
  const byAction = useMemo(() => {
    const map = new Map<ShortcutAction, string[]>();
    for (const binding of SHORTCUT_BINDINGS) {
      const list = map.get(binding.action) ?? [];
      list.push(binding.display);
      map.set(binding.action, list);
    }
    return map;
  }, []);

  // Not every catalogue part has a hotkey, and a part without one has nothing
  // to say on a shortcuts page. Including them rendered a column of empty
  // keycaps, which is worse than omitting them.
  const placement = useMemo(
    () =>
      CATALOG.filter((entry) => entry.paletteVisible !== false && entry.hotkey.trim().length > 0).sort((a, b) =>
        a.hotkey.localeCompare(b.hotkey),
      ),
    [],
  );

  return (
    <SettingsPage
      title="Keyboard shortcuts"
      summary="Every binding Tau resolves today. These are fixed in this build and cannot be remapped yet."
    >
      <SettingsGroup
        title="Editing and tools"
        note="Control and Command are interchangeable. LTspice's function keys work as well as the Mac equivalents, so both sets of reflexes are safe."
      >
        <div className="tau-shortcut-table" role="table" aria-label="Editing shortcuts">
          {ACTION_ORDER.map((action) => {
            const keys = byAction.get(action);
            if (!keys) return null;
            return (
              <div className="tau-shortcut-row" role="row" key={action}>
                <span role="cell" className="tau-shortcut-name">
                  {SHORTCUT_ACTION_LABELS[action]}
                </span>
                <span role="cell" className="tau-shortcut-keys">
                  {keys.map((key) => (
                    <Keycap key={key}>{key}</Keycap>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsNotice title="W is the wire tool, not the VCCS">
        <p>
          W starts the wire tool. The parts list below also gives W to a voltage-controlled
          current source, and the wire tool wins, so that part has to be placed from the parts
          panel or with Find parts. This is a real collision and is listed rather than hidden.
        </p>
      </SettingsNotice>

      <SettingsGroup
        title="Place a part"
        note="Press the key with the schematic focused to start placing that component. Available in the schematic view only."
      >
        <div className="tau-shortcut-grid" role="table" aria-label="Component placement hotkeys">
          {placement.map((entry) => (
            <div className="tau-shortcut-chip" role="row" key={`${entry.kind}-${entry.hotkey}`}>
              <Keycap>{entry.hotkey.toUpperCase()}</Keycap>
              <span role="cell" className="tau-shortcut-part">
                {entry.name}
              </span>
            </div>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Elsewhere in Tau">
        <div className="tau-shortcut-table" role="table" aria-label="Application shortcuts">
          <div className="tau-shortcut-row" role="row">
            <span role="cell" className="tau-shortcut-name">
              Save schematic
            </span>
            <span role="cell" className="tau-shortcut-keys">
              <Keycap>⌘S</Keycap>
            </span>
          </div>
          <div className="tau-shortcut-row" role="row">
            <span role="cell" className="tau-shortcut-name">
              Zoom the waveform view
            </span>
            <span role="cell" className="tau-shortcut-keys">
              <Keycap>⌘ scroll</Keycap>
            </span>
          </div>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
