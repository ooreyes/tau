/**
 * Solver preferences: the app-wide layer between Tau's built-in defaults and
 * whatever the open document says.
 *
 * Precedence is `DEFAULT_OPTIONS` < these preferences < the document's own
 * `.options` directives. The document still wins, because a `.asc` that
 * carries `.options reltol=1e-6` was authored to simulate a particular way and
 * a global preference must not silently change someone else's circuit. What
 * these preferences change is the baseline every deck starts from.
 *
 * Only the ngspice path reads them. The linear preview solver carries its
 * tolerances in its own Newton loops and does not accept `.options` at all, so
 * the Settings copy says so rather than implying a control that reaches an
 * engine it cannot reach.
 */
import { DEFAULT_OPTIONS } from "../engine/spiceOptions";
import { createPreferenceStore } from "./preferences";

/** The four tolerances worth exposing. `rshunt`/`rseries` stay internal: they
 *  are convergence scaffolding Tau adds to match LTspice, not accuracy dials. */
export const TOLERANCE_KEYS = ["reltol", "abstol", "vntol", "gmin"] as const;
export type ToleranceKey = (typeof TOLERANCE_KEYS)[number];

export interface SimulationPreferences {
  /** Per-key override, or `null` to use Tau's default for that key. */
  tolerances: Record<ToleranceKey, string | null>;
  /**
   * Whether an analysis may fall back to the linear preview solver when the
   * native path declines. Off means Tau refuses instead of quietly answering
   * with a different, weaker engine - the honest choice for coursework being
   * graded against LTspice.
   */
  allowPreviewFallback: boolean;
  /** Default waveform resolution for new transient runs. */
  transientDetail: TransientDetailPreference;
  /** Expand the simulator's "Technical details" disclosure without a click. */
  alwaysShowTechnicalDetails: boolean;
}

export type TransientDetailPreference = "quick" | "balanced" | "precision";

export const TRANSIENT_DETAIL_LABELS: Record<TransientDetailPreference, string> = {
  quick: "Quick",
  balanced: "Balanced",
  precision: "Precision",
};

export const DEFAULT_SIMULATION_PREFERENCES: SimulationPreferences = {
  tolerances: { reltol: null, abstol: null, vntol: null, gmin: null },
  allowPreviewFallback: true,
  transientDetail: "balanced",
  alwaysShowTechnicalDetails: false,
};

/** A tolerance override has to parse as a positive finite number: ngspice reads
 *  these verbatim, and a malformed value fails the whole deck rather than the
 *  one option. Empty string means "no override". */
export function isValidToleranceValue(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (!/^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0;
}

function validTolerances(raw: unknown): Record<ToleranceKey, string | null> {
  const out: Record<ToleranceKey, string | null> = { ...DEFAULT_SIMULATION_PREFERENCES.tolerances };
  if (!raw || typeof raw !== "object") return out;
  const source = raw as Record<string, unknown>;
  for (const key of TOLERANCE_KEYS) {
    const value = source[key];
    if (typeof value === "string" && isValidToleranceValue(value)) out[key] = value.trim();
  }
  return out;
}

function validPreferences(raw: unknown): SimulationPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const detail = source.transientDetail;
  return {
    tolerances: validTolerances(source.tolerances),
    allowPreviewFallback:
      typeof source.allowPreviewFallback === "boolean"
        ? source.allowPreviewFallback
        : DEFAULT_SIMULATION_PREFERENCES.allowPreviewFallback,
    transientDetail:
      detail === "quick" || detail === "balanced" || detail === "precision"
        ? detail
        : DEFAULT_SIMULATION_PREFERENCES.transientDetail,
    alwaysShowTechnicalDetails:
      typeof source.alwaysShowTechnicalDetails === "boolean"
        ? source.alwaysShowTechnicalDetails
        : DEFAULT_SIMULATION_PREFERENCES.alwaysShowTechnicalDetails,
  };
}

export const simulationPreferences = createPreferenceStore<SimulationPreferences>({
  key: "tau.simulation.preferences.v1",
  defaults: DEFAULT_SIMULATION_PREFERENCES,
  validate: validPreferences,
});

export const loadSimulationPreferences = simulationPreferences.load;
export const saveSimulationPreferences = simulationPreferences.save;
export const useSimulationPreferences = simulationPreferences.use;

/**
 * The tolerance overrides as a `.options` map, ready to sit under a document's
 * own directives. Keys the user has not overridden are absent so that Tau's
 * default keeps applying rather than being restated.
 */
export function solverOptionOverrides(
  preferences: SimulationPreferences = loadSimulationPreferences(),
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const key of TOLERANCE_KEYS) {
    const value = preferences.tolerances[key];
    if (value && isValidToleranceValue(value)) overrides[key] = value.trim();
  }
  return overrides;
}

/** What a given tolerance resolves to today, for display next to the field. */
export function effectiveTolerance(key: ToleranceKey, preferences: SimulationPreferences): string {
  return preferences.tolerances[key] ?? DEFAULT_OPTIONS[key] ?? "";
}

/** True when any tolerance differs from Tau's built-in baseline. */
export function hasToleranceOverrides(preferences: SimulationPreferences): boolean {
  return TOLERANCE_KEYS.some((key) => preferences.tolerances[key] !== null);
}
