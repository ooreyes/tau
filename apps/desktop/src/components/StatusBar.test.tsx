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
