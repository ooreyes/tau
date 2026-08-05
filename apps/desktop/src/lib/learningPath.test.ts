import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_SUCCESS_DIRECTIVE,
  FIRST_SUCCESS_EXAMPLE_ID,
  FIRST_SUCCESS_FILENAME,
  LEARNING_PATH_KEY,
  LEARNING_PATH_KIND,
  contextualHelpFor,
  defaultLearningPathState,
  dismissLearningPath,
  firstSuccessExampleDocument,
  firstSuccessExampleMeta,
  isLearningPathActive,
  loadLearningPathState,
  markLearningPathComplete,
  parseLearningPathState,
  recordLearningPathSimulationOutcome,
  shouldOfferLearningPath,
  shouldShowLearningPathCoach,
  startLearningPath,
} from "./learningPath";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: () => null,
    get length() { return memory.size; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseLearningPathState", () => {
  it("returns the default envelope for garbage input", () => {
    expect(parseLearningPathState(null)).toEqual(defaultLearningPathState());
    expect(parseLearningPathState("nope")).toEqual(defaultLearningPathState());
    expect(parseLearningPathState({ kind: "other.v1", status: "completed" }).status).toBe("pending");
  });

  it("accepts a versioned envelope", () => {
    expect(parseLearningPathState({
      kind: LEARNING_PATH_KIND,
      version: 1,
      status: "in_progress",
      exampleId: FIRST_SUCCESS_EXAMPLE_ID,
      startedAt: 100,
      completedAt: null,
      dismissedAt: null,
    })).toEqual({
      kind: LEARNING_PATH_KIND,
      version: 1,
      status: "in_progress",
      exampleId: FIRST_SUCCESS_EXAMPLE_ID,
      startedAt: 100,
      completedAt: null,
      dismissedAt: null,
    });
  });
});

describe("start / dismiss / complete", () => {
  it("persists in_progress and offers the path until dismissed or completed", () => {
    expect(shouldOfferLearningPath(loadLearningPathState())).toBe(true);
    const started = startLearningPath(1_700_000_000_000);
    expect(started.status).toBe("in_progress");
    expect(isLearningPathActive(started)).toBe(true);
    expect(JSON.parse(memory.get(LEARNING_PATH_KEY)!).status).toBe("in_progress");
    expect(shouldOfferLearningPath(started)).toBe(true);
    expect(shouldShowLearningPathCoach(started)).toBe(true);
  });

  it("dismisses forever without claiming success", () => {
    startLearningPath(10);
    const dismissed = dismissLearningPath(20);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedAt).toBe(20);
    expect(shouldOfferLearningPath(dismissed)).toBe(false);
    expect(shouldShowLearningPathCoach(dismissed)).toBe(false);
    expect(contextualHelpFor(dismissed, "empty")).toBeNull();
  });

  it("completes only from an ok simulation while in_progress", () => {
    startLearningPath(10);
    expect(recordLearningPathSimulationOutcome({ ok: false }).status).toBe("in_progress");
    const done = recordLearningPathSimulationOutcome({ ok: true });
    expect(done.status).toBe("completed");
    expect(done.completedAt).toEqual(expect.any(Number));
    expect(shouldOfferLearningPath(done)).toBe(false);
    expect(shouldShowLearningPathCoach(done)).toBe(true);
    // Further errors never reopen or regress.
    expect(recordLearningPathSimulationOutcome({ ok: false }).status).toBe("completed");
  });

  it("does not complete from pending without start", () => {
    expect(recordLearningPathSimulationOutcome({ ok: true }).status).toBe("pending");
  });

  it("does not reopen a dismissed path on success", () => {
    dismissLearningPath(1);
    expect(markLearningPathComplete(2).status).toBe("dismissed");
    expect(startLearningPath(3).status).toBe("dismissed");
  });
});

describe("firstSuccessExampleDocument", () => {
  it("builds the RC flagship with an authored .tran", () => {
    const meta = firstSuccessExampleMeta();
    expect(meta.id).toBe(FIRST_SUCCESS_EXAMPLE_ID);
    expect(meta.filename).toBe(FIRST_SUCCESS_FILENAME);
    expect(meta.name).toMatch(/RC/i);

    const doc = firstSuccessExampleDocument();
    expect(doc.directives).toEqual([FIRST_SUCCESS_DIRECTIVE]);
    expect(doc.components.some((c) => c.kind === "vsource")).toBe(true);
    expect(doc.components.some((c) => c.kind === "resistor")).toBe(true);
    expect(doc.components.some((c) => c.kind === "capacitor")).toBe(true);
    expect(doc.wires.length).toBeGreaterThan(0);
  });
});

describe("contextualHelpFor", () => {
  it("returns welcome tip on empty pending canvas", () => {
    const tip = contextualHelpFor(defaultLearningPathState(), "empty");
    expect(tip?.id).toBe("welcome");
    expect(tip?.shortcuts).toContain("Try RC Charging");
  });

  it("returns press-run tip when the example is loaded", () => {
    const tip = contextualHelpFor(
      { ...defaultLearningPathState(), status: "in_progress" },
      "example_ready",
    );
    expect(tip?.id).toBe("press-run");
    expect(tip?.body).toMatch(/Run/i);
  });

  it("returns success tip after completion regardless of ui context", () => {
    const tip = contextualHelpFor(
      { ...defaultLearningPathState(), status: "completed", completedAt: 1 },
      "empty",
    );
    expect(tip?.id).toBe("first-success");
  });
});
