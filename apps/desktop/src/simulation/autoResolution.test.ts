import { describe, expect, it } from "vitest";

import {
  autoTransientOptions,
  collectAutoResolutionInputs,
  suggestAcSweep,
  suggestTransientOptions,
} from "./autoResolution";
import { MAX_TRANSIENT_STEPS } from "./linearTransient";
import type { SchematicComponent } from "../schematic/types";

const part = (kind: SchematicComponent["kind"], value: string, label = ""): SchematicComponent => ({
  id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  x: 0,
  y: 0,
  rotation: 0,
  value,
  label,
});

describe("collectAutoResolutionInputs (§11 Unit C8)", () => {
  it("computes RC time constants against the geometric-mean resistance", () => {
    // R = 1k and 100k → R_typ = sqrt(1e3 · 1e5) = 10 kΩ; C = 1µ → τ = 10 ms.
    const inputs = collectAutoResolutionInputs([
      part("resistor", "1k", "R1"),
      part("resistor", "100k", "R2"),
      part("capacitor", "1u", "C1"),
    ]);
    expect(inputs.maxTauSeconds).toBeCloseTo(0.01, 6);
    expect(inputs.minTauSeconds).toBeCloseTo(0.01, 6);
    expect(inputs.maxSourceHz).toBe(0);
  });

  it("computes inductor time constants as L/R and tracks source frequency range", () => {
    // R_typ = 100 Ω; L = 10 mH → τ_L = 1e-4 s. Sources at 1 kHz and 50 Hz.
    const inputs = collectAutoResolutionInputs([
      part("resistor", "100", "R1"),
      part("inductor", "10m", "L1"),
      part("vac", "SINE(0 1 1k)", "V1"),
      part("vac", "SINE(0 1 50)", "V2"),
    ]);
    expect(inputs.maxTauSeconds).toBeCloseTo(1e-4, 9);
    expect(inputs.maxSourceHz).toBeCloseTo(1000, 6);
    expect(inputs.minSourceHz).toBeCloseTo(50, 6);
  });

  it("skips malformed values and IC= suffixes without throwing", () => {
    const inputs = collectAutoResolutionInputs([
      part("resistor", "not-a-number", "R1"),
      part("capacitor", "100n IC=1", "C1"), // leading token parses
      part("vac", "", "V1"), // malformed source — skipped
    ]);
    // No valid resistor → fallback R_typ = 1 kΩ; τ = 100n · 1k = 100 µs.
    expect(inputs.maxTauSeconds).toBeCloseTo(1e-4, 9);
    expect(inputs.maxSourceHz).toBe(0);
  });
});

describe("autoTransientOptions (§11 Unit C8)", () => {
  it("falls back to the classic 6 ms / 240 defaults for a source-less, memory-less circuit", () => {
    expect(autoTransientOptions({ maxSourceHz: 0, minSourceHz: 0, maxTauSeconds: 0, minTauSeconds: 0 }))
      .toEqual({ stopTime: 0.006, steps: 240 });
  });

  it("covers 5 cycles of the slowest source with 64 samples/cycle of the fastest", () => {
    // Single 1 kHz source, no reactive parts: window = 5/1000 = 5 ms;
    // steps = ceil(0.005 · 1000 · 64) = 320.
    const options = autoTransientOptions({
      maxSourceHz: 1000, minSourceHz: 1000, maxTauSeconds: 0, minTauSeconds: 0,
    });
    expect(options.stopTime).toBeCloseTo(0.005, 9);
    expect(options.steps).toBe(320);
  });

  it("extends the window to settle the slowest time constant", () => {
    // 1 kHz source but τ_max = 2 ms → settle window 7·2 ms = 14 ms wins over
    // 5 cycles (5 ms). Steps: max(240, ceil(0.014·1000·64)=896, τ_min term
    // ceil(0.014/0.002·4)=28) = 896.
    const options = autoTransientOptions({
      maxSourceHz: 1000, minSourceHz: 1000, maxTauSeconds: 0.002, minTauSeconds: 0.002,
    });
    expect(options.stopTime).toBeCloseTo(0.014, 9);
    expect(options.steps).toBe(896);
  });

  it("keeps at least 4 samples per fastest time constant", () => {
    // No sources; τ from 1 µs to 1 ms → window 7 ms, steps = ceil(0.007/1e-6·4)
    // = 28000 (beats the 240 floor).
    const options = autoTransientOptions({
      maxSourceHz: 0, minSourceHz: 0, maxTauSeconds: 0.001, minTauSeconds: 1e-6,
    });
    expect(options.stopTime).toBeCloseTo(0.007, 9);
    expect(options.steps).toBe(28000);
  });

  it("gives up window length, not sample density, when the step cap binds", () => {
    // 1 MHz fast source + 1 Hz slow source: 5 s window at 64 Ms/s wants 320M
    // steps — impossible. The window shrinks to the cap at that density but
    // never below one cycle of the slowest source (1 s → still capped math),
    // and steps land on the cap.
    const options = autoTransientOptions({
      maxSourceHz: 1e6, minSourceHz: 1, maxTauSeconds: 0, minTauSeconds: 0,
    });
    expect(options.steps).toBeLessThanOrEqual(MAX_TRANSIENT_STEPS);
    expect(options.stopTime).toBeGreaterThan(0);
    // Density preserved as far as the cap allows: cap / (64 samples · 1 MHz)
    // = 200000/6.4e7 ≈ 3.125 ms, then the ≥1-cycle-of-slowest floor lifts the
    // window to 1 s and the cap clamps the step count.
    expect(options.stopTime).toBeCloseTo(1, 6);
    expect(options.steps).toBe(MAX_TRANSIENT_STEPS);
  });

  it("suggests options end-to-end from schematic parts", () => {
    // R=1k, C=1µ → τ=1 ms → window 7 ms; SINE 1 kHz → steps
    // max(240, ceil(0.007·1000·64)=448, ceil(0.007/0.001·4)=28) = 448.
    const options = suggestTransientOptions([
      part("resistor", "1k", "R1"),
      part("capacitor", "1u", "C1"),
      part("vac", "SINE(0 1 1k)", "V1"),
    ]);
    expect(options.stopTime).toBeCloseTo(0.007, 9);
    expect(options.steps).toBe(448);
  });
});

describe("suggestAcSweep (§11 Unit C8)", () => {
  it("keeps the classic 10 Hz–1 MHz sweep when every source is DC", () => {
    expect(suggestAcSweep([part("vsource", "5", "V1")]))
      .toEqual({ startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
  });

  it("brackets the circuit's source frequencies by two decades each way", () => {
    // 1 kHz source → start 10 Hz, stop 100 kHz.
    expect(suggestAcSweep([part("vac", "SINE(0 1 1k)", "V1")]))
      .toEqual({ startHz: 10, stopHz: 1e5, pointsPerDecade: 20 });
  });
});
