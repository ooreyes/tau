#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

node scripts/generate-sevenseg-fixtures.mjs --check
pnpm -C apps/desktop exec vitest run src/simulation/sevenSegmentAcceptance.test.ts --reporter=dot

packaged_app="${TAU_PACKAGED_APP:-$repo_root/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app}"
if [[ ! -d "$packaged_app" ]]; then
  echo "SEVEN-SEG-PACKAGED: missing $packaged_app" >&2
  exit 1
fi
echo "SEVEN-SEG-PACKAGED: fixtures verified against Tau engine; packaged app present at $packaged_app"
