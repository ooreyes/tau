import { describe, it, expect } from "vitest";
import { seriesToCsv } from "./waveformCsv";

describe("seriesToCsv", () => {
  it("writes a header row plus one row per axis sample", () => {
    const csv = seriesToCsv("time", [0, 1, 2], [
      { label: "V(out)", values: [0, 0.5, 1] },
      { label: "V(in)", values: [0, 1, 2] },
    ]);
    expect(csv).toBe(["time,V(out),V(in)", "0,0,0", "1,0.5,1", "2,1,2"].join("\n"));
  });

  it("writes empty cells for missing or non-finite samples", () => {
    const csv = seriesToCsv("freq", [1, 10], [
      { label: "a", values: [NaN, 5] }, // NaN → gap
      { label: "b", values: [3] },      // short series → gap on row 2
    ]);
    expect(csv).toBe(["freq,a,b", "1,,3", "10,5,"].join("\n"));
  });

  it("quotes header cells containing commas or quotes (RFC 4180)", () => {
    const csv = seriesToCsv("x", [1], [
      { label: "V(a,b)", values: [2] },
      { label: 'q"uote', values: [3] },
    ]);
    expect(csv.split("\n")[0]).toBe('x,"V(a,b)","q""uote"');
  });

  it("handles an empty axis (header only)", () => {
    expect(seriesToCsv("time", [], [{ label: "V(out)", values: [] }])).toBe("time,V(out)");
  });
});
