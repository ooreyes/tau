/**
 * Student-path local AI ensure: install → download → load, owned by Tau.
 * Pure decisions stay free of port/endpoint language so Settings and chat
 * never ask a freshman to start a server.
 */
import {
  getLocalAiStatus,
  installLocalAiRuntime,
  isNativeDesktopApp,
  startLocalAi,
  type LocalAiStatus,
} from "./localAiRuntime";

export type LocalAiEnsureAction =
  | { type: "ready" }
  | { type: "wait"; phase: "checking" | "starting" | "installing" | "downloading" }
  | { type: "install" }
  | { type: "start"; allowDownload: boolean; modelId: string; repository?: string }
  | { type: "refuse"; detail: string }
  | { type: "unavailable"; detail: string };

export interface LocalAiEnsureInput {
  isNative: boolean;
  status: LocalAiStatus | null;
  modelId: string;
  downloaded: boolean;
  repository?: string;
  /** True while an ensure step is already in flight. */
  busy?: boolean;
}

const UNMANAGED_DETAIL =
  "Another app is blocking on-device AI. Quit other local AI tools, then try again in Tau.";
const DESKTOP_ONLY_DETAIL =
  "Open the Tau Mac app to use on-device AI. No account or API key needed.";

function looksUnmanaged(status: LocalAiStatus): boolean {
  if (status.state === "ready" && !status.managed) return true;
  if (status.state !== "error") return false;
  if (!status.managed && status.installed) return true;
  const detail = status.detail.toLowerCase();
  return detail.includes("did not start") || detail.includes("port 8080") || detail.includes("unowned");
}

/** Pure next-step for the student ensure path. */
export function decideLocalAiEnsure(input: LocalAiEnsureInput): LocalAiEnsureAction {
  if (!input.isNative) {
    return { type: "unavailable", detail: DESKTOP_ONLY_DETAIL };
  }
  if (input.busy) {
    return { type: "wait", phase: "checking" };
  }
  if (!input.status) {
    return { type: "wait", phase: "checking" };
  }
  if (looksUnmanaged(input.status)) {
    return { type: "refuse", detail: UNMANAGED_DETAIL };
  }
  if (input.status.state === "ready" && input.status.managed) {
    return { type: "ready" };
  }
  if (input.status.state === "starting") {
    return { type: "wait", phase: "starting" };
  }
  if (!input.status.installed) {
    // Browser fallback reports stopped + not installed without being native;
    // that case is already handled by isNative above.
    return { type: "install" };
  }
  if (input.status.state === "stopped" || input.status.state === "error") {
    return {
      type: "start",
      allowDownload: !input.downloaded,
      modelId: input.modelId,
      repository: input.repository,
    };
  }
  return { type: "wait", phase: "checking" };
}

/** Student-facing status line — never mentions localhost, ports, or uv. */
export function studentFacingLocalAiDetail(
  status: LocalAiStatus | null,
  decision?: LocalAiEnsureAction,
  options?: { modelId?: string; downloading?: boolean },
): string {
  if (decision?.type === "refuse" || decision?.type === "unavailable") {
    return decision.detail;
  }
  if (decision?.type === "start" && decision.allowDownload) {
    const mb = status?.presets.find((preset) => preset.id === decision.modelId)?.downloadMb;
    return mb && mb > 0
      ? `Downloading on-device model (~${mb.toLocaleString("en-US")} MB)…`
      : "Downloading on-device model…";
  }
  if (!status) return "Checking on-device AI…";
  if (status.state === "ready" && status.managed) return "On-device AI is ready.";
  if (status.state === "starting") return "Loading on-device AI…";
  if (looksUnmanaged(status)) return UNMANAGED_DETAIL;
  if (!status.installed) return "Tau will set up on-device AI on this Mac.";
  if (options?.downloading) {
    const preset = status.presets.find((entry) => entry.id === options.modelId);
    return preset && preset.downloadMb > 0
      ? `Downloading on-device model (~${preset.downloadMb.toLocaleString("en-US")} MB)…`
      : "Downloading on-device model…";
  }
  if (status.state === "error") {
    return status.detail
      .replace(/127\.0\.0\.1(?::\d+)?/gi, "on-device AI")
      .replace(/port \d+/gi, "on-device AI")
      .replace(/`?uv tool install mlx-lm`?/gi, "Tau's installer")
      .replace(/MLX LM/g, "On-device AI")
      .replace(/mlx_lm\.server/gi, "on-device AI");
  }
  if (status.state === "stopped") return "On-device AI is ready to start.";
  return "Starting on-device AI…";
}

export function studentFacingEnsurePhase(decision: LocalAiEnsureAction): string {
  switch (decision.type) {
    case "ready":
      return "Ready";
    case "install":
      return "Setting up…";
    case "start":
      return decision.allowDownload ? "Downloading…" : "Starting…";
    case "wait":
      return decision.phase === "starting"
        ? "Loading…"
        : decision.phase === "installing"
          ? "Setting up…"
          : decision.phase === "downloading"
            ? "Downloading…"
            : "Checking…";
    case "refuse":
      return "Blocked";
    case "unavailable":
      return "Unavailable";
    default:
      return "Checking…";
  }
}

export interface EnsureLocalAiResult {
  status: LocalAiStatus;
  decision: LocalAiEnsureAction;
  /** True when this call performed install and/or start. */
  acted: boolean;
}

/**
 * One vertical ensure step: install runtime if missing, then download+start
 * the selected model. Callers poll while status is "starting".
 */
export async function ensureLocalAi(options: {
  modelId: string;
  downloaded: boolean;
  repository?: string;
  /** When false, refuse to start a missing model instead of downloading. */
  allowDownload?: boolean;
}): Promise<EnsureLocalAiResult> {
  const isNative = await isNativeDesktopApp();
  let status = await getLocalAiStatus();
  let decision = decideLocalAiEnsure({
    isNative,
    status,
    modelId: options.modelId,
    downloaded: options.downloaded,
    repository: options.repository,
  });

  if (decision.type === "refuse" || decision.type === "unavailable" || decision.type === "ready" || decision.type === "wait") {
    return { status, decision, acted: false };
  }

  let acted = false;
  if (decision.type === "install") {
    status = await installLocalAiRuntime();
    acted = true;
    decision = decideLocalAiEnsure({
      isNative: true,
      status,
      modelId: options.modelId,
      downloaded: options.downloaded,
      repository: options.repository,
    });
  }

  if (decision.type === "start") {
    const allowDownload = options.allowDownload ?? decision.allowDownload;
    if (!allowDownload && !options.downloaded) {
      return {
        status,
        decision: {
          type: "refuse",
          detail: "On-device model is not downloaded yet. Choose Use on-device AI to download it.",
        },
        acted,
      };
    }
    status = await startLocalAi(decision.modelId, allowDownload, decision.repository);
    acted = true;
    decision = decideLocalAiEnsure({
      isNative: true,
      status,
      modelId: options.modelId,
      downloaded: options.downloaded || allowDownload,
      repository: options.repository,
    });
  }

  return { status, decision, acted };
}
