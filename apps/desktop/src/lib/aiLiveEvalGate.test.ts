import { describe, expect, it } from "vitest";
import {
  decideAiLiveEval,
  detectAiLiveEvalBackends,
  isAiLiveEvalFlagSet,
  TAU_AI_LIVE_EVAL_ENV,
  TAU_LIVE_MLX_ENV,
} from "./aiLiveEvalGate";

describe("aiLiveEvalGate (release-gated live evals)", () => {
  it("treats the live-eval flag as unset by default (fail-closed)", () => {
    expect(isAiLiveEvalFlagSet({})).toBe(false);
    expect(isAiLiveEvalFlagSet({ [TAU_AI_LIVE_EVAL_ENV]: "0" })).toBe(false);
    expect(isAiLiveEvalFlagSet({ [TAU_AI_LIVE_EVAL_ENV]: "" })).toBe(false);
  });

  it("opts in only when TAU_AI_LIVE_EVAL=1 (or legacy TAU_LIVE_MLX=1)", () => {
    expect(isAiLiveEvalFlagSet({ [TAU_AI_LIVE_EVAL_ENV]: "1" })).toBe(true);
    expect(isAiLiveEvalFlagSet({ [TAU_LIVE_MLX_ENV]: "1" })).toBe(true);
    expect(isAiLiveEvalFlagSet({ [TAU_AI_LIVE_EVAL_ENV]: "true" })).toBe(false);
  });

  it("refuses live execution when the flag is unset — never skip-green as pass", () => {
    const decision = decideAiLiveEval(
      {},
      { mlxReachable: true },
    );
    expect(decision).toEqual({ status: "refuse", reason: "flag_unset" });
  });

  it("fail-closes when opted in but no MLX and no cloud keys are present", () => {
    const decision = decideAiLiveEval(
      { [TAU_AI_LIVE_EVAL_ENV]: "1" },
      { mlxReachable: false },
    );
    expect(decision).toEqual({ status: "refuse", reason: "no_backend" });
  });

  it("allows MLX when the flag is set and loopback is reachable", () => {
    const decision = decideAiLiveEval(
      { [TAU_AI_LIVE_EVAL_ENV]: "1" },
      { mlxReachable: true },
    );
    expect(decision).toEqual({ status: "run", backends: ["mlx"] });
  });

  it("detects Anthropic / Gemini BYOK env keys without inventing a Tau OAuth path", () => {
    expect(
      detectAiLiveEvalBackends(
        { ANTHROPIC_API_KEY: "sk-test" },
        { mlxReachable: false },
      ),
    ).toEqual(["anthropic"]);
    expect(
      detectAiLiveEvalBackends(
        { GEMINI_API_KEY: "gem-test" },
        { mlxReachable: false },
      ),
    ).toEqual(["gemini"]);
    expect(
      detectAiLiveEvalBackends(
        {
          [TAU_AI_LIVE_EVAL_ENV]: "1",
          ANTHROPIC_API_KEY: "sk-test",
          GEMINI_API_KEY: "gem-test",
        },
        { mlxReachable: true },
      ),
    ).toEqual(["mlx", "anthropic", "gemini"]);
  });

  it("runs when opted in via legacy TAU_LIVE_MLX with a reachable server", () => {
    expect(
      decideAiLiveEval({ [TAU_LIVE_MLX_ENV]: "1" }, { mlxReachable: true }),
    ).toEqual({ status: "run", backends: ["mlx"] });
  });
});
