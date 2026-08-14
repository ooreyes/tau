// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { StatusBar } from "./StatusBar";
import { useSchematic } from "../store/useSchematic";

const CSS = readFileSync(join(__dirname, "..", "App.css"), "utf8");

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from App.css`).toBeGreaterThan(-1);
  const bodyStart = CSS.indexOf("{", start) + 1;
  const end = CSS.indexOf("}\n", bodyStart);
  return CSS.slice(bodyStart, end);
}

describe("StatusBar simulator guidance", () => {
  beforeEach(() => {
    useSchematic.setState({
      components: [],
      wires: [],
      tool: { mode: "select" },
    });
  });

  afterEach(() => cleanup());

  it("uses concise inspection guidance without repeating the view-only label", () => {
    render(<StatusBar mode="simulator" result={null} />);

    expect(screen.getByText("Inspect - select a component to focus telemetry")).toBeTruthy();
    expect(screen.queryByText(/topology locked/i)).toBeNull();
    expect(screen.queryByText(/engine:/i)).toBeNull();
    expect(screen.queryByText(/grid 0\.1 in/i)).toBeNull();
  });

  /**
   * Review item 5 asked for the lower-left gear "and the text underneath it"
   * to go. Only the gear went. `Ready` never changed while editing, the file
   * name is already in the title bar and on the tab, and `Select` is the
   * resting tool - so at rest the strip is now absent entirely.
   */
  it("shows nothing at all in a resting schematic editor", () => {
    const { container } = render(<StatusBar mode="schematic" result={null} />);
    expect(container.querySelector(".statusbar")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Select")).toBeNull();
  });

  it("appears only while a tool is mid-gesture, and says just that", () => {
    useSchematic.setState({ tool: { mode: "wire" } as never });
    const { container } = render(<StatusBar mode="schematic" result={null} />);
    expect(container.querySelector(".statusbar")).toBeTruthy();
    expect(screen.getByText("Wiring")).toBeTruthy();
    // Still no duplicated document identity.
    expect(screen.queryByText(/\.asc/)).toBeNull();
  });

  /**
   * CHROME-2: Settings now lives at the foot of the activity rail, so the strip
   * must not keep a second copy - and it must not be left rendering an empty
   * utility cluster either. With no context of its own it goes back to
   * rendering nothing at all.
   */
  it("no longer carries a Settings utility, and stays absent when it has nothing else to say", () => {
    const { container } = render(<StatusBar mode="schematic" result={null} />);

    expect(container.querySelector(".statusbar")).toBeNull();
    expect(container.querySelector(".statusbar-utility")).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    // The prop is gone, not merely unused: a shell that still passes it would
    // otherwise silently resurrect the lower-right gear.
    const source = readFileSync(join(__dirname, "StatusBar.tsx"), "utf8");
    expect(source).not.toMatch(/onOpenSettings/);
    expect(source).not.toMatch(/statusbar-utility/);
  });

  it("renders no empty utility cluster in the one mode that always shows the strip", () => {
    const { container } = render(<StatusBar mode="simulator" result={null} />);

    expect(container.querySelector(".statusbar")).toBeTruthy();
    expect(container.querySelector(".statusbar-utility")).toBeNull();
    expect(container.querySelector(".statusbar")?.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("running status motion contract", () => {
  it("uses a stable semantic lamp rather than a decorative infinite pulse", () => {
    expect(ruleBody(".status-lamp--running .status-lamp-dot")).toContain("background: var(--signal)");
    expect(ruleBody(".status-lamp--running .status-lamp-dot")).not.toMatch(/animation\s*:/);
    expect(ruleBody(".run-lamp-dot--running")).toContain("background: var(--signal)");
    expect(ruleBody(".run-lamp-dot--running")).not.toMatch(/animation\s*:/);
    expect(CSS).not.toContain("status-lamp-pulse");
  });
});
