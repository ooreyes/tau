#!/usr/bin/env bash
# Prove first-success learning path + contextual help (product-gates DoD partial).
# Does NOT claim the full student/pro/dev product-gates box (CLI/API still open).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/learningPath.test.ts \
  src/components/LearningPathCoach.test.tsx \
  src/components/EmptyState.learningPath.test.tsx \
  --reporter=dot
echo "PRODUCT-GATES-LEARNING-PATH: ok"
