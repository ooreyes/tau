// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveInstrumentActions } from "./LiveInstrumentActions";

describe("LiveInstrumentActions", () => {
  it("exposes the real voltage, current, and power instrument gestures", () => {
    const onProbeNode = vi.fn();
    const onMeasureCurrent = vi.fn();
    const onInspectPower = vi.fn();
    render(<LiveInstrumentActions onProbeNode={onProbeNode} onMeasureCurrent={onMeasureCurrent} onInspectPower={onInspectPower} />);
    fireEvent.click(screen.getByRole("button", { name: /Probe node voltage/i }));
    fireEvent.click(screen.getByRole("button", { name: /Measure component current/i }));
    fireEvent.click(screen.getByRole("button", { name: /Inspect component power/i }));
    expect(onProbeNode).toHaveBeenCalledOnce();
    expect(onMeasureCurrent).toHaveBeenCalledOnce();
    expect(onInspectPower).toHaveBeenCalledOnce();
  });
});
