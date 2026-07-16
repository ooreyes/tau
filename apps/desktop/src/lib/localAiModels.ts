import type { LocalAiPresetInfo } from "./localAiRuntime";

const STORAGE_KEY = "tau.local-ai.custom-models.v1";
const CHANGE_EVENT = "tau:local-ai-models-changed";

export interface CustomLocalAiModel extends LocalAiPresetInfo {
  custom: true;
}

export function validHuggingFaceRepository(repository: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(repository.trim());
}

export function loadCustomLocalAiModels(): CustomLocalAiModel[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const repository = String((entry as { repository?: unknown }).repository ?? "").trim();
      if (!validHuggingFaceRepository(repository)) return [];
      return [{
        id: `custom:${repository}`,
        repository,
        label: repository.split("/")[1],
        downloadMb: 0,
        downloaded: false,
        custom: true as const,
      }];
    });
  } catch {
    return [];
  }
}

function persist(models: CustomLocalAiModel[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models.map(({ repository }) => ({ repository }))));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function importCustomLocalAiModel(repository: string): CustomLocalAiModel[] {
  const normalized = repository.trim();
  if (!validHuggingFaceRepository(normalized)) {
    throw new Error("Enter a Hugging Face MLX repository as owner/model-name.");
  }
  const current = loadCustomLocalAiModels();
  if (current.some((model) => model.repository === normalized)) return current;
  const next = [...current, {
    id: `custom:${normalized}`,
    repository: normalized,
    label: normalized.split("/")[1],
    downloadMb: 0,
    downloaded: false,
    custom: true as const,
  }];
  persist(next);
  return next;
}

export function removeCustomLocalAiModel(id: string): CustomLocalAiModel[] {
  const next = loadCustomLocalAiModels().filter((model) => model.id !== id);
  persist(next);
  return next;
}

export const LOCAL_AI_MODELS_CHANGE_EVENT = CHANGE_EVENT;
