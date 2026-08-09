/**
 * First-success learning path + contextual help (product-gates DoD slice).
 *
 * Guides a new user from an empty project canvas → load the flagship RC Charging
 * example → press Run → mark the first successful simulation. Persistence is
 * versioned `tau.learning.path.v1` so dismiss / complete survive restarts.
 *
 * Together with recovery, external-edit, run records, and the versioned CLI/API
 * this closes the student/pro/dev product-gates DoD box. Other DoD boxes (and
 * SHIPPABLE) remain open.
 */

import { EXAMPLE_CIRCUITS } from "../examples/circuits";
import type { SchematicDocument } from "../store/useSchematic";

export const LEARNING_PATH_KIND = "tau.learning.path.v1" as const;
export const LEARNING_PATH_VERSION = 1 as const;
export const LEARNING_PATH_KEY = "tau.learning.path.v1";

/** Flagship first-success circuit — already proven by examples/circuits tests. */
export const FIRST_SUCCESS_EXAMPLE_ID = "rc.v1" as const;
export const FIRST_SUCCESS_FILENAME = "rc-charging.asc";
/** Bare directive (no leading `.`) matching SchematicDocument convention. */
export const FIRST_SUCCESS_DIRECTIVE = "tran 5m";

export type LearningPathStatus = "pending" | "in_progress" | "completed" | "dismissed";

/**
 * UI surface the coach is explaining. Callers map app state → one of these;
 * the tip catalog stays pure.
 */
export type LearningPathUiContext =
  | "empty"
  | "example_ready"
  | "simulating"
  | "success";

export interface LearningPathState {
  kind: typeof LEARNING_PATH_KIND;
  version: typeof LEARNING_PATH_VERSION;
  status: LearningPathStatus;
  exampleId: typeof FIRST_SUCCESS_EXAMPLE_ID;
  startedAt: number | null;
  completedAt: number | null;
  dismissedAt: number | null;
}

export interface ContextualHelpTip {
  id: string;
  title: string;
  body: string;
  /** Short shortcut / action hints under the tip. */
  shortcuts: string[];
}

