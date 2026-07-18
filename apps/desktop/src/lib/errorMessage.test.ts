import { describe, expect, it } from "vitest";
import { technicalErrorDetails, userFacingErrorMessage } from "./errorMessage";

describe("userFacingErrorMessage", () => {
  it("preserves bounded Error and Tauri string diagnostics", () => {
    expect(userFacingErrorMessage(new Error("singular matrix at node out"), "fallback")).toBe("singular matrix at node out");
    expect(userFacingErrorMessage("ngspice parser rejected line 12", "fallback")).toBe("ngspice parser rejected line 12");
  });

  it("collapses native transcripts into actionable product copy", () => {
    const raw = "ngspice rejected the circuit: stdout Circuit: tau | stderr Warning: IC on non-existent node - out | stderr Error: .ic syntax error";
    expect(userFacingErrorMessage(raw, "Could not run this simulation.")).toBe(
      "An initial-condition directive is invalid or refers to a part that is no longer in the circuit.",
    );
    expect(technicalErrorDetails(raw)).toContain("stderr Error: .ic syntax error");
  });

  it("falls back for non-text failures and bounds hostile payloads", () => {
    expect(userFacingErrorMessage({ secret: "nope" }, "safe fallback")).toBe("safe fallback");
    const result = userFacingErrorMessage(`bad\0${"x".repeat(5_000)}`, "fallback");
    expect(result).not.toContain("\0");
    expect(result.length).toBe(240);
    expect(technicalErrorDetails("x".repeat(5_000))?.length).toBe(4_000);
  });
});
