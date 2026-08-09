/**
 * General: the switches someone changes in their first week.
 *
 * Everything here is deliberately reversible and none of it changes a
 * simulation result. Anything that could change a number belongs on Simulation,
 * where the copy can say what it costs.
 */
import { Button } from "@/components/ui/button";
import { ThemeControl } from "../../components/SettingsPanel";
import { clearAllUnsavedLocalState } from "../../lib/unsavedRecovery";
import {
  simulationPreferences,
  useSimulationPreferences,
} from "../../lib/simulationPreferences";
import { resetAllPreferences } from "../../lib/preferenceRegistry";
import { SettingsGroup, SettingsPage, SettingsRow, SettingsToggle } from "../SettingsPrimitives";

/**
 * What Reset clears, named by page rather than by knob.
 *
 * Being thorough here would mean writing "solver tolerances", and General is
 * the first page a student opens. `SettingsWorkspaceCopy.test.tsx` holds this
 * page to showing no solver internals, and it is right to: spelling out the
 * jargon would put it on the one page that exists to keep it away. Naming the
 * Simulation page is both calmer and exactly as accurate, because everything
 * on it lives in the single preference this clears.
 */
const RESET_SCOPE_NOTE =
  "Returns the preferences on these pages to their shipped defaults: appearance, " +
  "everything on the Simulation page, the assistant provider and model, cloud " +
  "consent, and Tau's local usage counters.";

export function GeneralPage({ onNotice }: { onNotice: (message: string) => void }) {
  const simulation = useSimulationPreferences();

  const clearAutosave = () => {
    try {
      clearAllUnsavedLocalState();
      onNotice("Recovery snapshot cleared.");
    } catch {
      onNotice("The recovery snapshot could not be cleared in this webview.");
    }
  };

  const resetEverything = () => {
    const confirmed = window.confirm(
      "Reset Tau's preferences to their defaults? Your API keys, schematics, model libraries, assistant conversations, run history, and panel sizes are not touched.",
    );
    if (!confirmed) return;
    resetAllPreferences();
    onNotice("Preferences reset to defaults. Keys, schematics, conversations, and history were left alone.");
  };

  return (
    <SettingsPage
      title="General"
      summary="Appearance, recovery, and how much detail Tau shows when something goes wrong."
    >
      <SettingsGroup title="Appearance">
        <ThemeControl />
      </SettingsGroup>

      <SettingsGroup
        title="When something fails"
        note="Tau explains a failure in plain language first and keeps the engine transcript behind a disclosure. Turn this on if you would rather read the transcript every time."
      >
        <SettingsToggle
          id="general-technical-details"
          label="Expand technical details automatically"
          hint="Opens the engine transcript under a failed run without a click. This is the same setting as Expand technical details on the Simulation page."
          checked={simulation.alwaysShowTechnicalDetails}
          onChange={(next) =>
            simulationPreferences.update({ alwaysShowTechnicalDetails: next })
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Autosave"
        note="Tau keeps a recovery snapshot of unsaved edits so a crash or an accidental close does not lose your work. It lives on this Mac only."
      >
        <SettingsRow
          label="Recovery snapshot"
          hint="Clearing it discards unsaved edits Tau is holding for an untitled schematic"
        >
          <Button size="sm" variant="outline" onClick={clearAutosave}>
            Clear
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Reset" note={RESET_SCOPE_NOTE}>
        {/* Outline, not filled. Reset is the least likely thing anyone came to
            this page to do, and a filled destructive control made it the
            loudest element on the screen (DESIGN_SYSTEM.md section 4: at most
            one filled control per surface, and it should be the primary one).
            The confirmation prompt carries the weight instead. */}
        <SettingsRow
          label="All Tau settings"
          hint="Not affected: your API keys, your schematics, your imported model libraries, the unsaved-work recovery snapshot, your simulation run history, your assistant conversations, and the panel sizes in this window."
        >
          <Button size="sm" variant="outline" onClick={resetEverything}>
            Reset to defaults
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
