// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Toolbar } from "./Toolbar";
import type { AnalysisResult } from "../simulation/linearTransient";

afterEach(() => cleanup());

const baseProps = {
  mode: "schematic" as const,
  result: null,
  runState: "idle" as const,
  isRunning: false,
  title: "test.sim",
  assistantOpen: false,
  onModeChange: vi.fn(),
  onRun: vi.fn(),
  onToggleAssistant: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe("Toolbar Run health control", () => {
  it("is visibly acceptable before a known error and still invokes Run", () => {
    const onRun = vi.fn();
    render(<Toolbar {...baseProps} onRun={onRun} />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    expect(run.classList.contains("run-button--ok")).toBe(true);
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("switches to the danger gradient after a failed run", () => {
    const failed = {
      ok: false,
      title: "Transient",
      message: "singular matrix",
      warnings: [],
    } as AnalysisResult;
    render(<Toolbar {...baseProps} result={failed} runState="error" />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    expect(run.classList.contains("run-button--error")).toBe(true);
    expect(run.classList.contains("run-button--ok")).toBe(false);
  });

  it("keeps the one Assistant entry point in the top-right toolbar in both modes", () => {
    const onToggleAssistant = vi.fn();
    const { rerender } = render(<Toolbar {...baseProps} onToggleAssistant={onToggleAssistant} />);

    const open = screen.getByRole("button", { name: "Open Tau assistant" });
    expect(open.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(open);
    expect(onToggleAssistant).toHaveBeenCalledOnce();

    rerender(<Toolbar {...baseProps} mode="simulator" assistantOpen onToggleAssistant={onToggleAssistant} />);
    const close = screen.getByRole("button", { name: "Close Tau assistant" });
    expect(close.getAttribute("aria-pressed")).toBe("true");
    expect(close.classList.contains("assistant-toolbar-button--active")).toBe(true);
  });
});
