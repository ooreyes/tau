// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchematicComponent } from "../schematic/types";
import { DcSetupForm, StepSetupForm } from "./AnalysisSetupForms";

// jsdom lacks PointerEvent capture APIs that Radix Select uses on open.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

const V1: SchematicComponent = {
  id: "v1",
  kind: "vsource",
  label: "V1",
  value: "5",
  x: 0,
  y: 0,
  rotation: 0,
};
const V2: SchematicComponent = {
  id: "v2",
  kind: "vsource",
  label: "V2",
  value: "12",
  x: 40,
  y: 0,
  rotation: 0,
};

/** Radix Select opens on pointerdown; include button/pointerId for jsdom. */
async function chooseSelectOption(ariaLabel: string, optionName: string) {
  const trigger = screen.getByRole("combobox", { name: ariaLabel });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, pointerType: "mouse" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerUp(option, { button: 0, pointerId: 1, pointerType: "mouse" });
  fireEvent.click(option);
}

describe("AnalysisSetupForms ui/Select", () => {
  afterEach(() => cleanup());

  it("exposes DC sweep source as ui/Select combobox (not native <select>)", () => {
    render(
      <DcSetupForm
        setup={{ source: "V1", start: 0, stop: 5, step: 1 }}
        components={[V1, V2]}
        onChange={() => {}}
      />,
    );
    const source = screen.getByRole("combobox", { name: "DC sweep source" });
    expect(source.tagName).toBe("BUTTON");
    expect(source.getAttribute("data-slot")).toBe("select-trigger");
    expect(source.textContent).toContain("V1");
    expect(document.querySelector(".analysis-setup select")).toBeNull();
  });

  it("picks another DC sweep source via the list", async () => {
    const onChange = vi.fn();
    render(
      <DcSetupForm
        setup={{ source: "V1", start: 0, stop: 5, step: 1 }}
        components={[V1, V2]}
        onChange={onChange}
      />,
    );
    await chooseSelectOption("DC sweep source", "V2");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ source: "V2" }),
    );
  });

  it("exposes Step sweep kind as ui/Select and switches to Parameter", async () => {
    const onChange = vi.fn();
    render(
      <StepSetupForm
        setup={{ kind: "source", name: "V1", start: 0, stop: 5, step: 1 }}
        components={[V1]}
        onChange={onChange}
      />,
    );
    const kind = screen.getByRole("combobox", { name: "Step sweep kind" });
    expect(kind.tagName).toBe("BUTTON");
    expect(kind.getAttribute("data-slot")).toBe("select-trigger");
    expect(kind.textContent).toContain("Source");
    expect(document.querySelector(".analysis-setup select")).toBeNull();

    await chooseSelectOption("Step sweep kind", "Parameter");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "param" }),
    );
  });
});
