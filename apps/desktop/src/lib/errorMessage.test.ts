import { describe, expect, it } from "vitest";
import { userFacingErrorMessage } from "./errorMessage";

describe("userFacingErrorMessage", () => {
  it("preserves bounded Error and Tauri string diagnostics", () => {
    expect(userFacingErrorMessage(new Error("singular matrix at node out"), "fallback")).toBe("singular matrix at node out");
    expect(userFacingErrorMessage("ngspice parser rejected line 12", "fallback")).toBe("ngspice parser rejected line 12");
  });

  it("falls back for non-text failures and bounds hostile payloads", () => {
    expect(userFacingErrorMessage({ secret: "nope" }, "safe fallback")).toBe("safe fallback");
    const result = userFacingErrorMessage(`bad\0${"x".repeat(5_000)}`, "fallback");
    expect(result).not.toContain("\0");
    expect(result.length).toBe(2_000);
  });
});
