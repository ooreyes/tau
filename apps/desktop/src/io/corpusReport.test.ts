import { describe, it, expect } from "vitest";
import {
  summarizeCorpus,
  ngspiceOpSucceeded,
  formatCorpusReport,
  classifyCorpusCapability,
  summarizeCorpusCapability,
  formatCorpusCapabilitySummary,
  type CorpusRow,
} from "./corpusReport";

const row = (over: Partial<CorpusRow>): CorpusRow => ({
  file: "a.asc",
  imported: true,
  warnings: 0,
  deckBuilt: true,
  opConverged: true,
  validated: true,
  modelSubstitutions: 0,
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
      modelSubstitutions: 0,
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
      modelSubstitutions: 0,
    });
  });
});

describe("classifyCorpusCapability", () => {
  it("marks a full success", () => {
    expect(classifyCorpusCapability(row({}))).toBe("success");
  });

  it("treats unresolvedSubckts as a capability refusal even without matching prose", () => {
    expect(classifyCorpusCapability(row({
      deckBuilt: false,
      opConverged: false,
      unresolvedSubckts: ["LT1184F"],
      error: "deck: something else entirely",
    }))).toBe("capability_refusal");
  });

  it("classifies product-copy deck refusals as capability_refusal", () => {
    expect(classifyCorpusCapability(row({
      deckBuilt: false,
      opConverged: false,
      error: "deck: Simulation refused: NIGBT is LTspice-only.",
    }))).toBe("capability_refusal");
    expect(classifyCorpusCapability(row({
      deckBuilt: false,
      opConverged: false,
      error: 'deck: No imported library defines the subcircuit "LT1001". Attach the vendor model file.',
    }))).toBe("capability_refusal");
  });

  it("classifies unknown-subckt OP deaths as deck_guard_leak, not success-by-wording", () => {
    expect(classifyCorpusCapability(row({
      opConverged: false,
      error: "op: Error: unknown subckt: lt1184f",
    }))).toBe("deck_guard_leak");
  });

  it("classifies real OP misses and unexpected deck throws as failure", () => {
    expect(classifyCorpusCapability(row({
      opConverged: false,
      error: "op: singular matrix: check nodes",
    }))).toBe("failure");
    expect(classifyCorpusCapability(row({
      deckBuilt: false,
      opConverged: false,
      error: "deck: Add a ground symbol before simulating.",
    }))).toBe("failure");
    expect(classifyCorpusCapability(row({
      imported: false,
      deckBuilt: false,
      opConverged: false,
      error: "import: bad bytes",
    }))).toBe("failure");
  });

  it("summarizes buckets without a zero-hard-failure fiction", () => {
    const rows = [
      row({ file: "ok.asc" }),
      row({
        file: "refused.asc",
        deckBuilt: false,
        opConverged: false,
        unresolvedSubckts: ["Missing"],
        error: 'deck: No imported library defines the subcircuit "Missing".',
      }),
      row({
        file: "leak.asc",
        opConverged: false,
        error: "op: unknown subckt: foo",
      }),
      row({
        file: "singular.asc",
        opConverged: false,
        error: "op: singular matrix",
      }),
    ];
    expect(summarizeCorpusCapability(rows)).toEqual({
      success: 1,
      capability_refusal: 1,
      deck_guard_leak: 1,
      failure: 1,
    });
    expect(formatCorpusCapabilitySummary(summarizeCorpusCapability(rows))).toBe(
      "success 1 · capability-refusal 1 · deck-guard-leak 1 · failure 1",
    );
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
    expect(text).toContain("model-substitutions 0");
  });

  it("prints any model substitution as a release-visible count", () => {
    expect(formatCorpusReport([row({ modelSubstitutions: 2 })])).toContain("model-substitutions 2");
  });
});
