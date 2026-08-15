// @vitest-environment jsdom
/**
 * The diagnostics traffic light's truth table (PDF-6 item 6).
 *
 * The report's rule is a rule about consequence, not about volume - "Red should
 * only be there if it wont run in simulator" - so the cases that matter most
 * here are the ones where a naive implementation would escalate: a pile of
 * warnings, and a warning that is somebody's twelfth. Each of those was checked
 * by making `diagnosticsHealth` return "error" on `warningCount > 0` and
 * confirming these go red.
 */
import { beforeEach, describe, expect, it } from "vitest";

// This jsdom build has localStorage disabled - the same guard every preference
// module relies on. Install an in-memory Storage so the persistence path is
// actually exercised rather than silently falling back to defaults and passing
// for the wrong reason (see lib/preferenceRegistry.test.ts:11-32).
const backing = new Map<string, string>();
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

import {
  DEFAULT_DIAGNOSTICS_PREFERENCES,
  diagnosticsHealth,
  diagnosticsHealthLabel,
  diagnosticsPreferences,
  diagnosticsSuppressedCount,
  diagnosticsVisibleCount,
  loadDiagnosticsSeverityPolicy,
  resetDiagnosticsPreferences,
  saveDiagnosticsSeverityPolicy,
  type DiagnosticsSeverityPolicy,
} from "./diagnosticsHealth";

beforeEach(() => {
  backing.clear();
  // The store caches in module scope, so clearing storage alone would leak a
  // policy set by an earlier test into the next one.
  resetDiagnosticsPreferences();
});

describe("diagnosticsHealth under the default policy", () => {
  it("is green with nothing to report", () => {
    expect(diagnosticsHealth({ errorCount: 0, warningCount: 0 })).toBe("ok");
    expect(diagnosticsVisibleCount({ errorCount: 0, warningCount: 0 })).toBe(0);
  });

  it("is yellow for one warning", () => {
    expect(diagnosticsHealth({ errorCount: 0, warningCount: 1 })).toBe("warning");
    expect(diagnosticsVisibleCount({ errorCount: 0, warningCount: 1 })).toBe(1);
  });

  it("many warnings and no error is yellow, never red", () => {
    const input = { errorCount: 0, warningCount: 17 };
    expect(diagnosticsHealth(input)).toBe("warning");
    expect(diagnosticsVisibleCount(input)).toBe(17);
  });

  it("is red as soon as one row stops the simulation", () => {
    expect(diagnosticsHealth({ errorCount: 1, warningCount: 0 })).toBe("error");
    expect(diagnosticsHealth({ errorCount: 1, warningCount: 9 })).toBe("error");
    expect(diagnosticsVisibleCount({ errorCount: 1, warningCount: 9 })).toBe(10);
  });

  it("is red for a failed run that printed no message", () => {
    // An engine can fail with an empty message. Counting error ROWS alone would
    // show green over a run that did not complete.
    expect(diagnosticsHealth({ errorCount: 0, warningCount: 0, hasError: true })).toBe("error");
    expect(diagnosticsHealth({ errorCount: 0, warningCount: 3, hasError: true })).toBe("error");
  });

  it("hides nothing", () => {
    expect(diagnosticsSuppressedCount({ errorCount: 1, warningCount: 4 })).toBe(0);
  });
});

describe("diagnosticsHealth under errors-only", () => {
  it("collapses warnings to green and stops counting them", () => {
    const input = { errorCount: 0, warningCount: 6 };
    expect(diagnosticsHealth(input, "errors-only")).toBe("ok");
    expect(diagnosticsVisibleCount(input, "errors-only")).toBe(0);
    // Green, but the app is still able to say what it is holding back.
    expect(diagnosticsSuppressedCount(input, "errors-only")).toBe(6);
  });

  it("never yellows, whatever the warning count", () => {
    for (const warningCount of [1, 2, 40]) {
      expect(diagnosticsHealth({ errorCount: 0, warningCount }, "errors-only")).toBe("ok");
    }
  });

  it("keeps the error red and counts only the errors", () => {
    const input = { errorCount: 2, warningCount: 11 };
    expect(diagnosticsHealth(input, "errors-only")).toBe("error");
    expect(diagnosticsVisibleCount(input, "errors-only")).toBe(2);
  });

  it("still reddens a failed run with no printable rows", () => {
    expect(diagnosticsHealth({ errorCount: 0, warningCount: 0, hasError: true }, "errors-only"))
      .toBe("error");
  });
});

describe("diagnosticsHealthLabel", () => {
  it("gives the three healths distinct names that do not rely on colour", () => {
    expect(diagnosticsHealthLabel("ok", 0)).toBe("Diagnostics: no problems");
    expect(diagnosticsHealthLabel("warning", 1))
      .toBe("Diagnostics: 1 warning, this circuit will still run");
    expect(diagnosticsHealthLabel("warning", 4))
      .toBe("Diagnostics: 4 warnings, this circuit will still run");
    expect(diagnosticsHealthLabel("error", 1))
      .toBe("Diagnostics: 1 problem, this circuit will not run");
    expect(diagnosticsHealthLabel("error", 3))
      .toBe("Diagnostics: 3 problems, this circuit will not run");
  });

  it("says a failed run will not run even with no countable rows", () => {
    expect(diagnosticsHealthLabel("error", 0)).toBe("Diagnostics: this circuit will not run");
  });
});

describe("the severity-policy preference", () => {
  it("defaults to showing warnings", () => {
    expect(DEFAULT_DIAGNOSTICS_PREFERENCES.severityPolicy).toBe("all");
    expect(loadDiagnosticsSeverityPolicy()).toBe("all");
  });

  it("persists the choice and reads it back", () => {
    saveDiagnosticsSeverityPolicy("errors-only");
    expect(loadDiagnosticsSeverityPolicy()).toBe("errors-only");
    expect(localStorage.getItem("tau.diagnostics.preferences.v1")).toContain("errors-only");
  });

  it("resets to warnings-shown, never to the quieter setting", () => {
    saveDiagnosticsSeverityPolicy("errors-only");
    resetDiagnosticsPreferences();
    expect(loadDiagnosticsSeverityPolicy()).toBe("all");
    expect(localStorage.getItem("tau.diagnostics.preferences.v1")).toBeNull();
  });

  it("coerces an unknown policy to showing warnings rather than to silence", () => {
    // Exercised through `save` because that is where the store runs the same
    // validator it uses on a blob read back from storage. The failure mode of a
    // bad value must be "you see too much", never "you silently see less".
    diagnosticsPreferences.save({ severityPolicy: "quiet" as DiagnosticsSeverityPolicy });
    expect(loadDiagnosticsSeverityPolicy()).toBe("all");
  });

  it("refuses a blob that is not an object and keeps the current policy", () => {
    saveDiagnosticsSeverityPolicy("errors-only");
    diagnosticsPreferences.save(null as never);
    expect(loadDiagnosticsSeverityPolicy()).toBe("errors-only");
  });
});
