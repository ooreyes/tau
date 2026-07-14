// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ZoomIn } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstrumentIconButton } from "./instrument-icon-button";

afterEach(() => cleanup());

describe("InstrumentIconButton", () => {
  it("renders a labelled 28px instrument action with a consistent outline icon", () => {
    render(<InstrumentIconButton icon={ZoomIn} label="Zoom in" />);

    const button = screen.getByRole("button", { name: "Zoom in" });
    const icon = button.querySelector("svg");

    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("size-7");
    expect(button.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(icon?.getAttribute("width")).toBe("16");
    expect(icon?.getAttribute("height")).toBe("16");
    expect(icon?.getAttribute("stroke-width")).toBe("1.6");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("forwards action, pressed, disabled, and focus-state semantics", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <InstrumentIconButton icon={ZoomIn} label="Lock zoom" pressed onClick={onClick} />,
    );

    const pressed = screen.getByRole("button", { name: "Lock zoom" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.className).toContain("aria-pressed:bg-primary/15");
    expect(pressed.className).toContain("focus-visible:ring-2");
    fireEvent.click(pressed);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<InstrumentIconButton icon={ZoomIn} label="Lock zoom" disabled onClick={onClick} />);
    const disabled = screen.getByRole("button", { name: "Lock zoom" }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(disabled);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("exposes richer interaction help from keyboard focus", async () => {
    render(
      <InstrumentIconButton
        icon={ZoomIn}
        label="Zoom in"
        tooltip="Zoom in around the pointer"
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: "Zoom in" }));

    expect((await screen.findByRole("tooltip")).textContent).toContain("Zoom in around the pointer");
  });
});
