/**
 * AGENTS.md Definition of Done — Waveform viewer box.
 *
 * Asserts each required bullet end-to-end against the shipped pure APIs
 * (and PNG raster helper) that SimulationPanel wires. Re-run via:
 *   scripts/waveform-viewer-dod.sh
 *
 * Evidence lineage on auto/ltspice-parity (ancestors of tip at proof time):
 *   expressions — plotExpression.ts + AC/DC/STEP evaluators
 *   cursors — cursors.ts + CursorView / FFT / Bode / step-family wiring
 *   FFT/THD — fft.ts spectrumThd (50% harmonic fixture)
 *   stepped-family overlays — stepAnalysisFamily acFamilyOverlaySeries
 *   CSV/image — waveformCsv.ts + plotPng waveformSvgsToPng
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorReadout } from "./cursors";
import { spectrumThd, waveformSpectrum } from "./fft";
import { evaluatePlotExpression } from "./plotExpression";
import { waveformSvgsToPng } from "./plotPng";
import { acFamilyOverlaySeries } from "./stepAnalysisFamily";
import type { AnalysisResult } from "./linearTransient";
import type { AcResult } from "./acSweep";
import type { AnalysisFamily } from "./stepAnalysisFamily";
import {
  seriesToCsv,
  spectrumToCsv,
  stepFamilyToCsv,
  cursorReadoutToCsv,
} from "./waveformCsv";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function transientFixture(): AnalysisResult {
  return {
    ok: true,
    title: "dod-waveform",
    times: [0, 1e-3, 2e-3],
    traces: [
      { id: "in", label: "V(in)", unit: "V", color: "#f00", values: [1, 2, 3] },
      { id: "out", label: "V(out)", unit: "V", color: "#0f0", values: [0.5, 1, 1.5] },
    ],
    currents: [{ ref: "R1", label: "I(R1)", values: [10, 20, 30] }],
    stats: { netCount: 2, componentCount: 2, sampleCount: 3, stopTime: 2e-3, stepSize: 1e-3 },
    warnings: [],
    circuit: undefined as never,
  };
}

describe("AGENTS.md Waveform viewer DoD", () => {
  it("arbitrary expressions: V(out)-V(in) and V(out)*I(R1) overlay traces", () => {
    const diff = evaluatePlotExpression("V(out)-V(in)", transientFixture(), "#abc");
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.trace.values).toEqual([-0.5, -1, -1.5]);

    const power = evaluatePlotExpression("V(out)*I(R1)", transientFixture(), "#abc");
    expect(power.ok).toBe(true);
    if (!power.ok) return;
    expect(power.trace.values).toEqual([5, 20, 45]);
  });

  it("cursors: two markers yield Δt and per-signal delta/slope", () => {
    const axis = [0, 1e-3, 2e-3];
    const readout = cursorReadout(
      axis,
      [{ label: "V(out)", unit: "V", values: [0, 1, 2] }],
      0,
      2e-3,
    );
    expect(readout.dx).toBeCloseTo(2e-3, 12);
    expect(readout.traces[0]!.y1).toBe(0);
    expect(readout.traces[0]!.y2).toBe(2);
    expect(readout.traces[0]!.dy).toBe(2);
    expect(readout.traces[0]!.slope).toBeCloseTo(1000, 6);
    const csv = cursorReadoutToCsv(readout);
    expect(csv.split("\n")[0]).toBe("signal,unit,c1,c2,delta,slope");
    expect(csv).toMatch(/V\(out\)/);
  });

  it("FFT/THD: spectrum + THD = 50% for fund + half-amp 2nd harmonic", () => {
    // Exact-bin rectangular fixture (same contract as fft.test.ts spectrumThd).
    const n = 256;
    const duration = 1;
    const cycles = 8;
    const f = cycles / duration;
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      times.push(t);
      values.push(Math.cos(2 * Math.PI * f * t) + 0.5 * Math.cos(2 * Math.PI * 2 * f * t));
    }
    const spectrum = waveformSpectrum(times, values, {
      window: "rectangular",
      points: n,
      tStart: 0,
      tEnd: duration,
    });
    const thd = spectrumThd(spectrum);
    expect(thd.thd).toBeCloseTo(0.5, 3);
    expect(spectrumToCsv(spectrum, "V(out)").split("\n")[0]).toBe(
      "freq_Hz,V(out),V(out)_dB",
    );
  });

  it("stepped-family overlays: AC .step members share one signal curve family", () => {
    const freqs = [10, 100, 1000];
    const member = (label: string, magDb: number[]): AnalysisFamily<AcResult>["members"][number] => ({
      label,
      value: 0,
      result: {
        ok: true,
        freqs,
        traces: [{ id: "out", label: "V(out)", magDb, phaseDeg: [0, -45, -90] }],
        warnings: [],
      },
    });
    const family: AnalysisFamily<AcResult> = {
      ok: true,
      members: [member("R=1k", [0, -3, -20]), member("R=2k", [0, -6, -26])],
      warnings: [],
    };
    const overlay = acFamilyOverlaySeries(family);
    expect(overlay).not.toBeNull();
    expect(overlay!.signal).toBe("V(out)");
    expect(overlay!.series).toHaveLength(2);
    expect(overlay!.series[0]!.magDb).toEqual([0, -3, -20]);
    expect(overlay!.series[1]!.magDb).toEqual([0, -6, -26]);
  });

  it("CSV export: transient series + step-family long format", () => {
    const series = seriesToCsv("time", [0, 1e-3], [
      { label: "V(out)", values: [1, 0.5] },
      { label: "I(R1)", values: [0.001, 0.0005] },
    ]);
    expect(series.split("\n")[0]).toBe("time,V(out),I(R1)");
    expect(series).toContain("0.001,0.5,0.0005");

    const stepCsv = stepFamilyToCsv("V(out)", [
      { label: "R=1k", times: [0, 1], values: [1, 0.5] },
      { label: "R=2k", times: [0, 1], values: [1, 0.25] },
    ]);
    expect(stepCsv.split("\n")[0]).toBe("step,time,V(out)");
    expect(stepCsv).toMatch(/R=1k/);
    expect(stepCsv).toMatch(/R=2k/);
  });

  it("image export: waveformSvgsToPng rasters visible SVG panes", async () => {
    const drawImage = vi.fn();
    const context = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:waveform-dod"),
      revokeObjectURL: vi.fn(),
    });
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", LoadedImage);

    const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    element.setAttribute("viewBox", "0 0 340 210");
    document.body.append(element);
    const blob = await waveformSvgsToPng([element]);
    expect(blob.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalled();
  });
});
