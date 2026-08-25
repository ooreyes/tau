// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HierarchyGuidanceDialog } from "./HierarchyGuidanceDialog";
import { HIERARCHY_GUIDANCE_KEY, resetHierarchyGuidance } from "../lib/hierarchyGuidance";

afterEach(() => {
  cleanup();
  resetHierarchyGuidance();
});

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
  });
});

describe("HierarchyGuidanceDialog", () => {
  it("teaches the five-step boundary workflow with keyboard-reachable controls", () => {
    const onStart = vi.fn();
    render(<HierarchyGuidanceDialog open onOpenChange={vi.fn()} onStart={onStart} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Save the sheet inside a project")).toBeTruthy();
    expect(screen.getByLabelText("Step 1 of 5")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();

    for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Save, then run the real hierarchy")).toBeTruthy();
    expect(screen.getByText("5 / 5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start with Sheet interface" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(HIERARCHY_GUIDANCE_KEY) ?? "null")).toMatchObject({ completed: true });
  });
});
