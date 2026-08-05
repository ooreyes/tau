/**
 * Settings → Circuit assistant. Owns on-device ensure→download→load and cloud
 * consent / BYOK fields. ShellPanels should render this section rather than
 * inlining AI chrome (CEO wiring patch if not yet swapped).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { userFacingErrorMessage } from "../lib/errorMessage";
import { loadAssistantApiKey, saveAssistantApiKey, useAssistantApiKey } from "../lib/assistant";
import { loadGeminiApiKey, saveGeminiApiKey, useGeminiApiKey } from "../lib/providerApiKey";
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

export function SettingsAiSection({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const storedApiKey = useAssistantApiKey();
  const [apiKeyInput, setApiKeyInput] = useState(loadAssistantApiKey);
  const [geminiKeyInput, setGeminiKeyInput] = useState(loadGeminiApiKey);
  const hydratedGeminiKey = useGeminiApiKey();
  useEffect(() => {
    setGeminiKeyInput((current) => (current ? current : hydratedGeminiKey));
  }, [hydratedGeminiKey]);
  const assistantPreferences = useAssistantPreferences();
  const cloudConsent = useCloudAiConsent();
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [localAiError, setLocalAiError] = useState<string | null>(null);
  const [customLocalModels, setCustomLocalModels] = useState(loadCustomLocalAiModels);
  const [customModelRepository, setCustomModelRepository] = useState("");
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);

  useEffect(() => setApiKeyInput(storedApiKey), [storedApiKey]);

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
              <select
                id="assistant-local-model"
                className="settings-select"
                aria-label="On-device model"
                value={assistantPreferences.localModel}
                onChange={(event) => saveAssistantPreferences({
                  ...assistantPreferences,
                  localModel: event.currentTarget.value as LocalAiPresetInfo["id"],
                })}
              >
                {localPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
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
              <select
                id="assistant-cloud-provider"
                className="settings-select"
                aria-label="Cloud provider"
                value={assistantPreferences.provider}
                onChange={(event) => saveAssistantPreferences({
                  ...assistantPreferences,
                  provider: event.currentTarget.value as AssistantProviderChoice,
                })}
              >
                <option value="gemini">Gemini · free tier</option>
                <option value="anthropic">Anthropic · your API key</option>
              </select>
              <span className="settings-field-hint">
                Gemini Flash is free for students (no credit card). Anthropic bills separately from any ChatGPT plan.
              </span>
            </label>
            {assistantPreferences.provider === "gemini" && (
              <label className="settings-field" htmlFor="assistant-gemini-model">
                <span>Gemini model</span>
                <select
                  id="assistant-gemini-model"
                  className="settings-select"
                  aria-label="Gemini model"
                  value={assistantPreferences.geminiModel}
                  onChange={(event) => saveAssistantPreferences({
                    ...assistantPreferences,
                    geminiModel: event.currentTarget.value,
                  })}
                >
                  {Object.entries(GEMINI_MODEL_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.freeTier ? `${preset.label} (free tier)` : preset.label}
                    </option>
                  ))}
                </select>
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
                  placeholder="Optional until you chat — AIza…"
                  value={geminiKeyInput}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setGeminiKeyInput(next);
                    saveGeminiApiKey(next);
                  }}
                />
                <span className="settings-field-hint">
                  Free key at aistudio.google.com/apikey. Stored in your Mac keychain — never in the schematic file.
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
                  placeholder="Optional until you chat — sk-ant-…"
                  value={apiKeyInput}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setApiKeyInput(next);
                    saveAssistantApiKey(next);
                  }}
                />
                <span className="settings-field-hint">
                  Stored in your Mac keychain. A ChatGPT subscription does not cover this key.
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
