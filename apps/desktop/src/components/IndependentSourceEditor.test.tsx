// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndependentSourceEditor } from "./IndependentSourceEditor";

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

function renderSource(value: string, legacyKind?: "vac" | "iac" | "vpulse") {
  const onValueChange = vi.fn();
  const onBeginChange = vi.fn();
  render(
    <IndependentSourceEditor
      value={value}
      unit={legacyKind === "iac" ? "A" : "V"}
      legacyKind={legacyKind}
      onBeginChange={onBeginChange}
      onValueChange={onValueChange}
    />,
  );
  return { onBeginChange, onValueChange };
}

describe("IndependentSourceEditor validation", () => {
  it("keeps an invalid unitless duty draft visible and does not mutate the source", () => {
    const { onBeginChange, onValueChange } = renderSource("0 5 100k 0.5", "vpulse");
    const duty = screen.getByLabelText("Duty (0–1)") as HTMLInputElement;

    fireEvent.change(duty, { target: { value: "2" } });

    expect(duty.value).toBe("2");
    expect(duty.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at or below 1");
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(duty, { target: { value: "0.75" } });

    expect(duty.getAttribute("aria-invalid")).toBe("false");
    expect(onBeginChange).toHaveBeenCalledOnce();
    expect(onBeginChange).toHaveBeenCalledWith("duty");
    expect(onValueChange).toHaveBeenLastCalledWith("0 5 100k 0.75");
  });

  it("refuses non-positive legacy frequency drafts while retaining the valid value", () => {
    const { onBeginChange, onValueChange } = renderSource("1 1k", "vac");
    const frequency = screen.getByLabelText("Frequency") as HTMLInputElement;

    fireEvent.change(frequency, { target: { value: "0" } });

    expect(frequency.value).toBe("0");
    expect(frequency.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("above 0");
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps an incomplete unitless cycles draft accessible until it is valid", () => {
    const { onBeginChange, onValueChange } = renderSource("SINE(0 1 1k)");
    const cycles = screen.getByLabelText("Cycles") as HTMLInputElement;

    fireEvent.change(cycles, { target: { value: "1e-" } });

    expect(cycles.value).toBe("1e-");
    expect(cycles.getAttribute("aria-invalid")).toBe("true");
    expect(cycles.getAttribute("aria-describedby")).toBeTruthy();
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
