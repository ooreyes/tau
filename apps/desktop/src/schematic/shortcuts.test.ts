import { describe, it, expect } from "vitest";
import { resolveShortcut, type ShortcutAction } from "./shortcuts";

const plain = (key: string) => resolveShortcut({ key, ctrlOrMeta: false, shift: false });
const mod = (key: string, shift = false) => resolveShortcut({ key, ctrlOrMeta: true, shift });

describe("resolveShortcut — LTspice function keys (§8)", () => {
  it.each<[string, ShortcutAction]>([
    ["F2", "palette"],
    ["F3", "wire"],
    ["F5", "delete"],
    ["F6", "copy"],
    ["F9", "undo"],
  ])("%s → %s", (key, action) => {
    expect(plain(key)).toBe(action);
  });

  it("Shift+F9 redoes (LTspice)", () => {
    expect(resolveShortcut({ key: "F9", ctrlOrMeta: false, shift: true })).toBe("redo");
  });

  it("keeps F4/F7/F8 unbound until label/move/drag tools exist", () => {
    expect(plain("F4")).toBeNull();
    expect(plain("F7")).toBeNull();
    expect(plain("F8")).toBeNull();
  });
});

describe("resolveShortcut — modifier bindings", () => {
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

describe("resolveShortcut — plain keys", () => {
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
