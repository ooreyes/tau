import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  decideLocalAiEnsure,
  ensureLocalAi,
  studentFacingLocalAiDetail,
} from "./localAiEnsure";
import type { LocalAiStatus } from "./localAiRuntime";

const runtime = vi.hoisted(() => ({
  isNative: vi.fn(),
  getStatus: vi.fn(),
  start: vi.fn(),
  install: vi.fn(),
}));

vi.mock("./localAiRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./localAiRuntime")>()),
  isNativeDesktopApp: runtime.isNative,
  getLocalAiStatus: runtime.getStatus,
  startLocalAi: runtime.start,
  installLocalAiRuntime: runtime.install,
}));

function status(overrides: Partial<LocalAiStatus> = {}): LocalAiStatus {
  return {
    state: "stopped",
    endpoint: "http://127.0.0.1:8080/v1",
    managed: false,
    installed: true,
    modelId: null,
    modelRepository: null,
    detail: "MLX LM is installed. Choose a model to start local inference.",
    presets: [
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
    ],
    ...overrides,
  };
}

beforeEach(() => {
  runtime.isNative.mockReset();
  runtime.getStatus.mockReset();
  runtime.start.mockReset();
  runtime.install.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("decideLocalAiEnsure", () => {
  it("refuses the browser path without inventing a local server", () => {
    expect(decideLocalAiEnsure({
      isNative: false,
      status: status({ installed: false }),
      modelId: "qwen3-1.7b-4bit",
      downloaded: false,
    })).toEqual({
      type: "unavailable",
      detail: expect.stringMatching(/Tau Mac app/i),
    });
  });

  it("installs when the runtime is missing, then starts with download when stopped", () => {
    expect(decideLocalAiEnsure({
      isNative: true,
      status: status({ installed: false }),
      modelId: "qwen3-1.7b-4bit",
      downloaded: false,
    })).toEqual({ type: "install" });

    expect(decideLocalAiEnsure({
      isNative: true,
      status: status({ installed: true, state: "stopped" }),
      modelId: "qwen3-1.7b-4bit",
      downloaded: false,
    })).toEqual({
      type: "start",
      allowDownload: true,
      modelId: "qwen3-1.7b-4bit",
      repository: undefined,
    });

    expect(decideLocalAiEnsure({
      isNative: true,
      status: status({ installed: true, state: "stopped" }),
      modelId: "qwen3-4b-4bit",
      downloaded: true,
    })).toEqual({
      type: "start",
      allowDownload: false,
      modelId: "qwen3-4b-4bit",
      repository: undefined,
    });
  });

  it("waits while starting and reports ready only for managed ready", () => {
    expect(decideLocalAiEnsure({
      isNative: true,
      status: status({ state: "starting", managed: true }),
      modelId: "qwen3-4b-4bit",
      downloaded: true,
    })).toEqual({ type: "wait", phase: "starting" });

    expect(decideLocalAiEnsure({
      isNative: true,
      status: status({ state: "ready", managed: true }),
      modelId: "qwen3-4b-4bit",
      downloaded: true,
    })).toEqual({ type: "ready" });
  });

  it("refuses an unmanaged listener instead of sending circuit context", () => {
    const decision = decideLocalAiEnsure({
      isNative: true,
      status: status({
        state: "error",
        managed: false,
        installed: true,
        detail: "Port 8080 is occupied by a local server Tau did not start.",
      }),
      modelId: "qwen3-4b-4bit",
      downloaded: true,
    });
    expect(decision.type).toBe("refuse");
    if (decision.type === "refuse") {
      expect(decision.detail).not.toMatch(/8080|127\.0\.0\.1|localhost/i);
      expect(decision.detail).toMatch(/blocking on-device AI/i);
    }
  });
});

describe("studentFacingLocalAiDetail", () => {
  it("never surfaces ports or uv install commands", () => {
    const detail = studentFacingLocalAiDetail(status({
      state: "error",
      detail: "MLX LM is not installed. Run `uv tool install mlx-lm` or open Settings.",
    }));
    expect(detail).not.toMatch(/uv tool|8080|127\.0\.0\.1|localhost/i);
    expect(detail).toMatch(/On-device AI|Tau/i);
  });
});

describe("ensureLocalAi", () => {
  it("installs then downloads and starts in one call", async () => {
    runtime.isNative.mockResolvedValue(true);
    runtime.getStatus.mockResolvedValue(status({ installed: false }));
    runtime.install.mockResolvedValue(status({ installed: true, state: "stopped" }));
    runtime.start.mockResolvedValue(status({ state: "starting", managed: true, installed: true }));

    const result = await ensureLocalAi({
      modelId: "qwen3-1.7b-4bit",
      downloaded: false,
    });

    expect(runtime.install).toHaveBeenCalledTimes(1);
    expect(runtime.start).toHaveBeenCalledWith("qwen3-1.7b-4bit", true, undefined);
    expect(result.acted).toBe(true);
    expect(result.status.state).toBe("starting");
  });

  it("refuses download when allowDownload is false and weights are missing", async () => {
    runtime.isNative.mockResolvedValue(true);
    runtime.getStatus.mockResolvedValue(status({ installed: true, state: "stopped" }));

    const result = await ensureLocalAi({
      modelId: "qwen3-4b-4bit",
      downloaded: false,
      allowDownload: false,
    });

    expect(runtime.start).not.toHaveBeenCalled();
    expect(result.decision.type).toBe("refuse");
    expect(result.acted).toBe(false);
  });

  it("does not start when the browser path is unavailable", async () => {
    runtime.isNative.mockResolvedValue(false);
    runtime.getStatus.mockResolvedValue(status({ installed: false }));

    const result = await ensureLocalAi({
      modelId: "qwen3-1.7b-4bit",
      downloaded: false,
    });

    expect(runtime.install).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(result.decision.type).toBe("unavailable");
  });
});
