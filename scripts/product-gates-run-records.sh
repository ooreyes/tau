#!/usr/bin/env bash
# Prove reproducible run records (product-gates DoD partial).
# Does NOT claim the full student/pro/dev product-gates box.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/runRecord.test.ts \
  src/components/SimulationPanel.runRecord.test.tsx \
  --reporter=dot
echo "PRODUCT-GATES-RUN-RECORDS: ok"
