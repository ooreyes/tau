// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnsavedRecoverySnapshot } from "../lib/unsavedRecovery";
import { UnsavedRecoveryDialog } from "./UnsavedRecoveryDialog";

afterEach(() => {
  cleanup();
});

function snapshot(overrides: Partial<UnsavedRecoverySnapshot> = {}): UnsavedRecoverySnapshot {
  return {
    version: 1,
    savedAt: Date.now() - 120_000,
    dirty: true,
    title: "tank.asc",
    filePath: "/tmp/tank.asc",
    signature: "sig",
    document: {
      components: [{
        id: "r1",
        kind: "resistor",
        label: "R1",
        value: "1k",
        x: 0,
        y: 0,
        rotation: 0,
      }],
      wires: [],
    },
    ...overrides,
  };
}

describe("UnsavedRecoveryDialog", () => {
  it("offers Restore and Discard with the schematic title", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <UnsavedRecoveryDialog
        snapshot={snapshot()}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Restore unsaved work?")).toBeTruthy();
    expect(screen.getByText(/tank\.asc/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("labels untitled scratchpads without a path", () => {
    render(
      <UnsavedRecoveryDialog
        snapshot={snapshot({ filePath: null, title: "untitled.sim" })}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText(/unsaved schematic “untitled\.sim”/)).toBeTruthy();
  });

  it("does not discard or close the recovery copy when Escape is pressed", () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedRecoveryDialog
        snapshot={snapshot()}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("does not discard or close the recovery copy when the backdrop is clicked", () => {
    const onDiscard = vi.fn();
    const { container } = render(
      <UnsavedRecoveryDialog
        snapshot={snapshot()}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    const overlay = container.ownerDocument.querySelector<HTMLElement>(
      '[data-slot="dialog-overlay"]',
    );
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("discards only when the explicit Discard action is chosen", () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedRecoveryDialog
        snapshot={snapshot()}
        onRestore={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
