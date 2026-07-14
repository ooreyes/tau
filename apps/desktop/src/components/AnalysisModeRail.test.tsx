// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisModeRail } from "./AnalysisModeRail";

afterEach(() => cleanup());

describe("AnalysisModeRail", () => {
  it("keeps every analysis reachable with a full accessible name and tooltip", () => {
    render(<AnalysisModeRail value="tran" onValueChange={() => undefined} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(tabs.map((tab) => tab.textContent)).toEqual(["TRAN", "OP", "AC", "DC", "TF", "NOISE", "STEP"]);

    const noise = screen.getByRole("tab", { name: "Noise analysis (.noise)" });
    expect(noise.getAttribute("title")).toBe("Noise analysis (.noise)");
    expect((noise as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a mode selection without owning or clearing analysis results", () => {
    const onValueChange = vi.fn();
    render(<AnalysisModeRail value="tran" onValueChange={onValueChange} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operating point (.op)" }), { button: 0 });
    expect(onValueChange).toHaveBeenCalledWith("op");
  });

  it("exposes a coherent disabled state while an analysis is running", () => {
    render(<AnalysisModeRail value="ac" onValueChange={() => undefined} disabled />);

    for (const tab of screen.getAllByRole("tab")) expect((tab as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("tab", { name: "AC sweep (.ac)" }).getAttribute("data-state")).toBe("active");
  });
});
