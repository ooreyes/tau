#!/usr/bin/env bash
# Prove crash-safe unsaved recovery (product-gates DoD partial).
# Does NOT claim the full student/pro/dev product-gates box.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/unsavedRecovery.test.ts \
  src/components/UnsavedRecoveryDialog.test.tsx \
  --reporter=dot
echo "PRODUCT-GATES-UNSAVED-RECOVERY: ok"
