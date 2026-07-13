// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExplorerPanel } from "./ShellPanels";
import { useProject } from "../store/useProject";

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
  });
  useProject.getState().ensureDefaultWorkspace();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderExplorer = () => {
  const onOpenSimFile = vi.fn();
  const onNotice = vi.fn();
  render(
    <ExplorerPanel
      activeFilePath={null}
      onOpenSimFile={onOpenSimFile}
      onOpenAscText={vi.fn()}
      onNotice={onNotice}
    />,
  );
  return { onOpenSimFile, onNotice };
};

describe("ExplorerPanel VS Code action row", () => {
  it("exposes New File, New Folder, Refresh, and Collapse as working controls", async () => {
    renderExplorer();
    for (const name of [
      "New simulation file",
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
    await waitFor(() => expect(screen.getByText("Analog")).toBeTruthy());
  });

  it("creates and opens a simulation from the New File control", async () => {
    const { onOpenSimFile } = renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New simulation file" }));
    const input = screen.getByRole("textbox", { name: "New simulation name" });
    fireEvent.change(input, { target: { value: "gain-stage.sim" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpenSimFile).toHaveBeenCalledOnce());
    expect(screen.getByText("gain-stage.sim")).toBeTruthy();
  });

  it("creates a visible folder from the New Folder control", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByRole("textbox", { name: "New folder name" });
    fireEvent.change(input, { target: { value: "Filters" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Filters")).toBeTruthy());
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
});
