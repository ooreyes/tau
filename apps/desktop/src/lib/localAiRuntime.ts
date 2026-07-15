/** Native lifecycle boundary for Tau's optional MLX-LM server.
 *
 * The inference API is fixed to loopback. Renderer code cannot pass an
 * executable, model repository, host, or port to Rust; it selects one of the
 * audited presets and the native command owns the process arguments.
 */

export const LOCAL_AI_ENDPOINT = "http://127.0.0.1:8080/v1";

export type LocalAiState = "stopped" | "starting" | "ready" | "error";

export interface LocalAiPresetInfo {
  id: "qwen3-1.7b-4bit" | "qwen3-4b-4bit";
  repository: string;
  label: string;
  downloadMb: number;
  downloaded: boolean;
}

export interface LocalAiStatus {
  state: LocalAiState;
  endpoint: typeof LOCAL_AI_ENDPOINT;
  managed: boolean;
  installed: boolean;
  modelId: LocalAiPresetInfo["id"] | null;
  modelRepository: string | null;
  detail: string;
  presets: LocalAiPresetInfo[];
}

export const LOCAL_AI_PRESETS: LocalAiPresetInfo[] = [
  {
    id: "qwen3-1.7b-4bit",
    repository: "Qwen/Qwen3-1.7B-MLX-4bit",
    label: "Qwen3 1.7B · 4-bit",
    downloadMb: 914,
    downloaded: false,
  },
  {
    id: "qwen3-4b-4bit",
    repository: "Qwen/Qwen3-4B-MLX-4bit",
    label: "Qwen3 4B · 4-bit",
    downloadMb: 2_300,
    downloaded: false,
  },
];

async function isTauriRuntime(): Promise<boolean> {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return false;
  }
}

export async function isNativeDesktopApp(): Promise<boolean> {
  return isTauriRuntime();
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** Browser/dev fallback can use an already-running MLX server, but it never
 * starts a process or claims to know whether weights are cached. */
async function browserLocalAiStatus(): Promise<LocalAiStatus> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 600);
  try {
    const response = await fetch(`${LOCAL_AI_ENDPOINT}/models`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      state: "ready",
      endpoint: LOCAL_AI_ENDPOINT,
      managed: false,
      installed: true,
      modelId: null,
      modelRepository: null,
      detail: "A loopback inference server is ready.",
      presets: LOCAL_AI_PRESETS,
    };
  } catch {
    return {
      state: "stopped",
      endpoint: LOCAL_AI_ENDPOINT,
      managed: false,
      installed: false,
      modelId: null,
      modelRepository: null,
      detail: "Open Tau desktop to start MLX local inference.",
      presets: LOCAL_AI_PRESETS,
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function getLocalAiStatus(): Promise<LocalAiStatus> {
  return (await isTauriRuntime())
    ? invokeNative<LocalAiStatus>("local_ai_status")
    : browserLocalAiStatus();
}

export async function installLocalAiRuntime(): Promise<LocalAiStatus> {
  if (!(await isTauriRuntime())) {
    throw new Error("Tau desktop is required to install the local MLX runtime.");
  }
  return invokeNative<LocalAiStatus>("install_local_ai_runtime");
}

export async function startLocalAi(
  modelId: LocalAiPresetInfo["id"],
  allowDownload: boolean,
): Promise<LocalAiStatus> {
  if (!(await isTauriRuntime())) {
    throw new Error("Tau desktop is required to start the local MLX server.");
  }
  return invokeNative<LocalAiStatus>("start_local_ai", { modelId, allowDownload });
}

export async function stopLocalAi(): Promise<LocalAiStatus> {
  if (!(await isTauriRuntime())) {
    throw new Error("Tau desktop is required to stop the managed local MLX server.");
  }
  return invokeNative<LocalAiStatus>("stop_local_ai");
}
