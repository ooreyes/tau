// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TelemetryDock } from "./TelemetryDock";
import type { ComponentMeasurement, MeasuredSeries } from "../simulation/measurementModel";

// This jsdom build has localStorage disabled — install an in-memory Storage
// (mirrors panelResize.test.tsx) so the dock's height/collapse persistence
// path is actually exercised instead of silently no-oping.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage,
});

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

function series(label: string, values: number[]): MeasuredSeries {
  return {
    id: label,
    label,
    unit: "V",
    values,
    statistics: { min: Math.min(...values), max: Math.max(...values), average: 1, rms: 1, final: values[values.length - 1] ?? 0 },
    classification: { kind: "steady" },
  };
}

const rows: ComponentMeasurement[] = [
  { componentId: "r1", ref: "R1", kind: "resistor", voltage: series("V(R1)", [1, 2, 3]) },
  { componentId: "c1", ref: "C1", kind: "capacitor", voltage: series("V(C1)", [0, 1, 2]) },
];

describe("TelemetryDock", () => {
  it("shows a small-caps title, component count, and expanded telemetry cards by default", () => {
    render(<TelemetryDock rows={rows} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("Telemetry")).toBeTruthy();
    expect(screen.getByText("2 components")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle component telemetry" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getByText("C1")).toBeTruthy();
  });

  it("collapses to the header row only, and persists across a remount", () => {
    const { unmount } = render(<TelemetryDock rows={rows} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle component telemetry" }));
    expect(screen.queryByText("R1")).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle component telemetry" }).getAttribute("aria-expanded")).toBe("false");
    unmount();

    render(<TelemetryDock rows={rows} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle component telemetry" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("R1")).toBeNull();
  });

  it("clicking a card selects/focuses that component (reuses ComponentMeasurementsPanel's compact variant)", () => {
    const onSelect = vi.fn();
    render(<TelemetryDock rows={rows} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("R1"));
    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("shows a one-line muted hint instead of stale data when there is no result", () => {
    render(<TelemetryDock rows={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("0 components")).toBeTruthy();
    expect(screen.getByText("Run a simulation to see per-component telemetry.")).toBeTruthy();
  });

  it("exposes a draggable top-edge resize handle while expanded, not while collapsed", () => {
    const { rerender } = render(<TelemetryDock rows={rows} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("separator", { name: "Resize component telemetry dock" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle component telemetry" }));
    rerender(<TelemetryDock rows={rows} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByRole("separator", { name: "Resize component telemetry dock" })).toBeNull();
  });
});
