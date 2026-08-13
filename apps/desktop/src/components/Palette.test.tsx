// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Palette } from "./Palette";

afterEach(cleanup);

describe("P4-16 palette component viewer", () => {
  it("updates to the highlighted CT transformer and keeps its full canvas geometry", () => {
    render(<Palette focusSignal={0} onNotice={() => {}} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "CT Transformer" }));

    const preview = screen.getByRole("img", { name: "CT Transformer symbol" });
    expect(preview.getAttribute("data-component-preview")).toBe("ctTransformer");
    // Same ComponentSymbol geometry as the sheet: one primary winding, two
    // secondary halves, a center-tap dot, and all three secondary leads.
    expect(preview.querySelectorAll("path")).toHaveLength(3);
    expect(preview.querySelector('circle[cx="22"][cy="0"]')).toBeTruthy();
    expect(preview.querySelectorAll('line[x1="22"][x2="32"]')).toHaveLength(3);
  });

  it("updates from keyboard focus, not only a mouse hover", () => {
    render(<Palette focusSignal={0} onNotice={() => {}} />);

    fireEvent.focus(screen.getByTitle("Place generic led - press E"));

    expect(screen.getByRole("img", { name: "Generic LED symbol" })
      .getAttribute("data-component-preview")).toBe("led");
  });
});
