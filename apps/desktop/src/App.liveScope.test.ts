import { describe, expect, it } from "vitest";

import { liveScopeChannelRequests } from "./App";

describe("live scope channel allocation", () => {
  it("keeps an authored power triplet atomic under the channel cap", () => {
    const triplet = [
      { vector: "@r1[id]", label: "I(R1)", unit: "A", componentId: "r1", powerRole: "current" as const },
      { vector: "v(n1)", label: "V+(R1)", unit: "V", componentId: "r1", powerRole: "positive" as const, hidden: true },
      { vector: "v(0)", label: "V-(R1)", unit: "V", componentId: "r1", powerRole: "negative" as const, hidden: true },
    ];
    const result = liveScopeChannelRequests([], new Set(), 2, triplet);
    expect(result.channels).toEqual([]);
    expect(result.omitted).toBe(3);

    const complete = liveScopeChannelRequests([], new Set(), 3, triplet);
    expect(complete.channels.map((channel) => channel.unit)).toEqual(["A", "V", "V"]);
  });
});
