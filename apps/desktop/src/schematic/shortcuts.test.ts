import { describe, it, expect, vi } from "vitest";
import {
  dispatchShortcutAction,
  isEditingAction,
  resolveShortcut,
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
