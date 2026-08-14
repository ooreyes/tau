// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("uses every non-transient analysis outcome instead of stale transient runState for header decoration", () => {
    const kinds = ["op", "ac", "dc", "tf", "noise", "step"] as const;
    const { rerender } = render(<Toolbar {...baseProps} mode="simulator" />);

    for (const kind of kinds) {
      // `runState` only records transient completion today. These are the
      // concrete outcome shapes App derives from its actual OP/AC/DC/TF/noise/
      // step result stores, so an idle transient state must not restore sheen.
      rerender(<Toolbar {...baseProps} mode="simulator" runState="idle" outcome={{ ok: true, message: kind }} />);
      const successful = screen.getByRole("button", { name: "Run simulation" });
      expect(successful.classList.contains("run-button--ok"), `${kind} success`).toBe(true);
      expect(successful.classList.contains("pdf4-action-sheen"), `${kind} success sheen`).toBe(false);
      expect(screen.getByText("Complete")).toBeTruthy();

      rerender(<Toolbar {...baseProps} mode="simulator" runState="complete" outcome={{ ok: false, message: `${kind} failed` }} />);
      const failed = screen.getByRole("button", { name: "Run simulation" });
      expect(failed.classList.contains("run-button--error"), `${kind} error`).toBe(true);
      expect(failed.classList.contains("pdf4-action-sheen"), `${kind} error sheen`).toBe(false);
      expect(screen.getByText("Error")).toBeTruthy();
    }
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

/**
 * CHROME-1: the Run control's idle state.
 *
 * History (`git log -p -- App.css` on the run-button rules): green has only
 * ever appeared AFTER a clean run (`.run-button--ok`); the idle invitation
 * PDF4 added paints in `--accent`, which is deliberately neutral graphite.
 * So "no longer a shimmering green" is a state that never existed, and these
 * tests pin the one the user asked for: idle Run reads healthy green, with the
 * shared restrained phase, and reduced motion still stops the phase.
 *
 * Nothing here restates a literal from App.css. The class list comes off the
 * rendered button and the declarations are read back out of the stylesheets.
 */
