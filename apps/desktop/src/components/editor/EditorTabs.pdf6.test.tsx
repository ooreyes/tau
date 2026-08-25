// @vitest-environment jsdom
/**
 * TABS lane - PDF6-05, "redesign the tab selectors".
 *
 * The report was specific: "There shouldnt be that blue dot only a dot to show
 * when they haven't been saved." Two of the three marks each tab carried are
 * therefore gone - the coloured chip entirely, and the second dot that used to
 * sit beside the close button - and what is left has to be pinned, because
 * every one of these is the kind of thing a later pass restores by accident:
 *
 *   - no tab renders the chip at all (case 1 fails on the pre-PDF6 markup),
 *   - a saved tab carries no mark whatsoever,
 *   - an unsaved tab carries exactly ONE, and no x beside it at rest,
 *   - the close button is still in the accessibility tree under the same name
 *     that App.workspace.test.tsx and the close-confirmation flow query it by.
 *
 * The at-rest/revealed states are read out of the real cascade rather than
 * asserted against the source text: App.css and this lane's stylesheet are both
 * loaded into jsdom, so `getComputedStyle` sees the same declarations the
 * desktop renderer does. jsdom has no pointer or focus-ring state, so the two
 * reveal transitions are checked structurally through the CSSOM instead - which
 * is still the parsed stylesheet, not a regex over a file.
 *
 * This file is deliberately separate from EditorChrome.test.tsx: that one is the
 * TOOLBAR lane's and covers EditorToolbar only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { EditorTabs } from "./EditorChrome";

const LANE_CSS = readFileSync(join(__dirname, "../../styles/pdf6Tabs.css"), "utf8");
// Vitest's CSS transform does not attach imported stylesheets to jsdom, and the
// override only means anything in the presence of what it overrides, so the
// production pair is loaded in production order.
const PRODUCTION_CSS = [readFileSync(join(__dirname, "../../App.css"), "utf8"), LANE_CSS].join("\n");

let productionStyle: HTMLStyleElement | null = null;

function loadProductionCss() {
  productionStyle = document.createElement("style");
  productionStyle.textContent = PRODUCTION_CSS;
  document.head.append(productionStyle);
}

const TABS = [
  { id: "t1", title: "USB PORT.asc" },
  { id: "t2", title: "USB-C Cable.asc", dirty: true },
  { id: "t3", title: "untitled.asc" },
];

function renderTabs(overrides: Partial<ComponentProps<typeof EditorTabs>> = {}) {
  const props: ComponentProps<typeof EditorTabs> = {
    tabs: TABS,
    activeId: "t2",
    mode: "schematic",
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onRenameTab: vi.fn(),
    onNewCircuit: vi.fn(),
    onHideSimulator: vi.fn(),
    ...overrides,
  };
  return { ...render(<EditorTabs {...props} />), props };
}

/** Every style rule in the lane sheet, flattened out of any @media wrapper. */
function laneStyleRules(): CSSStyleRule[] {
  const el = document.createElement("style");
  el.textContent = LANE_CSS;
  document.head.append(el);
  const out: CSSStyleRule[] = [];
  const walk = (rules: CSSRuleList | undefined) => {
    for (const rule of Array.from(rules ?? [])) {
      if ("selectorText" in rule) out.push(rule as CSSStyleRule);
      else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  walk(el.sheet?.cssRules);
  el.remove();
  return out;
}

/** Selectors in the lane sheet that give `target` this exact opacity. */
function selectorsSettingOpacity(target: string, opacity: string): string[] {
  return laneStyleRules()
    .filter((rule) => rule.style.getPropertyValue("opacity").trim() === opacity)
    .flatMap((rule) => rule.selectorText.split(",").map((s) => s.trim()))
    .filter((selector) => selector.includes(target));
}

afterEach(() => {
  cleanup();
  productionStyle?.remove();
  productionStyle = null;
  vi.restoreAllMocks();
});

describe("EditorTabs - the blue chip is gone (PDF6-05)", () => {
  it("renders no coloured chip on any tab", () => {
    const { container } = renderTabs();
    // `.editor-tab` is also the `+` button's class, so the sheets are counted
    // by role - and there are three of them, one per open sheet.
    expect(container.querySelectorAll('[role="tab"]').length).toBe(3);

    // The chip was an <i> whose only job was a colour: `blue` for every
    // inactive tab, `amber` for the active one. Both the element and the two
    // class names have to be absent - hiding it in CSS would leave the next
    // reader believing the strip still encodes something here.
    expect(container.querySelectorAll(".editor-tab i")).toHaveLength(0);
    expect(container.querySelectorAll(".editor-tab .blue, .editor-tab .amber")).toHaveLength(0);
    expect(container.querySelectorAll(".editor-tabs i")).toHaveLength(0);
  });

  it("shows no dot at all on a saved tab", () => {
    const { container } = renderTabs({ tabs: [{ id: "t1", title: "USB PORT.asc" }], activeId: "t1" });
    expect(container.querySelectorAll(".tab-dirty-indicator")).toHaveLength(0);
    expect(screen.queryByRole("img", { name: /has unsaved changes/ })).toBeNull();
  });

  it("shows exactly one mark on an unsaved tab, and it is the unsaved dot", () => {
    const { container } = renderTabs();
    const dots = container.querySelectorAll(".tab-dirty-indicator");
    expect(dots).toHaveLength(1);
    // Named, not just present: colour and shape alone are not a signal, and this
    // label is what App.workspace.test.tsx asserts the save flow clears.
    expect(screen.getByRole("img", { name: "USB-C Cable.asc has unsaved changes" })).toBe(dots[0]);

    // ...and it belongs to the unsaved tab, not to the strip in general.
    const dirtyTab = container.querySelectorAll('[role="tab"]')[1];
    expect(dirtyTab.contains(dots[0])).toBe(true);
  });
});

describe("EditorTabs - one slot, dot at rest, x on hover or focus", () => {
  beforeEach(loadProductionCss);

  it("keeps the x invisible while the dot is showing, in the real cascade", () => {
    const { container } = renderTabs();
    const dirtyTab = container.querySelectorAll('[role="tab"]')[1];
    const dot = dirtyTab.querySelector(".tab-dirty-indicator")!;
    const close = dirtyTab.querySelector(".tab-close")!;

    expect(getComputedStyle(dot).opacity).toBe("1");
    expect(getComputedStyle(close).opacity).toBe("0");
  });

  it("stacks both marks in one slot, so the tab does not resize when they swap", () => {
    const { container } = renderTabs();
    const slot = container.querySelectorAll('[role="tab"]')[1].querySelector(".tab-slot")!;
    expect(slot.querySelector(".tab-close")).not.toBeNull();
    expect(slot.querySelector(".tab-dirty-indicator")).not.toBeNull();
    expect(getComputedStyle(slot).display).toBe("grid");
    // Same grid cell: that is what makes "never both at once" a swap rather
    // than a reflow.
    const stacked = laneStyleRules().find((rule) => rule.selectorText === ".editor-tab .tab-slot > *");
    expect(stacked?.style.getPropertyValue("grid-area").trim()).toBe("1 / 1");
    expect(Array.from(slot.children)).toHaveLength(2);
  });

  it("reveals the x for the pointer AND the keyboard, and hides the dot for both", () => {
    // jsdom has no hover state and no focus-ring heuristic, so these two
    // transitions are read off the parsed stylesheet.
    const revealed = selectorsSettingOpacity(".tab-close", "1");
    expect(revealed.some((s) => s.includes(":hover"))).toBe(true);
    expect(revealed.some((s) => s.includes(":focus-visible"))).toBe(true);

    const hidden = selectorsSettingOpacity(".tab-dirty-indicator", "0");
    expect(hidden.some((s) => s.includes(":hover"))).toBe(true);
    expect(hidden.some((s) => s.includes(":focus-visible"))).toBe(true);

    // The keyboard path has to work from the tab itself, not only from the
    // button: the tab is the tabstop the strip is navigated by.
    expect(revealed).toContain(".editor-tab:focus-visible .tab-close");
  });

  it("never hides the close button from the accessibility tree to do it", () => {
    renderTabs();
    for (const tab of TABS) {
      const close = screen.getByRole("button", { name: `Close ${tab.title}` });
      // display/visibility are the two that would drop it out of the tree (and
      // out of getByRole, which is how the close flow is driven everywhere).
      expect(getComputedStyle(close).display).not.toBe("none");
      expect(getComputedStyle(close).visibility).not.toBe("hidden");
    }
  });
});

describe("EditorTabs - preserved behaviour", () => {
  it("keeps `Close <title>` as the close button's name and still closes", () => {
    const { props } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Close USB-C Cable.asc" }));
    expect(props.onCloseTab).toHaveBeenCalledWith("t2");

    // The click must not also select the tab it closed.
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it("marks the selected tab programmatically and in its class list", () => {
    const { container } = renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect([...container.querySelectorAll(".editor-tab.active")]).toEqual([tabs[1]]);
    expect(container.querySelector(".editor-tabs")?.getAttribute("role")).toBe("tablist");
  });

  it("still selects a tab by click and by keyboard", () => {
    const { props } = renderTabs();
    const first = screen.getAllByRole("tab")[0];
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "Enter" });
    fireEvent.keyDown(first, { key: " " });
    expect(props.onSelectTab).toHaveBeenCalledTimes(3);
    expect(props.onSelectTab).toHaveBeenLastCalledWith("t1");
  });

  it("commits a rename on double-click and cancels it on Escape", () => {
    const { props } = renderTabs();
    const tab = screen.getAllByRole("tab")[1];

    fireEvent.doubleClick(tab);
    const input = screen.getByRole("textbox", { name: "Rename USB-C Cable.asc" });
    fireEvent.change(input, { target: { value: "buck.asc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameTab).toHaveBeenCalledWith("t2", "buck.asc");
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.doubleClick(tab);
    const second = screen.getByRole("textbox", { name: "Rename USB-C Cable.asc" });
    fireEvent.change(second, { target: { value: "discarded.asc" } });
    fireEvent.keyDown(second, { key: "Escape" });
    expect(props.onRenameTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    // The label comes back, with .sim stripping still in force below.
    expect(screen.getAllByRole("tab")[1].textContent).toContain("USB-C Cable.asc");
  });

  it("still strips the .sim extension from the label only", () => {
    renderTabs({ tabs: [{ id: "t1", title: "buck.sim", dirty: true }], activeId: "t1" });
    expect(screen.getByText("buck")).toBeTruthy();
    // The file's real name is what the close button and the dot still say.
    expect(screen.getByRole("button", { name: "Close buck.sim" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "buck.sim has unsaved changes" })).toBeTruthy();
  });

  it("keeps the new-tab button and the simulator's way back to the schematic", () => {
    const { props, unmount } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(props.onNewCircuit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Return to schematic editor" })).toBeNull();
    unmount();

    const simulator = renderTabs({ mode: "simulator" });
    fireEvent.click(screen.getByRole("button", { name: "Return to schematic editor" }));
    expect(simulator.props.onHideSimulator).toHaveBeenCalledOnce();
  });
});

describe("EditorTabs - project sheet roles", () => {
  it("labels root and child sheets in the tab and accessible description", () => {
    renderTabs({
      tabs: [
        { id: "root", title: "USB_PSU.sim", sheetRole: "root" },
        { id: "child", title: "Buck5V.sim", sheetRole: "child" },
      ],
      activeId: "child",
    });
    const [root, child] = screen.getAllByRole("tab");
    expect(root.getAttribute("data-sheet-role")).toBe("root");
    expect(child.getAttribute("data-sheet-role")).toBe("child");
    expect(root.getAttribute("aria-label")).toBeNull();
    expect(child.getAttribute("aria-label")).toBeNull();
    expect(root.getAttribute("aria-describedby")).toBe("root-sheet-role");
    expect(child.getAttribute("aria-describedby")).toBe("child-sheet-role");
    expect(document.querySelector("#root-sheet-role")?.textContent).toBe("Root sheet");
    expect(document.querySelector("#child-sheet-role")?.textContent).toBe("Child sheet");
    expect(root.querySelector(".tab-sheet-role")?.textContent).toBe("Root");
    expect(child.querySelector(".tab-sheet-role")?.textContent).toBe("Child");
    expect(child.getAttribute("aria-selected")).toBe("true");

    const roleDescriptionRule = laneStyleRules().find(
      (rule) => rule.selectorText === ".editor-tabs > .tab-sheet-role-a11y",
    );
    expect(roleDescriptionRule?.style.position).toBe("absolute");
    expect(roleDescriptionRule?.style.clip).toBe("rect(0px, 0px, 0px, 0px)");
  });
});

describe("EditorTabs - the redesigned selection reads without a chip", () => {
  beforeEach(loadProductionCss);

  it("gives the active tab the sheet surface, --text ink, and one accent hairline", () => {
    const { container } = renderTabs();
    const [inactive, active] = [...container.querySelectorAll('[role="tab"]')];
    const activeStyle = getComputedStyle(active);

    expect(activeStyle.color).toBe("var(--text)");
    expect(activeStyle.background).toBe("var(--canvas-surface)");
    // One hairline, and it is the only accent on the tab.
    expect(activeStyle.boxShadow).toBe("inset 0 2px 0 var(--accent)");
    expect(getComputedStyle(inactive).boxShadow).toBe("");

    // Weight is deliberately NOT a selection signal: it would re-flow every
    // tab to the right of the one you selected.
    expect(activeStyle.fontWeight).toBe(getComputedStyle(inactive).fontWeight);
  });

  it("drops the per-tab vertical rule and lets the label ellipsise instead", () => {
    const { container } = renderTabs();
    const tab = container.querySelector(".editor-tab")!;
    expect(getComputedStyle(tab).borderRightWidth).toBe("0px");

    const title = tab.querySelector(".tab-title")!;
    const titleStyle = getComputedStyle(title);
    expect(titleStyle.textOverflow).toBe("ellipsis");
    expect(titleStyle.overflow).toBe("hidden");
    expect(titleStyle.whiteSpace).toBe("nowrap");
    // Truncation is only honest if the full name is still recoverable.
    expect(tab.getAttribute("title")).toBe("USB PORT.asc");
  });

  it("spends no raw colour of its own", () => {
    // DESIGN_SYSTEM 7.1: every colour routes through a token. Cheap to check
    // here, and this stylesheet is new enough to still be easy to keep clean.
    const withoutComments = LANE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});
