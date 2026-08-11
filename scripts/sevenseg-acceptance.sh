#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [path/to/Tau.app]" >&2
  exit 64
fi

node scripts/generate-sevenseg-fixtures.mjs --check
pnpm -C apps/desktop exec vitest run src/simulation/sevenSegmentAcceptance.test.ts --reporter=dot

packaged_app="${1:-${TAU_PACKAGED_APP:-$repo_root/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app}}"
if [[ ! -d "$packaged_app" ]]; then
  echo "SEVEN-SEG-PACKAGED: missing $packaged_app" >&2
  exit 1
fi
packaged_executable="$packaged_app/Contents/MacOS/Tau"
packaged_library="$packaged_app/Contents/Resources/ngspice/lib/libngspice.dylib"
if [[ ! -x "$packaged_executable" || ! -f "$packaged_library" ]]; then
  echo "SEVEN-SEG-PACKAGED-WORKER: missing executable or bundled ngspice library under $packaged_app" >&2
  exit 1
fi
python3 scripts/packaged-engine-smoke.py "$packaged_executable" "$packaged_library"
echo "SEVEN-SEG-FIXTURE-DECK-PREVIEW: 12/12 fixture imports, deck guards, and preview decodes passed"
echo "SEVEN-SEG-PACKAGED-WORKER: packaged Tau worker smoke passed; seven-segment import/simulate screenshots are recorded separately by Computer Use"
