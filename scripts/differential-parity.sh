#!/usr/bin/env bash
# Authored-analysis differential parity vs installed LTspice.
# Stdout of the vitest corpus run (coverage matrix) is the source of truth.
# This does NOT close the AGENTS.md DoD "broad differential parity" box by
# itself — it advances it with a re-runnable harness and proven cells.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SPEC="scripts/differentialParity.corpus.ts"
[[ -f "$ROOT/apps/desktop/$SPEC" ]] || {
  echo "differential parity proof is missing apps/desktop/$SPEC" >&2
  exit 1
}

exec pnpm -C apps/desktop exec vitest run \
  --config vitest.corpus.config.ts \
  "$SPEC"
