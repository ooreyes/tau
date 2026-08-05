#!/usr/bin/env bash
# Prove AI proposal Create/Apply is gated by packaged-ngspice validation
# (fail-closed). Does not claim the full AI DoD box — only this bullet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/assistantNgspiceValidate.test.ts \
  src/components/AssistantPanel.test.tsx \
  --reporter=dot
echo "AI-NGSPICE-BEFORE-APPLY: ok"
