#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

exec pnpm -C apps/desktop exec vitest run \
  --config vitest.corpus.config.ts \
  scripts/circuitTestingV1.corpus.ts
