// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

import { usePlotViewport } from "./usePlotViewport";

afterEach(() => cleanup());

function SharedPane({
  name,
  sharedX,
  onSharedXChange,
  canFrame = false,
}: {
  name: string;
  sharedX: { xMin: number; xMax: number };
  onSharedXChange: (next: { xMin: number; xMax: number }) => void;
  canFrame?: boolean;
}) {
  const { viewport, fitTo } = usePlotViewport({
    domain: { xMin: 0, xMax: 10, yMin: -1, yMax: 1 },
    resetKey: "run-1",
    width: 800,
    height: 200,
    pad: 40,
    sharedX,
    onXViewportChange: onSharedXChange,
  });
  return (
    <div>
      <output aria-label={`${name} viewport`}>{`${viewport.xMin}:${viewport.xMax}`}</output>
      {canFrame && (
        <>
          <button type="button" onClick={() => fitTo({ xMin: 8, xMax: 10, yMin: -0.5, yMax: 0.5 })}>
            Frame {name}
          </button>
          <button type="button" onClick={() => fitTo({ xMin: 0, xMax: 10, yMin: -0.5, yMax: 0.5 })}>
            Fit Y {name}
          </button>
        </>
      )}
    </div>
  );
}

function SharedHarness() {
  const [sharedX, setSharedX] = React.useState({ xMin: 0, xMax: 10 });
  return (
    <>
      <SharedPane name="first" sharedX={sharedX} onSharedXChange={setSharedX} canFrame />
      <SharedPane name="second" sharedX={sharedX} onSharedXChange={setSharedX} />
    </>
  );
}

describe("usePlotViewport explicit framing", () => {
  it("publishes an Auto Frame X window to every shared pane", async () => {
    render(<SharedHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Frame first" }));

    await waitFor(() => {
      expect(screen.getByLabelText("first viewport").textContent).toBe("8:10");
      expect(screen.getByLabelText("second viewport").textContent).toBe("8:10");
    });
  });

  it("does not leak a Y-only fit into a later shared-X adoption", async () => {
    const publish = vi.fn();
    const { rerender } = render(
      <SharedPane
        name="single"
        sharedX={{ xMin: 0, xMax: 10 }}
        onSharedXChange={publish}
        canFrame
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fit Y single" }));
    rerender(
      <SharedPane
        name="single"
        sharedX={{ xMin: 2, xMax: 8 }}
        onSharedXChange={publish}
        canFrame
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("single viewport").textContent).toBe("2:8"));
    expect(publish).not.toHaveBeenCalled();
  });
});
