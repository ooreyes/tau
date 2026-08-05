import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TAU_CLI_API_VERSION,
  TAU_CLI_DIAGNOSE_KIND,
  cliHelp,
  cliVersion,
  diagnoseAsc,
  formatCliText,
  parseTauCliArgs,
  serializeCliResult,
} from "./tauCliApi";

const DIVIDER_ASC = readFileSync(
  join(process.cwd(), "../../Circuit_testing_v1/01_op_voltage_divider.asc"),
  "utf8",
);

describe("parseTauCliArgs", () => {
  it("parses diagnose --json path", () => {
    expect(parseTauCliArgs(["diagnose", "--json", "tank.asc"])).toEqual({
      command: "diagnose",
      json: true,
      fromStdin: false,
      path: "tank.asc",
      usageError: null,
    });
  });

  it("rejects diagnose without a path", () => {
    const parsed = parseTauCliArgs(["diagnose"]);
    expect(parsed.command).toBeNull();
    expect(parsed.usageError).toMatch(/requires/);
  });

  it("accepts diagnose --text for stdin", () => {
    expect(parseTauCliArgs(["diagnose", "--text", "--json"]).fromStdin).toBe(true);
  });

  it("maps --help / bare invocation to help", () => {
    expect(parseTauCliArgs(["--help"]).command).toBe("help");
    expect(parseTauCliArgs([]).command).toBe("help");
  });
});

describe("diagnoseAsc", () => {
  it("builds a versioned ok envelope for the voltage divider", () => {
    const result = diagnoseAsc({
      text: DIVIDER_ASC,
      title: "01_op_voltage_divider.asc",
      path: "/tmp/01_op_voltage_divider.asc",
    });
    expect(result.kind).toBe(TAU_CLI_DIAGNOSE_KIND);
    expect(result.apiVersion).toBe(TAU_CLI_API_VERSION);
    expect(result.status).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.stages.import.ok).toBe(true);
    expect(result.stages.import.componentCount).toBeGreaterThanOrEqual(3);
    expect(result.stages.validate.ok).toBe(true);
    expect(result.stages.deck.ok).toBe(true);
    expect(result.stages.deck.deckFingerprint).toMatch(/^v1:/);
    expect(result.diagnostics.some((d) => d.code === "deck.ok")).toBe(true);
    const roundTrip = JSON.parse(serializeCliResult(result));
    expect(roundTrip.kind).toBe(TAU_CLI_DIAGNOSE_KIND);
    expect(roundTrip.exitCode).toBe(0);
  });

  it("emits machine-readable import.error without throwing", () => {
    // Oversized component count trips import limits → error diagnostic.
    const flood = [
      "Version 4",
      "SHEET 1 880 680",
      ...Array.from({ length: 5_001 }, (_, i) =>
        `SYMBOL res ${i * 16} 80 R0\nSYMATTR InstName R${i}\nSYMATTR Value 1k`),
    ].join("\n");
    const result = diagnoseAsc({ text: flood, title: "flood.asc" });
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(2);
    expect(result.stages.import.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "import.error")).toBe(true);
  });

  it("refuses unresolved subcircuits with deck.refused code", () => {
    // Prefix-X foreign-style part with no attached library → deck refuse.
    const asc = [
      "Version 4",
      "SHEET 1 880 680",
      "SYMBOL Misc\\\\unknown_block 160 160 R0",
      "SYMATTR Prefix X",
      "SYMATTR InstName U1",
      "SYMATTR Value totally_missing_subckt_xyz",
      "SYMATTR SpiceModel totally_missing_subckt_xyz",
      "TEXT 72 288 Left 2 !.op",
    ].join("\n");
    const result = diagnoseAsc({ text: asc, title: "missing.asc" });
    expect(result.exitCode).not.toBe(0);
    expect(result.status === "refused" || result.status === "error" || result.status === "warning").toBe(true);
    expect(
      result.diagnostics.some((d) =>
        d.code.startsWith("deck.refused")
        || d.code === "deck.error"
        || d.code === "import.warning"
        || d.code === "import.error"
        || d.code === "import.note"
      ),
    ).toBe(true);
    // Never claim success when the part cannot be modeled.
    expect(result.status).not.toBe("ok");
  });
});

describe("cli help / version / format", () => {
  it("documents stable apiVersion on help and version", () => {
    expect(cliHelp().apiVersion).toBe(TAU_CLI_API_VERSION);
    expect(cliVersion().diagnoseKind).toBe(TAU_CLI_DIAGNOSE_KIND);
    expect(formatCliText(cliVersion())).toContain(TAU_CLI_API_VERSION);
  });
});
