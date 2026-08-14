// @vitest-environment jsdom
/**
 * Cross-lane proof for the Wave 2 shell.
 *
 * The focused component suites prove their own contracts. This file exercises
 * the seams where those contracts meet: one shared accessibility namespace,
 * one responsive width budget, one set of scroll owners, one waveform render
 * budget, and one token bridge. It intentionally uses public components and
 * source audits rather than mounting the full App, whose native/engine mocks
 * would make this evidence about harness wiring instead of UI guarantees.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisModeRail } from "../components/AnalysisModeRail";
import { ActivityRail } from "../components/shell/NavRail";
import { StatusBar } from "../components/StatusBar";
import { Toolbar } from "../components/Toolbar";
import { RunTransport, RUN_TRANSPORT_NAMES } from "../components/RunTransport";
import { liveScopeGeometry } from "../components/LiveScopePane";
import {
  SHELL_LAYOUT,
  explorerMax,
  resolveAnalysisPane,
  resolveChrome,
  rightColumnMax,
  workspaceWidth,
} from "../chrome/resolveChrome";
import { SURFACES } from "../chrome/surfaces";
import { LiveSampleRing, followingWindow } from "../simulation/liveRun";
import { MAX_WAVEFORM_RENDER_POINTS } from "../simulation/waveform";
import {
  countLiteral,
  cssRuleBody,
  declaredCustomProperties,
  readDesktopSource,
  referencedCustomProperties,
} from "./Wave2Regression";

afterEach(() => cleanup());

const toolbarProps = {
  mode: "schematic" as const,
  result: null,
  runState: "idle" as const,
  isRunning: false,
  title: "wave2.sim",
  assistantOpen: false,
  projectOpen: true,
  schematicOpen: true,
  onModeChange: vi.fn(),
  onRun: vi.fn(),
  onToggleAssistant: vi.fn(),
};

function renderSharedChrome() {
  return render(
    <>
      <Toolbar {...toolbarProps} />
      <StatusBar mode="schematic" result={null} />
      <ActivityRail
        mode="schematic"
        onOpenSettings={vi.fn()}
        explorerOpen
        partsOpen={false}
        projectOpen
        schematicOpen
        onFocusExplorer={vi.fn()}
        onModeChange={vi.fn()}
        onSearch={vi.fn()}
        onFocusComponents={vi.fn()}
      />
      <AnalysisModeRail value="tran" onValueChange={vi.fn()} />
      <RunTransport onPlanChange={vi.fn()} onRun={vi.fn()} onStop={vi.fn()} />
    </>,
  );
}

function namedElement(element: Element): string {
  return (
    element.getAttribute("aria-label")
    ?? element.getAttribute("title")
    ?? element.textContent?.replace(/\s+/g, " ").trim()
    ?? ""
  );
}

type NamedRole = "button" | "tab" | "radio" | "navigation" | "tablist" | "group" | "radiogroup";

function namedElements(...roles: NamedRole[]): HTMLElement[] {
  return roles.flatMap((role) => screen.queryAllByRole(role));
}

describe("Wave 2 accessibility and duplicate-control seam", () => {
  it("keeps the shared shell namespace named and collision-free", () => {
    renderSharedChrome();

    const controls = namedElements(
      "button",
      "tab",
      "radio",
      "navigation",
      "tablist",
      "group",
      "radiogroup",
    );
    const names = controls.map(namedElement);
    expect(names.every((name) => name.length > 0)).toBe(true);

    const duplicates = [...new Set(names)].filter(
      (name) => names.filter((candidate) => candidate === name).length > 1,
    );
    expect(duplicates).toEqual([]);

    // These are the cross-lane names most likely to be duplicated when a
    // surface gains a local fallback control. Pin the one-owner vocabulary.
    expect(screen.getAllByRole("button", { name: "Settings" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Open Bode" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Run simulation" })).toHaveLength(1);
    expect(screen.getAllByRole("navigation", { name: "Workspace sections" })).toHaveLength(1);
    expect(screen.getAllByRole("tablist", { name: "Analysis modes" })).toHaveLength(1);
    expect(screen.getAllByRole("group", { name: RUN_TRANSPORT_NAMES.group })).toHaveLength(1);
  });

  it("retains names and state semantics for controls that collapse to icons", () => {
    const app = readDesktopSource("App.tsx");
    const simulatorTools = app.slice(
      app.indexOf('role="toolbar" aria-label="Circuit inspection tools"'),
      app.indexOf("{(opAnalysis?.ok || analysis?.ok) &&", app.indexOf('role="toolbar" aria-label="Circuit inspection tools"')),
    );

    for (const title of [
      "Inspect components without editing",
      "Plot a node\\u2019s voltage over time",
      "Clamp an ammeter on a part or wire to plot its current over time",
      "Add, rename, or remove a node name",
    ]) {
      expect(simulatorTools, `missing responsive tooltip/name: ${title}`).toContain(`title="${title}"`);
    }
    expect(countLiteral(simulatorTools, "aria-pressed=")).toBe(4);
    expect(app).toContain("aria-label={currentVisualizer ? \"Current Mode on\" : \"Current Mode off\"}");

    const rail = readDesktopSource("components/shell/NavRail.tsx");
    expect(countLiteral(rail, "aria-label={label}")).toBe(1);
    expect(rail).toContain('aria-current={active ? "page" : undefined}');
  });
});

describe("Wave 2 responsive overflow seam", () => {
  it("keeps the 900px shell budget exact and stacks analysis before clipping", () => {
    const shellWidth = 900;
    const assistantWidth = Math.min(
      SURFACES.assistant.width.defaultWidth,
      rightColumnMax(shellWidth, "schematic", SURFACES.assistant.width),
    );
    const explorerWidth = explorerMax(shellWidth, [assistantWidth]);
    expect(explorerWidth).toBeDefined();

    expect(assistantWidth).toBe(340);
    expect(explorerWidth).toBe(230);
    expect(
      SHELL_LAYOUT.railWidth
      + SHELL_LAYOUT.handleWidth * 2
      + SHELL_LAYOUT.schematicEditorMin
      + explorerWidth!
      + assistantWidth,
    ).toBe(shellWidth);

    const narrow = resolveChrome({
      mode: "schematic",
      shellWidth,
      intent: { explorer: true, components: true, assistant: true },
      widths: {
        explorer: SURFACES.explorer.width.defaultWidth,
        components: SURFACES.components.width.defaultWidth,
        assistant: SURFACES.assistant.width.defaultWidth,
      },
    });
    expect(narrow.components.visible).toBe(true);
    expect(narrow.assistant.visible).toBe(true);
    expect(narrow.explorer.visible).toBe(false);
    expect(narrow.explorer.reason).toBe("yielded-space");

    const narrowWorkspace = workspaceWidth(shellWidth, [assistantWidth]);
    expect(narrowWorkspace).toBe(498);
    expect(resolveAnalysisPane({ workspace: narrowWorkspace, persisted: 480 }).layout).toBe("stacked");
    expect(resolveAnalysisPane({ workspace: 620, persisted: 480 }).layout).toBe("split");
  });

  it("gives every overflow-prone strip a local scroll owner", () => {
    const css = readDesktopSource("App.css");
    expect(cssRuleBody(css, ".app")).toMatch(/overflow:\s*hidden/);
    expect(cssRuleBody(css, ".shell-body")).toMatch(/overflow:\s*hidden/);

    for (const selector of [".editor-toolbar", ".plotter-tabs"]) {
      const body = cssRuleBody(css, selector);
      expect(body, `${selector} must be shrink-safe`).toMatch(/min-width:\s*0/);
      expect(body, `${selector} must scroll horizontally`).toMatch(/overflow-x:\s*auto/);
      expect(body, `${selector} must not scroll vertically`).toMatch(/overflow-y:\s*hidden/);
    }
    expect(cssRuleBody(css, ".run-transport-band")).toMatch(/overflow-x:\s*auto/);

    expect(cssRuleBody(css, ".sim-schematic-header")).toMatch(/overflow:\s*hidden/);
    expect(cssRuleBody(css, ".components-rail-body")).toMatch(/overflow:\s*auto/);

    const sheet = readDesktopSource("components/ui/sheet.tsx");
    expect(sheet).toContain("max-h-[calc(100vh-60px)]");
    expect(sheet).toContain("max-w-[calc(100vw-24px)]");
    expect(sheet).toContain("overflow-y-auto");
  });
});

describe("Wave 2 render-budget seam", () => {
  it("bounds live waveform path commands by pixels instead of samples", () => {
    const sampleCount = 100_000;
    const width = 940;
    const innerWidth = width - 2 * 46;
    const columns = Math.min(MAX_WAVEFORM_RENDER_POINTS, Math.floor(innerWidth));
    const ring = new LiveSampleRing({ capacity: sampleCount, channelCount: 1 });

    for (let index = 0; index < sampleCount; index += 1) {
      const phase = index / (sampleCount - 1);
      ring.push(phase, [Math.sin(phase * Math.PI * 80) + Math.sin(phase * Math.PI * 3) * 0.1]);
    }

    const geometry = liveScopeGeometry({
      ring,
      channels: [{ index: 0, label: "V(out)", unit: "V" }],
      timeWindow: followingWindow(1),
      width,
      height: 260,
    });
    const trace = geometry.traces[0]!;
    const commands = trace.path.match(/[ML]/g) ?? [];

    // The envelope retains first/min/max/last per pixel column; clipping can
    // add one crossing at either edge. The bound is independent of input N.
    expect(trace.pointCount).toBe(commands.length);
    expect(trace.pointCount).toBeLessThanOrEqual(columns * 4 + 2);
    expect(trace.pointCount).toBeLessThan(sampleCount / 20);

    const livePane = readDesktopSource("components/LiveScopePane.tsx");
    expect(livePane).toContain("const frame = useRingFrames(ring, running)");
    expect(livePane).toContain("requestAnimationFrame");
    expect(livePane).toContain("[ring, channels, timeWindow, plotWidth, height, frame]");
    expect(livePane).toContain("Math.min(MAX_WAVEFORM_RENDER_POINTS, Math.floor(innerWidth))");
  });
});

describe("Wave 2 token-contract seam", () => {
  it("keeps the shared palette, density, motion, and stacking tokens declared", () => {
    const appCss = readDesktopSource("App.css");
    const declared = declaredCustomProperties(appCss);
    const required = [
      "--bg", "--panel", "--panel-2", "--panel-3", "--panel-4",
      "--border", "--border-strong", "--border-subtle", "--text", "--muted", "--faint",
      "--accent", "--accent-ink", "--accent-soft", "--accent-line",
      "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--row-h",
      "--r-2xs", "--r-xs", "--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-pill",
      "--elev-pop", "--elev-float", "--motion-fast", "--motion-med",
      "--font-ui", "--font-mono", "--chrome-veil", "--chrome-blur", "--chrome-blur-saturate",
      "--z-canvas", "--z-chrome", "--z-drawer", "--z-summoned", "--z-inspector", "--z-modal", "--z-toast",
      "--toolbar-height", "--status-bar-height", "--rail-width",
    ];
    for (const token of required) expect(declared, `missing token ${token}`).toContain(token);

    const bridge = readDesktopSource("styles/tokens.css");
    for (const [utility, source] of [
      ["--color-background", "--bg"],
      ["--color-foreground", "--text"],
      ["--color-primary", "--accent"],
      ["--color-primary-foreground", "--accent-ink"],
      ["--color-secondary", "--panel-2"],
      ["--color-accent", "--panel-4"],
      ["--color-border", "--border"],
      ["--color-ring", "--accent"],
      ["--radius-md", "--r-md"],
    ] as const) {
      expect(bridge).toContain(`${utility}: var(${source})`);
    }
    expect(bridge).toContain("--animate-pop-in:");
    expect(bridge).toContain("var(--motion-fast)");
    expect(bridge).toContain("var(--spring)");
  });

  it("keeps migrated primitives on the token bridge instead of raw colors", () => {
    const declared = new Set([
      ...declaredCustomProperties(readDesktopSource("App.css")),
      ...declaredCustomProperties(readDesktopSource("styles/tokens.css")),
    ]);
    const runtimeProvided = new Set([
      "--radix-select-content-available-height",
      "--radix-select-trigger-height",
      "--radix-select-trigger-width",
      "--radix-tooltip-content-transform-origin",
    ]);
    const primitivePaths = [
      "components/ui/button.tsx",
      "components/ui/input.tsx",
      "components/ui/select.tsx",
      "components/ui/dialog.tsx",
      "components/ui/sheet.tsx",
      "components/ui/tabs.tsx",
      "components/ui/tooltip.tsx",
      "components/ui/instrument-icon-button.tsx",
    ];
    for (const path of primitivePaths) {
      const source = readDesktopSource(path);
      expect(source, `${path} has a hex literal`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source, `${path} has a raw rgb literal`).not.toMatch(/\brgba?\s*\(/i);
      const unresolved = referencedCustomProperties(source).filter(
        (token) => !declared.has(token) && !runtimeProvided.has(token),
      );
      expect(unresolved, `${path} references undeclared CSS tokens`).toEqual([]);
    }
  });
});

describe("Wave 2 dead duplicate markup seam", () => {
  it("keeps one owner for top-level shell surfaces and no legacy live hosts", () => {
    const app = readDesktopSource("App.tsx");
    expect(app.match(/<Toolbar[\s/>]/g) ?? []).toHaveLength(1);
    expect(app.match(/<ActivityRail[\s/>]/g) ?? []).toHaveLength(1);
    expect(app.match(/<ResultsDrawer[\s/>]/g) ?? []).toHaveLength(1);
    expect(app.match(/<CommandPalette[\s/>]/g) ?? []).toHaveLength(1);
    expect(app.match(/<SettingsWindow[\s/>]/g) ?? []).toHaveLength(1);
    expect(app.match(/<Toaster[\s/>]/g) ?? []).toHaveLength(1);

    expect(app).not.toContain("className=\"shell-toast\"");
    expect(app).not.toContain("cmdk-backdrop");
    expect(readDesktopSource("components/CommandPalette.tsx")).not.toContain("cmdk-backdrop");
    expect(readDesktopSource("components/CommandPalette.tsx")).toContain("@/components/ui/command");
    expect(readDesktopSource("components/ShellPanels.tsx")).toContain("@/components/ui/resizable");
  });
});
