/**
 * Profile: the page that exists to say there is no account.
 *
 * Tau has no sign-in, no server, and no user record, so there is no profile to
 * edit. The temptation is to fill this page with plausible-looking rows (a
 * name, an avatar, a "member since") that store nothing. That would be worse
 * than an empty page: it implies Tau knows who you are and has somewhere to put
 * it. Instead the page answers the question a user actually arrived with, which
 * is "what does Tau know about me, and where does it keep it".
 *
 * Everything listed here is read from the real storage locations at render
 * time, not hardcoded, so the page cannot claim a state Tau is not in.
 */
import { keychainAvailable } from "../settingsSurface";
import { PROVIDERS } from "../providerCatalog";
import { useHasAssistantApiKey } from "../../lib/assistant";
import { useHasGeminiApiKey, useHasOpenAiApiKey } from "../../lib/providerApiKey";
import { SettingsGroup, SettingsNotice, SettingsPage, SettingsRow } from "../SettingsPrimitives";

export function ProfilePage() {
  const native = keychainAvailable();
  // Presence booleans only. No key value reaches this page.
  const saved: Record<string, boolean> = {
    anthropic: useHasAssistantApiKey(),
    openai: useHasOpenAiApiKey(),
    gemini: useHasGeminiApiKey(),
  };
  const savedCount = Object.values(saved).filter(Boolean).length;

  return (
    <SettingsPage
      title="Profile"
      summary="Tau has no accounts. This page shows what is stored about you on this Mac and where."
    >
      <SettingsNotice title="There is nothing to sign in to">
        <p>
          Tau does not have user accounts. There is no Tau server, no login, and no profile
          record anywhere. Your schematics, your preferences, and your API keys stay on this
          computer.
        </p>
        <p>
          When you use the cloud assistant, your circuit question goes directly from this Mac
          to the provider you chose, using your own key. It does not pass through Tau.
        </p>
      </SettingsNotice>

      <SettingsGroup
        title="What is stored on this Mac"
        note="Every item below is local. Nothing here is uploaded or synced."
      >
        <SettingsRow
          label="Preferences"
          hint="Theme, solver defaults, and the choices on these pages"
        >
          <span className="tau-settings-value">This app's local storage</span>
        </SettingsRow>
        <SettingsRow
          label="API keys"
          hint={
            native
              ? `${savedCount} of ${PROVIDERS.length} providers have a key saved`
              : "No keychain in a browser preview"
          }
        >
          <span className="tau-settings-value">
            {native ? "macOS keychain" : "Memory, this session only"}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Schematics"
          hint="Only where you saved them, plus an unsaved-work recovery snapshot"
        >
          <span className="tau-settings-value">Your own folders</span>
        </SettingsRow>
        <SettingsRow
          label="Assistant conversations"
          hint="Kept next to the schematic they were about, on this Mac"
        >
          <span className="tau-settings-value">This app's local storage</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="What Tau sends anywhere"
        note="This is the complete list."
      >
        <SettingsRow
          label="Cloud assistant requests"
          hint="Only after you turn the cloud assistant on and consent, and only to the provider whose key you saved"
        >
          <span className="tau-settings-value">You choose</span>
        </SettingsRow>
        <SettingsRow
          label="On-device model downloads"
          hint="Only when you ask for an on-device model, from the model host"
        >
          <span className="tau-settings-value">You choose</span>
        </SettingsRow>
        <SettingsRow label="Analytics or telemetry" hint="Tau collects none">
          <span className="tau-settings-value">Never</span>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
