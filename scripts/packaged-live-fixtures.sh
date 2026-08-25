#!/usr/bin/env bash
# Contract gate for the two user-openable packaged Live fixtures.
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm -C apps/desktop exec vitest run --config vitest.corpus.config.ts scripts/packagedLiveFixtures.corpus.ts "$@"
