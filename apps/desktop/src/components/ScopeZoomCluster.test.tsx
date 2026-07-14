// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeZoomCluster } from "./ScopeZoomCluster";

afterEach(() => cleanup());

describe("ScopeZoomCluster", () => {
  it("uses accessible Lucide instrument actions and preserves every zoom command", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    const { container } = render(
      <ScopeZoomCluster onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />,
    );

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const fit = screen.getByRole("button", { name: "Fit plot to data" });

    fireEvent.click(zoomIn);
    fireEvent.click(zoomOut);
    fireEvent.click(fit);

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(zoomIn.querySelector(".lucide-zoom-in")).toBeTruthy();
    expect(zoomOut.querySelector(".lucide-zoom-out")).toBeTruthy();
    expect(fit.querySelector(".lucide-scan")).toBeTruthy();
    expect(container.textContent).not.toContain("+");
    expect(container.textContent).not.toContain("⌂");
  });
});
