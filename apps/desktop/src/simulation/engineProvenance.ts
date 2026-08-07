// Which solver produced a result. An engineering tool must never show a number
// without saying where it came from: ngspice and the preview solver do not
// model the same circuits, so the same schematic can give different answers.
//
// This module holds no imports on purpose. The result types below live in
// `simulation/`, the producers in `engine/nativeSpice.ts`, and the badge in a
// component - a leaf keeps that from becoming an import cycle.

/**
 * `ngspice` is the bundled native engine, which carries full device models.
 * `preview` is the small TypeScript solver that stands in for it outside a
 * desktop build; it covers linear R/C/L, sources, diodes and ideal op amps and
 * refuses anything else, so its results are a subset, never a substitute.
 */
export type SimulationEngine = "ngspice" | "preview";

/** Mixed into every displayed analysis result. Optional so a result built by a
 *  path that does not choose an engine stays valid and simply shows no badge -
 *  an absent badge means unknown, never "native". */
export interface EngineProvenance {
  engine?: SimulationEngine;
}

/** Stamps the engine at the point the choice is made, so the badge cannot drift
 *  away from the result it labels. */
export function withEngine<T extends object>(result: T, engine: SimulationEngine): T & EngineProvenance {
  return { ...result, engine };
}

/**
 * The native-first pattern every analysis follows, with the engine recorded as
 * a consequence of the choice rather than as a separate statement that could
 * disagree with it. A non-null result always came from ngspice, so the badge
 * cannot overstate the engine.
 *
 * A native runner returns `null` in exactly two cases, neither of them an
 * ngspice failure: there is no native runtime to reach, or the analysis shape
 * is one the native path declines up front (a `.step` family the single-deck
 * path cannot express - see `nativeStepPathRefusal`). An ngspice error throws
 * and propagates; a native result that fails conversion is returned as a
 * failed *native* result. Neither is ever downgraded to the preview solver.
 *
 * `fallback` is a thunk because the preview solver must not run when ngspice
 * already answered.
 */
export function resolveEngineResult<T extends object>(
  native: T | null,
  fallback: () => T,
): T & EngineProvenance {
  return native ? withEngine(native, "ngspice") : withEngine(fallback(), "preview");
}

export const ENGINE_LABELS: Record<SimulationEngine, string> = {
  ngspice: "ngspice",
  preview: "Linear preview",
};

export const ENGINE_DESCRIPTIONS: Record<SimulationEngine, string> = {
  ngspice: "Solved by bundled ngspice with each part's authored device model.",
  preview: "Not ngspice. Tau's linear MNA preview (R/C/L, sources, diodes, ideal op-amps only) — refuses vendor models and nonlinear devices. Use the desktop app for ngspice results.",
};
