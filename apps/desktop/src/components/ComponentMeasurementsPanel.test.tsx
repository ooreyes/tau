// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("article", { name: "R1" })).toBeTruthy();
    expect(screen.getAllByText("Voltage").every((element) => element.closest("dt") !== null)).toBe(true);

    fireEvent.click(screen.getByText("Reading and sign conventions"));
    expect(screen.getByText("Positive power is absorbed; negative power is delivered.")).toBeTruthy();
    expect(screen.getAllByText(/component positive terminal/)).toHaveLength(1);
  });

  it("filters by reference and kind with a live result count", () => {
    render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter component measurements" }), { target: { value: "capacitor" } });

    expect(screen.queryByText("R1")).toBeNull();
    expect(screen.getByText("C1")).toBeTruthy();
    expect(screen.getByText("1 shown")).toBeTruthy();
  });

  it("uses a dedicated native button for selection without making the whole card interactive", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={onSelect} />);
    const card = screen.getByRole("article", { name: "R1" });
    expect(card.tagName).toBe("ARTICLE");
    expect(card.getAttribute("aria-label")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select R1" }));
    expect(onSelect).toHaveBeenCalledWith("r1");

    rerender(<ComponentMeasurementsPanel rows={rows} selectedId="r1" onSelect={onSelect} />);
    const selected = screen.getByRole("button", { name: "Deselect R1" });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(selected);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("does not describe a negative nonperiodic FINAL power value as average power", () => {
    const negativePowerRow: ComponentMeasurement = {
      componentId: "v1",
      ref: "V1",
      kind: "vsource",
      power: series("P(V1)", "W", [-1, -2, -3], "transient"),
    };
    render(<ComponentMeasurementsPanel rows={[negativePowerRow]} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByText("FINAL")).toBeTruthy();
    expect(screen.queryByText(/delivering average power/i)).toBeNull();
    fireEvent.click(screen.getByText("Reading and sign conventions"));
    expect(screen.getByText("FINAL is the instantaneous value at the simulation stop time.")).toBeTruthy();
  });

  it("renders model-provided component safety advisories", () => {
    const warningRow: ComponentMeasurement = {
      ...rows[0],
      componentId: "d1",
      ref: "D1",
      kind: "led",
      advisories: [{
        kind: "high-led-current-no-limiter",
        severity: "warning",
        title: "High LED current · no limiter",
        message: "D1 reaches 315 mA with V1 directly across it. Add a series resistor or current regulator, and verify the LED model rating.",
      }],
    };
    render(<ComponentMeasurementsPanel rows={[warningRow]} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByRole("status").textContent).toContain("High LED current · no limiter");
    expect(screen.getByRole("status").textContent).toContain("D1 reaches 315 mA");
  });

  it("announces empty and no-match states", () => {
    const { rerender } = render(<ComponentMeasurementsPanel rows={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/Run a transient analysis/)).toBeTruthy();

    rerender(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter component measurements" }), { target: { value: "L99" } });
    expect(screen.getByText(/No components match/)).toBeTruthy();
  });
});

describe("ComponentMeasurementsPanel — variant=\"compact\" (telemetry dock grid)", () => {
  it("renders the same rows as responsive small cards, no search or disclosure chrome", () => {
    render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} variant="compact" />);
    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getByText("C1")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Component measurements" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Filter component measurements" })).toBeNull();
    expect(screen.queryByText("Reading and sign conventions")).toBeNull();
  });

  it("labels each spec row with the full quantity word, its qualifier, and a unit-bearing value", () => {
    render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={() => {}} variant="compact" />);
    // One row per quantity per card — never bare "V"/"I"/"P".
    expect(screen.getAllByText("Voltage")).toHaveLength(2);
    expect(screen.getAllByText("Current")).toHaveLength(2);
    expect(screen.getAllByText("Power")).toHaveLength(2);
    // Kind strings are humanized, not raw enum values.
    expect(screen.getByText("Resistor")).toBeTruthy();
    expect(screen.getByText("Capacitor")).toBeTruthy();
    expect(screen.queryByText("resistor")).toBeNull();
    // Periodic V carries an RMS qualifier and an engineering unit; missing
    // series render an em-dash placeholder (C1 has no current/power).
    const r1Card = screen.getByText("R1").closest("button") as HTMLElement;
    expect(within(r1Card).getAllByText("RMS").length).toBeGreaterThanOrEqual(2);
    expect(within(r1Card).getByText("AVG")).toBeTruthy();
    const c1Card = screen.getByText("C1").closest("button") as HTMLElement;
    expect(within(c1Card).getAllByText("—")).toHaveLength(2);
  });

  it("makes the whole card the click target (no dedicated Select button)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ComponentMeasurementsPanel rows={rows} selectedId={null} onSelect={onSelect} variant="compact" />);
    fireEvent.click(screen.getByText("R1"));
    expect(onSelect).toHaveBeenCalledWith("r1");

    rerender(<ComponentMeasurementsPanel rows={rows} selectedId="r1" onSelect={onSelect} variant="compact" />);
    const card = screen.getByText("R1").closest("button") as HTMLElement;
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("names dedicated AC source metadata as sine without calling classified traces sinusoidal", () => {
    const sourceRows: ComponentMeasurement[] = [
      { ...rows[0], componentId: "vac1", ref: "V1", kind: "vac" },
      { ...rows[0], componentId: "v1", ref: "V2", kind: "vsource" },
    ];
    render(<ComponentMeasurementsPanel rows={sourceRows} selectedId={null} onSelect={() => {}} variant="compact" />);

    expect(screen.getByText("Sine voltage source")).toBeTruthy();
    expect(screen.getByText("DC source")).toBeTruthy();
    expect(screen.getAllByText("RMS").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sine", { exact: true })).toBeNull();
  });

  it("shows a one-line empty hint distinct from the full variant's copy", () => {
    render(<ComponentMeasurementsPanel rows={[]} selectedId={null} onSelect={() => {}} variant="compact" />);
    expect(screen.getByText("Run a simulation to see per-component telemetry.")).toBeTruthy();
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