export interface FirstSuccessExampleMeta {
  id: typeof FIRST_SUCCESS_EXAMPLE_ID;
  name: string;
  description: string;
  filename: typeof FIRST_SUCCESS_FILENAME;
  directive: typeof FIRST_SUCCESS_DIRECTIVE;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asStatus(value: unknown): LearningPathStatus | null {
  return value === "pending"
    || value === "in_progress"
    || value === "completed"
    || value === "dismissed"
    ? value
    : null;
}

function asMillis(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function defaultLearningPathState(): LearningPathState {
  return {
    kind: LEARNING_PATH_KIND,
    version: LEARNING_PATH_VERSION,
    status: "pending",
    exampleId: FIRST_SUCCESS_EXAMPLE_ID,
    startedAt: null,
    completedAt: null,
    dismissedAt: null,
  };
}

/** Parse a persisted envelope; corrupt / foreign shapes fall back to default. */
export function parseLearningPathState(raw: unknown): LearningPathState {
  const obj = record(raw);
  if (!obj) return defaultLearningPathState();
  if (obj.kind !== LEARNING_PATH_KIND && obj.kind !== undefined) {
    return defaultLearningPathState();
  }
  const status = asStatus(obj.status) ?? "pending";
  return {
    kind: LEARNING_PATH_KIND,
    version: LEARNING_PATH_VERSION,
    status,
    exampleId: FIRST_SUCCESS_EXAMPLE_ID,
    startedAt: asMillis(obj.startedAt),
    completedAt: asMillis(obj.completedAt),
    dismissedAt: asMillis(obj.dismissedAt),
  };
}

export function loadLearningPathState(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  if (!storage) return defaultLearningPathState();
  try {
    const raw = storage.getItem(LEARNING_PATH_KEY);
    if (!raw) return defaultLearningPathState();
    return parseLearningPathState(JSON.parse(raw) as unknown);
  } catch {
    return defaultLearningPathState();
  }
}

export function saveLearningPathState(
  state: LearningPathState,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  const envelope: LearningPathState = {
    kind: LEARNING_PATH_KIND,
    version: LEARNING_PATH_VERSION,
    status: state.status,
    exampleId: FIRST_SUCCESS_EXAMPLE_ID,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    dismissedAt: state.dismissedAt,
  };
  storage.setItem(LEARNING_PATH_KEY, JSON.stringify(envelope));
}

/** Resets the learning path to its pending default, e.g. from Settings'
 *  "Reset to defaults". Takes the same optional storage override as
 *  loadLearningPathState/saveLearningPathState above for testability. */
export function resetLearningPathState(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  const next = defaultLearningPathState();
  saveLearningPathState(next, storage);
  return next;
}

/** Offer the empty-state CTA while the path is still open. */
export function shouldOfferLearningPath(state: LearningPathState): boolean {
  return state.status === "pending" || state.status === "in_progress";
}

/**
 * Show the coach while mid-path, or after success until the user acks
 * (`dismissedAt` set while status stays `completed`).
 */
export function shouldShowLearningPathCoach(state: LearningPathState): boolean {
  if (state.status === "in_progress") return true;
  if (state.status === "completed" && state.dismissedAt == null) return true;
  return false;
}

export function isLearningPathActive(state: LearningPathState): boolean {
  return state.status === "in_progress";
}

export function startLearningPath(
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  const prev = loadLearningPathState(storage);
  if (prev.status === "completed" || prev.status === "dismissed") return prev;
  const next: LearningPathState = {
    ...prev,
    status: "in_progress",
    startedAt: prev.startedAt ?? now,
    completedAt: null,
    dismissedAt: null,
  };
  saveLearningPathState(next, storage);
  return next;
}

/**
 * Dismiss the coach. Mid-path / pending → `dismissed` (path abandoned).
 * Completed → keep `completed` but set `dismissedAt` so the success coach
 * does not reappear on every launch.
 */
export function dismissLearningPath(
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  const prev = loadLearningPathState(storage);
  if (prev.status === "completed") {
    if (prev.dismissedAt != null) return prev;
    const next: LearningPathState = { ...prev, dismissedAt: now };
    saveLearningPathState(next, storage);
    return next;
  }
  if (prev.status === "dismissed") return prev;
  const next: LearningPathState = {
    ...prev,
    status: "dismissed",
    dismissedAt: now,
  };
  saveLearningPathState(next, storage);
  return next;
}

export function markLearningPathComplete(
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  const prev = loadLearningPathState(storage);
  if (prev.status === "dismissed") return prev;
  if (prev.status === "completed") return prev;
  const next: LearningPathState = {
    ...prev,
    status: "completed",
    startedAt: prev.startedAt ?? now,
    completedAt: now,
    dismissedAt: null,
  };
  saveLearningPathState(next, storage);
  return next;
}

/**
 * Advance the path from a settled simulation. Only a successful run while
 * `in_progress` completes the path — errors and idle never claim success.
 */
export function recordLearningPathSimulationOutcome(
  outcome: { ok: boolean },
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): LearningPathState {
  const prev = loadLearningPathState(storage);
  if (!outcome.ok || prev.status !== "in_progress") return prev;
  return markLearningPathComplete(Date.now(), storage);
}

export function firstSuccessExampleMeta(): FirstSuccessExampleMeta {
  const example = EXAMPLE_CIRCUITS.find((c) => c.id === FIRST_SUCCESS_EXAMPLE_ID);
  if (!example) {
    throw new Error(`Missing flagship example ${FIRST_SUCCESS_EXAMPLE_ID}`);
  }
  return {
    id: FIRST_SUCCESS_EXAMPLE_ID,
    name: example.name,
    description: example.description,
    filename: FIRST_SUCCESS_FILENAME,
    directive: FIRST_SUCCESS_DIRECTIVE,
  };
}

/** Build a runnable SchematicDocument from the flagship example + `.tran`. */
export function firstSuccessExampleDocument(): SchematicDocument {
  const example = EXAMPLE_CIRCUITS.find((c) => c.id === FIRST_SUCCESS_EXAMPLE_ID);
  if (!example) {
    throw new Error(`Missing flagship example ${FIRST_SUCCESS_EXAMPLE_ID}`);
  }
  return {
    components: example.components.map((c) => ({ ...c })),
    wires: example.wires.map((w) => ({
      ...w,
      points: w.points.map((p) => ({ ...p })),
    })),
    probes: [],
    netLabels: [],
    directives: [FIRST_SUCCESS_DIRECTIVE],
  };
}

const TIPS: Record<LearningPathUiContext, ContextualHelpTip> = {
  empty: {
    id: "welcome",
    title: "Simulate your first circuit",
    body: "Load the RC Charging example — a 5 V step charging a capacitor through 1 kΩ. Then press Run.",
    shortcuts: ["Try RC Charging", "Run"],
  },
  example_ready: {
    id: "press-run",
    title: "Press Run",
    body: "The RC Charging schematic is ready. Run the authored .tran and watch the capacitor charge toward 5 V.",
    shortcuts: ["Run", "Space rotates · W wires"],
  },
  simulating: {
    id: "running",
    title: "Running…",
    body: "Tau is solving the transient. Results appear in the analysis panel when the run settles.",
    shortcuts: ["Stop cancels"],
  },
  success: {
    id: "first-success",
    title: "First simulation complete",
    body: "You ran your first circuit. Probe nets on the schematic, export CSV from the analysis panel, or open another file from Explorer.",
    shortcuts: ["Probe", "Export"],
  },
};

/**
 * Contextual help for the learning path. Completed paths always get the
 * success tip; dismissed / foreign contexts return null.
 */
export function contextualHelpFor(
  state: LearningPathState,
  uiContext: LearningPathUiContext,
): ContextualHelpTip | null {
  if (state.status === "dismissed") return null;
  if (state.status === "completed") return TIPS.success;
  if (state.status === "pending" && uiContext === "empty") return TIPS.empty;
  if (state.status !== "in_progress" && state.status !== "pending") return null;
  return TIPS[uiContext] ?? TIPS.empty;
}
