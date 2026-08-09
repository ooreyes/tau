import { describe, expect, it, vi } from "vitest";

import {
  ENGINE_DESCRIPTIONS,
  ENGINE_LABELS,
  resolveEngineResult,
  withEngine,
  type SimulationEngine,
} from "./engineProvenance";

/**
 * The engine a result is attributed to must be a consequence of the choice the
 * app actually made, not a separate claim about it. These pin the seam every
 * analysis routes through, so a call site cannot name one engine while running
 * the other.
 */

describe("resolveEngineResult", () => {
  it("attributes a native result to ngspice and passes it through untouched", () => {
    const native = { ok: true as const, value: 42 };
    const fallback = vi.fn(() => ({ ok: true as const, value: 0 }));

    const result = resolveEngineResult(native, fallback);

    expect(result.engine).toBe("ngspice");
    expect(result.value).toBe(42);
    // The preview solver must not run when ngspice already answered - it is
    // the slow path and would discard the native answer's device models.
    expect(fallback).not.toHaveBeenCalled();
  });

  it("attributes the fallback to the preview solver when there is no native runtime", () => {
    const fallback = vi.fn(() => ({ ok: true as const, value: 7 }));

    const result = resolveEngineResult(null, fallback);

    expect(result.engine).toBe("preview");
    expect(result.value).toBe(7);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("attributes a native failure to ngspice, not to the fallback", () => {
    // A native runner that returns a failed result has still answered: the
    // circuit reached ngspice and ngspice rejected it. Falling back here would
    // both hide that and re-answer with a solver that models less.
    const native = { ok: false as const, message: "singular matrix" };
    const fallback = vi.fn(() => ({ ok: false as const, message: "fallback ran" }));

    const result = resolveEngineResult(native, fallback);

    expect(result.engine).toBe("ngspice");
    expect(result.message).toBe("singular matrix");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not mutate the result it attributes", () => {
    const native = { ok: true as const, warnings: [] as string[] };

    const result = resolveEngineResult(native, () => native);

    expect(result).not.toBe(native);
    expect("engine" in native).toBe(false);
  });
});

describe("withEngine", () => {
  it("keeps every field of the result it stamps", () => {
    const stamped = withEngine({ ok: true as const, a: 1, b: "two" }, "preview");
    expect(stamped).toEqual({ ok: true, a: 1, b: "two", engine: "preview" });
  });
});

describe("engine copy", () => {
  const engines: SimulationEngine[] = ["ngspice", "preview"];

  it("labels and describes both engines", () => {
    for (const engine of engines) {
      expect(ENGINE_LABELS[engine]).toBeTruthy();
      expect(ENGINE_DESCRIPTIONS[engine]).toBeTruthy();
    }
  });

  it("says out loud that the preview solver is a subset, so its badge is a caveat", () => {
    // Keep the badge honest: it must disown ngspice and say that vendor and
    // nonlinear work is refused rather than approximated. Matched loosely on
    // purpose - this pins the claim, not one phrasing of it.
    // (exact phrasing may shift; the claims must stay).
    expect(ENGINE_DESCRIPTIONS.preview).toMatch(/not (by )?ngspice/i);
    expect(ENGINE_DESCRIPTIONS.preview).toMatch(/refuses vendor models/i);
    expect(ENGINE_DESCRIPTIONS.preview).toMatch(/nonlinear/i);
    expect(ENGINE_LABELS.preview).not.toBe(ENGINE_LABELS.ngspice);
  });
});
