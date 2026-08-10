import { describe, expect, it, vi } from "vitest";
import { prewarmPreviewSolverForRuntime } from "./App";

describe("prewarmPreviewSolverForRuntime", () => {
  it("does not start the preview worker in the native ngspice runtime", () => {
    const prewarm = vi.fn();

    prewarmPreviewSolverForRuntime(true, prewarm);

    expect(prewarm).not.toHaveBeenCalled();
  });

  it("keeps the browser preview warm-up path", () => {
    const prewarm = vi.fn();

    prewarmPreviewSolverForRuntime(false, prewarm);

    expect(prewarm).toHaveBeenCalledTimes(1);
  });
});
