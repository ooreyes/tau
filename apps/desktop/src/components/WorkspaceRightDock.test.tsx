// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHELL_LAYOUT,
  WorkspaceRightDock,
  workspaceExplorerMax,
  workspaceRightDockMax,
} from "./WorkspaceRightDock";
import { ASSISTANT_PANEL_WIDTH } from "./AssistantPanel";

afterEach(() => cleanup());

describe("WorkspaceRightDock", () => {
  it("keeps Components and Assistant concurrently visible behind one width separator", () => {
    const resize = {
      width: 340,
      dragging: false,
      onPointerDown: vi.fn(),
      onKeyDown: vi.fn(),
      setWidth: vi.fn((width: number) => width),
    };
    render(
      <WorkspaceRightDock
        width={340}
        resize={resize}
        minWidth={ASSISTANT_PANEL_WIDTH.minWidth}
        maxWidth={ASSISTANT_PANEL_WIDTH.maxWidth}
      >
        <aside aria-label="Components">Properties</aside>
        <aside aria-label="Assistant">Ask Tau</aside>
      </WorkspaceRightDock>,
    );

    const dock = screen.getByRole("group", { name: "Workspace tools" });
    expect(screen.getByRole("complementary", { name: "Components" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
    expect(screen.getAllByRole("separator", { name: "Resize workspace tools" })).toHaveLength(1);
    expect(dock.getAttribute("style")).toContain("--workspace-dock-w: 340px");
  });

  it("keeps the 900px schematic budget exact when both tools share the maximum dock", () => {
    const shellWidth = 900;
    const dockWidth = workspaceRightDockMax(shellWidth, "schematic", ASSISTANT_PANEL_WIDTH);
    const explorerWidth = workspaceExplorerMax(shellWidth, dockWidth);

    expect(dockWidth).toBe(402);
    expect(explorerWidth).toBe(SHELL_LAYOUT.explorerMin);
    expect(
      SHELL_LAYOUT.railWidth
        + (SHELL_LAYOUT.handleWidth * 2)
        + SHELL_LAYOUT.schematicEditorMin
        + explorerWidth!
        + dockWidth,
    ).toBe(shellWidth);
  });
});
