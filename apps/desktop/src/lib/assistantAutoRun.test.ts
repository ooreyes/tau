import { describe, expect, it } from "vitest";

import { pickAutoRunAnalysis } from "./assistantAutoRun";

describe("pickAutoRunAnalysis", () => {
  it("returns null when there are no directives", () => {
    expect(pickAutoRunAnalysis([])).toBeNull();
  });

  it("returns null when no directive requests a runnable analysis", () => {
    expect(pickAutoRunAnalysis([".param x=1", ".temp 25", "* a comment"])).toBeNull();
  });

  it("picks a lone .tran directive", () => {
    expect(pickAutoRunAnalysis([".param x=1", ".tran 10m"])).toEqual({
      kind: "tran",
      directive: ".tran 10m",
    });
  });

  it("picks a lone .ac directive", () => {
    expect(pickAutoRunAnalysis([".ac dec 10 1 1meg"])).toEqual({
      kind: "ac",
      directive: ".ac dec 10 1 1meg",
    });
  });

  it("picks a lone .dc directive", () => {
    expect(pickAutoRunAnalysis([".dc V1 0 5 1"])).toEqual({
      kind: "dc",
      directive: ".dc V1 0 5 1",
    });
  });

  it("picks a lone .tf directive", () => {
    expect(pickAutoRunAnalysis([".tf V(out) V1"])).toEqual({
      kind: "tf",
      directive: ".tf V(out) V1",
    });
  });

  it("picks a lone .noise directive", () => {
    expect(pickAutoRunAnalysis([".noise V(out) V1 dec 10 1 1meg"])).toEqual({
      kind: "noise",
      directive: ".noise V(out) V1 dec 10 1 1meg",
    });
  });

  it("first recognized analysis directive wins, regardless of which kind", () => {
    expect(pickAutoRunAnalysis([".ac dec 10 1 1meg", ".tran 5m"])).toEqual({
      kind: "ac",
      directive: ".ac dec 10 1 1meg",
    });
    expect(pickAutoRunAnalysis([".tran 5m", ".ac dec 10 1 1meg"])).toEqual({
      kind: "tran",
      directive: ".tran 5m",
    });
  });

  it("skips a malformed directive and falls through to a later, different-kind directive", () => {
    // `.tran` with no numeric body doesn't parse, so it's not "recognized" -
    // the scan continues past it instead of stalling on the first keyword match.
    expect(pickAutoRunAnalysis([".tran", ".dc V1 0 5 1"])).toEqual({
      kind: "dc",
      directive: ".dc V1 0 5 1",
    });
  });

  it("tolerates surrounding whitespace and is case-insensitive on the keyword", () => {
    // `directives` entries never carry the ASC "!" marker - ascImport strips it -
    // but stray whitespace and LTspice's case-insensitive keywords still apply.
    expect(pickAutoRunAnalysis(["  .TRAN 10m  "])).toEqual({
      kind: "tran",
      directive: ".TRAN 10m",
    });
  });

  it("does not treat unrelated directives sharing a prefix as a match", () => {
    // `.four` starts with none of the runnable keywords and must not misfire.
    expect(pickAutoRunAnalysis([".four 1k"])).toBeNull();
  });

  it("auto-runs an operating point for .op even though analysesFromDirectives does not model it", () => {
    expect(pickAutoRunAnalysis([".four 1k", ".op"])).toEqual({ kind: "op", directive: ".op" });
    // Document order still wins across kinds.
    expect(pickAutoRunAnalysis([".op", ".tran 10m"])).toEqual({ kind: "op", directive: ".op" });
    // `.option`/`.options` must not be mistaken for an operating point.
    expect(pickAutoRunAnalysis([".options plotwinsize=0"])).toBeNull();
  });
});
