import { describe, it, expect, vi } from "vitest";
import {
  dispatchShortcutAction,
  isEditingAction,
  resolveShortcut,
  SHORTCUT_ACTION_LABELS,
  SHORTCUT_BINDINGS,
  type ShortcutAction,
  type ShortcutHandlers,
} from "./shortcuts";

const plain = (key: string) => resolveShortcut({ key, ctrlOrMeta: false, shift: false });
const mod = (key: string, shift = false) => resolveShortcut({ key, ctrlOrMeta: true, shift });

describe("resolveShortcut - LTspice function keys", () => {
  it.each<[string, ShortcutAction]>([
    ["F2", "palette"],
    ["F3", "wire"],
    ["F4", "label"],
    ["F5", "delete"],
    ["F6", "copy"],
    ["F9", "undo"],
  ])("%s → %s", (key, action) => {
    expect(plain(key)).toBe(action);
  });

  it("Shift+F9 redoes (LTspice)", () => {
    expect(resolveShortcut({ key: "F9", ctrlOrMeta: false, shift: true })).toBe("redo");
  });

  it("keeps F7/F8 unbound until move/drag tools exist", () => {
    expect(plain("F7")).toBeNull();
    expect(plain("F8")).toBeNull();
  });

  it("leaves Ctrl/Cmd+F4 alone (OS window shortcut)", () => {
    expect(mod("F4")).toBeNull();
  });
});

describe("resolveShortcut - modifier bindings", () => {
  it.each<[string, boolean, ShortcutAction]>([
    ["z", false, "undo"],
    ["z", true, "redo"],
    ["y", false, "redo"],
    ["k", false, "palette"],
    ["r", false, "rotate"],
    ["e", false, "mirror"],
    ["c", false, "copy"],
    ["v", false, "paste"],
    ["d", false, "duplicate"],
  ])("ctrl/cmd+%s (shift=%s) → %s", (key, shift, action) => {
    expect(mod(key, shift)).toBe(action);
  });

  it("is case-insensitive for letter keys (Shift held)", () => {
    expect(resolveShortcut({ key: "Z", ctrlOrMeta: true, shift: true })).toBe("redo");
    expect(plain("W")).toBe("wire");
  });

  it("passes unrelated modifier combos through (null)", () => {
    expect(mod("s")).toBeNull();
    expect(mod("F5")).toBeNull();
  });
});

describe("resolveShortcut - plain keys", () => {
  it.each<[string, ShortcutAction]>([
    ["/", "palette"],
    ["Escape", "cancel"],
    [" ", "rotate"],
    ["Backspace", "delete"],
    ["Delete", "delete"],
    ["w", "wire"],
  ])("%j → %s", (key, action) => {
    expect(plain(key)).toBe(action);
  });

  it("returns null for unbound keys (catalog hotkeys handled elsewhere)", () => {
    expect(plain("r")).toBeNull(); // resistor placement, not rotate
    expect(plain("F1")).toBeNull();
  });
});

const ALL_ACTIONS: ShortcutAction[] = [
  "undo", "redo", "palette", "rotate", "mirror", "copy", "paste",
  "duplicate", "cancel", "delete", "wire", "label",
];

const noopHandlers = (): ShortcutHandlers => ({
  undo: vi.fn(),
  redo: vi.fn(),
  openPalette: vi.fn(),
  rotate: vi.fn(),
  mirror: vi.fn(),
  copy: vi.fn(),
  paste: vi.fn(),
  duplicate: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  wire: vi.fn(),
  label: vi.fn(),
});

describe("isEditingAction - schematic read-only-outside-schematic-view gate ", () => {
  it("treats cancel and palette as view-level (always allowed)", () => {
    expect(isEditingAction("cancel")).toBe(false);
    expect(isEditingAction("palette")).toBe(false);
  });

  it.each<ShortcutAction>(["undo", "redo", "rotate", "mirror", "copy", "paste", "duplicate", "delete", "wire", "label"])(
    "treats %s as an editing action",
    (action) => {
      expect(isEditingAction(action)).toBe(true);
    },
  );
});

