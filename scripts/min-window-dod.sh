#!/usr/bin/env bash
# Prove UI usability at the app's stated minimum window size (tauri.conf.json
# minWidth × minHeight, currently 900×600). Screenshot proof lands under
# screenshots/min-window-dod/. Does NOT claim §10 design-system full adoption.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/components/ui/primitives.test.tsx \
  src/components/SettingsWorkspaceCopy.test.tsx \
  src/components/ShellPanels.test.tsx \
  --reporter=dot
TAU_DESIGN_FORCE_SERVER=1 TAU_DESIGN_PORT="${TAU_DESIGN_PORT:-1460}" \
  node scripts/min-window-dod.mjs
echo "MIN-WINDOW-DOD: ok"
