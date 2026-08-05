// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematic } from "../store/useSchematic";
import { SimulationSetupDialog } from "./SimulationSetupDialog";

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

describe("SimulationSetupDialog", () => {
  beforeEach(() => {
    useSchematic.getState().newCircuit();
  });
  afterEach(() => cleanup());

  it("exposes primary analysis as ui/Select combobox (not native <select>)", () => {
    useSchematic.getState().setDirectives([".tran 1u 10m"]);
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);
    const primary = screen.getByRole("combobox", { name: "Primary analysis" });
    expect(primary.tagName).toBe("BUTTON");
    expect(primary.getAttribute("data-slot")).toBe("select-trigger");
    expect(primary.textContent).toContain("Transient (.tran)");
    expect(document.querySelector(".simulation-setup-body select")).toBeNull();
  });

  it("turns a common analysis into a form while preserving advanced directives", async () => {
    useSchematic.getState().setDirectives([".tran 1u 10m", ".param Rload=10k"]);
    const onOpenChange = vi.fn();
    render(<SimulationSetupDialog open onOpenChange={onOpenChange} />);

    expect(screen.getByRole("combobox", { name: "Primary analysis" }).textContent)
      .toContain("Transient (.tran)");
    expect((screen.getByLabelText("Transient output interval") as HTMLInputElement).value).toBe("1u");
    expect((screen.getByLabelText("Transient stop time") as HTMLInputElement).value).toBe("10m");
    expect(screen.getByText("Need a source waveform?").parentElement?.textContent)
      .toMatch(/no PULSE\(\.\.\.\) syntax is required/i);

    await chooseSelectOption("Primary analysis", "Operating point (.op)");
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));

    expect(useSchematic.getState().directives).toEqual([".op", ".param Rload=10k"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("authors an AC sweep without requiring raw SPICE", async () => {
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);
    await chooseSelectOption("Primary analysis", "AC sweep (.ac)");
    fireEvent.change(screen.getByLabelText("AC sweep points"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("AC start frequency"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("AC stop frequency"), { target: { value: "2Meg" } });
    const sweep = screen.getByRole("combobox", { name: "AC sweep type" });
    expect(sweep.tagName).toBe("BUTTON");
    expect(sweep.textContent).toContain("Decade");
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
    expect(useSchematic.getState().directives).toEqual([".ac dec 24 20 2Meg"]);
  });

  it("accepts expert directives one per line behind Advanced", () => {
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Advanced SPICE directives"), {
      target: { value: "param gain=10\n.meas op output FIND V(out)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
    expect(useSchematic.getState().directives).toEqual([
      ".param gain=10",
      ".meas op output FIND V(out)",
    ]);
  });

  it("decodes imported Class-D measurements into named rows instead of raw directives", () => {
    useSchematic.getState().setDirectives([
      ".tran 0 3m",
      ".meas tran PS avg -(10*I(V1)+10*I(V2))",
      ".meas tran PL avg V(vo)*I(R1)",
      ".meas tran Efficiency param PL/PS",
      ".step param load list 4 8",
    ]);
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);

    expect(screen.getAllByText(/^Result \d$/)).toHaveLength(3);
    expect((screen.getByLabelText("Measurement 1 name") as HTMLInputElement).value).toBe("PS");
    expect((screen.getByLabelText("Measurement 1 formula") as HTMLInputElement).value).toBe("-(10*I(V1)+10*I(V2))");
    expect(screen.getByRole("combobox", { name: "Measurement 3 calculation" }).textContent)
      .toContain("Derived result");
    expect((screen.getByLabelText("Measurement 3 formula") as HTMLInputElement).value).toBe("PL/PS");
    expect((screen.getByLabelText("Advanced SPICE directives") as HTMLTextAreaElement).value).toBe(".step param load list 4 8");
    expect(document.querySelector(".measurement-builder select")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
    expect(useSchematic.getState().directives).toEqual([
      ".tran 0 3m",
      ".meas tran PS avg -(10*I(V1)+10*I(V2))",
      ".meas tran PL avg V(vo)*I(R1)",
      ".meas tran Efficiency param PL/PS",
      ".step param load list 4 8",
    ]);
  });

  it("authors a named average node measurement with form controls", () => {
    useSchematic.setState({
      netLabels: [
        { id: "out", x: 0, y: 0, text: "out" },
        { id: "gnd", x: 0, y: 32, text: "0" },
      ],
    });
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add measurement" }));
    fireEvent.change(screen.getByLabelText("Measurement 1 name"), { target: { value: "VoutAvg" } });
    expect(screen.getByRole("combobox", { name: "Measurement 1 node" }).textContent).toContain("out");
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
    expect(useSchematic.getState().directives).toEqual([".meas tran VoutAvg AVG V(out)"]);
  });
});
