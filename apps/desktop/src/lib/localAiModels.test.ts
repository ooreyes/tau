// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  importCustomLocalAiModel,
  loadCustomLocalAiModels,
  removeCustomLocalAiModel,
  validHuggingFaceRepository,
} from "./localAiModels";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  },
});

describe("custom local AI model registry", () => {
  beforeEach(() => localStorage.clear());

  it("imports and removes a validated MLX repository persistently", () => {
    const imported = importCustomLocalAiModel("mlx-community/Circuit-Qwen-4bit");
    expect(imported).toEqual([expect.objectContaining({
      id: "custom:mlx-community/Circuit-Qwen-4bit",
      repository: "mlx-community/Circuit-Qwen-4bit",
      custom: true,
    })]);
    expect(loadCustomLocalAiModels()).toHaveLength(1);
    expect(removeCustomLocalAiModel(imported[0].id)).toEqual([]);
    expect(loadCustomLocalAiModels()).toEqual([]);
  });

  it("rejects shell syntax, paths, and malformed repository names", () => {
    expect(validHuggingFaceRepository("owner/model-name")).toBe(true);
    for (const invalid of ["../model", "owner/model/extra", "owner;touch/model", "/absolute", "owner model/name"]) {
      expect(validHuggingFaceRepository(invalid)).toBe(false);
      expect(() => importCustomLocalAiModel(invalid)).toThrow(/Hugging Face MLX repository/);
    }
  });
});
