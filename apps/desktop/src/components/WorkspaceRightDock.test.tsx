// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  SHELL_LAYOUT,
  workspaceCanFitIndependentColumns,
  workspaceExplorerMax,
  workspaceRightColumnMax,
} from "./WorkspaceRightDock";
import { ASSISTANT_PANEL_WIDTH } from "./AssistantPanel";
import { COMPONENTS_RAIL_WIDTH } from "./ShellPanels";

describe("independent workspace columns", () => {
  it("admits both independent columns only when all schematic floors fit", () => {
    expect(workspaceCanFitIndependentColumns(993, [
      COMPONENTS_RAIL_WIDTH.minWidth,
      ASSISTANT_PANEL_WIDTH.minWidth,
    ])).toBe(false);
    expect(workspaceCanFitIndependentColumns(994, [
      COMPONENTS_RAIL_WIDTH.minWidth,
      ASSISTANT_PANEL_WIDTH.minWidth,
    ])).toBe(true);

    const assistantWidth = workspaceRightColumnMax(
      1000,
      "schematic",
      ASSISTANT_PANEL_WIDTH,
      [COMPONENTS_RAIL_WIDTH.minWidth],
    );
    const componentsWidth = workspaceRightColumnMax(
      1000,
      "schematic",
      COMPONENTS_RAIL_WIDTH,
      [assistantWidth],
    );
    const explorerWidth = workspaceExplorerMax(1000, [componentsWidth, assistantWidth]);

    expect(assistantWidth).toBe(286);
    expect(componentsWidth).toBe(208);
    expect(explorerWidth).toBe(SHELL_LAYOUT.explorerMin);
  });

  it("keeps the 900px budget exact by showing one independent right column", () => {
    const shellWidth = 900;
    const assistantWidth = Math.min(
      ASSISTANT_PANEL_WIDTH.defaultWidth,
      workspaceRightColumnMax(shellWidth, "schematic", ASSISTANT_PANEL_WIDTH),
    );
    const explorerWidth = workspaceExplorerMax(shellWidth, [assistantWidth]);

    expect(assistantWidth).toBe(340);
    expect(explorerWidth).toBe(230);
    expect(
      SHELL_LAYOUT.railWidth
        + (SHELL_LAYOUT.handleWidth * 2)
        + SHELL_LAYOUT.schematicEditorMin
        + explorerWidth!
        + assistantWidth,
    ).toBe(shellWidth);
  });
});
