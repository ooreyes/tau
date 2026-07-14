// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExplorerPanel } from "./ShellPanels";
import { useProject } from "../store/useProject";

const originalProjectActions = {
  detectCapability: useProject.getState().detectCapability,
  ensureDefaultWorkspace: useProject.getState().ensureDefaultWorkspace,
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

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
  useProject.getState().ensureDefaultWorkspace();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderExplorer = () => {
  const onOpenSimFile = vi.fn();
  const onOpenAscText = vi.fn();
  const onNotice = vi.fn();
  render(
    <ExplorerPanel
      activeFilePath={null}
      onOpenSimFile={onOpenSimFile}
      onOpenAscText={onOpenAscText}
      onNotice={onNotice}
    />,
  );
  return { onOpenSimFile, onOpenAscText, onNotice };
};

describe("ExplorerPanel VS Code action row", () => {
  it("exposes New File, New Folder, Refresh, and Collapse as working controls", async () => {
    const { onNotice } = renderExplorer();
    for (const name of [
      "New schematic file",
      "New folder",
      "Refresh explorer",
      "Collapse folders in explorer",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    expect(useProject.getState().expanded.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Collapse folders in explorer" }));
    expect(useProject.getState().expanded).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Explorer refreshed."));
  });

  it("creates and opens an ASC schematic from the New File control", async () => {
    const { onOpenAscText } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New schematic file" }));
    const input = screen.getByRole("textbox", { name: "New schematic name" });
    fireEvent.change(input, { target: { value: "gain-stage" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/gain-stage\.asc$/),
      "gain-stage.asc",
      "Version 4\nSHEET 1 880 680\n",
    ));
    expect(screen.getByText("gain-stage.asc")).toBeTruthy();
  });

  it("creates a visible folder from the New Folder control", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByRole("textbox", { name: "New folder name" });
    fireEvent.change(input, { target: { value: "Filters" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Filters")).toBeTruthy());
  });

  it("imports and opens ASC text without changing its filename", async () => {
    const { onOpenAscText } = renderExplorer();
    const source = "Version 4\nSHEET 1 880 680\n";
    const bytes = new TextEncoder().encode(source);
    const file = { name: "existing.asc", arrayBuffer: async () => bytes.buffer } as File;
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".asc"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/existing\.asc$/),
      "existing.asc",
      source,
    ));
    expect(screen.getByText("existing.asc")).toBeTruthy();
  });

  it("still opens an explicit legacy .sim document", async () => {
    const root = useProject.getState().rootPath!;
    const path = await useProject.getState().createSchematicFile(root, "legacy.sim");
    const { onOpenSimFile } = renderExplorer();

    fireEvent.click(screen.getByRole("button", { name: "legacy.sim" }));
    await waitFor(() => expect(onOpenSimFile).toHaveBeenCalledWith(
      path,
      "legacy.sim",
      expect.stringContaining('"app": "Tau"'),
    ));
  });

  it("does not announce a successful refresh when the project refresh fails", async () => {
    useProject.setState({ refresh: vi.fn().mockResolvedValue(false) });
    const { onNotice } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    await waitFor(() => expect(useProject.getState().refresh).toHaveBeenCalledOnce());
    expect(onNotice).not.toHaveBeenCalledWith("Explorer refreshed.");
  });

  it("keeps Open Folder and LTspice import available as secondary project actions", () => {
    renderExplorer();
    expect(screen.getByRole("button", { name: "Open Folder…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import .asc…" })).toBeTruthy();
  });

  it("offers real-folder actions when native Tau has no project open", () => {
    useProject.setState({
      rootPath: null,
      rootName: null,
      tree: [],
      capability: "tauri",
      detectCapability: vi.fn().mockResolvedValue(undefined),
      ensureDefaultWorkspace: vi.fn(),
    });
    renderExplorer();

    expect(screen.getByRole("button", { name: "Open Folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import .asc…" })).toBeTruthy();
    expect(screen.getByText("Schematics")).toBeTruthy();
  });

  it("does not claim the browser can create a folder", () => {
    useProject.setState({
      rootPath: null,
      rootName: null,
      tree: [],
      capability: "web",
      detectCapability: vi.fn().mockResolvedValue(undefined),
      ensureDefaultWorkspace: vi.fn(),
    });
    renderExplorer();

    expect(screen.getByRole("button", { name: "Open Folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Folder" })).toBeNull();
  });
});
