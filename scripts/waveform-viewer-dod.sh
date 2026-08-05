#!/usr/bin/env bash
# AGENTS.md Definition of Done — Waveform viewer proof.
# Runs the consolidated vitest that asserts each required bullet:
#   arbitrary expressions · cursors · FFT/THD · stepped-family overlays · CSV/image export
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SPEC="src/simulation/waveformViewerDod.test.ts"
[[ -f "$ROOT/apps/desktop/$SPEC" ]] || {
  echo "Waveform viewer DoD proof is missing apps/desktop/$SPEC" >&2
  exit 1
}

exec pnpm -C apps/desktop exec vitest run "$SPEC"
