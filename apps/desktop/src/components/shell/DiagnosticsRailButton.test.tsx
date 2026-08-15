// @vitest-environment jsdom
/**
 * The rail's `!` health light (PDF-6 item 6).
 *
 * The assertions worth having here are the ones about NOT relying on colour: a
 * test can see a class name, but a colour-blind reader cannot see the class. So
 * what is pinned is the accessible name for each of the three healths, which is
 * the carrier that survives both a monochrome display and a screen reader.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsRailButton } from "./DiagnosticsRailButton";

afterEach(() => cleanup());

describe("DiagnosticsRailButton", () => {
  it("names the clear state without needing the colour", () => {
    render(<DiagnosticsRailButton health="ok" count={0} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Diagnostics: no problems" });
    expect(button.getAttribute("data-health")).toBe("ok");
    // No badge with nothing to read: a permanent "0" trains the eye to ignore
    // the whole button.
    expect(button.querySelector(".rail-diagnostics-count")).toBeNull();
  });

  it("names the warning state and says the circuit still runs", () => {
    render(<DiagnosticsRailButton health="warning" count={3} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: "Diagnostics: 3 warnings, this circuit will still run",
    });
    expect(button.getAttribute("data-health")).toBe("warning");
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("3");
  });

  it("names the error state and says the circuit will not run", () => {
    render(<DiagnosticsRailButton health="error" count={1} open={false} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Diagnostics: 1 problem, this circuit will not run" })
        .getAttribute("data-health"),
    ).toBe("error");
  });

  it("gives the three healths three different names", () => {
    const names = (["ok", "warning", "error"] as const).map((health) => {
      const view = render(
        <DiagnosticsRailButton health={health} count={2} open={false} onToggle={vi.fn()} />,
      );
      const name = screen.getByRole("button").getAttribute("aria-label");
      view.unmount();
      return name;
    });
    expect(new Set(names).size).toBe(3);
  });

  it("toggles on click and reports its open state to assistive tech", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DiagnosticsRailButton health="error" count={2} open={false} onToggle={onToggle} />,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    // Open is driven from outside - this button holds no state of its own, which
    // is what lets the window and the button share one source of truth.
    rerender(<DiagnosticsRailButton health="error" count={2} open onToggle={onToggle} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button").className).toContain("active");
  });

  it("clamps a large count in the badge but never in the name", () => {
    render(<DiagnosticsRailButton health="warning" count={42} open={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button", {
      name: "Diagnostics: 42 warnings, this circuit will still run",
    });
    expect(button.querySelector(".rail-diagnostics-count")!.textContent).toBe("9+");
  });

  it("does not fire when disabled", () => {
    const onToggle = vi.fn();
    render(<DiagnosticsRailButton health="ok" count={0} open={false} onToggle={onToggle} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
