// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematic } from "../store/useSchematic";
import { SimulationSetupDialog } from "./SimulationSetupDialog";

describe("SimulationSetupDialog", () => {
  beforeEach(() => {
    useSchematic.getState().newCircuit();
  });
  afterEach(() => cleanup());

  it("turns a common analysis into a form while preserving advanced directives", () => {
    useSchematic.getState().setDirectives([".tran 1u 10m", ".param Rload=10k"]);
    const onOpenChange = vi.fn();
    render(<SimulationSetupDialog open onOpenChange={onOpenChange} />);

    expect((screen.getByLabelText("Primary analysis") as HTMLSelectElement).value).toBe("tran");
    expect((screen.getByLabelText("Transient output interval") as HTMLInputElement).value).toBe("1u");
    expect((screen.getByLabelText("Transient stop time") as HTMLInputElement).value).toBe("10m");
    expect(screen.getByText("Need a source waveform?").parentElement?.textContent)
      .toMatch(/no PULSE\(\.\.\.\) syntax is required/i);

    fireEvent.change(screen.getByLabelText("Primary analysis"), { target: { value: "op" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));

    expect(useSchematic.getState().directives).toEqual([".op", ".param Rload=10k"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("authors an AC sweep without requiring raw SPICE", () => {
    render(<SimulationSetupDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Primary analysis"), { target: { value: "ac" } });
    fireEvent.change(screen.getByLabelText("AC sweep points"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("AC start frequency"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("AC stop frequency"), { target: { value: "2Meg" } });
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
    expect((screen.getByLabelText("Measurement 3 calculation") as HTMLSelectElement).value).toBe("PARAM");
    expect((screen.getByLabelText("Measurement 3 formula") as HTMLInputElement).value).toBe("PL/PS");
    expect((screen.getByLabelText("Advanced SPICE directives") as HTMLTextAreaElement).value).toBe(".step param load list 4 8");

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
    fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
    expect(useSchematic.getState().directives).toEqual([".meas tran VoutAvg AVG V(out)"]);
  });
});
