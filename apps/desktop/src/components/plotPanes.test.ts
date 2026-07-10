import { describe, it, expect } from "vitest";
import {
  defaultLayout,
  automaticLayout,
  addPane,
  removePane,
  moveTrace,
  registerTrace,
  unregisterTrace,
  reconcileLayout,
  isValidLayout,
  allTraceIds,
  paneIndexOf,
} from "./plotPanes";

// ---------------------------------------------------------------------------
// defaultLayout
// ---------------------------------------------------------------------------
describe("defaultLayout", () => {
  it("creates a single pane with the provided trace ids", () => {
    const layout = defaultLayout(["t1", "t2"]);
    expect(layout).toHaveLength(1);
    expect(layout[0].traceIds).toEqual(["t1", "t2"]);
    expect(isValidLayout(layout)).toBe(true);
  });

  it("creates a single empty pane when called with no arguments", () => {
    const layout = defaultLayout();
    expect(layout).toHaveLength(1);
    expect(layout[0].traceIds).toEqual([]);
    expect(isValidLayout(layout)).toBe(true);
  });
});

describe("automaticLayout", () => {
  it("creates one plot card per available signal", () => {
    const layout = automaticLayout(["v:out", "i:R1", "p:R1"]);
    expect(layout).toHaveLength(3);
    expect(layout.map((pane) => pane.traceIds)).toEqual([["v:out"], ["i:R1"], ["p:R1"]]);
    expect(isValidLayout(layout)).toBe(true);
  });

  it("keeps an empty dashboard structurally valid", () => {
    expect(automaticLayout([])).toEqual(defaultLayout());
  });
});

