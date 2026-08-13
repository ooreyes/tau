// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { isTitlebarControlTarget, Toolbar } from "./Toolbar";
import {
  createTitlebarGestureMachine,
  handleTitlebarDoubleClick,
  startTitlebarDragging,
  toggleTitlebarMaximize,
} from "./titlebarWindow";
import type { AnalysisResult } from "../simulation/linearTransient";

const nativeWindow = vi.hoisted(() => ({
  isMaximized: vi.fn(),
  maximize: vi.fn(async () => {}),
  unmaximize: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
}));

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

  it("toggles physical native window bounds and restores them", async () => {
    const isMaximized = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const maximize = vi.fn(async () => {});
    const unmaximize = vi.fn(async () => {});
    const window = {
      isMaximized,
      maximize,
      unmaximize,
      startDragging: vi.fn(async () => {}),
    };

    await toggleTitlebarMaximize(window);
    expect(maximize).toHaveBeenCalledOnce();
    expect(unmaximize).not.toHaveBeenCalled();

    await toggleTitlebarMaximize(window);
    expect(unmaximize).toHaveBeenCalledOnce();
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
    expect(dragRegion.tagName).toBe("BUTTON");
    expect(dragRegion.getAttribute("type")).toBe("button");
    expect(dragRegion.getAttribute("aria-label")).toContain("double-click");
    expect(dragRegion.getAttribute("title")).toContain("maximize or restore");
    for (const selector of [".titlebar-left", ".mode-toggle", ".titlebar-right"]) {
      expect(toolbar.querySelector(selector)?.getAttribute("data-tauri-drag-region")).toBe("false");
    }
    expect(screen.getByRole("button", { name: "Run simulation" }).closest(".titlebar-drag-region")).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run simulation" }).closest(".titlebar-actions")).toBeTruthy();
  });

  it("treats the labeled drag surface as a gesture target even though it is button-shaped for AX", () => {
    const { container } = render(<Toolbar {...baseProps} />);
    const dragRegion = container.querySelector(".titlebar-drag-region")!;
    const ordinaryButton = screen.getByRole("button", { name: "Run simulation" });

    expect(isTitlebarControlTarget(dragRegion)).toBe(false);
    expect(isTitlebarControlTarget(ordinaryButton)).toBe(true);
  });

  it("toggles once for each complete native pointer double-click sequence", async () => {
    nativeWindow.isMaximized.mockReset()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    nativeWindow.maximize.mockClear();
    nativeWindow.unmaximize.mockClear();
    nativeWindow.startDragging.mockClear();
    const { container } = render(<Toolbar {...baseProps} />);
    const surface = container.querySelector(".titlebar-drag-region")!;
    const physicalDoubleClick = () => {
      fireEvent.mouseDown(surface, { button: 0, detail: 1 });
      fireEvent.click(surface, { detail: 1 });
      fireEvent.mouseDown(surface, { button: 0, detail: 2 });
      fireEvent.click(surface, { detail: 1 });
      fireEvent.doubleClick(surface, { detail: 2 });
    };

    physicalDoubleClick();
    physicalDoubleClick();

    await waitFor(() => expect(nativeWindow.unmaximize).toHaveBeenCalledOnce());
    expect(nativeWindow.maximize).toHaveBeenCalledOnce();
    // The regression this replaces: a drag was started on every press, so a
    // double-click asked the macOS window server to begin dragging twice while
    // also expecting to receive the events that server consumes. A stationary
    // double-click must not start a drag at all.
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
  });

  it("starts a native drag only once the pointer actually travels", async () => {
    nativeWindow.startDragging.mockClear();
    const { container } = render(<Toolbar {...baseProps} />);
    const surface = container.querySelector(".titlebar-drag-region")!;

    fireEvent.mouseDown(surface, { button: 0, detail: 1, clientX: 200, clientY: 12 });
    // Inside the threshold: still a click, so nothing native has happened yet.
    fireEvent.mouseMove(window, { clientX: 201, clientY: 13 });
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();

    fireEvent.mouseMove(window, { clientX: 240, clientY: 60 });
    await waitFor(() => expect(nativeWindow.startDragging).toHaveBeenCalledOnce());

    // And exactly once for the gesture, however far it continues.
    fireEvent.mouseMove(window, { clientX: 300, clientY: 90 });
    fireEvent.mouseUp(window);
    expect(nativeWindow.startDragging).toHaveBeenCalledOnce();
  });

  it("stops listening for movement once the press is released", () => {
    nativeWindow.startDragging.mockClear();
    const { container } = render(<Toolbar {...baseProps} />);
    const surface = container.querySelector(".titlebar-drag-region")!;

    fireEvent.mouseDown(surface, { button: 0, detail: 1, clientX: 200, clientY: 12 });
    fireEvent.mouseUp(window);
    // A later pointer sweep with no button held must not move the window.
    fireEvent.mouseMove(window, { clientX: 400, clientY: 200 });
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
  });

  it("treats an accessibility click pair as one toggle", async () => {
    nativeWindow.isMaximized.mockReset().mockResolvedValueOnce(false);
    nativeWindow.maximize.mockClear();
    nativeWindow.unmaximize.mockClear();
    const { container } = render(<Toolbar {...baseProps} />);
    const surface = container.querySelector(".titlebar-drag-region")!;

    fireEvent.click(surface, { detail: 1 });
    fireEvent.click(surface, { detail: 1 });

    await waitFor(() => expect(nativeWindow.maximize).toHaveBeenCalledOnce());
    expect(nativeWindow.unmaximize).not.toHaveBeenCalled();
  });

  it("keeps gesture state deterministic for pointer and AX event orders", () => {
    const machine = createTitlebarGestureMachine();
    // A press arms a drag; it does not start one.
    expect(machine.mouseDown(0, 1, { x: 0, y: 0 })).toBe("arm");
    expect(machine.pointerMove({ x: 1, y: 1 })).toBe("ignore");
    expect(machine.click(10, 1)).toBe("ignore");
    expect(machine.mouseDown(20, 2, { x: 0, y: 0 })).toBe("toggle");
    expect(machine.click(30, 1)).toBe("ignore");
    expect(machine.doubleClick(40)).toBe("ignore");

    const dragged = createTitlebarGestureMachine();
    expect(dragged.mouseDown(0, 1, { x: 100, y: 10 })).toBe("arm");
    expect(dragged.pointerMove({ x: 102, y: 11 })).toBe("ignore");
    expect(dragged.pointerMove({ x: 140, y: 40 })).toBe("drag");
    // One drag per gesture, and a dragged press is no longer a click half.
    expect(dragged.pointerMove({ x: 200, y: 80 })).toBe("ignore");
    dragged.pointerUp();
    expect(dragged.mouseDown(30, 1, { x: 200, y: 80 })).toBe("arm");

    const ax = createTitlebarGestureMachine();
    expect(ax.click(0, 1)).toBe("ignore");
    expect(ax.click(20, 1)).toBe("toggle");
    expect(ax.doubleClick(30)).toBe("ignore");
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

  it("gives idle Run and Ask Bode the same restrained invitation, never a stateful run", () => {
    const { rerender } = render(<Toolbar {...baseProps} />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    const bode = screen.getByRole("button", { name: "Open Bode" });
    expect(run.classList.contains("pdf4-action-sheen")).toBe(true);
    expect(bode.classList.contains("pdf4-action-sheen")).toBe(true);

    rerender(<Toolbar {...baseProps} isRunning />);
    expect(screen.getByRole("button", { name: "Run simulation" }).classList.contains("pdf4-action-sheen")).toBe(false);
    expect(screen.getByRole("button", { name: "Open Bode" }).classList.contains("pdf4-action-sheen")).toBe(false);
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

  it("keeps Run and the one Assistant entry point in the right-aligned action group in both modes", () => {
    const onToggleAssistant = vi.fn();
    const { rerender } = render(<Toolbar {...baseProps} onToggleAssistant={onToggleAssistant} />);

    const open = screen.getByRole("button", { name: "Open Bode" });
    expect(open.closest(".titlebar-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run simulation" }).closest(".titlebar-actions")).toBeTruthy();
    expect(open.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(open);
    expect(onToggleAssistant).toHaveBeenCalledOnce();

    rerender(<Toolbar {...baseProps} mode="simulator" assistantOpen onToggleAssistant={onToggleAssistant} />);
    const close = screen.getByRole("button", { name: "Close Bode" });
    expect(close.getAttribute("aria-pressed")).toBe("true");
    expect(close.classList.contains("assistant-toolbar-button--active")).toBe(true);
  });
});
