// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngineeringTraceReadout } from "./EngineeringTraceReadout";

afterEach(cleanup);

describe("EngineeringTraceReadout", () => {
  it("keeps the transient final and peak-to-peak values primary, with detail on demand", () => {
    const { container } = render(
      <EngineeringTraceReadout
        trace={{ id: "out", label: "V(out)", unit: "V", color: "var(--trace-cyan)", values: [-2, 2, 0] }}
        times={[0, 1, 2]}
        cursor={{ time: 0.5, value: 125e-3, label: "C1" }}
      />,
    );

    const readout = screen.getByRole("region", { name: "V(out) engineering readout" });
    const disclosure = within(readout).getByText("More measurements").closest("details");
    expect(disclosure?.open).toBe(false);
    expect(within(readout).getAllByText("Final value")).toHaveLength(2);
    expect(within(readout).getByText("Peak-to-peak")).toBeTruthy();
    expect(within(disclosure!).getByText("Minimum")).toBeTruthy();
    expect(within(disclosure!).getByText("Maximum")).toBeTruthy();
    expect(within(disclosure!).getByText("Average")).toBeTruthy();
    expect(within(disclosure!).getByText("RMS")).toBeTruthy();
    expect(within(disclosure!).getByText("C1")).toBeTruthy();
    expect(within(disclosure!).getByText("125 mV @ 500 ms")).toBeTruthy();
    expect(container.querySelector(".engineering-trace-readout__hero-mantissa")?.textContent).toBe("0");
    expect(container.querySelector(".engineering-trace-readout__hero-unit")?.textContent).toBe("V");
    expect(container.querySelector(".engineering-trace-readout")?.getAttribute("style"))
      .toContain("--trace-color: var(--trace-cyan)");
  });

  it("uses RMS as the primary value and keeps frequency visible for periodic signals", () => {
    const times = Array.from({ length: 401 }, (_, index) => index / 100);
    render(
      <EngineeringTraceReadout
        trace={{
          id: "ac",
          label: "V(ac)",
          unit: "V",
          values: times.map((time) => Math.sin(2 * Math.PI * 2 * time)),
        }}
        times={times}
      />,
    );

    const readout = screen.getByRole("region", { name: "V(ac) engineering readout" });
    const disclosure = within(readout).getByText("More measurements").closest("details")!;
    expect(within(readout).getByText("Periodic · 2 Hz")).toBeTruthy();
    expect(within(readout).queryByText(/sine/i)).toBeNull();
    expect(within(readout).getAllByText("RMS")).toHaveLength(2);
    expect(within(readout).getByText("Frequency")).toBeTruthy();
    expect(within(disclosure).getByText("Period")).toBeTruthy();
  });

  it("can defer visible identity to its single-channel pane without losing context", () => {
    render(
      <EngineeringTraceReadout
        trace={{ id: "out", label: "V(out)", unit: "V", values: [0, 1, 0] }}
        times={[0, 0.5, 1]}
        showIdentity={false}
      />,
    );

    const readout = screen.getByRole("region", { name: "V(out) engineering readout" });
    expect(within(readout).queryByText("V(out)")).toBeNull();
    expect(within(readout).getByText("Transient")).toBeTruthy();
    expect(readout.querySelector(".engineering-trace-readout__header--classification-only")).toBeTruthy();
  });

  it("renders nothing for an unavailable trace", () => {
    const { container } = render(
      <EngineeringTraceReadout
        trace={{ id: "bad", label: "V(bad)", unit: "V", values: [Number.NaN] }}
        times={[0]}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("labels full-run and computes peak-to-peak for the visible window", () => {
    render(
      <EngineeringTraceReadout
        trace={{ id: "out", label: "V(out)", unit: "V", values: [0, 4, 1] }}
        times={[0, 1, 2]}
        visibleWindow={{ tMin: 1, tMax: 2 }}
      />,
    );
    const readout = screen.getByRole("region", { name: "V(out) engineering readout" });
    expect(within(readout).getByTitle("Full run peak to peak")).toBeTruthy();
    expect(within(readout).getByText("Visible P-P")).toBeTruthy();
    expect(within(readout).getByText("3 V")).toBeTruthy();
  });

  it("does not rescan waveform samples for an unrelated presentation rerender", () => {
    let sampleReads = 0;
    const values = new Proxy([-2, 2, 0], {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) sampleReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const times = [0, 1, 2];
    const trace = { id: "out", label: "V(out)", unit: "V" as const, color: "var(--trace-cyan)", values };
    const { rerender } = render(
      <EngineeringTraceReadout trace={trace} times={times} className="before" />,
    );
    const readsAfterFirstRender = sampleReads;
    expect(readsAfterFirstRender).toBeGreaterThan(0);

    rerender(<EngineeringTraceReadout trace={trace} times={times} className="after" />);

    expect(sampleReads).toBe(readsAfterFirstRender);
  });
});
