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
    expect(cta.querySelector(".lucide-circuit-board")).toBeTruthy();
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
