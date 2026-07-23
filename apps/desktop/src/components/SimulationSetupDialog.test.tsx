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
});
