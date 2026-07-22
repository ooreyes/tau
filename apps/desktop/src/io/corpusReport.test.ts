import { describe, it, expect } from "vitest";
import { summarizeCorpus, ngspiceOpSucceeded, formatCorpusReport, type CorpusRow } from "./corpusReport";

const row = (over: Partial<CorpusRow>): CorpusRow => ({
  file: "a.asc",
  imported: true,
  warnings: 0,
  deckBuilt: true,
  opConverged: true,
  validated: true,
  ...over,
});

describe("summarizeCorpus", () => {
  it("counts each stage independently (hand-computed)", () => {
    const rows: CorpusRow[] = [
      row({ file: "clean.asc" }), // clean all the way
      row({ file: "warned.asc", warnings: 2 }), // imports, but not warning-clean
      row({ file: "nodeck.asc", warnings: 0, deckBuilt: false, opConverged: false, error: "no ground" }),
      row({ file: "noimport.asc", imported: false, warnings: 0, deckBuilt: false, opConverged: false }),
      row({ file: "noconv.asc", opConverged: false, error: "singular matrix" }),
    ];
    expect(summarizeCorpus(rows)).toEqual({
      total: 5,
      imported: 4,
      warningClean: 3,
      deckBuilt: 3,
      opConverged: 2,
      validated: 4,
    });
  });

  it("a failed import is never warning-clean, even with zero warnings", () => {
    const s = summarizeCorpus([row({ imported: false, warnings: 0, deckBuilt: false, opConverged: false })]);
    expect(s.warningClean).toBe(0);
  });

  it("a failed import is never counted as validated, even when validated is true", () => {
    const s = summarizeCorpus([row({ imported: false, validated: true })]);
    expect(s.validated).toBe(0);
  });

  it("a validateSchematicDocument failure on an imported file is not validated", () => {
    const s = summarizeCorpus([row({ imported: true, validated: false })]);
    expect(s.validated).toBe(0);
  });

  it("handles an empty corpus", () => {
    expect(summarizeCorpus([])).toEqual({
      total: 0,
      imported: 0,
      warningClean: 0,
      deckBuilt: 0,
      opConverged: 0,
      validated: 0,
    });
  });
});

describe("ngspiceOpSucceeded", () => {
  it("accepts a normal batch op solution", () => {
    const out = "Circuit: tau generated circuit\nNo. of Data Rows : 1\nv(out) = 5.0";
    expect(ngspiceOpSucceeded(out, 0)).toBe(true);
  });

  it("rejects aborted / singular / no-convergence runs even with exit 0", () => {
    expect(ngspiceOpSucceeded("singular matrix:  check nodes\nsimulation(s) aborted", 0)).toBe(false);
    expect(ngspiceOpSucceeded("No convergence in DC analysis\nsimulation(s) aborted", 0)).toBe(false);
    expect(ngspiceOpSucceeded("Fatal error: unknown device", 0)).toBe(false);
  });

  it("rejects nonzero exit, timeout kill (null status), and empty output", () => {
    expect(ngspiceOpSucceeded("No. of Data Rows : 1", 1)).toBe(false);
    expect(ngspiceOpSucceeded("No. of Data Rows : 1", null)).toBe(false);
    expect(ngspiceOpSucceeded("", 0)).toBe(false);
  });

  it("is case-insensitive on markers", () => {
    expect(ngspiceOpSucceeded("NO. OF DATA ROWS : 1", 0)).toBe(true);
    expect(ngspiceOpSucceeded("Singular Matrix!\nNo. of Data Rows : 1", 0)).toBe(false);
  });
});

describe("formatCorpusReport", () => {
  it("prints one line per file plus the summary counts", () => {
    const text = formatCorpusReport([
      row({ file: "ok.asc" }),
      row({ file: "bad.asc", opConverged: false, error: "singular matrix" }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toContain("file");
    expect(lines[1]).toContain("ok.asc");
    expect(lines[2]).toContain("bad.asc");
    expect(lines[2]).toContain("singular matrix");
    expect(text).toContain("total 2 · imported 2 · warning-clean 2 · deck-built 2 · op-converged 1");
  });
});
