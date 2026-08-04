import { describe, expect, it } from "vitest";
import { technicalErrorDetails, userFacingErrorMessage } from "./errorMessage";
import { unresolvedModelMessage, unresolvedSubcktMessage } from "../engine/spiceNetlist";

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

  it("masks JS-internal errors behind the plain-language fallback", () => {
    expect(userFacingErrorMessage(new TypeError("Cannot read properties of undefined (reading 'invoke')"), "Could not open this file.")).toBe("Could not open this file.");
    expect(userFacingErrorMessage("undefined is not an object (evaluating 'a.b')", "Save failed.")).toBe("Save failed.");
    expect(userFacingErrorMessage(new Error("x is not a function"), "Could not import .asc.")).toBe("Could not import .asc.");
    expect(userFacingErrorMessage("Failed to fetch", "Could not reach the local AI server.")).toBe("Could not reach the local AI server.");
    // The raw diagnostic stays available behind Technical details.
    expect(technicalErrorDetails(new TypeError("Cannot read properties of undefined (reading 'invoke')"))).toContain("invoke");
    // Legitimate product copy containing none of the signatures passes through.
    expect(userFacingErrorMessage(new Error("Add a ground symbol so node voltages have a reference."), "fallback")).toBe("Add a ground symbol so node voltages have a reference.");
  });

  it("surfaces the missing-subcircuit message verbatim (model-import guidance reaches the user)", () => {
    const message = unresolvedSubcktMessage(["LT1001"]);
    expect(userFacingErrorMessage(new Error(message), "ngspice could not run this simulation.")).toBe(message);
  });

  it("surfaces the missing-device-model refusal verbatim", () => {
    const message = unresolvedModelMessage([
      { ref: "M1", requested: "IRF540", substituted: "TAU_NMOS" },
    ]);
    expect(userFacingErrorMessage(new Error(message), "ngspice could not run this simulation.")).toBe(message);
  });

  it("falls back for non-text failures and bounds hostile payloads", () => {
    expect(userFacingErrorMessage({ secret: "nope" }, "safe fallback")).toBe("safe fallback");
    const result = userFacingErrorMessage(`bad\0${"x".repeat(5_000)}`, "fallback");
    expect(result).not.toContain("\0");
    expect(result.length).toBe(240);
    expect(technicalErrorDetails("x".repeat(5_000))?.length).toBe(4_000);
  });
});
