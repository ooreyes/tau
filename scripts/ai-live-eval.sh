#!/usr/bin/env bash
# Release-gated AI live evaluations (AI DoD partial — not the full box).
#
# Opt-in:  TAU_AI_LIVE_EVAL=1
# Legacy:  TAU_LIVE_MLX=1  (MLX-only; still accepted)
#
# Fail-closed semantics:
#   • Flag unset (default / everyday CI):
#       - Always proves the gate contract unit tests.
#       - Does NOT run live provider smokes.
#       - Prints AI-LIVE-EVAL: refuse (unset) and exits 0 for the contract.
#       - With --require-live (or TAU_AI_LIVE_EVAL_REQUIRE=1 / CI release jobs):
#         exits 1 — release must opt in; never silent-green live claims.
#   • Flag set, no MLX loopback and no cloud BYOK keys:
#       exits 1 (no_backend) — never skip-green as a live pass.
#   • Flag set + MLX and/or keys:
#       runs the matching *.live.test.ts smokes; success prints AI-LIVE-EVAL: ok
#
# Does NOT claim Tau OAuth/backend. Full AI DoD stays unchecked. SHIPPABLE=NO.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REQUIRE_LIVE=0
if [[ "${1:-}" == "--require-live" ]] || [[ "${TAU_AI_LIVE_EVAL_REQUIRE:-}" == "1" ]]; then
  REQUIRE_LIVE=1
fi

echo "==> AI live-eval gate contract (always)"
pnpm -C apps/desktop exec vitest run \
  src/lib/aiLiveEvalGate.test.ts \
  --reporter=dot

FLAG_SET=0
if [[ "${TAU_AI_LIVE_EVAL:-}" == "1" ]] || [[ "${TAU_LIVE_MLX:-}" == "1" ]]; then
  FLAG_SET=1
fi

if [[ "$FLAG_SET" -ne 1 ]]; then
  echo "AI-LIVE-EVAL: refuse (unset) — live smokes not run; set TAU_AI_LIVE_EVAL=1 for release"
  if [[ "$REQUIRE_LIVE" -eq 1 ]]; then
    echo "AI-LIVE-EVAL: fail-closed — --require-live / TAU_AI_LIVE_EVAL_REQUIRE=1 demands opt-in"
    exit 1
  fi
  echo "AI-LIVE-EVAL: contract-ok"
  exit 0
fi

# Probe loopback MLX (Tau's on-device path). Cloud keys come from the env.
MLX_OK=0
if curl -fsS --max-time 2 "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
  MLX_OK=1
fi

HAS_ANTHROPIC=0
if [[ -n "${ANTHROPIC_API_KEY:-}" ]] || [[ -n "${TAU_ASSISTANT_API_KEY:-}" ]]; then
  HAS_ANTHROPIC=1
fi
HAS_GEMINI=0
if [[ -n "${GEMINI_API_KEY:-}" ]] || [[ -n "${TAU_GEMINI_API_KEY:-}" ]]; then
  HAS_GEMINI=1
fi

if [[ "$MLX_OK" -eq 0 && "$HAS_ANTHROPIC" -eq 0 && "$HAS_GEMINI" -eq 0 ]]; then
  echo "AI-LIVE-EVAL: refuse (no_backend) — TAU_AI_LIVE_EVAL=1 but no MLX at :8080 and no cloud BYOK keys"
  exit 1
fi

LIVE_FILES=()
if [[ "$MLX_OK" -eq 1 ]]; then
  echo "==> Live MLX smoke (loopback :8080 reachable)"
  LIVE_FILES+=(src/lib/localMlxAssistant.live.test.ts)
fi
if [[ "$HAS_ANTHROPIC" -eq 1 || "$HAS_GEMINI" -eq 1 ]]; then
  echo "==> Live cloud BYOK smoke (env key present)"
  LIVE_FILES+=(src/lib/cloudAiAssistant.live.test.ts)
fi

# Ensure the live flag is visible to vitest even if only TAU_LIVE_MLX was set.
export TAU_AI_LIVE_EVAL=1

pnpm -C apps/desktop exec vitest run "${LIVE_FILES[@]}" --reporter=dot

echo "AI-LIVE-EVAL: ok"
