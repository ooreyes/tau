/**
 * The layout rule, tested as a pure function instead of through a full app
 * render driving a fake ResizeObserver.
 *
 * The first two cases are carried over verbatim from
 * `components/WorkspaceRightDock.test.tsx`, numbers and all, because this
 * module replaces that one and the numbers are the evidence that the
 * extraction changed nothing. The rest cover what the old shape could not
 * express: that yielding is temporary and never edits what the user asked for.
 */
import { describe, expect, it } from "vitest";
import {
  SHELL_LAYOUT,
  canFitIndependentColumns,
  explorerMax,
  resolveAnalysisPane,
  resolveChrome,
  rightColumnMax,
  workspaceWidth,
  type ChromeInput,
} from "./resolveChrome";
import { ANALYSIS_PANE_WIDTH, SURFACES } from "./surfaces";
import { loadPanelWidth, savePanelWidth } from "@/components/ui/resizable";

const COMPONENTS = SURFACES.components.width;
const ASSISTANT = SURFACES.assistant.width;

function input(over: Partial<ChromeInput> = {}): ChromeInput {
  return {
    mode: "schematic",
    shellWidth: 1440,
    intent: { explorer: true, components: true, assistant: true },
    widths: {
      explorer: SURFACES.explorer.width.defaultWidth,
      components: COMPONENTS.defaultWidth,
      assistant: ASSISTANT.defaultWidth,
    },
    ...over,
  };
}

describe("independent workspace columns (carried over from WorkspaceRightDock)", () => {
  it("admits both independent columns only when all schematic floors fit", () => {
    expect(canFitIndependentColumns(993, [COMPONENTS.minWidth, ASSISTANT.minWidth])).toBe(false);
    expect(canFitIndependentColumns(994, [COMPONENTS.minWidth, ASSISTANT.minWidth])).toBe(true);

    const assistantWidth = rightColumnMax(1000, "schematic", ASSISTANT, [COMPONENTS.minWidth]);
    const componentsWidth = rightColumnMax(1000, "schematic", COMPONENTS, [assistantWidth]);
    const explorerWidth = explorerMax(1000, [componentsWidth, assistantWidth]);

    expect(assistantWidth).toBe(286);
    expect(componentsWidth).toBe(208);
    expect(explorerWidth).toBe(SHELL_LAYOUT.explorerMin);
  });

  it("keeps the 900px budget exact by showing one independent right column", () => {
    const shellWidth = 900;
    const assistantWidth = Math.min(
      ASSISTANT.defaultWidth,
      rightColumnMax(shellWidth, "schematic", ASSISTANT),
    );
    const explorerWidth = explorerMax(shellWidth, [assistantWidth]);

    expect(assistantWidth).toBe(340);
    expect(explorerWidth).toBe(230);
    expect(
      SHELL_LAYOUT.railWidth +
        SHELL_LAYOUT.handleWidth * 2 +
        SHELL_LAYOUT.schematicEditorMin +
        explorerWidth! +
        assistantWidth,
    ).toBe(shellWidth);
  });
});

describe("resolveChrome", () => {
  it("shows all three columns when there is room", () => {
    const chrome = resolveChrome(input({ shellWidth: 1440 }));
    expect(chrome.explorer.visible).toBe(true);
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
  });

  it("yields the passive Explorer at the floor, keeping the creation tools", () => {
    const chrome = resolveChrome(input({ shellWidth: 900 }));
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
    expect(chrome.explorer.visible).toBe(false);
    // The reason is the point. A hidden column that cannot say why is a rail
    // button that silently does nothing.
    expect(chrome.explorer.reason).toBe("yielded-space");
  });

  /**
   * The behaviour the old shape could not have: the floor overrides the user's
   * request for as long as it applies, and stops overriding it the moment it
   * does not. App.tsx used to call `setPartsOpen(false)` at the floor, which
   * destroyed the preference instead of suspending it.
   */
  it("restores a yielded column when the window widens, without being re-asked", () => {
    const narrow = resolveChrome(input({ shellWidth: 900 }));
    expect(narrow.explorer.visible).toBe(false);

    const wide = resolveChrome(input({ shellWidth: 1440 }));
    expect(wide.explorer.visible).toBe(true);
    expect(wide.explorer.reason).toBe("intent");
  });

  it("never reports a column that the current mode does not have", () => {
    const chrome = resolveChrome(input({ mode: "simulator" }));
    expect(chrome.explorer.visible).toBe(false);
    expect(chrome.explorer.reason).toBe("wrong-mode");
    expect(chrome.components.visible).toBe(false);
    expect(chrome.components.reason).toBe("wrong-mode");
    // The assistant is the one column that survives the mode switch.
    expect(chrome.assistant.visible).toBe(true);
  });

  it("distinguishes a column the user closed from one that yielded", () => {
    const chrome = resolveChrome(
      input({ intent: { explorer: true, components: false, assistant: true } }),
    );
    expect(chrome.components.visible).toBe(false);
    expect(chrome.components.reason).toBe("closed");
  });

  it("clamps a persisted width that no longer fits, without losing it", () => {
    const chrome = resolveChrome(
      input({ shellWidth: 900, widths: { explorer: 400, components: 480, assistant: 520 } }),
    );
    expect(chrome.assistant.width).toBeLessThanOrEqual(chrome.assistant.maxWidth!);
    expect(chrome.assistant.width).toBeGreaterThanOrEqual(ASSISTANT.minWidth);
    // Clamping is a view concern: the input width is untouched, so widening
    // the window gives the user their own size back.
  });

  it("treats the pre-measurement frame as fitting so nothing flashes closed", () => {
    const chrome = resolveChrome(input({ shellWidth: 0 }));
    expect(chrome.explorer.visible).toBe(true);
    expect(chrome.components.visible).toBe(true);
    expect(chrome.assistant.visible).toBe(true);
  });
});

