// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Palette } from "./Palette";
import { allPaletteItems } from "../schematic/paletteItems";

afterEach(cleanup);

describe("P4-16 palette component viewer", () => {
  it("updates to the highlighted CT transformer and keeps its full canvas geometry", () => {
    render(<Palette focusSignal={0} onNotice={() => {}} />);

    // A row's accessible name is its whole content - the name, the hint that
    // tells NO from NC or a teaching model from a real part, and the keycap - so
    // match the part rather than pinning that copy from here.
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^CT Transformer/ }));

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

/**
 * PDF6 item 10 - the hint column, which the review found "needs to be aligned".
 *
 * The alignment itself is grid geometry (`styles/pdf6Palette.css`, asserted in
 * `styles/pdf6Palette.css.test.ts`), and it only holds if the markup keeps
 * feeding that grid: every hint has to be a DIRECT child of its row, carrying
 * exactly the text the catalog gives it. A hint wrapped in a layout div, or one
 * written into the row by hand, leaves the shared column and staggers again -
 * which is the state the review was looking at.
 */
describe("PDF6-10 palette hint column", () => {
  it("renders each row's hint as a grid child of the row, with the table's text", () => {
    render(<Palette focusSignal={0} onNotice={() => {}} />);

    const hintByName = new Map(allPaletteItems().map((item) => [item.name, item.desc ?? ""]));
    let checked = 0;
    for (const row of document.querySelectorAll(".palette-item")) {
      const name = row.querySelector(".palette-name")?.textContent ?? "";
      if (!hintByName.has(name)) continue; // the three tool rows, asserted below
      expect(row.querySelector(".palette-desc")?.textContent ?? "").toBe(hintByName.get(name));
      checked += 1;
    }
    // The rail browses the whole catalog, so this covers every visible row.
    expect(checked).toBe(hintByName.size);

    for (const hint of document.querySelectorAll(".palette-desc")) {
      expect(hint.parentElement?.classList.contains("palette-item")).toBe(true);
    }
  });

  it("puts the tool rows in the same three-part shape as a part row", () => {
    render(<Palette focusSignal={0} onNotice={() => {}} />);

    // Wire / Probe / Net label are hand-written rows rather than catalog entries,
    // so they are the ones most likely to drift out of the column.
    for (const [name, hint] of [["Wire", "route net"], ["Probe", "plot net"], ["Net label", "name net"]]) {
      const row = [...document.querySelectorAll(".palette-item")].find(
        (item) => item.querySelector(".palette-name")?.textContent === name,
      );
      expect(row, `${name} row`).toBeTruthy();
      expect(row?.querySelector(".palette-desc")?.textContent).toBe(hint);
    }
  });
});
