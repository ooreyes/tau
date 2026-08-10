import { describe, expect, it } from "vitest";

import {
  autoTransientOptions,
  collectAutoResolutionInputs,
  suggestAcSweep,
  suggestTransientOptions,
  transientDetailSteps,
  type AutoResolutionInputs,
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

describe("collectAutoResolutionInputs", () => {
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
      part("vac", "", "V1"), // malformed source - skipped
    ]);
    // No valid resistor → fallback R_typ = 1 kΩ; τ = 100n · 1k = 100 µs.
    expect(inputs.maxTauSeconds).toBeCloseTo(1e-4, 9);
    expect(inputs.maxSourceHz).toBe(0);
  });
});

describe("collectAutoResolutionInputs — parts the deck expands into R/L/C", () => {
  it("counts a DC motor's armature R and L", () => {
    // The deck emits `motor` as series R + L (spiceNetlist `case "motor"`), so
    // "10 1m" is 10 Ω / 1 mH → R_typ = 10 Ω and τ = L/R = 100 µs. Before the
    // motor branch existed this circuit reported no time constant at all.
    const inputs = collectAutoResolutionInputs([
      part("vsource", "100", "V1"),
      part("motor", "10 1m", "M1"),
    ]);
    expect(inputs.maxTauSeconds).toBeCloseTo(1e-4, 12);
    expect(inputs.minTauSeconds).toBeCloseTo(1e-4, 12);
    expect(inputs.maxSourceHz).toBe(0);
  });

  it("reads the motor pair through the emitter's parser, catalog defaults included", () => {
    // `R=… L=…` and a garbage value both go through `motorArmature`, so the
    // heuristic inherits its catalog defaults (10 Ω / 1 mH) rather than
    // inventing a second interpretation of the same value string.
    const keyed = collectAutoResolutionInputs([part("motor", "R=8 L=500u", "M1")]);
    expect(keyed.maxTauSeconds).toBeCloseTo(500e-6 / 8, 12);

    const garbage = collectAutoResolutionInputs([part("motor", "spin fast", "M1")]);
    expect(garbage.maxTauSeconds).toBeCloseTo(1e-3 / 10, 12);
  });

  it("counts a relay coil as the resistor the deck emits", () => {
    // Coil = 220 Ω is the only resistance, so R_typ = 220 and the 1 µF cap
    // sees τ = 220 µs instead of the no-resistor fallback's 1 ms.
    const inputs = collectAutoResolutionInputs([
      part("relay", "220", "K1"),
      part("capacitor", "1u", "C1"),
    ]);
    expect(inputs.maxTauSeconds).toBeCloseTo(220e-6, 12);

    // Blank value → `relayCoilOhms`' 100 Ω catalog default, same as the deck.
    const blank = collectAutoResolutionInputs([
      part("relay", "", "K1"),
      part("capacitor", "1u", "C1"),
    ]);
    expect(blank.maxTauSeconds).toBeCloseTo(100e-6, 12);
  });

  it("counts both transformer windings as inductances", () => {
    // `1:2` → L1 = 10 mH default, L2 = L1·(Ns/Np)² = 40 mH. No resistors, so
    // R_typ = 1 kΩ: τ = 10 µs and 40 µs.
    const ratio = collectAutoResolutionInputs([part("transformer", "1:2", "T1")]);
    expect(ratio.minTauSeconds).toBeCloseTo(1e-5, 12);
    expect(ratio.maxTauSeconds).toBeCloseTo(4e-5, 12);

    // Authored windings override the defaults through the same parser.
    const authored = collectAutoResolutionInputs([part("transformer", "L1=2m L2=8m k=0.98", "T1")]);
    expect(authored.minTauSeconds).toBeCloseTo(2e-6, 12);
    expect(authored.maxTauSeconds).toBeCloseTo(8e-6, 12);
  });

  it("counts a center-tapped secondary as the L/4 half-windings the deck emits", () => {
    // `1:4` → L1 = 10 mH, full secondary = 160 mH, but the deck emits two
    // half-windings of L2/4 = 40 mH each (L ∝ N²). τ = 10 µs and 40 µs, not
    // the 160 µs a full-secondary reading would claim.
    const inputs = collectAutoResolutionInputs([part("ctTransformer", "1:4", "T1")]);
    expect(inputs.minTauSeconds).toBeCloseTo(1e-5, 12);
    expect(inputs.maxTauSeconds).toBeCloseTo(4e-5, 12);
  });

  it("skips a transformer whose winding field is malformed instead of throwing", () => {
    // `transformerWindings` throws on `L1=oops`; auto mode must degrade to the
    // defaults so the run itself can report the bad value.
    const inputs = collectAutoResolutionInputs([
      part("transformer", "L1=oops", "T1"),
      part("resistor", "1k", "R1"),
    ]);
    expect(inputs.maxTauSeconds).toBe(0);
    expect(inputs.minTauSeconds).toBe(0);
  });
});

describe("autoTransientOptions", () => {
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
    // steps - impossible. The window shrinks to the cap at that density but
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

  it("gives a DC-motor circuit a settling window instead of the 6 ms default", () => {
    // 100 V DC into a "10 1m" motor is a first-order L/R step: τ = 1 mH/10 Ω =
    // 100 µs, settled by 7·τ = 700 µs. The window has to get SHORTER than the
    // 6 ms memory-less default, not longer - at 6 ms the whole inrush lives in
    // the first 2% of the plot. Steps stay at the balanced floor of 240
    // because the τ term only asks for ceil(700µ/100µ · 4) = 28.
    const options = suggestTransientOptions([
      part("vsource", "100", "V1"),
      part("motor", "10 1m", "M1"),
    ]);
    expect(options.stopTime).toBeCloseTo(7e-4, 12);
    expect(options.steps).toBe(240);
    expect(options.stopTime).toBeLessThan(0.006);
  });

  it("gives a transformer circuit a window from its magnetizing inductance", () => {
    // `1:2` with no resistors: L2 = 40 mH over R_typ = 1 kΩ → τ_max = 40 µs,
    // window 7·40 µs = 280 µs. Steps: the τ_min term is ceil(280µ/10µ · 4) =
    // 112, so the 240 floor still wins.
    const options = suggestTransientOptions([part("transformer", "1:2", "T1")]);
    expect(options.stopTime).toBeCloseTo(2.8e-4, 12);
    expect(options.steps).toBe(240);
  });
});

