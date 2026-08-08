/**
 * Model configuration: pick a provider, learn how to get a key from it, save
 * the key locally, and choose where the assistant runs.
 *
 * The page is built around one assumption: the reader has never created an API
 * key. So each provider carries literal numbered steps, a link straight to the
 * page that issues the key, and a warning about the two things that actually
 * trip people up (a consumer subscription is not API credit, and the key is
 * shown exactly once).
 *
 * Key entry is `ProviderKeyField` and only `ProviderKeyField`. Three instances
 * of one component, not three key-handling code paths - a second place that
 * writes a secret is a second place that can get the storage story wrong.
 */
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsAiSection } from "../../components/SettingsAiSection";
import { saveAssistantApiKey, useHasAssistantApiKey } from "../../lib/assistant";
import {
  saveGeminiApiKey,
  saveOpenAiApiKey,
  useHasGeminiApiKey,
  useHasOpenAiApiKey,
} from "../../lib/providerApiKey";
import { userFacingErrorMessage } from "../../lib/errorMessage";
import { PROVIDERS, providerInfo, type ProviderId } from "../providerCatalog";
import { ProviderKeyField } from "../ProviderKeyField";
import { keychainAvailable, openProviderPage } from "../settingsSurface";
import { SettingsGroup, SettingsNotice, SettingsPage } from "../SettingsPrimitives";

export function ModelConfigurationPage({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const info = providerInfo(provider);

  // All three hooks run every render: presence booleans only, never a value.
  const hasAnthropic = useHasAssistantApiKey();
  const hasOpenAi = useHasOpenAiApiKey();
  const hasGemini = useHasGeminiApiKey();
  const saved: Record<ProviderId, boolean> = {
    anthropic: hasAnthropic,
    openai: hasOpenAi,
    gemini: hasGemini,
  };
  const savers: Record<ProviderId, (key: string) => void> = {
    anthropic: saveAssistantApiKey,
    openai: saveOpenAiApiKey,
    gemini: saveGeminiApiKey,
  };

  const openKeyPage = () => {
    void openProviderPage(info.keyPageUrl).catch((error: unknown) => {
      onNotice(userFacingErrorMessage(error, "That page could not be opened."));
    });
  };

  return (
    <SettingsPage
      title="Model configuration"
      summary="Choose an AI provider, save its key on this Mac, and decide where the assistant runs."
    >
      <SettingsGroup
        title="Provider"
        note="Tau can hold a key for each of these at once. Switching provider here changes which key you are managing, not which one the assistant uses."
      >
        <div className="tau-provider-picker">
          <Select value={provider} onValueChange={(next) => setProvider(next as ProviderId)}>
            <SelectTrigger
              id="model-provider"
              size="sm"
              className="settings-select w-full"
              aria-label="API key provider"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                  {saved[entry.id] ? " · key saved" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="tau-provider-cost">{info.costNote}</p>

        <ol className="tau-howto" aria-label={`Steps to create a ${info.label} key`}>
          {info.steps.map((step, index) => (
            <li key={step}>
              <span className="tau-howto-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="tau-howto-step">{step}</span>
            </li>
          ))}
        </ol>

        <div className="tau-howto-actions">
          <Button size="sm" variant="outline" onClick={openKeyPage}>
            <ExternalLink size={13} strokeWidth={1.7} aria-hidden="true" />
            Open {info.consoleName}
          </Button>
          <span className="tau-howto-url">{info.keyPageUrl}</span>
        </div>

        <ProviderKeyField
          id={`provider-key-${provider}`}
          label={`${info.label} API key`}
          keyPrefix={info.keyPrefix}
          hasKey={saved[provider]}
          onSave={savers[provider]}
          onNotice={onNotice}
        />
      </SettingsGroup>

      {/* Both branches are true statements about where the secret is. The
          desktop sentence would be a lie in a browser, which has no keychain
          and no native process, so the browser gets its own. */}
      <SettingsNotice title="Tau never sees your key">
        {keychainAvailable() ? (
          <p>
            The key goes into the macOS keychain and is read back only by Tau's native process
            when it makes a request on your behalf. It is not sent to Tau, it is not stored in
            a schematic file, and this page cannot display it once it is saved. If you lose it,
            create a new one at your provider and replace it here.
          </p>
        ) : (
          <p>
            This is a browser preview. There is no keychain here, so a key you enter is held in
            memory for this tab and is gone when you reload. It is not written to disk and not
            sent to Tau. Use the desktop app to store a key that persists.
          </p>
        )}
      </SettingsNotice>

      <SettingsGroup
        title="Where the assistant runs"
        note="Separate from the keys above. On-device needs no key and no account. The cloud path uses the key for whichever provider you select here."
      >
        <SettingsAiSection onNotice={onNotice} />
      </SettingsGroup>
    </SettingsPage>
  );
}
