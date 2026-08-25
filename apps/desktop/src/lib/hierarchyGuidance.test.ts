import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeHierarchyGuidance,
  DEFAULT_HIERARCHY_GUIDANCE_STATE,
  HIERARCHY_GUIDANCE_KEY,
  readHierarchyGuidanceState,
  resetHierarchyGuidance,
} from "./hierarchyGuidance";

describe("hierarchy guidance preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
    });
  });

  afterEach(() => {
    resetHierarchyGuidance();
  });

  it("fails open for missing, corrupt, and wrong-version envelopes", () => {
    expect(readHierarchyGuidanceState()).toEqual(DEFAULT_HIERARCHY_GUIDANCE_STATE);
    localStorage.setItem(HIERARCHY_GUIDANCE_KEY, "not json");
    expect(readHierarchyGuidanceState()).toEqual(DEFAULT_HIERARCHY_GUIDANCE_STATE);
    localStorage.setItem(HIERARCHY_GUIDANCE_KEY, JSON.stringify({ kind: "tau.hierarchy.guidance.v0", completed: true }));
    expect(readHierarchyGuidanceState()).toEqual(DEFAULT_HIERARCHY_GUIDANCE_STATE);
  });

  it("stores completion in a versioned envelope and reset makes first use visible again", () => {
    completeHierarchyGuidance();
    expect(JSON.parse(localStorage.getItem(HIERARCHY_GUIDANCE_KEY) ?? "null")).toEqual({
      kind: "tau.hierarchy.guidance.v1",
      completed: true,
    });
    expect(readHierarchyGuidanceState().completed).toBe(true);
    resetHierarchyGuidance();
    expect(readHierarchyGuidanceState()).toEqual(DEFAULT_HIERARCHY_GUIDANCE_STATE);
  });
});