/**
 * The circuit | analysis split, decided before any of it is wired up.
 *
 * These cases are the contract the layout change consumes: they exist so the
 * split threshold and the divider clamp are settled arithmetic with a stated
 * reason, rather than numbers invented inline in a component where nothing
 * can check them.
 */
describe("analysis pane split", () => {
  it("splits exactly at the workspace width the stylesheet already calls cramped", () => {
    // 620 is `@container workspace (max-width: 620px)` in App.css, and a
    // container query's max-width is inclusive - at exactly 620 the CSS has
    // already dropped the run-facts strip. Splitting AT 620 is therefore the
    // boundary worth pinning: one pixel of disagreement here is a layout that
    // is two columns while the stylesheet thinks it is a cramped one.
    expect(resolveAnalysisPane({ workspace: 620, persisted: 480 }).layout).toBe("split");
    expect(resolveAnalysisPane({ workspace: 619, persisted: 480 }).layout).toBe("stacked");
    expect(SHELL_LAYOUT.splitMinWorkspace).toBe(620);
  });

  it("never lets the analysis pane push the circuit below its floor", () => {
    // The floor is this constant's job alone: `.workspace-column > .sim-schematic-pane
    // { min-width: 0 }` (App.css:7282-7285, specificity 0-2-0) overrides the
    // pane's own `min-width: 280px` (App.css:7519, 0-1-0), so the CSS will not
    // stop a drag. At the threshold the budget is exact - the split's narrowest
    // legal form is circuit floor + handle + plotter floor.
    const atThreshold = resolveAnalysisPane({ workspace: 620, persisted: 9999 });
    expect(atThreshold.maxWidth).toBe(332);
    expect(atThreshold.maxWidth + SHELL_LAYOUT.handleWidth + SHELL_LAYOUT.simulatorSchematicMin).toBe(
      620,
    );
    expect(atThreshold.minWidth).toBe(SHELL_LAYOUT.plotterMin);
  });

  it("measures the workspace as the shell minus the rail and the open side columns", () => {
    // The simulator's only side column is the Assistant, and at Tau's minimum
    // 900x600 window (tauri.conf.json) an open Assistant leaves too little to
    // split - the stacked drawer is what that window gets, which is the whole
    // reason the fallback is kept rather than dropped.
    expect(workspaceWidth(1440, [ASSISTANT.defaultWidth])).toBe(1038);
    expect(resolveAnalysisPane({ workspace: 1038, persisted: 480 }).layout).toBe("split");

    expect(workspaceWidth(900, [ASSISTANT.defaultWidth])).toBe(498);
    expect(resolveAnalysisPane({ workspace: 498, persisted: 480 }).layout).toBe("stacked");

    // Close the Assistant and the same 900px window splits again, because
    // nothing here edits intent - only the width changed.
    expect(workspaceWidth(900, [])).toBe(846);
    expect(resolveAnalysisPane({ workspace: 846, persisted: 480 }).layout).toBe("split");
  });

  it("stacks on the pre-measurement frame instead of guessing at a divider", () => {
    // Deliberately the opposite reading of a zero width from
    // `canFitIndependentColumns`, which calls it "fitting" so panels do not
    // flash closed. Asserted side by side because the divergence is the kind
    // of thing a later reader would otherwise assume was an oversight: an
    // optimistic guess there costs a flash, an optimistic guess here mounts a
    // divider whose clamp was computed from a width of zero.
    expect(canFitIndependentColumns(0, [COMPONENTS.minWidth, ASSISTANT.minWidth])).toBe(true);

    const workspace = workspaceWidth(0, [ASSISTANT.defaultWidth]);
    expect(workspace).toBe(0);
    expect(resolveAnalysisPane({ workspace, persisted: 480 }).layout).toBe("stacked");
  });

  it("clamps a persisted width for use without spending the user's stored choice", () => {
    // The bug this forbids: clamping on resize and persisting the clamp, so a
    // moment at a narrow window permanently shrinks the pane. Proven against
    // the real storage authority rather than by inspection - `usePanelWidth`
    // is what the divider will use, and `loadPanelWidth` reads the same key.
    const store = new Map<string, string>();
    const writes: string[] = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          writes.push(key);
          store.set(key, value);
        },
      },
    });
    try {
      savePanelWidth(ANALYSIS_PANE_WIDTH.storageKey, 540);
      writes.length = 0;

      const persisted = loadPanelWidth(ANALYSIS_PANE_WIDTH);
      expect(persisted).toBe(540);

      // 700 of workspace only affords 700 - 8 - 280 = 412.
      const narrow = resolveAnalysisPane({ workspace: 700, persisted });
      expect(narrow.width).toBe(412);
      expect(writes).toEqual([]);
      expect(loadPanelWidth(ANALYSIS_PANE_WIDTH)).toBe(540);

      // Widen the window and the user's own width comes back untouched.
      expect(resolveAnalysisPane({ workspace: 1100, persisted }).width).toBe(540);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
