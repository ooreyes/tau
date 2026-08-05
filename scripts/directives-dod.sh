#!/usr/bin/env bash
# AGENTS.md Definition of Done — corpus directives proof.
# Runs the consolidated vitest that asserts each required directive:
#   .tran .ac .op .dc .step .meas .noise .tf .param .func .temp .options
#   .model .inc .subckt
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SPEC="src/simulation/directivesDod.test.ts"
[[ -f "$ROOT/apps/desktop/$SPEC" ]] || {
  echo "Directives DoD proof is missing apps/desktop/$SPEC" >&2
  exit 1
}

exec pnpm -C apps/desktop exec vitest run "$SPEC"
