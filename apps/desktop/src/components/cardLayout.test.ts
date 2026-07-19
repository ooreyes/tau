import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDrop,
  cycleCardHeight,
  dropTargetFor,
  emptyCardLayout,
  loadCardLayout,
  reconcileCardLayout,
  saveCardLayout,
  toggleCardWidth,
  type CardSpec,
} from "./cardLayout";

// This jsdom build has localStorage disabled - install an in-memory Storage
// so the persistence path is actually exercised (mirrors panelResize.test.tsx).
const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, String(value)),
      removeItem: (key: string) => void backing.delete(key),
      clear: () => backing.clear(),
      key: (index: number) => [...backing.keys()][index] ?? null,
      get length() {
        return backing.size;
      },
    } as Storage,
  });
});
afterEach(() => backing.clear());

const plot = (id: string, title = id): CardSpec => ({ id: `plot:${id}`, kind: "plot", title });
const table = (id: "measurements" | "fourier"): CardSpec => ({ id, kind: "table", title: id });

describe("reconcileCardLayout - default widths", () => {
  it("gives a lone plot pane full width", () => {
    const next = reconcileCardLayout(emptyCardLayout(), [plot("out")]);
    expect(next.order).toEqual(["plot:out"]);
    expect(next.widths["plot:out"]).toBe("full");
    expect(next.heights["plot:out"]).toBe("M");
  });

  it("gives two-or-more plot panes half width so they tile two-up", () => {
    const next = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    expect(next.widths["plot:out"]).toBe("half");
    expect(next.widths["plot:in"]).toBe("half");
  });

  it("always gives a table full width, even alongside multiple plots", () => {
    const next = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in"), table("measurements")]);
    expect(next.widths.measurements).toBe("full");
    expect(next.heights.measurements).toBeUndefined(); // tables auto-height - no S/M/L
  });

  it("preserves a manual width/height choice across a rerun with the same cards", () => {
    const first = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const userChoice = toggleCardWidth(cycleCardHeight(first, "plot:out"), "plot:in");
    const rerun = reconcileCardLayout(userChoice, [plot("out"), plot("in")]);
    expect(rerun.heights["plot:out"]).toBe("L");
    expect(rerun.widths["plot:in"]).toBe("full");
  });

  it("drops stale ids and appends newly-available ones without disturbing existing order", () => {
    const first = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const reordered = applyDrop(first, "plot:out", { kind: "after", id: "plot:in" });
    const next = reconcileCardLayout(reordered, [plot("in"), plot("out"), plot("gate")]);
    expect(next.order).toEqual(["plot:in", "plot:out", "plot:gate"]);
  });

  it("keys plot cards by trace id, not pane index - surviving a pane-id regeneration", () => {
    // automaticLayout regenerates pane ids as `auto-p${index}` whenever the
    // signal set changes; a card keyed by trace id (not pane id) still finds
    // its saved prefs after the set reorders.
    const first = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const widened = toggleCardWidth(first, "plot:out"); // full
    // Same trace ids, different arrival order (as if a probe reorder changed
    // which pane index each trace landed in) - the id itself is unchanged.
    const next = reconcileCardLayout(widened, [plot("in"), plot("out")]);
    expect(next.widths["plot:out"]).toBe("full");
  });
});

describe("toggleCardWidth / cycleCardHeight", () => {
  it("flips half <-> full", () => {
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const toggled = toggleCardWidth(state, "plot:out");
    expect(toggled.widths["plot:out"]).toBe("full");
    expect(toggleCardWidth(toggled, "plot:out").widths["plot:out"]).toBe("half");
  });

  it("cycles S -> M -> L -> S", () => {
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out")]);
    const s1 = cycleCardHeight(state, "plot:out");
    const s2 = cycleCardHeight(s1, "plot:out");
    const s3 = cycleCardHeight(s2, "plot:out");
    expect([s1, s2, s3].map((s) => s.heights["plot:out"])).toEqual(["L", "S", "M"]);
  });
});

describe("dropTargetFor / applyDrop", () => {
  it("pairs into a half-slot when the hovered card is already half width", () => {
    const target = dropTargetFor({ id: "plot:in", width: "half" }, "start");
    expect(target).toEqual({ kind: "pair-before", id: "plot:in" });
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in"), plot("gate")]);
    // Order starts [out, in, gate]; dropping "gate" onto the start (left)
    // side of "in" lands it immediately before "in".
    const next = applyDrop(state, "plot:gate", target);
    expect(next.order).toEqual(["plot:out", "plot:gate", "plot:in"]);
    expect(next.widths["plot:gate"]).toBe("half");
    expect(next.widths["plot:in"]).toBe("half");
  });

  it("just reorders (no pairing) when the hovered card is full width", () => {
    const target = dropTargetFor({ id: "measurements", width: "full" }, "end");
    expect(target).toEqual({ kind: "after", id: "measurements" });
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), table("measurements")]);
    const originalWidth = state.widths["plot:out"];
    const next = applyDrop(state, "plot:out", target);
    expect(next.order).toEqual(["measurements", "plot:out"]);
    expect(next.widths["plot:out"]).toBe(originalWidth); // untouched by a plain reorder
  });

  it("is a no-op when a card is dropped onto itself", () => {
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const next = applyDrop(state, "plot:out", { kind: "after", id: "plot:out" });
    expect(next).toEqual(state);
  });

  it("appends at the end when the drop target no longer exists in order", () => {
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    const next = applyDrop(state, "plot:out", { kind: "after", id: "plot:ghost" });
    expect(next.order).toEqual(["plot:in", "plot:out"]);
  });
});

describe("loadCardLayout / saveCardLayout", () => {
  it("round-trips a saved layout", () => {
    const state = reconcileCardLayout(emptyCardLayout(), [plot("out"), plot("in")]);
    saveCardLayout("untitled.sim", state);
    expect(loadCardLayout("untitled.sim")).toEqual(state);
  });

  it("returns an empty layout when nothing is stored, and never throws on junk", () => {
    expect(loadCardLayout("nothing-here")).toEqual(emptyCardLayout());
    localStorage.setItem("tau.tranGrid.junk", "{not json");
    expect(loadCardLayout("junk")).toEqual(emptyCardLayout());
    localStorage.setItem("tau.tranGrid.wrong-shape", JSON.stringify({ order: "nope", widths: 5, heights: null }));
    expect(loadCardLayout("wrong-shape")).toEqual(emptyCardLayout());
  });

  it("keeps two circuit tabs' layouts independent", () => {
    const a = toggleCardWidth(reconcileCardLayout(emptyCardLayout(), [plot("out")]), "plot:out");
    const b = reconcileCardLayout(emptyCardLayout(), [plot("out")]);
    saveCardLayout("circuit-a.sim", a);
    saveCardLayout("circuit-b.sim", b);
    expect(loadCardLayout("circuit-a.sim").widths["plot:out"]).toBe("half");
    expect(loadCardLayout("circuit-b.sim").widths["plot:out"]).toBe("full");
  });
});