describe("transientDetailSteps", () => {
  it("maps engineer-facing detail levels to explicit samples per fastest cycle", () => {
    const inputs = { maxSourceHz: 1_000, minSourceHz: 1_000, maxTauSeconds: 0, minTauSeconds: 0 };
    expect(transientDetailSteps(inputs, 5e-3, "quick")).toBe(160);
    expect(transientDetailSteps(inputs, 5e-3, "balanced")).toBe(320);
    expect(transientDetailSteps(inputs, 5e-3, "precision")).toBe(640);
  });

  it("increases samples across the fastest time constant and honors the output cap", () => {
    const inputs = { maxSourceHz: 0, minSourceHz: 0, maxTauSeconds: 1e-3, minTauSeconds: 1e-6 };
    expect(transientDetailSteps(inputs, 7e-3, "quick")).toBe(14_000);
    expect(transientDetailSteps(inputs, 7e-3, "balanced")).toBe(28_000);
    expect(transientDetailSteps(inputs, 7e-3, "precision", 50_000)).toBe(50_000);
  });
});

describe("suggestAcSweep", () => {
  it("keeps the classic 10 Hz-1 MHz sweep when every source is DC", () => {
    expect(suggestAcSweep([part("vsource", "5", "V1")]))
      .toEqual({ startHz: 10, stopHz: 1e6, pointsPerDecade: 20 });
  });

  it("brackets the circuit's source frequencies by two decades each way", () => {
    // 1 kHz source → start 10 Hz, stop 100 kHz.
    expect(suggestAcSweep([part("vac", "SINE(0 1 1k)", "V1")]))
      .toEqual({ startHz: 10, stopHz: 1e5, pointsPerDecade: 20 });
  });
});

describe("autoTransientOptions detail level", () => {
  it("defaults to balanced, which is the density Tau has always shipped", () => {
    const withSourceAndTau: AutoResolutionInputs = {
      maxSourceHz: 1000, minSourceHz: 1000, maxTauSeconds: 0.002, minTauSeconds: 0.002,
    };
    const tauOnly: AutoResolutionInputs = {
      maxSourceHz: 0, minSourceHz: 0, maxTauSeconds: 0.001, minTauSeconds: 1e-6,
    };
    expect(autoTransientOptions(withSourceAndTau)).toEqual(autoTransientOptions(withSourceAndTau, "balanced"));
    expect(autoTransientOptions(tauOnly)).toEqual(autoTransientOptions(tauOnly, "balanced"));
  });

  it("detail changes sample density without moving the window", () => {
    const inputs: AutoResolutionInputs = {
      maxSourceHz: 1000, minSourceHz: 1000, maxTauSeconds: 0, minTauSeconds: 0,
    };
    const quick = autoTransientOptions(inputs, "quick");
    const balanced = autoTransientOptions(inputs, "balanced");
    const precision = autoTransientOptions(inputs, "precision");

    // Same window (5 cycles of the 1 kHz source) at every detail level.
    expect(quick.stopTime).toBeCloseTo(balanced.stopTime, 9);
    expect(precision.stopTime).toBeCloseTo(balanced.stopTime, 9);

    // Expected step counts come straight from the same profile-driven formula
    // transientDetailSteps uses - not hardcoded guesses - evaluated at the
    // shared window.
    expect(quick.steps).toBe(transientDetailSteps(inputs, balanced.stopTime, "quick"));
    expect(balanced.steps).toBe(transientDetailSteps(inputs, balanced.stopTime, "balanced"));
    expect(precision.steps).toBe(transientDetailSteps(inputs, balanced.stopTime, "precision"));

    // And density strictly increases quick -> balanced -> precision.
    expect(quick.steps).toBeLessThan(balanced.steps);
    expect(balanced.steps).toBeLessThan(precision.steps);
  });

  it("the source-less fallback keeps its window and takes its point count from the detail", () => {
    const inputs: AutoResolutionInputs = {
      maxSourceHz: 0, minSourceHz: 0, maxTauSeconds: 0, minTauSeconds: 0,
    };
    const quick = autoTransientOptions(inputs, "quick");
    const balanced = autoTransientOptions(inputs, "balanced");
    const precision = autoTransientOptions(inputs, "precision");

    // The fallback window (0.006 s) never moves with detail.
    expect(quick.stopTime).toBe(balanced.stopTime);
    expect(precision.stopTime).toBe(balanced.stopTime);

    // Steps track each profile's own minimum point count, derived the same
    // way transientDetailSteps derives it for a source-less, memory-less
    // circuit (nothing pushes the count above the floor).
    expect(quick.steps).toBe(transientDetailSteps(inputs, quick.stopTime, "quick"));
    expect(balanced.steps).toBe(transientDetailSteps(inputs, balanced.stopTime, "balanced"));
    expect(precision.steps).toBe(transientDetailSteps(inputs, precision.stopTime, "precision"));
    expect(quick.steps).toBeLessThan(balanced.steps);
    expect(balanced.steps).toBeLessThan(precision.steps);
  });
});
