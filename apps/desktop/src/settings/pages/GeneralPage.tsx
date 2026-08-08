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
import { aiUsage } from "../../lib/aiUsage";
import { SettingsGroup, SettingsPage, SettingsRow, SettingsToggle } from "../SettingsPrimitives";

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
      "Reset every Tau setting to its default? Saved API keys and your schematics are not touched.",
    );
    if (!confirmed) return;
    simulationPreferences.reset();
    aiUsage.reset();
    onNotice("Settings reset to defaults. API keys and schematics were left alone.");
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
          hint="Opens the engine transcript under a failed run without a click"
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

      <SettingsGroup
        title="Reset"
        note="Returns every preference on every page to its default. Your saved API keys, your schematics, and your model libraries are not affected."
      >
        {/* Outline, not filled. Reset is the least likely thing anyone came to
            this page to do, and a filled destructive control made it the
            loudest element on the screen (DESIGN_SYSTEM.md section 4: at most
            one filled control per surface, and it should be the primary one).
            The confirmation prompt carries the weight instead. */}
        <SettingsRow label="All Tau settings" hint="Cannot be undone">
          <Button size="sm" variant="outline" onClick={resetEverything}>
            Reset to defaults
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
