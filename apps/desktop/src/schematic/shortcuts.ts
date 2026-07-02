/**
 * Keyboard shortcut table (FEATURE_PARITY §8 — LTspice parity). Pure resolver
 * so every binding is unit-testable; `App.tsx` dispatches on the returned
 * action id. The caller is responsible for the "typing in an input" guard.
 *
 * LTspice function keys: F2 part picker, F3 wire, F5 delete, F6 copy, F9 undo
 * (Shift+F9 redo). F4 (net label), F7 (move), F8 (drag) are intentionally
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
  | "wire";

export interface ShortcutKey {
  key: string;
  ctrlOrMeta: boolean;
  shift: boolean;
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
