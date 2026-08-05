// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningPathCoach } from "./LearningPathCoach";

afterEach(() => {
  cleanup();
});

describe("LearningPathCoach", () => {
  it("renders contextual tip copy and dismisses", () => {
    const onDismiss = vi.fn();
    render(
      <LearningPathCoach
        tip={{
          id: "press-run",
          title: "Press Run",
          body: "The RC Charging schematic is ready.",
          shortcuts: ["Run"],
        }}
        status="in_progress"
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Learning path" })).toBeTruthy();
    expect(screen.getByText("Press Run")).toBeTruthy();
    expect(screen.getByText(/RC Charging/)).toBeTruthy();
    expect(screen.getByText("Run")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers a primary CTA and Got it after success", () => {
    const onPrimary = vi.fn();
    const onDismiss = vi.fn();
    render(
      <LearningPathCoach
        tip={{
          id: "first-success",
          title: "First simulation complete",
          body: "You ran your first circuit.",
          shortcuts: ["Probe"],
        }}
        status="completed"
        onDismiss={onDismiss}
        onPrimary={onPrimary}
        primaryLabel="Try RC Charging"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try RC Charging" }));
    expect(onPrimary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
