// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComponentMeasurement, MeasuredSeries } from "../simulation/measurementModel";
import { ComponentMeasurementsPanel, primaryReading, sparklinePath } from "./ComponentMeasurementsPanel";

afterEach(cleanup);

function series(
  label: string,
  unit: MeasuredSeries["unit"],
  values: number[],
  kind: MeasuredSeries["classification"]["kind"] = "steady",
): MeasuredSeries {
  return {
    id: label,
    label,
    unit,
    values,
    statistics: { min: Math.min(...values), max: Math.max(...values), average: 1, rms: 2, final: values[values.length - 1] ?? 0 },
    classification: kind === "periodic" ? { kind, frequency: 1000, period: 0.001 } : { kind },
  };
}

const rows: ComponentMeasurement[] = [
  {
    componentId: "r1",
    ref: "R1",
    kind: "resistor",
    voltage: series("V(R1)", "V", [0, 2, 0], "periodic"),
    current: series("I(R1)", "A", [0, 0.002, 0], "periodic"),
    power: series("P(R1)", "W", [0, 0.004, 0], "periodic"),
  },
  {
    componentId: "c1",
    ref: "C1",
    kind: "capacitor",
    voltage: series("V(C1)", "V", [0, 1, 3], "transient"),
  },
];

describe("ComponentMeasurementsPanel", () => {
  it("renders complete readings, signal semantics, and a bounded accessible sparkline", () => {
    render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByRole("heading", { name: "Component measurements" })).toBeTruthy();
    expect(screen.getByText("2 components · 1 with complete V/I/P telemetry")).toBeTruthy();
    expect(screen.getByText("Periodic · 1 kHz")).toBeTruthy();
    expect(screen.getAllByText("RMS")).toHaveLength(2);
    expect(screen.getByText("AVG")).toBeTruthy();
    expect(screen.getByRole("img", { name: "V(R1): Periodic · 1 kHz" }).querySelectorAll("path")).toHaveLength(1);
    expect(screen.getByText("Positive power means absorbed")).toBeTruthy();
  });

  it("filters by reference and kind with a live result count", () => {
    render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter component measurements" }), { target: { value: "capacitor" } });

    expect(screen.queryByText("R1")).toBeNull();
    expect(screen.getByText("C1")).toBeTruthy();
    expect(screen.getByText("1 shown")).toBeTruthy();
  });

  it("uses native buttons for keyboard-accessible selection and toggles the selected row", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Select R1, resistor" }));
    expect(onSelect).toHaveBeenCalledWith("r1");

    rerender(<ComponentMeasurementsPanel rows={rows} selectedId="r1" onSelect={onSelect} />);
    const selected = screen.getByRole("button", { name: "Selected R1, resistor" });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(selected);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("announces empty and no-match states", () => {
    const { rerender } = render(<ComponentMeasurementsPanel rows={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/Run a transient analysis/)).toBeTruthy();

    rerender(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter component measurements" }), { target: { value: "L99" } });
    expect(screen.getByText(/No components match/)).toBeTruthy();
  });
});

describe("measurement presentation helpers", () => {
  it("uses RMS for periodic signals and final for other signals", () => {
    expect(primaryReading(series("periodic", "V", [0, 5, 0], "periodic"))).toEqual({ value: 2, qualifier: "RMS" });
    expect(primaryReading(series("power", "W", [0, 5, 0], "periodic"))).toEqual({ value: 1, qualifier: "AVG" });
    expect(primaryReading(series("transient", "V", [0, 5, 3], "transient"))).toEqual({ value: 3, qualifier: "FINAL" });
  });

  it("bounds sparkline paths and keeps the final point", () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index);
    const path = sparklinePath(values, 112, 32, 16);
    expect(path.split("L")).toHaveLength(16);
    expect(path).toContain("112.0 2.0");
    expect(sparklinePath([Number.NaN, 1])).toBe("");
  });
});