// ---------------------------------------------------------------------------
// addPane
// ---------------------------------------------------------------------------
describe("addPane", () => {
  it("appends an empty pane", () => {
    const layout = addPane(defaultLayout(["t1"]));
    expect(layout).toHaveLength(2);
    expect(layout[1].traceIds).toEqual([]);
    expect(isValidLayout(layout)).toBe(true);
  });

  it("each added pane gets a unique id", () => {
    const l1 = addPane(defaultLayout());
    const l2 = addPane(l1);
    const ids = l2.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// removePane — invariants
// ---------------------------------------------------------------------------
describe("removePane", () => {
  it("reassigns orphaned traces to pane 0", () => {
    let layout = defaultLayout(["t1"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t1", 1); // move t1 to pane 1
    layout = removePane(layout, 1);      // remove pane 1 → t1 goes to pane 0
    expect(layout).toHaveLength(1);
    expect(layout[0].traceIds).toContain("t1");
    expect(isValidLayout(layout)).toBe(true);
  });

  it("removing the only pane is a no-op (≥1 pane invariant)", () => {
    const layout = defaultLayout(["t1"]);
    const after = removePane(layout, 0);
    expect(after).toHaveLength(1);
    expect(isValidLayout(after)).toBe(true);
  });

  it("no trace is orphaned after removal", () => {
    let layout = defaultLayout(["t1", "t2"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t2", 1);
    layout = removePane(layout, 1);
    expect(allTraceIds(layout)).toContain("t2");
    expect(isValidLayout(layout)).toBe(true);
  });

  it("traces from removed pane prepend to existing pane 0 traces", () => {
    let layout = defaultLayout(["t1"]);
    layout = addPane(layout);
    layout = addPane(layout);
    layout = moveTrace(layout, "t1", 2); // pane 2 owns t1
    // pane 0 and pane 1 are empty, pane 2 has t1
    layout = removePane(layout, 2); // t1 should go to pane 0
    expect(layout[0].traceIds).toContain("t1");
    expect(isValidLayout(layout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// moveTrace
// ---------------------------------------------------------------------------
describe("moveTrace", () => {
  it("moves a trace from one pane to another", () => {
    let layout = defaultLayout(["t1", "t2"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t2", 1);
    expect(layout[0].traceIds).not.toContain("t2");
    expect(layout[1].traceIds).toContain("t2");
    expect(isValidLayout(layout)).toBe(true);
  });

  it("moving to current pane is a no-op", () => {
    const layout = defaultLayout(["t1"]);
    const after = moveTrace(layout, "t1", 0);
    expect(after).toEqual(layout);
  });

  it("moving to out-of-range index is a no-op", () => {
    const layout = defaultLayout(["t1"]);
    const after = moveTrace(layout, "t1", 99);
    expect(after).toEqual(layout);
  });

  it("a trace appears in exactly one pane after move", () => {
    let layout = defaultLayout(["t1", "t2", "t3"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t2", 1);
    for (const id of ["t1", "t2", "t3"]) {
      const count = layout.filter((p) => p.traceIds.includes(id)).length;
      expect(count).toBe(1);
    }
    expect(isValidLayout(layout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerTrace / unregisterTrace
// ---------------------------------------------------------------------------
describe("registerTrace", () => {
  it("adds a new trace to pane 0", () => {
    const layout = registerTrace(defaultLayout(), "t1");
    expect(layout[0].traceIds).toContain("t1");
  });

  it("does not duplicate a trace already tracked", () => {
    const layout = registerTrace(registerTrace(defaultLayout(), "t1"), "t1");
    expect(layout[0].traceIds.filter((id) => id === "t1")).toHaveLength(1);
  });
});

describe("unregisterTrace", () => {
  it("removes a trace from its pane", () => {
    const layout = unregisterTrace(defaultLayout(["t1", "t2"]), "t1");
    expect(layout[0].traceIds).not.toContain("t1");
    expect(layout[0].traceIds).toContain("t2");
  });

  it("is a no-op for an unknown trace", () => {
    const layout = defaultLayout(["t1"]);
    expect(unregisterTrace(layout, "unknown")).toEqual(layout);
  });
});

// ---------------------------------------------------------------------------
// reconcileLayout
// ---------------------------------------------------------------------------
describe("reconcileLayout", () => {
  it("adds newly available traces to pane 0", () => {
    const layout = reconcileLayout(defaultLayout(), ["t1", "t2"]);
    expect(layout[0].traceIds).toContain("t1");
    expect(layout[0].traceIds).toContain("t2");
  });

  it("removes obsolete traces", () => {
    let layout = defaultLayout(["t1", "t2"]);
    layout = reconcileLayout(layout, ["t1"]);
    expect(layout[0].traceIds).not.toContain("t2");
    expect(layout[0].traceIds).toContain("t1");
  });

  it("preserves per-pane assignments for surviving traces", () => {
    let layout = defaultLayout(["t1", "t2"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t2", 1);
    layout = reconcileLayout(layout, ["t1", "t2", "t3"]);
    expect(paneIndexOf(layout, "t2")).toBe(1);
    expect(paneIndexOf(layout, "t3")).toBe(0); // new trace goes to pane 0
    expect(isValidLayout(layout)).toBe(true);
  });

  it("always leaves at least one pane", () => {
    const layout = reconcileLayout(defaultLayout(["t1"]), []);
    expect(layout.length).toBeGreaterThanOrEqual(1);
    expect(isValidLayout(layout)).toBe(true);
  });

  it("does not duplicate traces", () => {
    let layout = defaultLayout(["t1"]);
    layout = reconcileLayout(layout, ["t1", "t2"]);
    const all = allTraceIds(layout);
    const unique = new Set(all);
    expect(all.length).toBe(unique.size);
  });
});

// ---------------------------------------------------------------------------
// isValidLayout
// ---------------------------------------------------------------------------
describe("isValidLayout", () => {
  it("rejects an empty layout", () => {
    expect(isValidLayout([])).toBe(false);
  });

  it("rejects a layout with duplicate trace ids across panes", () => {
    const bad = [
      { id: "p0", traceIds: ["t1"] },
      { id: "p1", traceIds: ["t1"] },
    ];
    expect(isValidLayout(bad)).toBe(false);
  });

  it("accepts a well-formed layout", () => {
    expect(isValidLayout(defaultLayout(["t1", "t2"]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allTraceIds / paneIndexOf
// ---------------------------------------------------------------------------
describe("allTraceIds", () => {
  it("returns ids in pane order then insertion order", () => {
    let layout = defaultLayout(["t1"]);
    layout = addPane(layout);
    layout = registerTrace(layout, "t2");
    layout = moveTrace(layout, "t2", 1);
    expect(allTraceIds(layout)).toEqual(["t1", "t2"]);
  });
});

describe("paneIndexOf", () => {
  it("returns the correct pane index", () => {
    let layout = defaultLayout(["t1"]);
    layout = addPane(layout);
    layout = moveTrace(layout, "t1", 1);
    expect(paneIndexOf(layout, "t1")).toBe(1);
  });

  it("returns -1 for an untracked id", () => {
    expect(paneIndexOf(defaultLayout(), "missing")).toBe(-1);
  });
});
