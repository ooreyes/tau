// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineeringInput } from "./EngineeringInput";

// jsdom lacks PointerEvent capture APIs that Radix Select uses on open.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

/** Radix Select opens on pointerdown; include button/pointerId for jsdom. */
async function chooseSelectOption(ariaLabel: string, optionName: string) {
  const trigger = screen.getByRole("combobox", { name: ariaLabel });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, pointerType: "mouse" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerUp(option, { button: 0, pointerId: 1, pointerType: "mouse" });
  fireEvent.click(option);
}

afterEach(cleanup);

describe("EngineeringInput", () => {
  it("ignores keystrokes that aren't a prefix of a valid mantissa", () => {
    const onValueChange = vi.fn();
    render(<EngineeringInput label="R1" unit="Ω" value="4.7" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("R1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "jfgnjgjfbfbg" } });

    expect(input.value).toBe("4.7");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("exposes SI prefix as ui/Select combobox (not native <select>)", () => {
    render(<EngineeringInput label="R1" unit="Ω" value="4.7k" onValueChange={vi.fn()} />);
    const prefix = screen.getByRole("combobox", { name: "R1 SI prefix" });
    expect(prefix.tagName).toBe("BUTTON");
    expect(prefix.getAttribute("data-slot")).toBe("select-trigger");
    expect(prefix.textContent).toContain("kΩ");
    expect(document.querySelector(".eng-input select")).toBeNull();
  });

  it("commits a mantissa plus prefix once both are set", async () => {
    const onValueChange = vi.fn();
    render(<EngineeringInput label="R1" unit="Ω" value="1" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("R1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "4.7" } });
    await chooseSelectOption("R1 SI prefix", "µΩ");

    expect(onValueChange).toHaveBeenLastCalledWith("4.7u");
  });

  it("lets partial states through as typable but does not commit them", () => {
    const onValueChange = vi.fn();
    render(<EngineeringInput label="R1" unit="Ω" value="4.7" onValueChange={onValueChange} />);
    const input = screen.getByLabelText("R1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "-" } });
    expect(input.value).toBe("-");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1e-" } });
    expect(input.value).toBe("1e-");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("reverts an incomplete mantissa to the stored value on blur", () => {
    const onValueChange = vi.fn();
    render(
      <div>
        <EngineeringInput label="R1" unit="Ω" value="4.7" onValueChange={onValueChange} />
        <button type="button">elsewhere</button>
      </div>,
    );
    const input = screen.getByLabelText("R1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1e-" } });
    expect(input.value).toBe("1e-");

    fireEvent.blur(input, { relatedTarget: screen.getByText("elsewhere") });
    expect(input.value).toBe("4.7");
  });

  it("sizes the input to the mantissa length so long values are not clipped", () => {
    render(<EngineeringInput label="R1" unit="Ω" value="123456789012" onValueChange={vi.fn()} />);
    const input = screen.getByLabelText("R1") as HTMLInputElement;
    expect(input.value).toBe("123456789012");
    expect(input.style.width).toBe("13ch");
  });

  it("accepts exponent notation and compacts a long value on blur", () => {
    const onValueChange = vi.fn();
    render(
      <div>
        <EngineeringInput label="C1" unit="F" value="123456789012" onValueChange={onValueChange} />
        <button type="button">elsewhere</button>
      </div>,
    );
    const input = screen.getByLabelText("C1") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2.5e-12" } });
    expect(onValueChange).toHaveBeenLastCalledWith("2.5e-12");

    fireEvent.change(input, { target: { value: "123456789012" } });
    fireEvent.blur(input, { relatedTarget: screen.getByText("elsewhere") });
    expect(input.value).toBe("1.23456789e11");
  });

  it("marks an out-of-range draft invalid, refuses it, and restores the committed value", () => {
    const onValueChange = vi.fn();
    render(
      <div>
        <EngineeringInput
          label="Dead time"
          unit="s"
          value="200n"
          min={1e-12}
          max={1}
          onValueChange={onValueChange}
        />
        <button type="button">elsewhere</button>
      </div>,
    );
    const input = screen.getByLabelText("Dead time") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(input, { relatedTarget: screen.getByText("elsewhere") });
    expect(input.value).toBe("200");
  });

  it("uses a bounded unitless field without an irrelevant SI-prefix chooser", () => {
    const onValueChange = vi.fn();
    render(
      <EngineeringInput label="Input threshold" unit="" value="0.5" min={0.1} max={0.9} onValueChange={onValueChange} />,
    );
    const input = screen.getByLabelText("Input threshold") as HTMLInputElement;
    expect(screen.queryByLabelText("Input threshold SI prefix")).toBeNull();
    fireEvent.change(input, { target: { value: "0.6" } });
    expect(onValueChange).toHaveBeenCalledWith("0.6");
    fireEvent.change(input, { target: { value: "1" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("treats an empty optional field as valid without committing", () => {
    const onValueChange = vi.fn();
    render(
      <EngineeringInput label="At value" unit="V" value="" allowEmpty onValueChange={onValueChange} />,
    );
    const input = screen.getByLabelText("At value") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(onValueChange).not.toHaveBeenCalled();

    // Incomplete drafts are still invalid and still do not commit.
    fireEvent.change(input, { target: { value: "1e" } });
    expect(input.value).toBe("1e");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("still marks empty invalid when allowEmpty is off", () => {
    render(<EngineeringInput label="R1" unit="Ω" value="" onValueChange={vi.fn()} />);
    expect(screen.getByLabelText("R1").getAttribute("aria-invalid")).toBe("true");
  });
});
