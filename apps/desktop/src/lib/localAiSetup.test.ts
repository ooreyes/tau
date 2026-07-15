import { describe, expect, it } from "vitest";
import { shouldOfferLocalAiSetup } from "./localAiSetup";

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
