// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngineeringTraceReadout } from "./EngineeringTraceReadout";

afterEach(cleanup);

describe("EngineeringTraceReadout", () => {
  it("renders an accessible compact engineering summary", () => {
    render(
      <EngineeringTraceReadout
        trace={{ id: "out", label: "V(out)", unit: "V", values: [-2, 2, 0] }}
        times={[0, 1, 2]}
        cursor={{ time: 0.5, value: 125e-3, label: "C1" }}
      />,
    );

    const readout = screen.getByRole("region", { name: "V(out) engineering readout" });
    expect(within(readout).getByText("MIN")).toBeTruthy();
    expect(within(readout).getByText("MAX")).toBeTruthy();
    expect(within(readout).getByText("AVG")).toBeTruthy();
    expect(within(readout).getByText("RMS")).toBeTruthy();
    expect(within(readout).getByText("P–P")).toBeTruthy();
    expect(within(readout).getByText("FINAL")).toBeTruthy();
    expect(within(readout).getByText("C1")).toBeTruthy();
    expect(within(readout).getByText("125 mV @ 500 ms")).toBeTruthy();
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
});
