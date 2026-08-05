import { describe, it, expect } from "vitest";
import { seriesToCsv, stepFamilyToCsv, spectrumToCsv } from "./waveformCsv";

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

describe("stepFamilyToCsv", () => {
  it("keeps independent per-member time grids in long format", () => {
    const csv = stepFamilyToCsv("V(out)", [
      { label: "R=1k", times: [0, 1e-3], values: [0, 1] },
      { label: "R=2k", times: [0, 2e-3, 4e-3], values: [0, 0.5, 1] },
    ]);
    expect(csv).toBe(
      [
        "step,time,V(out)",
        "R=1k,0,0",
        "R=1k,0.001,1",
        "R=2k,0,0",
        "R=2k,0.002,0.5",
        "R=2k,0.004,1",
      ].join("\n"),
    );
  });

  it("quotes step/signal labels with commas and blanks non-finite samples", () => {
    const csv = stepFamilyToCsv("V(a,b)", [
      { label: "R=1,2", times: [0, 1], values: [NaN, 2] },
    ]);
    expect(csv).toBe(['step,time,"V(a,b)"', '"R=1,2",0,', '"R=1,2",1,2'].join("\n"));
  });

  it("emits header only for an empty family", () => {
    expect(stepFamilyToCsv("V(out)", [])).toBe("step,time,V(out)");
  });

  it("pads trailing times when values are shorter than the time grid", () => {
    const csv = stepFamilyToCsv("I(R1)", [
      { label: "V1=5", times: [0, 1, 2], values: [0.1] },
    ]);
    expect(csv).toBe(["step,time,I(R1)", "V1=5,0,0.1", "V1=5,1,", "V1=5,2,"].join("\n"));
  });
});

describe("spectrumToCsv", () => {
  it("exports freq + linear magnitude + dB columns for an FFT spectrum", () => {
    const csv = spectrumToCsv(
      {
        frequencies: [0, 1000, 2000],
        magnitude: [0.1, 1, 0.5],
        magnitudeDb: [-20, 0, -6.0206],
      },
      "V(out)",
    );
    expect(csv).toBe(
      [
        "freq_Hz,V(out),V(out)_dB",
        "0,0.1,-20",
        "1000,1,0",
        "2000,0.5,-6.0206",
      ].join("\n"),
    );
  });

  it("quotes signal labels with commas and defaults the label when blank", () => {
    const csv = spectrumToCsv(
      { frequencies: [0], magnitude: [1], magnitudeDb: [0] },
      "V(a,b)",
    );
    expect(csv.split("\n")[0]).toBe('freq_Hz,"V(a,b)","V(a,b)_dB"');
    expect(spectrumToCsv({ frequencies: [], magnitude: [], magnitudeDb: [] }, "  ").split("\n")[0]).toBe(
      "freq_Hz,magnitude,magnitude_dB",
    );
  });
});
