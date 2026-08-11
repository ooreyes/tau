/**
 * The one list "Reset to defaults" (GeneralPage.tsx) is allowed to consult.
 *
 * Every hand-rolled preference module in `lib/` now owns a `reset*` function
 * that clears its own versioned localStorage key and re-applies its shipped
 * default. Before this file, `resetEverything` in GeneralPage called exactly
 * two of them (`simulationPreferences.reset()`, `aiUsage.reset()`) even
 * though its copy claimed to reset "every preference on every page." Adding a
 * preference module and forgetting to wire it into that button silently
 * reintroduces the same defect. This registry is the single place a reset
 * module gets registered, so the button's behaviour and the button's copy
 * can both be generated from one list instead of drifting apart.
 *
 * The governing rule: reset clears *settings*, never *content*, and every
 * exclusion has to be named in the user-visible copy. Two categories are
 * deliberately excluded here, for different reasons:
 *
 * Layout (`tau.ui.explorerWidth`, `tau.ui.componentsRailWidth`,
 * `tau.assistant.width`, `tau.assistant.open`, `tau.telemetryDock.height`,
 * `tau.telemetryDock.collapsed`) — `usePanelWidth` in
 * `components/panelResize.tsx` reads its stored width once at mount
 * (`useState(() => loadPanelWidth(config))`) with no change-event listener,
 * so clearing these keys would change nothing the user can see until the
 * window relaunches. Shipping a reset that silently does nothing until a
 * future reload is worse than not resetting: the user has no way to tell
 * whether the click worked. Layout is also directly draggable, so the user
 * already has a fast way back to a comfortable size without this button.
 *
 * Content (`tau.unsaved.recovery.v1` / legacy `tau.schematic.v1`,
 * `tau.run.history.v1`, `tau.local-ai.custom-models.v1`, and the per-document
 * assistant-memory families) — these are things the user made or that Tau is
 * holding on the user's behalf: an unsaved-work recovery snapshot, the record
 * of past simulation runs, imported model files, assistant conversations.
 * Deleting any of them from a button labelled "Reset to defaults" is data
 * loss dressed up as a preference change. Each already has its own,
 * separately-labelled control (see `PRESERVED_PREFERENCES` below), and
 * clearing all of them at once is never what "reset my preferences" means.
 */
import { aiUsage } from "./aiUsage";
import { resetAssistantPreferences } from "./assistantPreferences";
import { resetCloudAiConsent } from "./cloudAiConsent";
import { resetLearningPathState } from "./learningPath";
import { resetLocalAiSetup } from "./localAiSetup";
import { simulationPreferences } from "./simulationPreferences";
import { resetThemeMode } from "./theme";

export interface ResettablePreference {
  key: string;
  label: string;
  reset: () => void;
}

/** Every preference "Reset to defaults" actually clears. */
export const RESETTABLE_PREFERENCES: readonly ResettablePreference[] = [
  {
    key: "tau.simulation.preferences.v1",
    label: "Solver tolerances and waveform detail",
    reset: () => simulationPreferences.reset(),
  },
  {
    key: "tau.ui.theme",
    label: "Appearance (theme)",
    reset: () => resetThemeMode(),
  },
  {
    key: "tau.assistant.preferences.v1",
    label: "Assistant provider and model",
    reset: () => resetAssistantPreferences(),
  },
  {
    key: "tau.cloud-ai.consent.v1",
    label: "Cloud AI consent",
    reset: () => resetCloudAiConsent(),
  },
  {
    key: "tau.local-ai.setup.v1",
    label: "Local AI first-run setup",
    reset: () => resetLocalAiSetup(),
  },
  {
    key: "tau.ai.usage.v1",
    label: "Tau's local usage counters",
    reset: () => aiUsage.reset(),
  },
  {
    key: "tau.learning.path.v1",
    label: "Learning path",
    reset: () => {
      resetLearningPathState();
    },
  },
];

/**
 * Keys Reset deliberately leaves alone, and where each one's own control
 * lives. Kept here (rather than only in prose) so the reasoning travels with
 * the code, and so a future page can render this list as an inline "not
 * affected by Reset" note without retyping it.
 */
export const PRESERVED_PREFERENCES: readonly {
  key: string;
  label: string;
  controlledAt: string;
}[] = [
  {
    key: "tau.unsaved.recovery.v1",
    label: "Unsaved-work recovery snapshot",
    controlledAt: "General, the Autosave Clear button",
  },
  {
    key: "tau.schematic.v1",
    label: "Legacy autosave snapshot",
    controlledAt: "General, the Autosave Clear button",
  },
  {
    key: "tau.run.history.v1",
    label: "Simulation run history",
    controlledAt: "Usage, Clear history",
  },
  {
    key: "tau.local-ai.custom-models.v1",
    label: "Imported local model file",
    controlledAt: "Model configuration, per-item Remove",
  },
  {
    key: "tau.ui.explorerWidth",
    label: "Explorer panel width",
    controlledAt: "The panel's own drag handle",
  },
  {
    key: "tau.ui.componentsRailWidth",
    label: "Components rail width",
    controlledAt: "The panel's own drag handle",
  },
  {
    key: "tau.ui.analysisPaneWidth",
    label: "Analysis pane width",
    controlledAt: "The divider between the circuit and the analysis pane",
  },
  {
    key: "tau.assistant.width",
    label: "Assistant panel width",
    controlledAt: "The panel's own drag handle",
  },
  {
    key: "tau.assistant.open",
    label: "Assistant panel open/closed state",
    controlledAt: "The assistant panel's own toggle",
  },
  {
    key: "tau.telemetryDock.height",
    label: "Telemetry dock height",
    controlledAt: "The dock's own drag handle",
  },
  {
    key: "tau.telemetryDock.collapsed",
    label: "Telemetry dock collapsed state",
    controlledAt: "The dock's own collapse toggle",
  },
];

/**
 * Key prefixes for per-document or per-tab state, also preserved. Copied
 * verbatim from the private constants declared in `lib/assistantMemory.ts`
 * (around lines 38-41: `HISTORY_PREFIX`, `RECOVERY_PREFIX`,
 * `CONVERSATIONS_PREFIX`, `ACTIVE_CONVERSATION_PREFIX`) plus the transient
 * chart-layout prefix in `components/cardLayout.ts`. Not imported directly
 * because those constants are module-private; if any of them ever change,
 * this list has to be updated by hand.
 */
export const PRESERVED_KEY_PREFIXES: readonly string[] = [
  "tau.tranGrid.",
  "tau.assistant.history.v1:",
  "tau.assistant.recovery.v1:",
  "tau.assistant.conversations.v2:",
  "tau.assistant.activeConversation.v2:",
];

/**
 * Resets every preference listed above. Each module's own `reset` runs
 * inside its own try/catch so a single storage-hostile module (private
 * browsing, quota exceeded, a corrupt shim) cannot abort the rest - the user
 * clicked one button expecting everything on the list to clear, not a
 * best-effort prefix of it.
 */
export function resetAllPreferences(): void {
  for (const preference of RESETTABLE_PREFERENCES) {
    try {
      preference.reset();
    } catch {
      // Intentionally swallowed: this module failed to reset, but the rest
      // of the list must still run.
    }
  }
}
