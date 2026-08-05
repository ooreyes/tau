// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const startPlacing = vi.fn();
vi.mock("../store/useSchematic", () => ({
  useSchematic: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      startPlacing,
      startWiring: vi.fn(),
      startProbing: vi.fn(),
      startLabeling: vi.fn(),
    }),
}));

import { CommandPalette } from "./CommandPalette";

afterEach(() => {
  cleanup();
  startPlacing.mockReset();
});

describe("CommandPalette ui/command", () => {
  it("opens as a Dialog command palette (not the legacy cmdk-backdrop)", () => {
    render(<CommandPalette open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add component" })).toBeTruthy();
    expect(document.querySelector(".cmdk-backdrop")).toBeNull();
    expect(document.querySelector('[data-slot="command"]')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search parts/)).toBeTruthy();
  });

  it("filters and places a catalog part on select", async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Search parts/);
    fireEvent.change(input, { target: { value: "resistor" } });
    const item = await screen.findByText("Resistor");
    fireEvent.click(item);
    expect(startPlacing).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
