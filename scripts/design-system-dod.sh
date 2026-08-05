#!/usr/bin/env bash
# Prove §10 visual design system full adoption (AGENTS.md).
# Combines the machine drift gate with both-theme screenshot evidence.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/design-system-drift.sh

pnpm -C apps/desktop exec vitest run \
  src/components/ui/instrument-icon-button.test.tsx \
  --reporter=dot

TAU_DESIGN_FORCE_SERVER=1 TAU_DESIGN_PORT="${TAU_DESIGN_PORT:-1470}" \
  node scripts/design-system-dod.mjs

echo "DESIGN-SYSTEM-DOD: ok"
