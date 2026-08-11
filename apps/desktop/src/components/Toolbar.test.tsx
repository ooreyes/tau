// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Toolbar } from "./Toolbar";
import { handleTitlebarDoubleClick, startTitlebarDragging, toggleTitlebarMaximize } from "./titlebarWindow";
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
  it("turns a direct title-bar double-click into one native maximize toggle", async () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const toggleMaximize = vi.fn(async () => {});

    await handleTitlebarDoubleClick({ preventDefault, stopPropagation }, toggleMaximize);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("uses Tauri's native toggleMaximize API for the window", async () => {
    const toggleMaximize = vi.fn(async () => {});
    const window = { toggleMaximize, startDragging: vi.fn(async () => {}) };

    await toggleTitlebarMaximize(window);
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("starts native dragging through the explicit window API", async () => {
    const startDragging = vi.fn(async () => {});
    await startTitlebarDragging({ startDragging });
    expect(startDragging).toHaveBeenCalledOnce();
  });

  it("keeps native title-bar drag and zoom on an unused surface only", () => {
    const { container } = render(<Toolbar {...baseProps} />);
    const toolbar = container.querySelector(".toolbar")!;
    const dragRegion = container.querySelector(".titlebar-drag-region")!;

    expect(toolbar.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(dragRegion.getAttribute("data-tauri-drag-region")).toBeNull();
    expect(dragRegion.getAttribute("aria-hidden")).toBe("true");
    expect(dragRegion.getAttribute("title")).toContain("maximize or restore");
    for (const selector of [".titlebar-left", ".mode-toggle", ".titlebar-right"]) {
      expect(toolbar.querySelector(selector)?.getAttribute("data-tauri-drag-region")).toBe("false");
    }
    expect(screen.getByRole("button", { name: "Run simulation" }).closest(".titlebar-drag-region")).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" }).closest(".titlebar-drag-region")).toBeNull();
  });

  it("stays neutral before validation and still invokes Run", () => {
    const onRun = vi.fn();
    render(<Toolbar {...baseProps} onRun={onRun} />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    expect(run.classList.contains("run-button--ok")).toBe(false);
    expect(run.classList.contains("run-button--error")).toBe(false);
    expect(run.classList.contains("run-button--running")).toBe(false);
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("uses the success gradient only after a completed clean run", () => {
    const complete = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    } as AnalysisResult;
    render(<Toolbar {...baseProps} mode="simulator" result={complete} runState="complete" />);
    expect(screen.getByRole("button", { name: "Run simulation" }).classList.contains("run-button--ok")).toBe(true);
  });

  it("uses the active gradient while a run is in progress", () => {
    render(<Toolbar {...baseProps} mode="simulator" isRunning />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    expect(run.classList.contains("run-button--running")).toBe(true);
    expect(run.classList.contains("run-button--ok")).toBe(false);
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

    const open = screen.getByRole("button", { name: "Open Bode" });
    expect(open.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(open);
    expect(onToggleAssistant).toHaveBeenCalledOnce();

    rerender(<Toolbar {...baseProps} mode="simulator" assistantOpen onToggleAssistant={onToggleAssistant} />);
    const close = screen.getByRole("button", { name: "Close Bode" });
    expect(close.getAttribute("aria-pressed")).toBe("true");
    expect(close.classList.contains("assistant-toolbar-button--active")).toBe(true);
  });
});
