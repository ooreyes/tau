// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(() => {
  cleanup();
});

describe("EmptyState first-success learning path", () => {
  it("offers Try RC Charging when the learning path is open", () => {
    const onTryFirstSuccess = vi.fn();
    render(
      <EmptyState
        projectOpen
        onNewCircuit={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={onTryFirstSuccess}
      />,
    );
    const cta = screen.getByRole("button", { name: /Try RC Charging/i });
    // `Waypoints`, not `CircuitBoard`. PDF-6 item 6 retired that glyph as the
    // app's mark for "a schematic" on two grounds that apply here too: it draws
    // a populated board, which is the wrong artefact for a thing Tau draws, and
    // at button size its enclosing rectangle eats the cell while the interior
    // detail lands sub-pixel, so it reads as a filled square. This button opens
    // a schematic, so it takes the mark the rest of the app now uses for one.
    expect(cta.querySelector(".lucide-waypoints")).toBeTruthy();
    expect(cta.querySelector(".lucide-circuit-board")).toBeNull();
    expect(cta.querySelector(".lucide-sparkles")).toBeNull();
    fireEvent.click(cta);
    expect(onTryFirstSuccess).toHaveBeenCalledOnce();
  });

  /**
   * Regression guard for the P3-04B variant split.
   *
   * App.tsx passes `offerFirstSuccess` to BOTH `<EmptyState>` call sites, and
   * the second one - the card that renders inside an open, empty schematic -
   * used to fall through to the "project open" branch and therefore showed
   * this CTA. Adding a third variant for `schematicOpen` moved that call site
   * onto copy that had no learning-path action, which silently removed the
   * first-success onboarding path from the one screen a first-time user
   * actually reaches. The two cases above cannot see it: neither passes
   * `schematicOpen`, so both keep exercising the old branch.
   */
  it("still offers Try RC Charging inside an open, empty schematic", () => {
    const onTryFirstSuccess = vi.fn();
    render(
      <EmptyState
        projectOpen
        schematicOpen
        onShowParts={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={onTryFirstSuccess}
      />,
    );
    // The headline is still the place-a-part copy: the learning path is an
    // alternative route to a first result, not a replacement for the fix.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Place your first component");
    const cta = screen.getByRole("button", { name: /Try RC Charging/i });
    fireEvent.click(cta);
    expect(onTryFirstSuccess).toHaveBeenCalledOnce();
    // DESIGN_SYSTEM 4: exactly one filled control. "Browse components" is it,
    // because it is the action the headline names. `border` is not the tell -
    // the default variant carries `border-transparent` too - so this asks for
    // the filled recipe by name.
    const filled = [...document.querySelectorAll<HTMLButtonElement>(".empty-state-actions button")]
      .filter((b) => b.className.includes("bg-primary"));
    expect(filled.map((b) => b.textContent?.trim())).toEqual(["Browse components"]);
  });

  /**
   * The same DESIGN_SYSTEM 4 rule the open-sheet case above pins, on the card
   * before it. These two used to disagree: this one made "Try RC Charging" the
   * filled control and demoted "New schematic" to outline, while the open-sheet
   * card kept its own action filled and the example outline. A reader crossing
   * from one to the next therefore had to relearn which button the card was
   * actually about. The rule is the same on both now - the filled control is
   * the action the headline names - and the order follows it.
   */
  it("keeps New schematic the one filled control while the learning path is on offer", () => {
    render(
      <EmptyState
        projectOpen
        onNewCircuit={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={vi.fn()}
      />,
    );
    const actions = [...document.querySelectorAll<HTMLButtonElement>(".empty-state-actions button")];
    expect(actions.map((b) => b.textContent?.trim())).toEqual([
      "New schematic",
      "Try RC Charging",
      "Ask Bode",
    ]);
    const filled = actions.filter((b) => b.className.includes("bg-primary"));
    expect(filled.map((b) => b.textContent?.trim())).toEqual(["New schematic"]);
  });

  /**
   * `startFirstSuccessExample` refuses without a project root ("Open or create
   * a project folder before trying the RC example."), so offering the CTA on
   * the no-project card would be a button whose only outcome is a notice
   * explaining why it did nothing.
   */
  it("withholds the CTA when there is no project to create the example in", () => {
    render(
      <EmptyState
        projectOpen={false}
        onOpenFolder={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Try RC Charging/i })).toBeNull();
  });

  it("hides the CTA when the learning path is not offered", () => {
    render(
      <EmptyState
        projectOpen
        onNewCircuit={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Try RC Charging/i })).toBeNull();
  });
});
