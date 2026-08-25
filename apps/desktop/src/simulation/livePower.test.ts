import { describe, expect, it } from "vitest";

import { deriveLivePower, orientedPowerPair } from "./livePower";

describe("live power instrument", () => {
  it("uses the authored positive/negative terminal orientation", () => {
    expect(orientedPowerPair({ p: "n+", n: "0" })).toEqual(["n+", "0"]);
    expect(orientedPowerPair({ c: "n+", e: "0" })).toEqual(["n+", "0"]);
  });

  it("derives watts from V+ - V- and current entering V+", () => {
    expect(deriveLivePower([5, 4], [0, 1], [0.2, -0.5])).toEqual([1, -1.5]);
    expect(deriveLivePower([5], [0, 0], [1])).toEqual([5]);
    expect(deriveLivePower([0], [5], [1])).toEqual([-5]);
  });
});
