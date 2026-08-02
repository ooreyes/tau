#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

specs=(
  "scripts/classdEfficiency.corpus.ts"
  "scripts/waveformParity.corpus.ts"
)

for spec in "${specs[@]}"; do
  [[ -f "$ROOT/apps/desktop/$spec" ]] || {
    echo "DoD parity proof is missing apps/desktop/$spec" >&2
    exit 1
  }
done

exec pnpm -C apps/desktop exec vitest run \
  --config vitest.corpus.config.ts \
  "${specs[@]}"