describe("dispatchShortcutAction - mode gate ", () => {
  it("dispatches every action in schematic mode", () => {
    const handlers = noopHandlers();
    for (const action of ALL_ACTIONS) dispatchShortcutAction(action, "schematic", handlers);
    expect(handlers.undo).toHaveBeenCalledTimes(1);
    expect(handlers.redo).toHaveBeenCalledTimes(1);
    expect(handlers.openPalette).toHaveBeenCalledTimes(1);
    expect(handlers.rotate).toHaveBeenCalledTimes(1);
    expect(handlers.mirror).toHaveBeenCalledTimes(1);
    expect(handlers.copy).toHaveBeenCalledTimes(1);
    expect(handlers.paste).toHaveBeenCalledTimes(1);
    expect(handlers.duplicate).toHaveBeenCalledTimes(1);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(handlers.remove).toHaveBeenCalledTimes(1);
    expect(handlers.wire).toHaveBeenCalledTimes(1);
    expect(handlers.label).toHaveBeenCalledTimes(1);
  });

  it("blocks every editing action in simulator mode", () => {
    const handlers = noopHandlers();
    for (const action of ALL_ACTIONS) dispatchShortcutAction(action, "simulator", handlers);
    expect(handlers.undo).not.toHaveBeenCalled();
    expect(handlers.redo).not.toHaveBeenCalled();
    expect(handlers.rotate).not.toHaveBeenCalled();
    expect(handlers.mirror).not.toHaveBeenCalled();
    expect(handlers.copy).not.toHaveBeenCalled();
    expect(handlers.paste).not.toHaveBeenCalled();
    expect(handlers.duplicate).not.toHaveBeenCalled();
    expect(handlers.remove).not.toHaveBeenCalled();
    expect(handlers.wire).not.toHaveBeenCalled();
    expect(handlers.label).not.toHaveBeenCalled();
  });

  it("still lets cancel and palette (⌘K) through in simulator mode", () => {
    const handlers = noopHandlers();
    dispatchShortcutAction("cancel", "simulator", handlers);
    dispatchShortcutAction("palette", "simulator", handlers);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
    expect(handlers.openPalette).toHaveBeenCalledTimes(1);
  });
});

/**
 * `SHORTCUT_BINDINGS` is a second statement of what `resolveShortcut`'s switch
 * already implements, so the Settings shortcuts page can render bindings as
 * data. Two statements of the same facts drift. These tests are what stop that:
 * every row is fed back through the resolver, and the key space is swept for
 * bindings no row mentions.
 */
describe("SHORTCUT_BINDINGS agrees with the resolver", () => {
  it("resolves every listed binding to the action it claims", () => {
    for (const binding of SHORTCUT_BINDINGS) {
      expect(
        resolveShortcut({
          key: binding.key,
          ctrlOrMeta: binding.ctrlOrMeta,
          shift: binding.shift,
        }),
        `${binding.display} should resolve to ${binding.action}`,
      ).toBe(binding.action);
    }
  });

  it("lists every binding the resolver actually has", () => {
    // The full space the resolver looks at: single printable keys plus the
    // named keys it switches on, across both modifier states and both shifts.
    const keys = [
      ..."abcdefghijklmnopqrstuvwxyz0123456789/ ".split(""),
      "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9",
      "Escape", "Backspace", "Delete", "Enter", "Tab",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ];
    const listed = new Set(
      SHORTCUT_BINDINGS.map((b) => `${b.key}|${b.ctrlOrMeta}|${b.shift}`),
    );
    const missing: string[] = [];
    for (const key of keys) {
      for (const ctrlOrMeta of [false, true]) {
        for (const shift of [false, true]) {
          const action = resolveShortcut({ key, ctrlOrMeta, shift });
          if (!action) continue;
          if (listed.has(`${key}|${ctrlOrMeta}|${shift}`)) continue;
          // A shift-insensitive binding is listed once, unshifted, and that is
          // fine as long as the unshifted row resolves to the same action.
          if (
            !shift &&
            listed.has(`${key}|${ctrlOrMeta}|false`)
          ) continue;
          if (
            shift &&
            listed.has(`${key}|${ctrlOrMeta}|false`) &&
            resolveShortcut({ key, ctrlOrMeta, shift: false }) === action
          ) continue;
          missing.push(`${ctrlOrMeta ? "mod+" : ""}${shift ? "shift+" : ""}${key} -> ${action}`);
        }
      }
    }
    expect(missing, "bindings the resolver has but the table omits").toEqual([]);
  });

  it("names every action it can display", () => {
    for (const binding of SHORTCUT_BINDINGS) {
      expect(SHORTCUT_ACTION_LABELS[binding.action]).toBeTruthy();
    }
  });
});
