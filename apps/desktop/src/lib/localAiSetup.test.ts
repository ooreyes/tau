import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissLocalAiSetup,
  loadLocalAiSetupPreferences,
  resetLocalAiSetup,
  shouldOfferLocalAiSetup,
} from "./localAiSetup";

describe("shouldOfferLocalAiSetup", () => {
  it("offers setup only in the native app before the user dismisses or reaches ready", () => {
    expect(shouldOfferLocalAiSetup({
      isNative: false,
      dismissed: false,
      status: { state: "stopped", installed: false },
    })).toBe(false);
    expect(shouldOfferLocalAiSetup({
      isNative: true,
      dismissed: true,
      status: { state: "stopped", installed: false },
    })).toBe(false);
    expect(shouldOfferLocalAiSetup({
      isNative: true,
      dismissed: false,
      status: { state: "ready", installed: true },
    })).toBe(false);
    expect(shouldOfferLocalAiSetup({
      isNative: true,
      dismissed: false,
      status: null,
    })).toBe(true);
    expect(shouldOfferLocalAiSetup({
      isNative: true,
      dismissed: false,
      status: { state: "stopped", installed: false },
    })).toBe(true);
  });
});

describe("resetLocalAiSetup", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  it("clears the dismissal and notifies listeners so onboarding can re-offer", () => {
    dismissLocalAiSetup();
    expect(loadLocalAiSetupPreferences()).toEqual({ dismissed: true });

    const dispatch = window.dispatchEvent as ReturnType<typeof vi.fn>;
    dispatch.mockClear();
    resetLocalAiSetup();

    expect(loadLocalAiSetupPreferences()).toEqual({ dismissed: false });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "tau:local-ai-setup-changed" }));
  });
});