describe("run readiness ink", () => {
  const APP_CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");
  const PDF4_CSS = readFileSync(join(__dirname, "..", "styles", "pdf4Chrome.css"), "utf8");

  /** Every rule body in `css` whose selector mentions one of `classes`. */
  function rulesFor(css: string, classes: string[]): string[] {
    const bodies: string[] = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (let match = rule.exec(css); match; match = rule.exec(css)) {
      const selector = match[1];
      if (classes.some((cls) => selector.includes(`.${cls}`))) bodies.push(match[2]);
    }
    return bodies;
  }

  function idleRunClasses(): string[] {
    render(<Toolbar {...baseProps} />);
    const run = screen.getByRole("button", { name: "Run simulation" });
    cleanup();
    return [...run.classList];
  }

  it("inks the idle Run control green from the success token", () => {
    const declarations = rulesFor(APP_CSS + PDF4_CSS, idleRunClasses()).join("\n");
    expect(declarations).toMatch(/var\(--success\)/);
  });

  /**
   * "Green" is measured, not asserted: jsdom will not resolve `color-mix`, so
   * the mix is replayed here from the percentages in the rule and the token
   * hexes in App.css's own :root blocks. The accent-inked sheen the control
   * used to wear is blended the same way as the control: it resolves to a
   * neutral graphite (dark) / blue (light), which is what the review saw.
   */
  it("resolves to a green fill in both themes, where the shared sheen resolved to neutral", () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const blend = (ink: string, base: string, pct: number) =>
      channels(ink).map((v, i) => v * (pct / 100) + channels(base)[i] * (1 - pct / 100));
    const greenLead = (rgb: number[]) => rgb[1] - Math.max(rgb[0], rgb[2]);

    /** The nth definition of `token` in App.css - 1st is dark :root, 2nd light. */
    function token(name: string, occurrence: number): string {
      const hits = [...APP_CSS.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
      expect(hits.length, `${name} is not defined twice in App.css`).toBeGreaterThan(occurrence);
      return hits[occurrence][1];
    }

    const readyRule = rulesFor(APP_CSS, ["run-button--ready"])
      .find((body) => body.includes("background-image")) as string;
    const stops = [...readyRule.matchAll(/var\(--success\) (\d+)%, var\(--panel-2\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(stops.length, "the ready fill has no success stops to measure").toBeGreaterThan(1);
    const sheenPeak = Number(
      /var\(--pdf4-sheen-ink\) (\d+)%, var\(--panel-2\)\) 48%/.exec(PDF4_CSS)?.[1],
    );

    for (const [theme, index] of [["dark", 0], ["light", 1]] as const) {
      const panel = token("--panel-2", index);
      const peak = blend(token("--success", index), panel, Math.max(...stops));
      expect(greenLead(peak), `${theme} peak is not green`).toBeGreaterThan(9);
      for (const stop of stops) {
        expect(greenLead(blend(token("--success", index), panel, stop)), `${theme} ${stop}% stop`)
          .toBeGreaterThan(0);
      }
      // The state we replaced, measured on the same axis.
      const accent = blend(token("--accent", index), panel, sheenPeak);
      expect(greenLead(accent), `${theme} accent sheen was already green`).toBeLessThan(2);
    }
  });

  it("gives the idle Run control a phase, and stops it under reduced motion", () => {
    const classes = idleRunClasses();
    const css = APP_CSS + PDF4_CSS;
    const animated = rulesFor(css, classes).filter((body) => /animation:\s*(?!none)/.test(body));
    expect(animated.length, "no rule animates the idle Run control").toBeGreaterThan(0);

    // The reduce block must reach the very class that carries the green phase,
    // not merely some other class the button happens to also have.
    const greenClass = classes.find((cls) =>
      rulesFor(APP_CSS, [cls]).some((body) => body.includes("var(--success)")),
    );
    expect(greenClass, "no App.css class on idle Run carries the success ink").toBeTruthy();
    const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(
      rulesFor(css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g)?.join("\n") ?? reduce, [
        greenClass as string,
      ]).some((body) => /animation:\s*none/.test(body)),
      `no reduced-motion rule stops .${greenClass}`,
    ).toBe(true);
  });

  /**
   * VERIFY/CHROME-1: the green is a LAMP, so it may not go out for a reason
   * that has nothing to do with run readiness.
   *
   * `shouldInviteAction` also clears when the assistant panel is open - correct
   * for PDF4's shared *invitation*, whose whole point was not to compete with
   * Bode for attention, but wrong once that same class carries "armed, nothing
   * wrong". Opening Bode changes nothing about whether the circuit can run, so
   * the lamp stays lit; only the shimmering fill stands down.
   */
  it("keeps the lamp armed while Bode is open, and stands only the fill down", () => {
    render(<Toolbar {...baseProps} schematicOpen projectOpen assistantOpen />);
    const run = screen.getByRole("button", { name: "Run simulation" });

    // The class that greens the lamp dot is still there...
    const lampClass = [...run.classList].find((cls) =>
      rulesFor(APP_CSS, [cls]).some((body) => body.includes("var(--success)")),
    );
    expect(lampClass, "Bode being open extinguished the Run lamp").toBeTruthy();
    // ...and it is the one App.css uses to ink the dot, read back from the rule.
    expect(APP_CSS).toContain(`.${lampClass} .run-lamp-dot`);

    // ...while the shared sheen, which is what competes for attention, is not.
    expect(run.classList.contains("pdf4-action-sheen")).toBe(false);

    // Sanity: with Bode closed the control wears both.
    cleanup();
    render(<Toolbar {...baseProps} schematicOpen projectOpen />);
    const armed = screen.getByRole("button", { name: "Run simulation" });
    expect(armed.classList.contains(lampClass as string)).toBe(true);
    expect(armed.classList.contains("pdf4-action-sheen")).toBe(true);
  });

  it("drops the green invitation the moment the control has real state", () => {
    const idle = idleRunClasses();
    const green = idle.find((cls) =>
      rulesFor(APP_CSS, [cls]).some((body) => body.includes("var(--success)")),
    ) as string;

    for (const props of [
      { isRunning: true },
      { mode: "simulator" as const, runState: "error" as const, outcome: { ok: false as const, message: "x" } },
      { liveRunning: true },
    ]) {
      render(<Toolbar {...baseProps} {...props} />);
      expect(
        screen.getByRole("button", { name: "Run simulation" }).classList.contains(green),
        `${JSON.stringify(props)} still wears the idle green`,
      ).toBe(false);
      cleanup();
    }
  });
});
