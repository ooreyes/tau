// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { StatusBar } from "./StatusBar";
import { useSchematic } from "../store/useSchematic";

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
    render(<StatusBar mode="simulator" result={null} title="filter.asc" />);

    expect(screen.getByText("Inspect - select a component to focus telemetry")).toBeTruthy();
    expect(screen.queryByText(/topology locked/i)).toBeNull();
    expect(screen.queryByText(/engine:/i)).toBeNull();
    expect(screen.queryByText(/grid 0\.1 in/i)).toBeNull();
  });
});
