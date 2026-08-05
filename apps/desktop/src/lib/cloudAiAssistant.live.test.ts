/**
 * Opt-in cloud BYOK live smoke. Gated by TAU_AI_LIVE_EVAL=1 plus a real
 * Anthropic or Gemini API key in the environment. Default CI never runs this.
 * This is native BYOK billing — not Tau OAuth (still incomplete / not faked).
 *
 *   TAU_AI_LIVE_EVAL=1 ANTHROPIC_API_KEY=… pnpm -C apps/desktop vitest run \
 *     src/lib/cloudAiAssistant.live.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAiLiveEval } from "./aiLiveEvalGate";
import { saveCloudAiConsent } from "./cloudAiConsent";
import { GeminiAssistant } from "./geminiAssistant";

const decision = decideAiLiveEval(process.env, { mlxReachable: false });
const liveCloud =
  decision.status === "run"
  && (decision.backends.includes("anthropic") || decision.backends.includes("gemini"));

describe.runIf(liveCloud)("cloud AI assistant (live BYOK)", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    saveCloudAiConsent({ consented: true });
  });

  it.runIf(decision.status === "run" && decision.backends.includes("gemini"))(
    "Gemini returns a non-empty prose reply for a trivial circuit question",
    { timeout: 120_000 },
    async () => {
      const key = process.env.GEMINI_API_KEY ?? process.env.TAU_GEMINI_API_KEY ?? "";
      const assistant = new GeminiAssistant({ apiKey: key });
      const reply = await assistant.complete({
        contextText: "The schematic is empty. No simulation has been run.",
        history: [{
          role: "user",
          content: "In one short sentence, what is a voltage divider?",
        }],
        allowCurrentApply: false,
      });
      expect(reply.actions).toHaveLength(0);
      expect(reply.text.trim().length).toBeGreaterThan(10);
    },
  );

  it.runIf(decision.status === "run" && decision.backends.includes("anthropic"))(
    "Anthropic env key is present for live BYOK (smoke reserved for native path)",
    () => {
      // Anthropic live round-trip goes through Tauri cloud_ai_proxy in the
      // packaged app; vitest here only proves the release gate saw a key so
      // release CI cannot claim "live" without credentials.
      const key = process.env.ANTHROPIC_API_KEY ?? process.env.TAU_ASSISTANT_API_KEY ?? "";
      expect(key.trim().length).toBeGreaterThan(0);
    },
  );
});
