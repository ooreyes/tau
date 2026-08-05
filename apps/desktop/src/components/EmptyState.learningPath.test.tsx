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
    fireEvent.click(screen.getByRole("button", { name: /Try RC Charging/i }));
    expect(onTryFirstSuccess).toHaveBeenCalledOnce();
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
