/**
 * Settings → Circuit assistant. Owns on-device ensure→download→load and cloud
 * consent / BYOK fields. ShellPanels should render this section rather than
 * inlining AI chrome (CEO wiring patch if not yet swapped).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { userFacingErrorMessage } from "../lib/errorMessage";
import { saveAssistantApiKey, useHasAssistantApiKey } from "../lib/assistant";
import { saveGeminiApiKey, useHasGeminiApiKey } from "../lib/providerApiKey";
import { GEMINI_MODEL_PRESETS } from "../lib/geminiAssistant";
import {
  saveAssistantPreferences,
  useAssistantPreferences,
  type AssistantProviderChoice,
} from "../lib/assistantPreferences";
import {
  LOCAL_AI_PRESETS,
  getLocalAiStatus,
  stopLocalAi,
  type LocalAiPresetInfo,
  type LocalAiStatus,
} from "../lib/localAiRuntime";
import {
  ensureLocalAi,
  studentFacingLocalAiDetail,
} from "../lib/localAiEnsure";
import {
  importCustomLocalAiModel,
  loadCustomLocalAiModels,
  removeCustomLocalAiModel,
} from "../lib/localAiModels";
import { saveCloudAiConsent } from "../lib/cloudAiConsent";
import { useCloudAiConsent } from "../lib/cloudAiConsentHooks";

const CLOUD_PROVIDER_ITEMS: readonly { value: "gemini" | "anthropic"; label: string }[] = [
  { value: "gemini", label: "Gemini · free tier" },
  { value: "anthropic", label: "Anthropic · your API key" },
];

function SettingsSelect({
  id,
  label,
  value,
  onValueChange,
  items,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        size="sm"
        className="settings-select w-full"
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsAiSection({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const hasAnthropicKey = useHasAssistantApiKey();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const hasGeminiKey = useHasGeminiApiKey();
  const assistantPreferences = useAssistantPreferences();
  const cloudConsent = useCloudAiConsent();
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [localAiError, setLocalAiError] = useState<string | null>(null);
  const [customLocalModels, setCustomLocalModels] = useState(loadCustomLocalAiModels);
  const [customModelRepository, setCustomModelRepository] = useState("");
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);

  useEffect(() => {
    if (assistantPreferences.provider !== "local-mlx") return;
    let cancelled = false;
    setLocalAiStatus(null);
    setLocalAiError(null);
    void getLocalAiStatus().then((status) => {
      if (!cancelled) setLocalAiStatus(status);
    }).catch((error: unknown) => {
      if (!cancelled) setLocalAiError(userFacingErrorMessage(error, "Could not check on-device AI."));
    });
    return () => { cancelled = true; };
  }, [assistantPreferences.provider, assistantPreferences.localModel]);

  useEffect(() => {
    if (assistantPreferences.provider !== "local-mlx" || localAiStatus?.state !== "starting") return;
    let cancelled = false;
    const timer = globalThis.setInterval(() => {
      void getLocalAiStatus().then((status) => {
        if (!cancelled) setLocalAiStatus(status);
      }).catch((error: unknown) => {
        if (!cancelled) setLocalAiError(userFacingErrorMessage(error, "Could not check on-device AI."));
      });
    }, 900);
    return () => { cancelled = true; globalThis.clearInterval(timer); };
  }, [assistantPreferences.provider, localAiStatus?.state]);

  const runLocalAiAction = async (action: () => Promise<LocalAiStatus>) => {
    setLocalAiBusy(true);
    setLocalAiError(null);
    try { setLocalAiStatus(await action()); }
    catch (error) { setLocalAiError(userFacingErrorMessage(error, "On-device AI could not start.")); }
    finally { setLocalAiBusy(false); }
  };

  const localPresets = [
    ...(localAiStatus?.presets.length ? localAiStatus.presets : LOCAL_AI_PRESETS),
    ...customLocalModels,
  ];
  const selectedLocalPreset = localPresets.find((preset) => preset.id === assistantPreferences.localModel)
    ?? LOCAL_AI_PRESETS.find((preset) => preset.id === assistantPreferences.localModel)!;

  const turnOnLocalAi = async () => {
    setLocalAiBusy(true);
    setLocalAiError(null);
    try {
      const result = await ensureLocalAi({
        modelId: assistantPreferences.localModel,
        downloaded: selectedLocalPreset.downloaded,
        repository: "custom" in selectedLocalPreset ? selectedLocalPreset.repository : undefined,
        allowDownload: true,
      });
      setLocalAiStatus(result.status);
      if (result.decision.type === "refuse" || result.decision.type === "unavailable") {
        setLocalAiError(result.decision.detail);
      }
    } catch (error) {
      setLocalAiError(userFacingErrorMessage(error, "On-device AI could not start."));
    } finally {
      setLocalAiBusy(false);
    }
  };

  const pathChoice: "on-device" | "cloud" = assistantPreferences.provider === "local-mlx" ? "on-device" : "cloud";
  const localStateLabel = localAiStatus
    ? localAiStatus.state === "ready" ? "Ready"
      : localAiStatus.state === "starting" ? "Loading"
        : localAiStatus.state === "error" ? "Needs attention" : "Off"
    : "Checking";
  const localStatusDetail = studentFacingLocalAiDetail(localAiStatus, undefined, {
    modelId: assistantPreferences.localModel,
    downloading: localAiBusy && !selectedLocalPreset.downloaded,
  });

  return (
    <div className="settings-section">
      <span className="settings-sheet-kicker">Circuit assistant</span>
      <div className="settings-field-grid">
        <div className="settings-field" role="group" aria-label="Assistant path">
          <span>Where should Bode run?</span>
          <div className="settings-path-toggle" role="radiogroup" aria-label="Assistant path">
            <button
              type="button"
              role="radio"
              aria-checked={pathChoice === "on-device"}
              className={`settings-path-btn${pathChoice === "on-device" ? " active" : ""}`}
              onClick={() => saveAssistantPreferences({ ...assistantPreferences, provider: "local-mlx" })}
            >
              On-device
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={pathChoice === "cloud"}
              className={`settings-path-btn${pathChoice === "cloud" ? " active" : ""}`}
              onClick={() => saveAssistantPreferences({
                ...assistantPreferences,
                provider: assistantPreferences.provider === "anthropic" ? "anthropic" : "gemini",
              })}
            >
              Cloud
            </button>
          </div>
          <span className="settings-field-hint">
            {pathChoice === "on-device"
              ? "Stays on this Mac. Tau downloads and loads a small model for you — no account."
              : "Uses a free Gemini key or Anthropic key you provide. Circuit questions leave this Mac only after you consent."}
          </span>
        </div>
        {pathChoice === "on-device" ? (
          <>
            <label className="settings-field" htmlFor="assistant-local-model">
              <span>Model</span>
              <SettingsSelect
                id="assistant-local-model"
                label="On-device model"
                value={assistantPreferences.localModel}
                onValueChange={(next) => saveAssistantPreferences({
                  ...assistantPreferences,
                  localModel: next as LocalAiPresetInfo["id"],
                })}
                items={localPresets.map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                }))}
              />
              <span className="settings-field-hint">
                Start with 1.7B for a quick try (~900 MB). 4B is better for building circuits if you have 8 GB+ memory.
              </span>
            </label>
            <div className="settings-local-runtime" data-state={localAiStatus?.state ?? "checking"}>
              <div className="settings-local-runtime-head">
                <span className="settings-local-state-dot" aria-hidden="true" />
                <strong>On-device AI · {localStateLabel}</strong>
              </div>
              <p role="status">{localStatusDetail}</p>
              {localAiStatus && !selectedLocalPreset.downloaded && localAiStatus.state !== "ready" && (
                <span className="settings-local-download">
                  {selectedLocalPreset.downloadMb > 0
                    ? `Download: ${selectedLocalPreset.downloadMb.toLocaleString("en-US")} MB`
                    : "Download size depends on the imported model."}
                </span>
              )}
              {localAiError && <span className="settings-local-notice" role="status">{localAiError}</span>}
              {localAiStatus && (
                <div className="settings-local-actions">
                  {localAiStatus.state === "ready" || localAiStatus.state === "starting" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={localAiBusy || !localAiStatus.managed}
                      onClick={() => void runLocalAiAction(stopLocalAi)}
                    >
                      Turn off
                    </Button>
                  ) : (
                    <Button size="sm" disabled={localAiBusy} onClick={() => void turnOnLocalAi()}>
                      {localAiBusy
                        ? "Working…"
                        : !localAiStatus.installed
                          ? "Turn on"
                          : selectedLocalPreset.downloaded
                            ? "Turn on"
                            : "Download & turn on"}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <details
              className="settings-advanced"
              open={showAdvancedLocal || customLocalModels.length > 0}
              onToggle={(event) => setShowAdvancedLocal(event.currentTarget.open)}
            >
              <summary>Advanced</summary>
              <div className="settings-field" aria-label="Custom local models">
                <span>Import another model</span>
                <div className="settings-inline-actions">
                  <Input
                    value={customModelRepository}
                    aria-label="Hugging Face model repository"
                    placeholder="owner/model-name"
                    onChange={(event) => setCustomModelRepository(event.currentTarget.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!customModelRepository.trim()}
                    onClick={() => {
                      try {
                        const models = importCustomLocalAiModel(customModelRepository);
                        const imported = models.find((model) => model.repository === customModelRepository.trim());
                        setCustomLocalModels(models);
                        setCustomModelRepository("");
                        if (imported) {
                          saveAssistantPreferences({ provider: "local-mlx", localModel: imported.id });
                        }
                        onNotice("Model imported. Choose Download & turn on to fetch it.");
                      } catch (error) {
                        setLocalAiError(userFacingErrorMessage(error, "Could not import that model."));
                      }
                    }}
                  >
                    Import
                  </Button>
                  {selectedLocalPreset && "custom" in selectedLocalPreset && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!window.confirm(`Remove ${selectedLocalPreset.label} from Tau? Downloaded files stay on disk.`)) return;
                        setCustomLocalModels(removeCustomLocalAiModel(selectedLocalPreset.id));
                        saveAssistantPreferences({ provider: "local-mlx", localModel: "qwen3-4b-4bit" });
                        onNotice("Removed custom model from Tau.");
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <span className="settings-field-hint">
                  Optional. Paste an MLX model name if you already know one — Tau handles the rest.
                </span>
              </div>
            </details>
          </>
        ) : (
          <>
            <label className="settings-field" htmlFor="assistant-cloud-provider">
              <span>Cloud provider</span>
              <SettingsSelect
                id="assistant-cloud-provider"
                label="Cloud provider"
                value={
                  assistantPreferences.provider === "anthropic" ? "anthropic" : "gemini"
                }
                onValueChange={(next) => saveAssistantPreferences({
                  ...assistantPreferences,
                  provider: next as AssistantProviderChoice,
                })}
                items={CLOUD_PROVIDER_ITEMS}
              />
              <span className="settings-field-hint">
                Gemini Flash is free for students (no credit card). Anthropic bills separately from any ChatGPT plan.
              </span>
            </label>
            {assistantPreferences.provider === "gemini" && (
              <label className="settings-field" htmlFor="assistant-gemini-model">
                <span>Gemini model</span>
                <SettingsSelect
                  id="assistant-gemini-model"
                  label="Gemini model"
                  value={assistantPreferences.geminiModel}
                  onValueChange={(next) => saveAssistantPreferences({
                    ...assistantPreferences,
                    geminiModel: next,
                  })}
                  items={Object.entries(GEMINI_MODEL_PRESETS).map(([id, preset]) => ({
                    value: id,
                    label: preset.freeTier ? `${preset.label} (free tier)` : preset.label,
                  }))}
                />
              </label>
            )}
            <label className="settings-consent" htmlFor="assistant-cloud-consent">
              <input
                id="assistant-cloud-consent"
                type="checkbox"
                checked={cloudConsent.consented}
                onChange={(event) => saveCloudAiConsent({ consented: event.currentTarget.checked })}
              />
              <span>
                I understand circuit questions will be sent to{" "}
                {assistantPreferences.provider === "gemini" ? "Google" : "Anthropic"} for AI replies.
              </span>
            </label>
            {assistantPreferences.provider === "gemini" ? (
              <label className="settings-field" htmlFor="assistant-gemini-key">
                <span>Gemini API key</span>
                <Input
                  id="assistant-gemini-key"
                  aria-label="Gemini API key"
                  type="password"
                  variant="mono"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasGeminiKey
                    ? "Key saved in Mac keychain — paste a new key to replace"
                    : "Optional until you chat — AIza…"}
                  value={geminiKeyInput}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setGeminiKeyInput(next);
                    saveGeminiApiKey(next);
                  }}
                />
                <span className="settings-field-hint">
                  Free key at aistudio.google.com/apikey. Stored in your Mac keychain — never held in the renderer for API calls, never in the schematic file.
                </span>
              </label>
            ) : (
              <label className="settings-field" htmlFor="assistant-api-key">
                <span>Anthropic API key</span>
                <Input
                  id="assistant-api-key"
                  aria-label="Anthropic API key"
                  type="password"
                  variant="mono"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasAnthropicKey
                    ? "Key saved in Mac keychain — paste a new key to replace"
                    : "Optional until you chat — sk-ant-…"}
                  value={apiKeyInput}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setApiKeyInput(next);
                    saveAssistantApiKey(next);
                  }}
                />
                <span className="settings-field-hint">
                  Stored in your Mac keychain and attached by Tau's native process — never held in the renderer for API calls. A ChatGPT subscription does not cover this key.
                </span>
              </label>
            )}
            {!cloudConsent.consented && (
              <span className="settings-local-notice" role="status">
                Consent is required before cloud chat can send circuit context.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
