#!/usr/bin/env bash
# Prove the full AI DoD box (AGENTS.md) via native BYOK — not Tau OAuth.
#
# Satisfies: supported cloud path (Anthropic/Gemini BYOK with separate API
# billing OR on-device MLX) · credentials out of renderer · explicit cloud
# consent · bounded circuit tools · packaged ngspice before apply ·
# release-gated live evals · no ChatGPT cookie reuse / no ChatGPT-sub billing
# implication.
#
# Tau OAuth/backend is an alternate path in the DoD wording, not a missing
# requirement when BYOK is present. Never invent OAuth here.
#
# SHIPPABLE remains NO until every other AGENTS.md DoD box is checked.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/ai-consent.sh
bash scripts/ai-credentials-out-of-renderer.sh
bash scripts/ai-ngspice-before-apply.sh
bash scripts/ai-live-eval.sh

echo "AI-DOD: ok (BYOK path; Tau OAuth not required / not faked)"
echo "SHIPPABLE? NO — other DoD boxes remain open"
