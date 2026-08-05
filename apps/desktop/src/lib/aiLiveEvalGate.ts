/**
 * Release-gated AI live-eval decision helper.
 *
 * Live provider smokes (real MLX loopback or cloud BYOK) must never green-pass
 * in default CI. Opt in with TAU_AI_LIVE_EVAL=1. When the flag is set but no
 * backend is available, callers must fail closed — never skip-green.
 *
 * Encodes the release gate for live evaluations (AI DoD bullet). Full box
 * proof is scripts/ai-dod.sh via native BYOK — Tau OAuth is not required.
 */

export const TAU_AI_LIVE_EVAL_ENV = "TAU_AI_LIVE_EVAL";

/** Legacy MLX-only opt-in still honored so existing docs/scripts keep working. */
export const TAU_LIVE_MLX_ENV = "TAU_LIVE_MLX";

export type AiLiveEvalBackend = "mlx" | "anthropic" | "gemini";

export type AiLiveEvalDecision =
  | { status: "refuse"; reason: "flag_unset" }
  | { status: "refuse"; reason: "no_backend" }
  | { status: "run"; backends: readonly AiLiveEvalBackend[] };

export interface AiLiveEvalEnv {
  readonly [key: string]: string | undefined;
}

export interface AiLiveEvalProbe {
  /** True when loopback mlx_lm.server answers /v1/models. */
  readonly mlxReachable: boolean;
}

export function isAiLiveEvalFlagSet(env: AiLiveEvalEnv = process.env): boolean {
  return env[TAU_AI_LIVE_EVAL_ENV] === "1" || env[TAU_LIVE_MLX_ENV] === "1";
}

export function detectAiLiveEvalBackends(
  env: AiLiveEvalEnv = process.env,
  probe: AiLiveEvalProbe = { mlxReachable: false },
): AiLiveEvalBackend[] {
  const backends: AiLiveEvalBackend[] = [];
  if (probe.mlxReachable) backends.push("mlx");
  if (nonEmpty(env.ANTHROPIC_API_KEY) || nonEmpty(env.TAU_ASSISTANT_API_KEY)) {
    backends.push("anthropic");
  }
  if (nonEmpty(env.GEMINI_API_KEY) || nonEmpty(env.TAU_GEMINI_API_KEY)) {
    backends.push("gemini");
  }
  return backends;
}

/**
 * Fail-closed gate:
 * - flag unset → refuse (live smokes must not run / must not claim pass)
 * - flag set, no backend → refuse (caller exits non-zero; never skip-green)
 * - flag set + ≥1 backend → run
 */
export function decideAiLiveEval(
  env: AiLiveEvalEnv = process.env,
  probe: AiLiveEvalProbe = { mlxReachable: false },
): AiLiveEvalDecision {
  if (!isAiLiveEvalFlagSet(env)) {
    return { status: "refuse", reason: "flag_unset" };
  }
  const backends = detectAiLiveEvalBackends(env, probe);
  if (backends.length === 0) {
    return { status: "refuse", reason: "no_backend" };
  }
  return { status: "run", backends };
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
