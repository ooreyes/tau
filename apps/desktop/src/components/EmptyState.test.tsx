// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { useProject } from "../store/useProject";
import { useSchematic } from "../store/useSchematic";

const originalProjectActions = {
  detectCapability: useProject.getState().detectCapability,
  ensureDefaultWorkspace: useProject.getState().ensureDefaultWorkspace,
};

beforeEach(() => {
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    error: null,
    capability: "none",
    workspaceFiles: {},
    ...originalProjectActions,
  });
  useSchematic.setState({ userModelLibraries: [], past: [], future: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fileFrom(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer } as File;
}

describe("EmptyState no-project import action", () => {
  it("gives every prose action a real button when no project is open (folder, import)", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import circuit" })).toBeTruthy();
  });

  it("does not show the no-project Import action once a schematic can be created directly", () => {
    render(<EmptyState projectOpen onNewCircuit={vi.fn()} onAskBode={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Import circuit" })).toBeNull();
    expect(screen.getByRole("button", { name: "New schematic" })).toBeTruthy();
  });

  it("imports a dropped .asc into a freshly seeded workspace and opens it", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onOpenAscText = vi.fn();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onOpenAscText={onOpenAscText} onNotice={onNotice} />);

    const source = "Version 4\nSHEET 1 880 680\n";
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("existing.asc", source)] } });

    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/existing\.asc$/),
      "existing.asc",
      source,
    ));
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("Imported"));
  });

  it("converts a dropped SPICE netlist and passes its conversion warnings through to onOpenAscText", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onOpenAscText = vi.fn();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onOpenAscText={onOpenAscText} onNotice={onNotice} />);

    const source = "* t\nR1 a 0 1k\nX1 a b mysub\n.end\n";
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("board.cir", source)] } });

    await waitFor(() => expect(onOpenAscText).toHaveBeenCalled());
    const call = onOpenAscText.mock.calls[0];
    expect(call[0]).toMatch(/board\.asc$/);
    expect(call[3]).toEqual(expect.arrayContaining([expect.stringContaining("X1")]));
  });

  it("refuses to attach a dropped model library since no schematic can be open on this screen", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onNotice={onNotice} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("vendor.lib", ".subckt FOO a b\nR1 a b 1k\n.ends\n")] } });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      "Open or create a schematic before attaching a model library.",
    ));
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("explains precisely when a dropped file is not something Tau can import", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onNotice={onNotice} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("photo.png", "hello")] } });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("does not recognize")));
  });
});
