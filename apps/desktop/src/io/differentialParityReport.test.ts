import { describe, expect, it } from "vitest";
import {
  formatDifferentialParityReport,
  summarizeDifferentialParity,
  type DifferentialCell,
} from "./differentialParityReport";

describe("differentialParityReport", () => {
  const cells: DifferentialCell[] = [
    {
      analysis: "tran",
      circuit: "rc",
      topology: "RC low-pass",
      status: "sibling",
      note: "waveformParity.corpus.ts",
    },
    {
      analysis: "ac",
      circuit: "rc",
      topology: "RC low-pass",
      status: "pass",
      note: "mag V(out) nRms<=1%",
    },
    {
      analysis: "step",
      circuit: "any",
      topology: "stepped family",
      status: "gap",
      note: "no LTspice differential matrix yet",
    },
  ];

  it("counts pass / sibling / gap without treating gaps as passes", () => {
    const summary = summarizeDifferentialParity(cells);
    expect(summary).toEqual(expect.objectContaining({ pass: 1, sibling: 1, gap: 1 }));
    expect(summary.byAnalysis.ac.pass).toBe(1);
    expect(summary.byAnalysis.step.gap).toBe(1);
  });

  it("prints an explicit GAPS section for script stdout", () => {
    const text = formatDifferentialParityReport({
      generatedAt: "2026-08-04T00:00:00Z",
      cells,
    });
    expect(text).toContain("DIFFERENTIAL PARITY");
    expect(text).toContain("SUMMARY pass=1 sibling=1 gap=1");
    expect(text).toMatch(/GAPS \(explicit\):[\s\S]*step\/any/);
    expect(text).not.toMatch(/SUMMARY[^\n]*pass=3/);
  });
});
