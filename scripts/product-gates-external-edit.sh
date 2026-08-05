#!/usr/bin/env bash
# Prove safe external-edit / conflict handling (product-gates DoD partial).
# Does NOT claim the full student/pro/dev product-gates box.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/externalEditConflict.test.ts \
  src/components/ExternalEditConflictDialog.test.tsx \
  --reporter=dot
echo "PRODUCT-GATES-EXTERNAL-EDIT: ok"
