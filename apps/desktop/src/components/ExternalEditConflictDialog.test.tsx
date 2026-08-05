// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalEditConflictDialog,
  type PendingExternalEdit,
} from "./ExternalEditConflictDialog";

afterEach(() => {
  cleanup();
});

function pending(overrides: Partial<PendingExternalEdit> = {}): PendingExternalEdit {
  return {
    tabId: "tab-1",
    filePath: "/tmp/tank.asc",
    title: "tank.asc",
    kind: "conflict",
    diskText: "Version 4\nWIRE 0 0 16 0\n",
    diskFingerprint: "v1:1:abc",
    ...overrides,
  };
}

describe("ExternalEditConflictDialog", () => {
  it("offers Reload and Keep mine for a conflict", () => {
    const onReload = vi.fn();
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(
      <ExternalEditConflictDialog
        pending={pending()}
        onReload={onReload}
        onKeep={onKeep}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("File conflict")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("offers Reload for a clean external change", () => {
    render(
      <ExternalEditConflictDialog
        pending={pending({ kind: "external-only" })}
        onReload={vi.fn()}
        onKeep={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("File changed on disk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeTruthy();
  });

  it("hides Reload and offers Keep open / Discard when the file is missing", () => {
    const onDiscard = vi.fn();
    const onKeep = vi.fn();
    render(
      <ExternalEditConflictDialog
        pending={pending({ kind: "missing", diskText: null, diskFingerprint: null })}
        onReload={vi.fn()}
        onKeep={onKeep}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByText("File missing on disk")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep open" }));
    expect(onKeep).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
