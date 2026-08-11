// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ActivityRail } from "./NavRail";

afterEach(() => cleanup());

describe("ActivityRail shell contract", () => {
  it("keeps four symmetric workspace destinations and no redundant Settings gear", () => {
    render(
      <ActivityRail
        mode="schematic"
        explorerOpen
        partsOpen={false}
        projectOpen
        schematicOpen
        onFocusExplorer={vi.fn()}
        onModeChange={vi.fn()}
        onSearch={vi.fn()}
        onFocusComponents={vi.fn()}
      />,
    );

    const rail = screen.getByRole("navigation", { name: "Workspace sections" });
    expect(rail.querySelectorAll(".rail-btn")).toHaveLength(4);
    expect(rail.querySelector(".rail-separator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Explorer" }).getAttribute("aria-current")).toBe("page");
  });

  it("keeps every rail destination keyboard-focusable with a tooltip label", () => {
    render(
      <ActivityRail
        mode="simulator"
        explorerOpen={false}
        partsOpen
        projectOpen
        schematicOpen
        onFocusExplorer={vi.fn()}
        onModeChange={vi.fn()}
        onSearch={vi.fn()}
        onFocusComponents={vi.fn()}
      />,
    );

    for (const label of ["Explorer", "Search", "Components", "Waveforms"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.getAttribute("type")).toBe("button");
      expect(button.classList.contains("rail-btn")).toBe(true);
    }
  });
});
