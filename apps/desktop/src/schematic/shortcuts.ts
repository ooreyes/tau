/**
 * Keyboard shortcut table (FEATURE_PARITY §8 — LTspice parity). Pure resolver
 * so every binding is unit-testable; `App.tsx` dispatches on the returned
 * action id. The caller is responsible for the "typing in an input" guard.
 *
 * LTspice function keys: F2 part picker, F3 wire, F4 net label, F5 delete,
 * F6 copy, F9 undo (Shift+F9 redo). F7 (move) and F8 (drag) are intentionally
 * unbound until Tau grows those tools — binding them to something else would
 * teach users the wrong reflex.
 */

export type ShortcutAction =
  | "undo"
  | "redo"
  | "palette"
  | "rotate"
  | "mirror"
  | "copy"
  | "paste"
  | "duplicate"
  | "cancel"
  | "delete"
  | "wire"
  | "label";

export interface ShortcutKey {
  key: string;
  ctrlOrMeta: boolean;
  shift: boolean;
}

/**
 * Actions that read or navigate rather than mutate the schematic document or
 * arm an editing tool — safe to run from any view. Every other action is an
 * editing action and only applies in the schematic view: the simulator view
 * is read-only (pan/zoom/probe only — see Canvas's `interactive` prop and
 * `dispatchShortcutAction` below), so undo/redo, delete, rotate/mirror,
 * copy/paste/duplicate, and the wire/label tools must not fire there.
 */
const VIEW_LEVEL_ACTIONS = new Set<ShortcutAction>(["cancel", "palette"]);

export function isEditingAction(action: ShortcutAction): boolean {
  return !VIEW_LEVEL_ACTIONS.has(action);
}

export type EditorViewMode = "schematic" | "simulator";

/** The store/UI callbacks a resolved shortcut action dispatches to. Named
 *  `remove` (not `delete`, a reserved word in some contexts) for the
 *  "delete" action to keep the mapping obvious. */
export interface ShortcutHandlers {
  undo: () => void;
  redo: () => void;
  openPalette: () => void;
  rotate: () => void;
  mirror: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  cancel: () => void;
  remove: () => void;
  wire: () => void;
  label: () => void;
}

/**
 * Dispatch a resolved shortcut action, gated by view mode. Pure aside from
 * calling the supplied handlers, so it is unit-testable against the real
 * store's bound actions without rendering `App.tsx` (see shortcuts.test.ts).
 */
export function dispatchShortcutAction(
  action: ShortcutAction,
  mode: EditorViewMode,
  handlers: ShortcutHandlers,
): void {
  if (mode !== "schematic" && isEditingAction(action)) return;
  switch (action) {
    case "undo": return handlers.undo();
    case "redo": return handlers.redo();
    case "palette": return handlers.openPalette();
    case "rotate": return handlers.rotate();
    case "mirror": return handlers.mirror();
    case "copy": return handlers.copy();
    case "paste": return handlers.paste();
    case "duplicate": return handlers.duplicate();
    case "cancel": return handlers.cancel();
    case "delete": return handlers.remove();
    case "wire": return handlers.wire();
    case "label": return handlers.label();
  }
}

/**
 * Resolve a keystroke to an action, or null when unbound. Ctrl and Cmd are
 * interchangeable. Bindings that ignore Shift (Delete, Escape…) still resolve
 * with it held; modifier bindings are exact so unrelated OS shortcuts pass
 * through untouched.
 */
export function resolveShortcut({ key, ctrlOrMeta, shift }: ShortcutKey): ShortcutAction | null {
  const k = key.length === 1 ? key.toLowerCase() : key;

  if (ctrlOrMeta) {
    switch (k) {
      case "z":
        return shift ? "redo" : "undo";
      case "y":
        return "redo";
      case "k":
        return "palette";
      case "r":
        return "rotate";
      case "e":
        return "mirror";
      case "c":
        return "copy";
      case "v":
        return "paste";
      case "d":
        return "duplicate";
      default:
        return null; // leave other OS / app shortcuts alone
    }
  }

  switch (k) {
    case "/":
    case "F2":
      return "palette";
    case "F3":
      return "wire";
    case "F4":
      return "label";
    case "F5":
    case "Backspace":
    case "Delete":
      return "delete";
    case "F6":
      return "copy";
    case "F9":
      return shift ? "redo" : "undo";
    case "Escape":
      return "cancel";
    case " ":
      return "rotate";
    case "w":
      return "wire";
    default:
      return null;
  }
}
